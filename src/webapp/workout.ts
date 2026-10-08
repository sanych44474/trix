// Guided workout logger backend for the Mini App (roadmap P2): today's session payload and the save
// route's body. The save is completeWorkout (bot/workoutSave.ts), the same call the chat's
// finalizeWorkoutLog makes, so both surfaces share one set of side effects. Assembly and validation
// are pure (unit-tested); saveWorkout/buildWorkoutTodayPayload only fetch and write rows.
import { parseRestSec } from "../domain/restTime";
import { learnExerciseMuscles } from "../exerciseMuscleLearning";
import type { Api } from "grammy";
import { completeWorkout, type WorkoutSaveEntry } from "../bot/workoutSave";
import { muscleGroupToEnum } from "../domain/exerciseDefaults";
import { planRepsMid, planSetsCount, planWeight } from "../bot/guidedLog";
import { fitsEquipmentPreset, profileEquipmentToPreset } from "../domain/gymSwap";
import { catalogMusclesForExercise, muscleFromQuery } from "../domain/swapMuscles";
import { exerciseMetric, formatSetEntry } from "../domain/setFormat";
import { getPlanDay, nextTargetSet, workingSets, type TargetStep } from "../domain/progression";
import { resolveWeightMode } from "../domain/exerciseClass";
import { localParts } from "../domain/localTime";
import { deleteWorkoutDraft, getWorkoutDraft, getWorkoutLog, workoutLogsSince } from "../adapters/d1/v2Workouts";
import { getActivePlan } from "../adapters/d1/v2Plans";
import {
  getCatalogExercise,
  getExerciseTranslation,
  getExerciseTranslationNames,
  getExerciseVideos,
  getUserVideos,
  listCandidatesByMuscles,
  searchExercisesByName,
} from "../adapters/d1/v2Catalog";
import { isoDateMinus } from "../features/gamification/boards";
import { cleanAi, t } from "../locales/i18n";
import { aiText } from "../ai/index";
import { exerciseVideoKey } from "../render";
import { lookupExerciseVideoCached } from "../youtube";
import { buildVideoOpenLink } from "../domain/videoLink";
import type { Env, ExerciseMetric, ExerciseVideo, LoggedExercise, PlanDoc, SetEntry, UserDoc, Weekday, WorkoutLogDoc } from "../types";

export interface WorkoutTodayExercise {
  index: number;
  name: string;
  metric: ExerciseMetric;
  sets: number; // prefill: planned set count
  reps: number; // prefill: mid of the planned rep range
  weightKg: number; // prefill: planned start weight (0 = bodyweight)
  planSets: string; // raw plan display, e.g. "4 × 8–10"
  planWeight: string; // raw plan display, e.g. "50 kg"
  technique?: string; // localized technique notes from the plan (info dropdown)
  canonicalName?: string; // English catalog name, for matching technique pictures
  videoUrl?: string; // tracked /v redirect (or direct URL in local dev)
  videoTitle?: string;
  // What the user actually did LAST time for this exercise (most recent completed log) —
  // powers the "repeat last workout" prefill in the logger.
  last?: { w: number; r: number; sec: number; m: number }[];
  // The progression engine's target for today (domain/progression nextTargetSet) from the last
  // session's working sets — shown under the exercise and used as the weight/reps prefill.
  target?: { w: number; r: number; lastW: number; lastR: number; step: TargetStep };
  ssGroup?: string; // superset/circuit group letter (shared with adjacent exercises)
  wmode?: "total" | "perSide" | "perHand"; // how the weight is entered (label only; number as-is)
  restSec?: number; // planned rest between sets in seconds, parsed from PlanExercise.rest ("90s", "2-3 min") by domain/restTime.ts
}

export interface WorkoutTodayPayload {
  date: string;
  weekday: Weekday;
  restDay: boolean;
  alreadyLogged: boolean; // a completed log exists for today (a skip placeholder does not count)
  muscleGroup?: string;
  exercises: WorkoutTodayExercise[];
  // The saved log for this date (edit mode prefill) + past dates that have a log to fix.
  saved?: { name: string; rpe?: number; planName?: string; sets: { w: number; r: number; sec: number; m: number }[] }[];
  savedAt?: string; // when that log was last written -- the client compares it against its local copy
  durationSec?: number; // the saved session's measured length, if the app measured one
  restTotalSec?: number;
  // The server copy of an unsaved logger for this date (another device, or a cleared cache).
  draft?: { body: string; updatedAt: string };
  recentDates?: string[];
}

