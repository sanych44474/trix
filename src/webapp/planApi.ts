// Plan view + editor for the Mini App (roadmap P5). GET returns a user's plan (own, or a
// trainer's client via ?clientId=); POST applies one edit op (weight / sets / delete / move /
// swap / add), mirroring the bot's day editor. All writes go through updateActivePlanSplit, so
// the client and the bot editor stay in sync. Same initData auth as every other webapp API.
import {
  getActivePlan,
  listPlanChanges,
  recordPlanChange,
  updateActivePlanSplit,
  updatePlanMesocycle,
} from "../adapters/d1/v2Plans";
import { defaultMesocycle, type Mesocycle } from "../domain/mesocycle";
import { getClientForTrainer } from "../adapters/d1/v2Trainer";
import {
  getCatalogExercise,
  getExerciseTranslation,
  getExerciseVideos,
  getUserVideos,
  searchExercisesByName,
  setUserVideo,
} from "../adapters/d1/v2Catalog";
import { exerciseMetric, resolveWeightMode } from "../domain/progression";
import { cleanAi } from "../locales/i18n";
import { exerciseVideoKey, weekdayName } from "../render";
import { parseYouTubeId } from "../youtube";
import { miniAppUser } from "./auth";
import { readJsonBody } from "./validate";
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
  ssGroup?: string;
  wmode?: "total" | "perSide" | "perHand";
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
  mesocycle: Mesocycle | null; // opt-in block periodization overlay, see src/domain/mesocycle.ts
  changes: PlanChangeView[]; // recent audit trail; a trainer reading a client's plan sees the same list
}

interface PlanChangeView {
  source: string; // ai_coach | manual | injury_swap | trainer
  summary: string;
  at: string; // ISO
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

/** One-line "what changed" for the audit trail, mirroring the phrasing the bot's own editor
 *  already writes ("weight: Bench Press -> 60 kg") so both surfaces read as one history. */
function changeSummary(action: string, before: string, after: PlanExercise | undefined): string {
  if (action === "weight") return `weight: ${before} -> ${after?.startWeight ?? "?"}`;
  if (action === "sets") return `sets: ${before} -> ${after?.sets ?? "?"}`;
  if (action === "wmode") return `weight mode: ${before} -> ${after?.weightMode ?? "total"}`;
  if (action === "video") return `video: ${before}`;
  if (action === "link") return `superset: ${before}`;
  if (action === "del") return `removed: ${before}`;
  if (action === "move") return `reordered: ${before}`;
  if (action === "swap") return `swap: ${before} -> ${after?.name ?? "?"}`;
  if (action === "add") return `added: ${after?.name ?? "?"}`;
  return action;
}

export async function handlePlanApi(req: Request, url: URL, env: Env): Promise<Response> {
  const user = await miniAppUser(req, url, env);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  if (req.method === "GET" && url.pathname === "/api/plan/catalog") {
    const query = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
    if (query.length < 2) return Response.json({ items: [] }, { headers: { "cache-control": "no-store" } });
    const found = await searchExercisesByName(env.DB, query, 8, user.lang).catch(() => []);
    const items = await Promise.all(found.map(async (exercise) => {
      const translation = user.lang === "en" ? null : await getExerciseTranslation(env.DB, exercise.id, user.lang).catch(() => null);
      return { id: exercise.id, name: translation?.name || exercise.name, muscle: exercise.muscle };
    }));
    return Response.json({ items }, { headers: { "cache-control": "no-store" } });
  }

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
    // The change log had no reader anywhere in the codebase until now -- it was written by the
    // bot's editor and never shown. Surfacing it here serves both audiences off one endpoint:
    // an athlete seeing what their coach changed, and a trainer seeing a client's plan history.
    const changes = await listPlanChanges(env.DB, owner._id, 10).catch(() => []);
    const payload: PlanPayload = {
      owner: { id: owner._id, name: owner.profile.name ?? `id ${owner._id}` },
      editable: true,
      version: plan.generatedAt.toISOString(),
      days: toView(plan.split, videos, owner.lang),
      mesocycle: plan.mesocycle ?? null,
      changes: changes.map((c) => ({ source: c.source, summary: c.summary, at: c.createdAt.toISOString() })),
    };
    return Response.json(payload, { headers: { "cache-control": "no-store", etag: `"${payload.version}"` } });
  }

