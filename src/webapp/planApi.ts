// Plan view + editor for the Mini App (roadmap P5). GET returns a user's plan (own, or a
// trainer's client via ?clientId=); POST applies one edit (weight / sets / delete / move / swap /
// add / day add-remove / difficulty / fitkit), translated into a PlanEdit and applied by
// features/plan/planEdits.ts, the same module the bot's editors use. Same initData auth as every
// other webapp API.
import { rebuildPlan, replanRunning } from "../features/plan/planService";
import { PlanEditError, applyPlanEdit, planEditStatus, planVersionMatches, type PlanEdit } from "../features/plan/planEdits";
import { kitMismatches, kitFromEquipment } from "../domain/equipmentFit";
import { getActivePlan, updatePlanMesocycle } from "../adapters/d1/v2Plans";
import { listPlanChanges } from "../adapters/d1/v2PlanHistory";
import { defaultMesocycle, type Mesocycle } from "../domain/mesocycle";
import { getClientForTrainer } from "../adapters/d1/v2Trainer";
import { updateUser } from "../adapters/d1/v2Users";
import { getExerciseTranslation, getExerciseVideos, getUserVideos, searchExercisesByName } from "../adapters/d1/v2Catalog";
import { exerciseMetric } from "../domain/setFormat";
import { resolveWeightMode } from "../domain/exerciseClass";
import { cleanAi } from "../locales/i18n";
import { exerciseVideoKey, weekdayName } from "../render";
import { miniAppUser } from "./auth";
import { readJsonBody } from "./validate";
import { buildVideoOpenLink } from "../domain/videoLink";
import type { Env, ExerciseVideo, Lang, PlanDay, UserDoc } from "../types";
import { apiFailure } from "./apiError";

interface PlanExerciseView {
  index: number;
  name: string;
  sets: string;
  startWeight: string;
  metric: string;
  technique?: string;
  note?: string;
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
  // The owner's equipment and how many plan exercises need gear outside it (domain/equipmentFit.ts);
  // > 0 shows the "fit my plan to my equipment" offer.
  kit: { equipment: string; mismatches: number };
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
  for (const [k, v] of map) {
    if (v.url) map.set(k, { ...v, url: await buildVideoOpenLink(env.WORKER_URL, v.url, userId, env.TELEGRAM_BOT_TOKEN) });
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
          ...(ex.note ? { note: ex.note } : {}),
          ...(v?.url ? { videoUrl: v.url } : {}),
          ...(v?.title ? { videoTitle: v.title } : {}),
        };
      }),
    }));
}

const VALUE_EDITS = new Set(["weight", "sets", "wmode", "video", "note", "technique"]);
type ValueEditKind = "weight" | "sets" | "wmode" | "video" | "note" | "technique";
const EXERCISE_EDITS = new Set(["link", "del"]);
type ExerciseEditKind = "link" | "del";

/** Translate the POST body into a PlanEdit. Null for an action the editor does not know. */
function toPlanEdit(body: Record<string, unknown>): PlanEdit | null {
  const action = String(body.action);
  const weekday = Number(body.weekday);
  const slot = {
    weekday,
    index: Number(body.index),
    ...(typeof body.expectName === "string" ? { expectName: body.expectName } : {}),
  };
  // The Mini App's shared edit() helper sends the new value as `value` for every action; `name` is
  // the older spelling the bot-era payload and the existing tests use. Accept both.
  const name = String(body.value ?? body.name ?? "");
  const catalogId = body.catalogId ? String(body.catalogId) : undefined;
  const freeExerciseId = typeof body.freeExerciseId === "string" ? body.freeExerciseId : undefined;
  if (VALUE_EDITS.has(action)) return { kind: action as ValueEditKind, value: String(body.value ?? ""), ...slot };
  if (EXERCISE_EDITS.has(action)) return { kind: action as ExerciseEditKind, ...slot };
  switch (action) {
    case "move":
      return { kind: "move", dir: body.dir === "up" ? "up" : "down", ...slot };
    case "swap":
      return { kind: "swap", name, catalogId, freeExerciseId, ...slot };
    case "add":
      return { kind: "add", weekday, name, catalogId, freeExerciseId };
    case "dayadd":
      return { kind: "dayadd", weekday, group: String(body.group ?? "") };
    case "daydel":
      return { kind: "daydel", weekday };
    case "dayswap":
      return { kind: "dayswap", weekday, other: Number(body.other) };
    case "difficulty":
      return { kind: "difficulty", weekday, dir: body.dir as "up" | "down" };
    case "fitkit":
      return { kind: "fitkit", ...(typeof body.equipment === "string" ? { equipment: body.equipment } : {}) };
    default:
      return null;
  }
}

