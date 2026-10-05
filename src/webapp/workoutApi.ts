// Guided-logger Mini App APIs: /api/workout/(today|swap|rest|save). Same initData auth as the
// dashboard; all routes act on the authenticated user only (no cross-user access).
import { FEEL_RPE, parseFeel } from "../domain/sessionFeel";
import { techniqueSteps } from "./techniqueSteps";
import { deleteRestTimers, setRestTimer } from "../adapters/d1/v2Admin";
import { deleteWorkoutDraft, getWorkoutLog, listStrength, putWorkoutDraft, recentWorkoutLogs, workoutLogsSince, setSessionFeelRpe } from "../adapters/d1/v2Workouts";
import { getActivePlan } from "../adapters/d1/v2Plans";
import { runIdempotent } from "../adapters/d1/v2Idempotency";
import { miniAppUser } from "./auth";
import { num, object, readJsonBody, str, validateBody } from "./validate";
import { stalledLifts } from "../domain/analysis";
import { aiText } from "../ai/index";
import { cleanAi } from "../locales/i18n";
import {
  assembleWorkoutCopy,
  assembleWorkoutHistory,
  buildWorkoutTodayPayload,
  createCustomExercise,
  lookupExerciseInfo,
  saveWorkout,
  searchCatalogForUser,
  validateSaveBody,
  workoutSwapAlternatives,
} from "./workout";
import { localParts } from "../domain/progression";
import type { Env, UserDoc } from "../types";
import { apiFailure } from "./apiError";