/** Pure payload assembly from pre-fetched rows — exported for unit tests. */
export function assembleWorkoutToday(
  plan: PlanDoc | null,
  today: string,
  weekday: Weekday,
  existing: WorkoutLogDoc | null,
  videos?: Map<string, ExerciseVideo>,
): WorkoutTodayPayload {
  const day = plan ? getPlanDay(plan, weekday) : undefined;
  const exercises = (day?.exercises ?? []).map((ex, i) => {
    const video = videos?.get(exerciseVideoKey(ex));
    const technique = ex.technique ? cleanAi(ex.technique).trim() : "";
    const restSec = parseRestSec(ex.rest);
    return {
      index: i,
      name: ex.name,
      metric: exerciseMetric(ex),
      sets: planSetsCount(ex.sets),
      reps: planRepsMid(ex.sets),
      weightKg: planWeight(ex.startWeight),
      planSets: ex.sets,
      planWeight: ex.startWeight,
      ...(ex.supersetGroup ? { ssGroup: ex.supersetGroup } : {}),
      wmode: resolveWeightMode(ex.name, ex.weightMode),
      ...(technique ? { technique } : {}),
      ...(ex.canonicalName && ex.canonicalName !== ex.name ? { canonicalName: ex.canonicalName } : {}),
      ...(video?.url ? { videoUrl: video.url } : {}),
      ...(video?.title ? { videoTitle: video.title } : {}),
      ...(restSec ? { restSec } : {}),
    };
  });
  return {
    date: today,
    weekday,
    restDay: exercises.length === 0,
    alreadyLogged: existing?.completed === true,
    ...(day ? { muscleGroup: day.muscleGroup } : {}),
    exercises,
  };
}

// ---- Copy-a-past-workout (Mini App) ----

export interface WorkoutHistoryItem {
  date: string;
  title: string; // first few exercise names, for the picker
  n: number; // exercise count
  durationSec?: number; // measured session length (Mini App sessions only)
}
export interface WorkoutCopyExercise {
  name: string;
  metric: ExerciseMetric;
  sets: { w: number; r: number; sec: number; m: number }[];
  rpe: number;
}

// Infer how a logged exercise was measured from its recorded sets (logs don't store the metric).
function loggedMetric(e: LoggedExercise): ExerciseMetric {
  const s = e.setsDone[0];
  if (!s) return "reps";
  if ((s.meters ?? 0) > 0) return "distance";
  if ((s.seconds ?? 0) > 0 && !s.reps) return "time";
  return "reps";
}

/** Compact list of past completed workouts a user can copy into today — pure, unit-testable. */
export function assembleWorkoutHistory(logs: WorkoutLogDoc[], today: string): WorkoutHistoryItem[] {
  return logs
    .filter((l) => l.date !== today && l.completed && l.exercises.some((e) => !e.skipped && e.setsDone.length > 0))
    .map((l) => {
      const names = l.exercises.filter((e) => !e.skipped && e.setsDone.length > 0).map((e) => e.name);
      const title = names.slice(0, 3).join(", ") + (names.length > 3 ? "…" : "");
      return { date: l.date, title, n: names.length, ...(l.durationSec ? { durationSec: l.durationSec } : {}) };
    });
}

/** One past log → the logger's prefill shape, so copying re-uses the exact sets/weights. */
export function assembleWorkoutCopy(log: WorkoutLogDoc): WorkoutCopyExercise[] {
  return log.exercises
    .filter((e) => !e.skipped && e.setsDone.length > 0)
    .map((e) => ({
      name: e.name,
      metric: loggedMetric(e),
      sets: e.setsDone.map((s) => ({ w: s.weight || 0, r: s.reps || 0, sec: s.seconds || 0, m: s.meters || 0 })),
      rpe: e.rpe || 0,
    }));
}

