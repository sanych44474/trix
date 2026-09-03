// Guided workout logger backend for the Mini App (roadmap P2): today's session payload and a
// ctx-free save that mirrors the bot's finalizeWorkoutLog (log + strength records + badges +
// level bookkeeping + trainer notify) so both surfaces stay in parity. Assembly and validation
// are pure (unit-tested); saveWorkout/buildWorkoutTodayPayload only fetch and write rows.
import { muscleGroupToEnum, planRepsMid, planSetsCount, planWeight } from "../bot";
import { computeXp, levelFromXp } from "../domain/gamification";
import { bestSetForMetric, exerciseMetric, formatSetEntry, getPlanDay, localParts, metricOfSets, resolveWeightMode } from "../domain/progression";
import { prMilestones, workoutMilestones } from "../domain/records";
import {
  awardAchievement,
  countCompletedWorkouts,
  getActivePlan,
  getCatalogExercise,
  getExerciseTranslation,
  getExerciseTranslationNames,
  getExerciseVideos,
  getUser,
  getUserVideos,
  getWorkoutLog,
  listCandidatesByMuscles,
  searchExercisesByName,
  updateUser,
  upsertStrengthRecord,
  upsertWorkoutLog,
  userStatCounts,
  workoutLogsSince,
} from "../db/repos";
import { isoDateMinus } from "../bot/boards";
import { cleanAi, t } from "../locales/i18n";
import { aiText } from "../ai/index";
import { exerciseVideoKey } from "../render";
import { lookupExerciseVideoCached } from "../youtube";
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
  videoUrl?: string; // tracked /v redirect (or direct URL in local dev)
  videoTitle?: string;
  // What the user actually did LAST time for this exercise (most recent completed log) —
  // powers the "repeat last workout" prefill in the logger.
  last?: { w: number; r: number; sec: number; m: number }[];
  ssGroup?: string; // superset/circuit group letter (shared with adjacent exercises)
  wmode?: "total" | "perSide" | "perHand"; // how the weight is entered (label only; number as-is)
}