  if (req.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });

  // This is a discriminated-union editor (action -> a different op, each with its own
  // pre-existing field checks and optimistic-concurrency guard below) -- readJsonBody adds the
  // size cap and uniform malformed-JSON handling; each action's own field validation is unchanged.
  const parsedPlan = await readJsonBody(req);
  if (!parsedPlan.ok) return parsedPlan.response;
  const body = parsedPlan.body as Record<string, unknown>;

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
  // Coarse concurrency guard: a full replan (new generatedAt) invalidates in-flight edits. v2
  // accepts the standard If-Match header; the JSON version remains for the legacy client.
  const ifMatch = req.headers.get("if-match")?.replace(/^W\//, "").replace(/^"|"$/g, "");
  const expectedVersion = ifMatch && ifMatch !== "*" ? ifMatch : typeof body.version === "string" ? body.version : undefined;
  if (expectedVersion && expectedVersion !== plan.generatedAt.toISOString()) {
    return Response.json({ error: "stale" }, { status: 409 });
  }

  // Mesocycle on/off is a whole-plan toggle, not a per-exercise edit -- it has no weekday/index
  // to resolve, so it's handled before the day-scoped actions below (which all require one).
  if (body.action === "meso") {
    await updatePlanMesocycle(env.DB, owner._id, body.on ? defaultMesocycle() : null);
    return Response.json({ ok: true });
  }

  const weekday = Number(body.weekday);
  const day = plan.split.find((d) => d.weekday === weekday);
  if (!day) return Response.json({ error: "bad request" }, { status: 400 });
  const action = String(body.action);
  const index = Number(body.index);
  const ex = day.exercises[index];
  const beforeName = ex?.name ?? "";
  // Optimistic target check for ops that reference an existing exercise (avoid editing the wrong
  // one if the plan shifted between load and tap).
  if (["weight", "sets", "del", "move", "swap", "video", "wmode", "link"].includes(action)) {
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
      // `value` is what the Mini App's shared edit() helper sends for EVERY action (App.tsx);
      // `name` is the older spelling the bot-era payload and the existing tests use. Reading
      // only `name` here silently 400'd every catalog swap and add-exercise from the app --
      // for a trainer editing a client's plan and for a solo user alike -- while the other
      // actions (weight/sets/wmode/video), which read `value`, kept working. Accept both.
      const name = String(body.value ?? body.name ?? "").trim().slice(0, 80);
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
    // Parity with the bot's editor (src/bot/planExerciseEdit.ts), which records every one of
    // these: without it an edit made in the Mini App left no audit trail while the identical
    // edit made in chat did. A trainer editing a client's plan is logged as "trainer", not
    // "manual", so the client can tell who changed what. Best-effort -- a failed audit write
    // must not fail the edit the user already saw succeed.
    const after = action === "add" ? day.exercises[day.exercises.length - 1] : action === "del" ? undefined : day.exercises[index];
    await recordPlanChange(
      env.DB,
      owner._id,
      owner._id === user._id ? "manual" : "trainer",
      changeSummary(action, beforeName, after),
    ).catch(() => {});
    const videos = await resolveVideos(env, owner._id, plan.split);
    // Return the refreshed log with the edit, so the client's history panel can't show a list
    // that's missing the change the user just made.
    const freshChanges = await listPlanChanges(env.DB, owner._id, 10).catch(() => []);
    return Response.json({
      ok: true,
      days: toView(plan.split, videos, owner.lang),
      version: plan.generatedAt.toISOString(),
      changes: freshChanges.map((c) => ({ source: c.source, summary: c.summary, at: c.createdAt.toISOString() })),
    });
  } catch (err) {
    console.error("api/plan edit", user._id, action, err);
    return Response.json({ error: "error" }, { status: 500 });
  }
}