export async function buildWorkoutTodayPayload(db: D1Database, user: UserDoc, workerUrl: string | undefined, botToken: string, dateOverride?: string): Promise<WorkoutTodayPayload> {
  const local = localParts(user.profile.timezone);
  const date = dateOverride ?? local.date;
  const weekday = dateOverride ? isoWeekdayOfDate(dateOverride) : local.weekday;
  const [plan, existing, draft] = await Promise.all([
    getActivePlan(db, user._id),
    getWorkoutLog(db, user._id, date),
    getWorkoutDraft(db, user._id, date).catch(() => null),
  ]);
  // Video links, same resolution as the bot's videosForDays: shared videos + the user's own
  // overrides, routed through the /v redirect (when deployed) so opens are counted.
  let videos: Map<string, ExerciseVideo> | undefined;
  const day = plan ? getPlanDay(plan, weekday as Weekday) : undefined;
  const keys = [...new Set((day?.exercises ?? []).map((e) => exerciseVideoKey(e)))];
  if (keys.length) {
    videos = await getExerciseVideos(db, keys).catch(() => new Map<string, ExerciseVideo>());
    const overrides = await getUserVideos(db, user._id, keys).catch(() => new Map<string, ExerciseVideo>());
    for (const [k, v] of overrides) videos.set(k, v);
    for (const [k, v] of videos) {
      if (v.url) videos.set(k, { ...v, url: await buildVideoOpenLink(workerUrl, v.url, user._id, botToken) });
    }
  }
  const payload = assembleWorkoutToday(plan, date, weekday as Weekday, existing, videos);
  // Edit mode: ship the saved log so the client prefills the form instead of starting blank.
  if (existing?.completed && existing.exercises.length) {
    payload.saved = existing.exercises
      .filter((ex) => !ex.skipped && ex.setsDone.length)
      .map((ex) => ({
        name: ex.name,
        ...(ex.rpe !== undefined ? { rpe: ex.rpe } : {}),
        ...(ex.planName ? { planName: ex.planName } : {}),
        sets: ex.setsDone.map((st) => ({ w: st.weight || 0, r: st.reps || 0, sec: st.seconds || 0, m: st.meters || 0 })),
      }));
    if (existing.updatedAt) payload.savedAt = existing.updatedAt.toISOString();
    if (existing.durationSec !== undefined) payload.durationSec = existing.durationSec;
    if (existing.restTotalSec !== undefined) payload.restTotalSec = existing.restTotalSec;
  }
  if (draft) payload.draft = draft;
  // "Repeat last time": for each of today's exercises, the sets from the most recent completed
  // log that contains it (scan newest-first, 60-day window).
  if (payload.exercises.length) {
    const logs = await workoutLogsSince(db, user._id, isoDateMinus(date, 60)).catch(() => [] as WorkoutLogDoc[]);
    const lastByName = new Map<string, LoggedExercise>();
    for (const log of [...logs].sort((a, b) => (a.date < b.date ? 1 : -1))) {
      if (!log.completed || log.date >= date) continue;
      for (const ex of log.exercises) {
        if (lastByName.has(ex.name) || ex.skipped || !ex.setsDone.length) continue;
        lastByName.set(ex.name, ex);
      }
    }
    for (const ex of payload.exercises) {
      const le = lastByName.get(ex.name);
      if (!le) continue;
      ex.last = le.setsDone.map((s) => ({ w: s.weight || 0, r: s.reps || 0, sec: s.seconds || 0, m: s.meters || 0 }));
      const target = todayTarget(ex, le);
      if (target) {
        ex.target = target;
        // The target is the prefill; a saved log or draft for today still wins on the client.
        ex.weightKg = target.w;
        ex.reps = target.r;
      }
    }
    // Past days (last 7) that have a completed log — the "fix a mistake" picker in the logger.
    if (!dateOverride) {
      const floor = isoDateMinus(date, 7);
      payload.recentDates = [...new Set(logs.filter((l) => l.completed && l.date < date && l.date >= floor).map((l) => l.date))]
        .sort()
        .reverse();
    }
  }
  return payload;
}

/** ISO weekday (1=Mon..7=Sun) of a YYYY-MM-DD string. */
/** Today's target for a rep-based exercise from its last logged session. Pure (unit-tested). */
export function todayTarget(ex: Pick<WorkoutTodayExercise, "name" | "metric" | "planSets">, last: LoggedExercise): WorkoutTodayExercise["target"] {
  if (ex.metric !== "reps") return undefined;
  const range = parseRepRangeLoose(ex.planSets ?? "");
  const ws = workingSets(last.setsDone, range?.low ?? 1);
  if (!ws) return undefined;
  const n = nextTargetSet(ws.weight, ws.reps, ex.name, last.rpe, range);
  return { w: n.weight, r: n.reps, lastW: ws.weight, lastR: ws.reps, step: n.step };
}

