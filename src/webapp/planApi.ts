// Plan view + editor for the Mini App (roadmap P5). GET returns a user's plan (own, or a
// trainer's client via ?clientId=); POST applies one edit op (weight / sets / delete / move /
// swap / add), mirroring the bot's day editor. All writes go through updateActivePlanSplit, so
// the client and the bot editor stay in sync. Same initData auth as every other webapp API.
import {
  getActivePlan,
  getCatalogExercise,
  getClientForTrainer,
  getExerciseTranslation,
  getExerciseVideos,
  getUserVideos,
  updateActivePlanSplit,
} from "../db/repos";
import { exerciseMetric, resolveWeightMode } from "../domain/progression";
import { cleanAi } from "../locales/i18n";
import { exerciseVideoKey, weekdayName } from "../render";
import { parseYouTubeId } from "../youtube";
import { setUserVideo } from "../db/repos";
import { miniAppUser } from "./auth";
import type { Env, ExerciseVideo, Lang, PlanDay, PlanExercise, UserDoc } from "../types";

interface PlanExerciseView {
  index: number;
  name: string;
  sets: string;
  startWeight: string;
  metric: string;
  technique?: string;
  videoUrl?: string;
  videoTitle?: string;
}
interface PlanDayView {
  weekday: number;
  name: string; // localized weekday name
  muscleGroup: string;
  exercises: PlanExerciseView[];
}
export interface PlanPayload {
  owner: { id: number; name: string };
  editable: boolean; // self, or a trainer/owner viewing their client
  version: string; // plan.generatedAt ISO — a full replan invalidates in-flight edits
  days: PlanDayView[];
}

async function resolveVideos(env: Env, userId: number, days: PlanDay[]): Promise<Map<string, ExerciseVideo>> {
  const keys = [...new Set(days.flatMap((d) => d.exercises.map((e) => exerciseVideoKey(e))))];
  if (!keys.length) return new Map();
  const map = await getExerciseVideos(env.DB, keys).catch(() => new Map<string, ExerciseVideo>());
  const overrides = await getUserVideos(env.DB, userId, keys).catch(() => new Map<string, ExerciseVideo>());
  for (const [k, v] of overrides) map.set(k, v);
  if (env.WORKER_URL) {
    for (const [k, v] of map) if (v.url) map.set(k, { ...v, url: `${env.WORKER_URL}/v?u=${encodeURIComponent(v.url)}&uid=${userId}` });
  }
  return map;
}

function toView(days: PlanDay[], videos: Map<string, ExerciseVideo>, lang: Lang): PlanDayView[] {
  return [...days]
    .sort((a, b) => a.weekday - b.weekday)
    .map((d) => ({
      weekday: d.weekday,
      name: weekdayName(lang, d.weekday),
      muscleGroup: d.muscleGroup,
      exercises: d.exercises.map((ex, index) => {
        const v = videos.get(exerciseVideoKey(ex));
        const technique = ex.technique ? cleanAi(ex.technique).trim() : "";
        return {
          index,
          name: ex.name,
          sets: ex.sets,
          startWeight: ex.startWeight,
          metric: exerciseMetric(ex),
          ...(ex.supersetGroup ? { ssGroup: ex.supersetGroup } : {}),
          wmode: resolveWeightMode(ex.name, ex.weightMode),
          ...(technique ? { technique } : {}),
          ...(v?.url ? { videoUrl: v.url } : {}),
          ...(v?.title ? { videoTitle: v.title } : {}),
        };
      }),
    }));
}

const MAX_EX_PER_DAY = 12;