const NON_DAY_ACTIONS_WITH_SWAPPED = new Set(["fitkit", "difficulty"]);

export async function handlePlanApi(req: Request, url: URL, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const user = await miniAppUser(req, url, env);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  // Rebuild the athlete's own plan from their current profile (after changing goal, level,
  // schedule or equipment in Settings). Builds in the background -- AI generation can take tens
  // of seconds -- and the app polls GET for `pending`; the user also gets a ping when it's ready.
  if (url.pathname === "/api/plan/replan") {
    if (req.method === "GET") {
      return Response.json({ pending: replanRunning(user), failed: !!user.session.replanFailed }, { headers: { "cache-control": "no-store" } });
    }
    if (req.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });
    if (!user.onboarded) return Response.json({ error: "not_onboarded" }, { status: 409 });
    if (user.role === "client" && user.trainerId) return Response.json({ error: "trainer_managed" }, { status: 403 });
    if (replanRunning(user)) return Response.json({ ok: true, pending: true });
    const session = { ...user.session, replanAt: new Date().toISOString(), replanFailed: undefined };
    await updateUser(env.DB, user._id, { session });
    const job = rebuildPlan(env, env.DB, { ...user, session });
    if (ctx) ctx.waitUntil(job); else await job;
    return Response.json({ ok: true, pending: true });
  }

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
    // The change log serves both audiences off one endpoint: an athlete seeing what their coach
    // changed, and a trainer seeing a client's plan history.
    const changes = await listPlanChanges(env.DB, owner._id, 10).catch(() => []);
    const payload: PlanPayload = {
      owner: { id: owner._id, name: owner.profile.name ?? `id ${owner._id}` },
      editable: true,
      version: plan.generatedAt.toISOString(),
      days: toView(plan.split, videos, owner.lang),
      mesocycle: plan.mesocycle ?? null,
      changes: changes.map((c) => ({ source: c.source, summary: c.summary, at: c.createdAt.toISOString() })),
      kit: { equipment: owner.profile.equipment ?? "", mismatches: kitMismatches(plan.split, kitFromEquipment(owner.profile.equipment)) },
    };
    return Response.json(payload, { headers: { "cache-control": "no-store", etag: `"${payload.version}"` } });
  }

  if (req.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });

  // This is a discriminated-union editor (action -> a different op). readJsonBody adds the size cap
  // and uniform malformed-JSON handling; the edit's own validation lives in planEdits.ts.
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

  // Mesocycle on/off is a whole-plan toggle, not a plan edit: no weekday or index to resolve.
  if (body.action === "meso") {
    if (!planVersionMatches(plan, expectedVersion)) return Response.json({ error: "stale" }, { status: 409 });
    await updatePlanMesocycle(env.DB, owner._id, body.on ? defaultMesocycle() : null);
    return Response.json({ ok: true });
  }

  const edit = toPlanEdit(body);
  if (!edit) return Response.json({ error: "bad request" }, { status: 400 });
  const action = String(body.action);
  try {
    const result = await applyPlanEdit({ env, owner, actorId: user._id, plan, expectedVersion }, edit);
    const videos = await resolveVideos(env, owner._id, result.split);
    // Return the refreshed log with the edit, so the client's history panel can't show a list
    // that's missing the change the user just made.
    const changes = await listPlanChanges(env.DB, owner._id, 10).catch(() => []);
    return Response.json({
      ok: true,
      days: toView(result.split, videos, owner.lang),
      version: plan.generatedAt.toISOString(),
      changes: changes.map((c) => ({ source: c.source, summary: c.summary, at: c.createdAt.toISOString() })),
      ...(NON_DAY_ACTIONS_WITH_SWAPPED.has(action) ? { swapped: result.swapped } : {}),
    });
  } catch (err) {
    if (err instanceof PlanEditError) return Response.json({ error: err.code }, { status: planEditStatus(err.code) });
    return apiFailure(env, "api_plan", err, { userId: user._id, action });
  }
}