function parseRepRangeLoose(s: string): { low: number; high: number } | undefined {
  const m = /(\d+)\s*[x×х*]\s*(\d+)\s*(?:[–\-—]\s*(\d+))?/i.exec(s);
  if (!m) return undefined;
  const low = parseInt(m[2]!, 10);
  return { low, high: m[3] ? parseInt(m[3], 10) : low };
}

function isoWeekdayOfDate(date: string): Weekday {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return (d === 0 ? 7 : d) as Weekday;
}

export interface SaveEntry {
  name: string;
  rpe?: number; // entry-level effort (same as the bot's one-tap srpe buttons)
  planName?: string; // the plan exercise this one replaced (in-session swap)
  sets: SetEntry[];
}

export interface SaveTiming {
  durationSec?: number;
  restTotalSec?: number;
}

// A measured session longer than this is a stale clock, not a workout; it is dropped, not clamped.
const MAX_SESSION_SEC = 5 * 3600;

const MAX_ENTRIES = 30;
const MAX_SETS = 20;

function num(v: unknown, lo: number, hi: number): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined;
}

/** Validate + normalize the save body. Empty sets and set-less exercises are dropped silently
 * (the UI sends the whole grid; untouched rows aren't an error). */
export function validateSaveBody(body: unknown): { entries: SaveEntry[]; timing: SaveTiming } | { error: string } {
  const raw = (body as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_ENTRIES) return { error: "entries" };
  const entries: SaveEntry[] = [];
  for (const e of raw as Record<string, unknown>[]) {
    if (!e || typeof e !== "object") return { error: "entry" };
    const name = typeof e.name === "string" ? e.name.trim().slice(0, 80) : "";
    if (!name) return { error: "name" };
    if (!Array.isArray(e.sets) || e.sets.length > MAX_SETS) return { error: "sets" };
    const sets: SetEntry[] = [];
    for (const s of e.sets as Record<string, unknown>[]) {
      if (!s || typeof s !== "object") return { error: "set" };
      const reps = num(s.reps, 0, 1000);
      const weight = num(s.weight, 0, 1000);
      if (reps === undefined || weight === undefined) return { error: "set" };
      const seconds = num(s.seconds, 1, 86_400);
      const meters = num(s.meters, 1, 200_000);
      const rpe = num(s.rpe, 0, 10);
      const set: SetEntry = { reps: Math.round(reps), weight };
      if (seconds !== undefined) set.seconds = Math.round(seconds);
      if (meters !== undefined) set.meters = Math.round(meters);
      if (rpe !== undefined) set.rpe = rpe;
      if (set.reps === 0 && !set.seconds && !set.meters) continue; // untouched row
      sets.push(set);
    }
    if (!sets.length) continue; // exercise never started
    const rpe = num(e.rpe, 0, 10);
    const planName = typeof e.planName === "string" ? e.planName.trim().slice(0, 80) : "";
    entries.push({ name, sets, ...(rpe !== undefined ? { rpe } : {}), ...(planName && planName !== name ? { planName } : {}) });
  }
  if (!entries.length) return { error: "empty" };
  // Timing is optional and advisory: a bad value is dropped rather than failing the whole save.
  const b = body as { durationSec?: unknown; restTotalSec?: unknown };
  const durationSec = num(b.durationSec, 1, MAX_SESSION_SEC);
  const restTotalSec = durationSec !== undefined ? num(b.restTotalSec, 0, durationSec) : undefined;
  const timing: SaveTiming = {
    ...(durationSec !== undefined ? { durationSec: Math.round(durationSec) } : {}),
    ...(restTotalSec !== undefined ? { restTotalSec: Math.round(restTotalSec) } : {}),
  };
  return { entries, timing };
}

/** Same human-readable raw text the bot stores as workout_logs.notes (logFinish format). */
export function buildRawText(entries: SaveEntry[]): string {
  return entries.map((e) => `${e.name} ${e.sets.map(formatSetEntry).join(", ")}`).join("\n");
}

export interface SaveResult {
  ok: true;
  prExercises: string[];
  newBadges: string[]; // localized labels, ready to display
  level: number;
  leveledUp: boolean;
  totalWorkouts: number;
}

const badgeKey = (code: string) => `badge_${code}` as Parameters<typeof t>[1];

/** The `sendMessage`-only surface announceSquadPr needs, over the raw Bot API — same reason the
 * trainer notify below uses fetch rather than grammY: this path is deliberately ctx-free and has
 * no Bot instance. The result is never read; a failed post must not disturb the save. */