export interface WorkoutTodayPayload {
  date: string;
  weekday: Weekday;
  restDay: boolean;
  alreadyLogged: boolean; // a completed log exists for today (a skip placeholder does not count)
  muscleGroup?: string;
  exercises: WorkoutTodayExercise[];
  // The saved log for this date (edit mode prefill) + past dates that have a log to fix.
  saved?: { name: string; rpe?: number; sets: { w: number; r: number; sec: number; m: number }[] }[];
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
      ...(video?.url ? { videoUrl: video.url } : {}),
      ...(video?.title ? { videoTitle: video.title } : {}),
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
      return { date: l.date, title, n: names.length };
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

export async function buildWorkoutTodayPayload(db: D1Database, user: UserDoc, workerUrl?: string, dateOverride?: string): Promise<WorkoutTodayPayload> {
  const local = localParts(user.profile.timezone);
  const date = dateOverride ?? local.date;
  const weekday = dateOverride ? isoWeekdayOfDate(dateOverride) : local.weekday;
  const [plan, existing] = await Promise.all([
    getActivePlan(db, user._id),
    getWorkoutLog(db, user._id, date),
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
    if (workerUrl) {
      for (const [k, v] of videos) {
        if (v.url) videos.set(k, { ...v, url: `${workerUrl}/v?u=${encodeURIComponent(v.url)}&uid=${user._id}` });
      }
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
        sets: ex.setsDone.map((st) => ({ w: st.weight || 0, r: st.reps || 0, sec: st.seconds || 0, m: st.meters || 0 })),
      }));
  }
  // "Repeat last time": for each of today's exercises, the sets from the most recent completed
  // log that contains it (scan newest-first, 60-day window).
  if (payload.exercises.length) {
    const logs = await workoutLogsSince(db, user._id, isoDateMinus(date, 60)).catch(() => [] as WorkoutLogDoc[]);
    const lastByName = new Map<string, { w: number; r: number; sec: number; m: number }[]>();
    for (const log of [...logs].sort((a, b) => (a.date < b.date ? 1 : -1))) {
      if (!log.completed) continue;
      for (const ex of log.exercises) {
        if (lastByName.has(ex.name) || !ex.setsDone.length) continue;
        lastByName.set(ex.name, ex.setsDone.map((s) => ({ w: s.weight || 0, r: s.reps || 0, sec: s.seconds || 0, m: s.meters || 0 })));
      }
    }
    for (const ex of payload.exercises) {
      const last = lastByName.get(ex.name);
      if (last) ex.last = last;
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
function isoWeekdayOfDate(date: string): Weekday {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return (d === 0 ? 7 : d) as Weekday;
}

export interface SaveEntry {
  name: string;
  rpe?: number; // entry-level effort (same as the bot's one-tap srpe buttons)
  sets: SetEntry[];
}

const MAX_ENTRIES = 30;
const MAX_SETS = 20;

function num(v: unknown, lo: number, hi: number): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined;
}

/** Validate + normalize the save body. Empty sets and set-less exercises are dropped silently
 * (the UI sends the whole grid; untouched rows aren't an error). */
export function validateSaveBody(body: unknown): { entries: SaveEntry[] } | { error: string } {
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
    entries.push({ name, sets, ...(rpe !== undefined ? { rpe } : {}) });
  }
  if (!entries.length) return { error: "empty" };
  return { entries };
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

/** Ctx-free mirror of finalizeWorkoutLog. Idempotent by construction: the log upserts on
 * (userId, date), records only ever improve, badges are INSERT OR IGNORE, lastLevel is
 * monotonic — so a network retry after a 401/timeout is safe. Celebrations are returned to
 * the app instead of being sent to chat; the trainer notification still goes out. */
export async function saveWorkout(env: Env, user: UserDoc, entries: SaveEntry[], dateOverride?: string): Promise<SaveResult> {
  const local = localParts(user.profile.timezone);
  const date = dateOverride ?? local.date;
  const weekday = dateOverride ? isoWeekdayOfDate(dateOverride) : local.weekday;
  const isPastEdit = date !== local.date;
  const exercises: LoggedExercise[] = entries.map((e) => ({
    name: e.name,
    setsDone: e.sets,
    skipped: false,
    ...(e.rpe !== undefined ? { rpe: e.rpe } : {}),
  }));
  await upsertWorkoutLog(env.DB, user._id, date, weekday as Weekday, exercises, true, buildRawText(entries));

  const prExercises: string[] = [];
  for (const e of entries) {
    const metric = metricOfSets(e.sets);
    const best = bestSetForMetric(e.sets, metric);
    if (!best) continue;
    const pr = await upsertStrengthRecord(
      env.DB,
      user._id,
      e.name,
      { metric, weight: best.weight, reps: best.reps, seconds: best.seconds, meters: best.meters },
      date,
      e.rpe,
    );
    if (pr.isPR) prExercises.push(e.name);
  }

  const fresh: string[] = [];
  const total = await countCompletedWorkouts(env.DB, user._id);
  for (const code of workoutMilestones(total)) {
    if (await awardAchievement(env.DB, user._id, code)) fresh.push(code);
  }
  if (prExercises.length && (await awardAchievement(env.DB, user._id, "first_pr"))) fresh.push("first_pr");
  // PR-milestone badges from the running lifetime PR count (persisted in reminders).
  if (prExercises.length) {
    const prCount = (user.reminders?.prCount ?? 0) + prExercises.length;
    const reminders = { ...user.reminders, prCount };
    await updateUser(env.DB, user._id, { reminders }).catch(() => {});
    user.reminders = reminders;
    for (const code of prMilestones(prCount)) if (await awardAchievement(env.DB, user._id, code)) fresh.push(code);
  }

  // Level bookkeeping — maybeCelebrateLevel minus the chat message (the app shows it).
  let level = 1;
  let leveledUp = false;
  try {
    const counts = await userStatCounts(env.DB, user._id);
    const lv = levelFromXp(computeXp(counts));
    level = lv.level;
    const last = user.reminders?.lastLevel;
    if (last !== lv.level) {
      const reminders = { ...user.reminders, lastLevel: lv.level };
      await updateUser(env.DB, user._id, { reminders });
      user.reminders = reminders;
      if (last !== undefined && lv.level > last) {
        leveledUp = true;
        const badge = lv.level >= 10 ? "level_10" : lv.level >= 5 ? "level_5" : null;
        if (badge && (await awardAchievement(env.DB, user._id, badge).catch(() => false))) fresh.push(badge);
      }
    }
  } catch {
    /* level display is best-effort */
  }

  // Trainer notify (parity with notifyTrainerWorkout) — raw Bot API, never fails the save.
  // Suppressed for past-date corrections: "client just trained" would be misleading.
  try {
    if (!isPastEdit && user.role === "client" && user.trainerId) {
      const trainer = await getUser(env.DB, user.trainerId);
      if (trainer) {
        await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: trainer.chatId,
            text: t(trainer.lang, "trainer_notify_done", { name: user.profile.name ?? `id ${user._id}`, n: exercises.length }),
            parse_mode: "HTML",
          }),
        });
      }
    }
  } catch {
    /* notify is best-effort */
  }

  return {
    ok: true,
    prExercises,
    newBadges: fresh.map((c) => t(user.lang, badgeKey(c))),
    level,
    leveledUp,
    totalWorkouts: total,
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
): Promise<{ name: string; videoUrl?: string; videoTitle?: string }> {
  const video = await lookupExerciseVideoCached(env.DB, env, name).catch(() => undefined);
  let url = video?.url ?? undefined;
  if (url && env.WORKER_URL) url = `${env.WORKER_URL}/v?u=${encodeURIComponent(url)}&uid=${user._id}`;
  return { name, ...(url ? { videoUrl: url } : {}), ...(video?.title ? { videoTitle: video.title } : {}) };
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
  if (url && env.WORKER_URL) url = `${env.WORKER_URL}/v?u=${encodeURIComponent(url)}&uid=${user._id}`;
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
): Promise<{ id: string; name: string }[] | null> {
  const { weekday } = localParts(user.profile.timezone);
  const day = plan ? getPlanDay(plan, weekday as Weekday) : undefined;
  const current = day?.exercises[index];
  if (!day || !current) return null;
  const level = user.profile.level;
  let candidates: Awaited<ReturnType<typeof listCandidatesByMuscles>> = [];
  if (current.exerciseId) {
    const cur = await getCatalogExercise(db, current.exerciseId);
    if (cur) {
      candidates = (await listCandidatesByMuscles(db, [cur.muscle], { level, perMuscle: 20, total: 20 })).filter(
        (c) => c.id !== cur.id,
      );
    }
  }
  if (!candidates.length) {
    const muscle = muscleGroupToEnum(day.muscleGroup);
    if (muscle) candidates = await listCandidatesByMuscles(db, [muscle], { level, perMuscle: 20, total: 20 });
  }
  const picked = candidates.sort(() => Math.random() - 0.5).slice(0, 3);
  const out: { id: string; name: string }[] = [];
  for (const c of picked) {
    let name = c.name;
    if (user.lang !== "en") {
      const tr = await getExerciseTranslation(db, c.id, user.lang).catch(() => null);
      if (tr?.name) name = tr.name;
    }
    out.push({ id: c.id, name });
  }
  return out;
}