export async function handlePlanApi(req: Request, url: URL, env: Env): Promise<Response> {
  const user = await miniAppUser(req, url, env);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  if (req.method === "GET") {
    const clientId = url.searchParams.get("clientId");
    let owner: UserDoc = user;
    if (clientId) {
      if (user.role !== "trainer") return Response.json({ error: "forbidden" }, { status: 403 });
      const client = await getClientForTrainer(env.DB, user._id, Number(clientId));
      if (!client) return Response.json({ error: "not found" }, { status: 404 });
      owner = client;
    }
    const plan = await getActivePlan(env.DB, owner._id);
    if (!plan) return Response.json({ error: "no_plan" }, { status: 404 });
    const videos = await resolveVideos(env, owner._id, plan.split);
    const payload: PlanPayload = {
      owner: { id: owner._id, name: owner.profile.name ?? `id ${owner._id}` },
      editable: true,
      version: plan.generatedAt.toISOString(),
      days: toView(plan.split, videos, owner.lang),
    };
    return Response.json(payload, { headers: { "cache-control": "no-store" } });
  }

  if (req.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "bad request" }, { status: 400 });
  }

  // Resolve the target plan owner (self or a trainer's client).
  let owner: UserDoc = user;
  if (body.clientId !== undefined) {
    if (user.role !== "trainer") return Response.json({ error: "forbidden" }, { status: 403 });
    const client = await getClientForTrainer(env.DB, user._id, Number(body.clientId));
    if (!client) return Response.json({ error: "not found" }, { status: 404 });
    owner = client;
  }

  const plan = await getActivePlan(env.DB, owner._id);
  if (!plan) return Response.json({ error: "no_plan" }, { status: 404 });
  // Coarse concurrency guard: a full replan (new generatedAt) invalidates in-flight edits.
  if (typeof body.version === "string" && body.version !== plan.generatedAt.toISOString()) {
    return Response.json({ error: "stale" }, { status: 409 });
  }

  const weekday = Number(body.weekday);
  const day = plan.split.find((d) => d.weekday === weekday);
  if (!day) return Response.json({ error: "bad request" }, { status: 400 });
  const action = String(body.action);
  const index = Number(body.index);
  const ex = day.exercises[index];
  // Optimistic target check for ops that reference an existing exercise (avoid editing the wrong
  // one if the plan shifted between load and tap).
  if (["weight", "sets", "del", "move", "swap", "video"].includes(action)) {
    if (!ex) return Response.json({ error: "bad request" }, { status: 400 });
    if (typeof body.expectName === "string" && body.expectName !== ex.name) {
      return Response.json({ error: "stale" }, { status: 409 });
    }
  }

  try {
    if (action === "weight") {
      const raw = String(body.value ?? "").trim();
      const kg = parseFloat(raw.replace(",", ".").replace(/[^\d.]/g, ""));
      // Keep EXACTLY what the user typed (rounded only to 0.5 kg to avoid float noise). The old
      // 2.5 kg snapping turned "3" into "2.5" — plates are the calculator's job, not the plan's.
      ex!.startWeight = Number.isFinite(kg) && kg > 0 && kg <= 1000 ? `${Math.round(kg * 2) / 2} kg` : raw.slice(0, 24) || ex!.startWeight;
    } else if (action === "wmode") {
      // Explicit weight-entry mode from the picker: total (cleared) | perSide | perHand.
      const v = String(body.value ?? "");
      ex!.weightMode = v === "perSide" || v === "perHand" ? v : undefined;
    } else if (action === "sets") {
      const norm = String(body.value ?? "").trim().replace(/\s+/g, " ").replace(/[xх*]/gi, "×");
      if (!/^\d+\s*×\s*\d+(?:\s*[-–]\s*\d+)?$/.test(norm)) return Response.json({ error: "bad request" }, { status: 400 });
      ex!.sets = norm.replace(/\s*×\s*/g, " × ");
    } else if (action === "video") {
      // Personal video override for this exercise (the plan OWNER's override, so a trainer
      // setting it for a client changes what the client sees — same as the bot's 🎥 flow).
      const videoId = parseYouTubeId(String(body.value ?? "").trim());
      if (!videoId) return Response.json({ error: "bad request" }, { status: 400 });
      await setUserVideo(env.DB, owner._id, exerciseVideoKey(ex!), ex!.name, { videoId, url: `https://youtu.be/${videoId}` });
    } else if (action === "link") {
      // Superset toggle with the NEXT exercise, on the existing supersetGroup letters (the
      // same field AI-generated plans use, so the bot's superset/circuit render just works).
      if (index >= day.exercises.length - 1) return Response.json({ error: "bad request" }, { status: 400 });
      const next = day.exercises[index + 1];
      if (ex!.supersetGroup && ex!.supersetGroup === next.supersetGroup) {
        // unlink: drop this exercise from the group; dissolve a group left with one member
        const g = ex!.supersetGroup;
        delete ex!.supersetGroup;
        const left = day.exercises.filter((e2) => e2.supersetGroup === g);
        if (left.length === 1) delete left[0].supersetGroup;
      } else if (next.supersetGroup) {
        ex!.supersetGroup = next.supersetGroup;
      } else if (ex!.supersetGroup) {
        next.supersetGroup = ex!.supersetGroup;
      } else {
        const used = new Set(day.exercises.map((e2) => e2.supersetGroup).filter(Boolean));
        const letter = "ABCDEFGH".split("").find((c) => !used.has(c)) ?? "A";
        ex!.supersetGroup = letter;
        next.supersetGroup = letter;
      }
    } else if (action === "del") {
      if (day.exercises.length <= 1) return Response.json({ error: "last" }, { status: 400 });
      day.exercises.splice(index, 1);
    } else if (action === "move") {
      const j = body.dir === "up" ? index - 1 : index + 1;
      if (j < 0 || j >= day.exercises.length) return Response.json({ ok: true }); // no-op at the edge
      [day.exercises[index], day.exercises[j]] = [day.exercises[j], day.exercises[index]];
    } else if (action === "swap" || action === "add") {
      const name = String(body.name ?? "").trim().slice(0, 80);
      if (name.length < 2) return Response.json({ error: "bad request" }, { status: 400 });
      const catalogId = body.catalogId ? String(body.catalogId) : undefined;
      const cat = catalogId ? await getCatalogExercise(env.DB, catalogId).catch(() => null) : null;
      let localName = cat?.name ?? name;
      if (cat && owner.lang !== "en") {
        const tr = await getExerciseTranslation(env.DB, cat.id, owner.lang).catch(() => null);
        if (tr?.name) localName = tr.name;
      }
      const built: PlanExercise = {
        name: cat ? localName : name,
        sets: action === "add" ? "3 × 8–12" : ex!.sets,
        startWeight: action === "add" ? "—" : (ex!.startWeight || "—"),
        technique: cat?.instructions ?? "",
        ...(cat ? { exerciseId: cat.id, canonicalName: cat.name, muscles: cat.muscle } : {}),
      };
      if (action === "add") {
        if (day.exercises.length >= MAX_EX_PER_DAY) return Response.json({ error: "full" }, { status: 400 });
        day.exercises.push(built);
      } else {
        day.exercises[index] = { ...built, isKeyLift: ex!.isKeyLift };
      }
    } else {
      return Response.json({ error: "bad request" }, { status: 400 });
    }
    await updateActivePlanSplit(env.DB, owner._id, plan.split);
    const videos = await resolveVideos(env, owner._id, plan.split);
    return Response.json({ ok: true, days: toView(plan.split, videos, owner.lang), version: plan.generatedAt.toISOString() });
  } catch (err) {
    console.error("api/plan edit", user._id, action, err);
    return Response.json({ error: "error" }, { status: 500 });
  }
}