function tgApi(env: Env): { sendMessage: Api["sendMessage"] } {
  return {
    sendMessage: (async (chatId: number | string, text: string, other?: Record<string, unknown>) => {
      await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, ...other }),
      });
      return undefined as never;
    }) as Api["sendMessage"],
  };
}

/** The Mini App's save. The work -- log, records, badges, level, trainer notification, squad post --
 * is completeWorkout (bot/workoutSave.ts), shared with the chat path; this only shapes the result
 * for the app. Celebrations are returned in the response instead of being sent to chat. */
export async function saveWorkout(env: Env, user: UserDoc, entries: SaveEntry[], dateOverride?: string, timing?: SaveTiming): Promise<SaveResult> {
  const local = localParts(user.profile.timezone);
  const date = dateOverride ?? local.date;
  const weekday = (dateOverride ? isoWeekdayOfDate(dateOverride) : local.weekday) as Weekday;
  const isPastEdit = date !== local.date;

  const saveEntries: WorkoutSaveEntry[] = entries.map((e) => ({ name: e.name, sets: e.sets, rpe: e.rpe, ...(e.planName ? { planName: e.planName } : {}) }));
  const done = await completeWorkout(env, user, saveEntries, { date, weekday, rawText: buildRawText(entries), isPastEdit, timing, api: tgApi(env) });
  // The unsaved-logger copy for this day is now superseded by the real log.
  await deleteWorkoutDraft(env.DB, user._id, date).catch(() => {});
  const fresh = done.levelBadge ? [...done.freshBadges, done.levelBadge] : done.freshBadges;

  return {
    ok: true,
    prExercises: done.prExercises,
    newBadges: fresh.map((c) => t(user.lang, badgeKey(c))),
    level: done.level,
    leveledUp: done.leveledUp,
    totalWorkouts: done.totalWorkouts,
  };
}

/** Free-text catalog search for the in-session swap: DB-only (no AI query translation — the
 * lang-aware name search already covers localized names), localized back to the user's lang. */
export async function searchCatalogForUser(
  db: D1Database,
  user: UserDoc,
  query: string,
): Promise<{ id: string; name: string }[]> {
  const found = await searchExercisesByName(db, query, 6, user.lang).catch(() => []);
  if (!found.length) return [];
  const names =
    user.lang === "en"
      ? new Map<string, string>()
      : await getExerciseTranslationNames(db, found.map((f) => f.id), user.lang).catch(() => new Map<string, string>());
  return found.map((f) => ({ id: f.id, name: names.get(f.id) || f.name }));
}

/** "Create" a custom exercise for the session: accept the free-text name and look a technique
 * video up on the internet (YouTube, cached into exercise_videos for everyone). No catalog row
 * is invented — records and logs key by name, so the custom name just works. */
export async function createCustomExercise(
  env: Env,
  user: UserDoc,
  name: string,
): Promise<{ name: string; videoUrl?: string; videoTitle?: string; muscles?: { primary: string[]; secondary: string[] } }> {
  // The video and the muscles (so the body map counts it from the first set) in parallel.
  const [video, muscles] = await Promise.all([
    lookupExerciseVideoCached(env.DB, env, name).catch(() => undefined),
    learnExerciseMuscles(env, name).catch(() => null),
  ]);
  let url = video?.url ?? undefined;
  if (url) url = await buildVideoOpenLink(env.WORKER_URL, url, user._id, env.TELEGRAM_BOT_TOKEN);
  return { name, ...(url ? { videoUrl: url } : {}), ...(video?.title ? { videoTitle: video.title } : {}), ...(muscles ? { muscles } : {}) };
}