export async function handleWorkoutApi(req: Request, url: URL, env: Env): Promise<Response> {
  const user = await miniAppUser(req, url, env);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const path = url.pathname;
  try {
    if (req.method === "GET" && path === "/api/workout/today") {
      const dateQ = url.searchParams.get("date");
      const dateErr = dateQ ? validateEditDate(dateQ, user) : null;
      if (dateErr) return Response.json({ error: dateErr }, { status: 400 });
      const payload = await buildWorkoutTodayPayload(env.DB, user, env.WORKER_URL, env.TELEGRAM_BOT_TOKEN, dateQ ?? undefined);
      return Response.json(payload, { headers: { "cache-control": "no-store" } });
    }
    // Proactive AI insight: analyses the last 45 days of training (adherence, stalled lifts,
    // strength trend) and returns 2-3 specific, actionable coaching tips.
    if (req.method === "GET" && path === "/api/workout/insight") {
      const today = localParts(user.profile.timezone).date;
      const cutoff = new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10);
      const d14 = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
      const [logs, records] = await Promise.all([workoutLogsSince(env.DB, user._id, cutoff), listStrength(env.DB, user._id, 40)]);
      const done = logs.filter((l) => l.completed);
      if (done.length < 2) return Response.json({ text: "", need: true });
      const stalled = stalledLifts(records, today);
      const summary = {
        workouts_14d: done.filter((l) => l.date >= d14).length,
        workouts_45d: done.length,
        stalled_lifts: stalled.slice(0, 6),
        top_lifts: records.slice(0, 8).map((r) => ({ name: r.exercise, best: `${r.bestWeight ?? 0}kg×${r.bestReps ?? 0}` })),
      };
      const langName = user.lang === "uk" ? "Ukrainian" : "English";
      const text = await aiText(env, {
        system: `You are an elite strength coach. From the athlete's 45-day training JSON, give 2-3 SPECIFIC, actionable insights: what's progressing, what stalled (and one concrete fix each — e.g. deload, variation, add a set, check recovery), and one priority for next week. Reference their real lifts by name. Answer in ${langName}. Plain text only, no markdown, no LaTeX, no backslashes, max 8 short lines.`,
        user: JSON.stringify(summary),
        temperature: 0.6,
        kind: "report",
        db: env.DB,
        userId: user._id,
      }).catch(() => "");
      return Response.json({ text: cleanAi(text).slice(0, 900) }, { headers: { "cache-control": "no-store" } });
    }
    if (req.method === "GET" && path === "/api/workout/history") {
      const logs = await recentWorkoutLogs(env.DB, user._id, 25);
      const today = localParts(user.profile.timezone).date;
      return Response.json({ logs: assembleWorkoutHistory(logs, today) }, { headers: { "cache-control": "no-store" } });
    }
    if (req.method === "GET" && path === "/api/workout/past") {
      const dateQ = (url.searchParams.get("date") ?? "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateQ)) return Response.json({ error: "bad request" }, { status: 400 });
      const log = await getWorkoutLog(env.DB, user._id, dateQ);
      if (!log) return Response.json({ error: "not found" }, { status: 404 });
      return Response.json({ exercises: assembleWorkoutCopy(log) }, { headers: { "cache-control": "no-store" } });
    }
    if (req.method === "GET" && path === "/api/workout/swap") {
      const index = Number(url.searchParams.get("index"));
      if (!Number.isInteger(index) || index < 0 || index > 50) {
        return Response.json({ error: "bad request" }, { status: 400 });
      }
      const planName = (url.searchParams.get("name") ?? "").trim().slice(0, 80) || undefined;
      const muscle = (url.searchParams.get("muscle") ?? "").trim().slice(0, 40) || undefined;
      const plan = await getActivePlan(env.DB, user._id);
      const result = await workoutSwapAlternatives(env.DB, user, plan, index, planName, muscle);
      if (result === null) return Response.json({ error: "bad request" }, { status: 400 });
      return Response.json(result);
    }
    if (req.method === "GET" && path === "/api/workout/exinfo") {
      const name = (url.searchParams.get("name") ?? "").trim();
      if (name.length < 2 || name.length > 80) return Response.json({ error: "bad request" }, { status: 400 });
      const info = await lookupExerciseInfo(env, user, name);
      return Response.json(info, { headers: { "cache-control": "no-store" } });
    }
    if (req.method === "GET" && path === "/api/workout/steps") {
      const id = (url.searchParams.get("id") ?? "").trim();
      if (!id || id.length > 120) return Response.json({ error: "bad request" }, { status: 400 });
      const result = await techniqueSteps(env, user, id).catch(() => ({ steps: [] as string[] }));
      if (!result) return Response.json({ error: "not found" }, { status: 404 });
      return Response.json(result, { headers: { "cache-control": "private, max-age=86400" } });
    }
    if (req.method === "GET" && path === "/api/workout/search") {
      const q = (url.searchParams.get("q") ?? "").trim();
      if (q.length < 2 || q.length > 60) return Response.json({ error: "bad request" }, { status: 400 });
      const matches = await searchCatalogForUser(env.DB, user, q);
      return Response.json({ matches });
    }
    // "How did it go?" after saving: the session's effort feeds next Monday's progression.
    if (req.method === "POST" && path === "/api/workout/feel") {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      const body = parsed.body as { date?: unknown; feel?: unknown } | null;
      const feel = parseFeel(body?.feel);
      const date = typeof body?.date === "string" ? body.date : "";
      const dateErr = validateEditDate(date, user);
      if (!feel || dateErr) return Response.json({ error: dateErr ?? "bad feel" }, { status: 400 });
      const updated = await setSessionFeelRpe(env.DB, user._id, date, FEEL_RPE[feel]);
      return Response.json({ ok: true, updated });
    }
    if (req.method === "POST" && path === "/api/workout/custom") {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      const v = validateBody(parsed.body, object({ name: str({ max: 200 }) }));
      if (!v.ok) return v.response;
      const name = v.value.name.trim().slice(0, 80);
      if (name.length < 2) return Response.json({ error: "bad request" }, { status: 400 });
      const result = await createCustomExercise(env, user, name);
      return Response.json(result);
    }
    // Cancelling a rest is a real server-side action, not just local UI state: the pending row
    // is what the minute-cron turns into a Telegram "rest is over" push. Without this, tapping
    // Stop/Skip in the app cleared the countdown but still let the push fire up to a minute
    // later, for a rest the user had explicitly abandoned.
    if (req.method === "DELETE" && path === "/api/workout/rest") {
      await deleteRestTimers(env.DB, [user._id]);
      return Response.json({ ok: true });
    }
    if (req.method === "POST" && path === "/api/workout/rest") {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      // Same bounds as the bot's rest buttons (onRestTimer): 30s..15min.
      const v = validateBody(parsed.body, object({ seconds: num({ min: 30, max: 900 }) }));
      if (!v.ok) return v.response;
      const dueAt = new Date(Date.now() + Math.round(v.value.seconds) * 1000).toISOString();
      await setRestTimer(env.DB, user._id, user.chatId, dueAt, user.lang);
      return Response.json({ ok: true });
    }
    if (req.method === "POST" && path === "/api/workout/save") {
      // validateSaveBody does its own lenient, filtering parse (skips an untouched exercise row
      // rather than rejecting the whole save) -- that's intentional domain behavior, not a gap;
      // only the size-capped read is new here.
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      const v = validateSaveBody(parsed.body);
      if ("error" in v) return Response.json({ error: v.error }, { status: 400 });
      const body = parsed.body;
      const dateB = body && typeof (body as { date?: unknown }).date === "string" ? (body as { date: string }).date : null;
      const dateErr = dateB ? validateEditDate(dateB, user) : null;
      if (dateErr) return Response.json({ error: dateErr }, { status: 400 });

      // Idempotency: the log row itself is safe to re-save (workout_logs' PK is (userId, date)),
      // but saveWorkout ALSO sends a trainer notification and awards badges/XP as side effects --
      // a lost-response retry (flaky connection, not a deliberate re-log) must not repeat those.
      // Client sends the same key for every retry of one logical save (logger.js); a fresh save
      // action always gets a fresh key, so this never blocks a genuine second workout that day.
      const { status, body: out } = await runIdempotent(env.DB, user._id, req.headers.get("idempotency-key"), async () => ({
        status: 200,
        body: await saveWorkout(env, user, v.entries, dateB ?? undefined, v.timing),
      }));
      return Response.json(out, { status });
    }
    // Unsaved-logger autosave. Last write wins by design: it is one person's own form, and the
    // client only ever sends its latest state. The body is opaque to the server (never parsed
    // beyond the size cap) and only ever handed back to this same account for this same date.
    if ((req.method === "PUT" || req.method === "DELETE") && path === "/api/workout/draft") {
      const dateQ = (url.searchParams.get("date") ?? "").trim();
      const dateErr = validateEditDate(dateQ, user);
      if (dateErr) return Response.json({ error: dateErr }, { status: 400 });
      if (req.method === "DELETE") {
        await deleteWorkoutDraft(env.DB, user._id, dateQ);
        return Response.json({ ok: true });
      }
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      const v = validateBody(parsed.body, object({ body: str({ max: MAX_DRAFT_CHARS }) }));
      if (!v.ok) return v.response;
      const updatedAt = await putWorkoutDraft(env.DB, user._id, dateQ, v.value.body);
      return Response.json({ ok: true, updatedAt });
    }
    return Response.json({ error: "not found" }, { status: 404 });
  } catch (err) {
    return apiFailure(env, "api_workout", err, { userId: user._id });
  }
}

// 30 exercises x 20 sets of JSON fits comfortably; anything bigger is not a real logger state.
const MAX_DRAFT_CHARS = 60_000;

// Edit window guard: only a real calendar date, today or up to 14 days back (user's timezone).
function validateEditDate(date: string, user: UserDoc): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return "bad date";
  const today = localParts(user.profile.timezone).date;
  if (date > today) return "future date";
  const floor = new Date(Date.parse(`${today}T00:00:00Z`) - 14 * 86_400_000).toISOString().slice(0, 10);
  if (date < floor) return "too old";
  return null;
}