// Lazy technique + video for ANY exercise name (custom/swapped exercises have neither in the
// plan). Catalog match first (curated + localized instructions), a short AI cue as fallback,
// plus a cached YouTube video. On-demand only (the user taps the info dropdown).
export async function lookupExerciseInfo(
  env: Env,
  user: UserDoc,
  name: string,
): Promise<{ technique: string; videoUrl?: string; videoTitle?: string }> {
  let technique = "";
  const matches = await searchExercisesByName(env.DB, name, 1, user.lang).catch(() => []);
  if (matches.length) {
    const cat = matches[0];
    technique = cleanAi(cat.instructions || "");
    if (user.lang !== "en") {
      const tr = await getExerciseTranslation(env.DB, cat.id, user.lang).catch(() => null);
      if (tr?.instructions) technique = cleanAi(tr.instructions);
    }
  }
  if (!technique) {
    // No catalog hit (custom exercise) → one short professional cue from the AI chain.
    technique = await aiText(env, {
      system: `You are an elite strength coach. In ${user.lang === "uk" ? "Ukrainian" : "English"} give 2–3 short sentences of technique for the exercise. Plain prose, no lists, no markdown, no LaTeX.`,
      user: name,
      temperature: 0.3,
      kind: "coach",
      db: env.DB,
      userId: user._id,
    }).then((x) => cleanAi(x || "").trim().slice(0, 600)).catch(() => "");
  }
  const video = await lookupExerciseVideoCached(env.DB, env, name).catch(() => undefined);
  let url = video?.url ?? undefined;
  if (url) url = await buildVideoOpenLink(env.WORKER_URL, url, user._id, env.TELEGRAM_BOT_TOKEN);
  return { technique, ...(url ? { videoUrl: url } : {}), ...(video?.title ? { videoTitle: video.title } : {}) };
}

/** In-session swap alternatives for today's exercise at `index` — same catalog discovery as the
 * bot's showLogSwapAlternatives (exerciseId muscle first, then the day's muscle group), minus
 * the ctx-bound fuzzy name search. Returns null when the index doesn't resolve to an exercise. */
export async function workoutSwapAlternatives(
  db: D1Database,
  user: UserDoc,
  plan: PlanDoc | null,
  index: number,
  planName?: string,
  muscleQuery?: string,
): Promise<{ alternatives: { id: string; name: string }[]; muscle: string | null } | null> {
  const { weekday } = localParts(user.profile.timezone);
  const day = plan ? getPlanDay(plan, weekday as Weekday) : undefined;
  // By name first: the logger's list can be reordered (moved exercises, a re-opened saved day
  // lists what was logged first), so its position no longer has to match the plan's.
  const byName = planName ? day?.exercises.find((e) => e.name === planName) : undefined;
  const current = byName ?? day?.exercises[index];
  // A typed muscle ("трицепс") picks the group outright; it works for any exercise, in the plan
  // or not. Anything else typed there is the person's own exercise, which the app adds itself.
  const typed = muscleQuery ? muscleFromQuery(muscleQuery) : null;
  if (muscleQuery && !typed) return { alternatives: [], muscle: null };
  if (!typed && !current && !planName) return null;
  const level = user.profile.level;
  // Order of evidence: the typed muscle; the exercise's own main mover read off its name (the
  // body map's lookup); its catalog entry; the day's group as the last resort -- which alone
  // used to turn a triceps pushdown's swaps into lunges on a "legs + arms" day.
  const ownName = current ? `${current.canonicalName ?? ""} ${current.name}`.trim() : planName ?? "";
  let muscles = typed?.catalog ?? catalogMusclesForExercise(current?.canonicalName ?? "");
  if (!muscles.length) muscles = catalogMusclesForExercise(current?.name ?? planName ?? "");
  let excludeId: string | undefined;
  if (!muscles.length && current?.exerciseId) {
    const cur = await getCatalogExercise(db, current.exerciseId);
    if (cur) { muscles = [cur.muscle]; excludeId = cur.id; }
  }
  if (!muscles.length && day) {
    const m = muscleGroupToEnum(day.muscleGroup);
    if (m) muscles = [m];
  }
  let candidates = muscles.length ? await listCandidatesByMuscles(db, muscles, { level, perMuscle: 25, total: 40 }) : [];
  const own = ownName.toLowerCase();
  candidates = candidates.filter((c) => c.id !== excludeId && c.id !== current?.exerciseId && !own.includes(c.name.toLowerCase()));
  // Respect the equipment the user actually has (onboarding profile.equipment) — without this,
  // a bodyweight-only/dumbbells-only user could be offered a barbell/machine exercise mid-set.
  const preset = profileEquipmentToPreset(user.profile.equipment);
  if (preset) candidates = candidates.filter((c) => fitsEquipmentPreset(c.equipments, preset));
  const picked = candidates.sort(() => Math.random() - 0.5).slice(0, 5);
  const out: { id: string; name: string }[] = [];
  for (const c of picked) {
    let name = c.name;
    if (user.lang !== "en") {
      const tr = await getExerciseTranslation(db, c.id, user.lang).catch(() => null);
      if (tr?.name) name = tr.name;
    }
    out.push({ id: c.id, name });
  }
  return { alternatives: out, muscle: typed?.slug ?? null };
}
