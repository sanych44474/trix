// Saving a finished workout (records, progression, streaks, squad posts), shared by the bot's and the Mini App's loggers. Moved from bot/workoutSave.ts.
import { type Api } from "grammy";
import { logInfo } from "../../log";
import type { Env, ExerciseMetric, LoggedExercise, SetEntry, UserDoc, Weekday } from "../../types";
import { getActivePlan, updateActivePlanSplit } from "../../adapters/d1/v2Plans";
import { adoptLoggedWeights } from "../../domain/startWeights";
import { countCompletedWorkouts, upsertStrengthRecord, upsertWorkoutLog } from "../../adapters/d1/v2Workouts";
import { awardAchievement } from "../../adapters/d1/v2Gamification";
import { getUser, updateUser } from "../../adapters/d1/v2Users";
import { bestSetForMetric, fmtDistance, fmtDuration, metricOfSets } from "../../domain/setFormat";
import { prMilestones, workoutMilestones } from "../../domain/records";
import { cleanAi, t } from "../../locales/i18n";
import { announceSquadPr } from "../squad/prAnnounce";
import { advanceLevel } from "../gamification/level";
import { notify } from "../../notify";
import { HTML } from "../../adapters/telegram/context";

export interface WorkoutSaveEntry {
  name: string;
  sets: SetEntry[];
  rpe?: number;
  planName?: string; // Mini App swap: the plan exercise this entry replaced
}

export interface PrHit {
  name: string;
  metric: ExerciseMetric;
  weight: number;
  reps: number;
  seconds?: number;
  meters?: number;
}

/** How a PR reads in the squad announcement. Shared by both surfaces on purpose: the bot and the
 * Mini App announce the SAME record, so formatting it in each would be one more thing to drift. */
export function formatPrBest(pr: PrHit): string {
  if (pr.metric === "time") return fmtDuration(pr.seconds ?? 0);
  if (pr.metric === "distance") return fmtDistance(pr.meters ?? 0);
  return `${pr.weight} kg × ${pr.reps}`;
}

export interface WorkoutSaveOutcome {
  exercises: LoggedExercise[];
  prExercises: string[];
  prHit: PrHit | null; // first PR this save, for the single-message chat celebration
  freshBadges: string[]; // badge codes: workout-count milestones, first_pr, PR-count milestones
  totalWorkouts: number;
}

/** Persist a completed workout and run the record-keeping every save needs regardless of
 * surface: the log row, strength-record/PR detection, and workout-count + PR-count badges.
 * Ctx-free and mutates `user.reminders` in place (mirrors the DB write) so a caller chaining
 * more bookkeeping off the same UserDoc — e.g. level transition — sees the updated prCount.
 * Shared by the chat path (finalizeWorkoutLog) and the Mini App save route. */
export async function applyWorkoutSave(
  db: D1Database,
  user: UserDoc,
  entries: WorkoutSaveEntry[],
  date: string,
  weekday: Weekday,
  rawText: string,
  isPastEdit = false, // true when `date` is a backfilled day, not today (Mini App only -- the chat path always logs today)
  timing?: { durationSec?: number; restTotalSec?: number }, // Mini App only: the measured session clock
): Promise<WorkoutSaveOutcome> {
  const exercises: LoggedExercise[] = entries.map((e) => ({
    name: e.name,
    setsDone: e.sets,
    skipped: false,
    ...(e.rpe !== undefined ? { rpe: e.rpe } : {}),
    ...(e.planName ? { planName: e.planName } : {}),
  }));
  // Checked BEFORE the save: if this user already had a completed workout, today's save (new or
  // an edit of an already-logged day -- upsertWorkoutLog's ON CONFLICT means either is possible)
  // is never their first. A pre-save count of 0 means it unambiguously is, no further check needed.
  const isFirstEver = (await countCompletedWorkouts(db, user._id).catch(() => 1)) === 0;
  await upsertWorkoutLog(db, user._id, date, weekday, exercises, true, rawText, timing);
  logInfo("workout_completed", { exerciseCount: entries.length, pastDate: isPastEdit }); // shared by both surfaces on purpose (see this function's own doc comment)
  if (isFirstEver) logInfo("first_workout_completed", {});

  const prExercises: string[] = [];
  let prHit: PrHit | null = null;
  for (const e of entries) {
    const metric = metricOfSets(e.sets);
    const best = bestSetForMetric(e.sets, metric);
    if (!best) continue;
    const pr = await upsertStrengthRecord(
      db,
      user._id,
      e.name,
      { metric, weight: best.weight, reps: best.reps, seconds: best.seconds, meters: best.meters },
      date,
      e.rpe,
    );
    if (pr.isPR) {
      prExercises.push(e.name);
      if (!prHit) prHit = { name: e.name, metric, weight: best.weight, reps: best.reps, seconds: best.seconds, meters: best.meters };
    }
  }

  // "pick a weight" exercises (beginners' first sessions) take the weight just logged as their plan
  // weight. Best-effort: a failure here must not fail the save the user already made.
  try {
    const plan = await getActivePlan(db, user._id);
    if (plan && !isPastEdit) {
      const logged = entries.map((e) => ({ name: e.planName ?? e.name, weight: Math.max(0, ...e.sets.map((x) => x.weight ?? 0)) }));
      const { split, adopted } = adoptLoggedWeights(plan.split, logged);
      if (adopted) await updateActivePlanSplit(db, user._id, split);
    }
  } catch { /* keep the marker; the weekly progression adopts it later */ }

  const fresh: string[] = [];
  const total = await countCompletedWorkouts(db, user._id);
  for (const code of workoutMilestones(total)) {
    if (await awardAchievement(db, user._id, code)) fresh.push(code);
  }
  if (prExercises.length && (await awardAchievement(db, user._id, "first_pr"))) fresh.push("first_pr");

  // Lifetime PR counter → milestone badges (prs_10 / prs_25).
  if (prExercises.length) {
    const prCount = (user.reminders?.prCount ?? 0) + prExercises.length;
    const reminders = { ...user.reminders, prCount };
    await updateUser(db, user._id, { reminders }).catch(() => {});
    user.reminders = reminders;
    for (const code of prMilestones(prCount)) if (await awardAchievement(db, user._id, code)) fresh.push(code);
  }

  return { exercises, prExercises, prHit, freshBadges: fresh, totalWorkouts: total };
}

/** What a finished workout produces: the record-keeping outcome plus the level it earned. */
export interface WorkoutCompletion extends WorkoutSaveOutcome {
  level: number;
  xp: number;
  leveledUp: boolean;
  /** A level_5 / level_10 badge newly awarded by this save. Kept apart from `freshBadges` because
   * only the Mini App lists it in its response; the chat announces the level-up itself. */
  levelBadge: string | null;
}

/**
 * Everything a finished workout does, whichever surface saved it: the log and records
 * (applyWorkoutSave), the level, the trainer's "your client trained" message and the squad's PR post.
 * The chat (finalizeWorkoutLog) and the Mini App (webapp/workout.ts saveWorkout) both call this and
 * only decide how to SAY the result. Before, each carried its own copy of the side effects, and the
 * copies had drifted (see test/squad-pr-parity.test.ts for the first time that bit).
 *
 * Replay safety: the log upserts on (user, date), records only improve, badges are INSERT OR IGNORE,
 * and the trainer message goes through the notification outbox under the key (date, client), so a
 * second save of the same day -- an offline replay, an edit -- cannot notify the trainer twice. A
 * past-date correction does not notify at all ("just trained" would be misleading).
 *
 * `api` is any sender of Telegram messages (grammY's ctx.api, or the raw-fetch one the Mini App
 * uses); `defer` lets the chat post to the squad after its reply instead of before it.
 */
export async function completeWorkout(
  env: Env,
  user: UserDoc,
  entries: WorkoutSaveEntry[],
  o: {
    date: string;
    weekday: Weekday;
    rawText: string;
    isPastEdit?: boolean;
    timing?: { durationSec?: number; restTotalSec?: number };
    api: Pick<Api, "sendMessage">;
    defer?: (work: Promise<unknown>) => void;
  },
): Promise<WorkoutCompletion> {
  const isPastEdit = o.isPastEdit ?? false;
  const outcome = await applyWorkoutSave(env.DB, user, entries, o.date, o.weekday, o.rawText, isPastEdit, o.timing);
  const lv = await advanceLevel(env.DB, user);

  if (!isPastEdit && user.role === "client" && user.trainerId) {
    try {
      const trainer = await getUser(env.DB, user.trainerId);
      if (trainer) {
        await notify(env, { api: o.api }, { userId: trainer._id, chatId: trainer.chatId }, {
          kind: "trainer_workout_done",
          key: `${o.date}:${user._id}`,
          text: t(trainer.lang, "trainer_notify_done", { name: user.profile.name ?? `id ${user._id}`, n: outcome.exercises.length }),
          extra: HTML,
        });
      }
    } catch { /* the trainer message must never fail the save */ }
  }

  if (outcome.prHit) {
    const pr = outcome.prHit;
    // announceSquadPr swallows per-chat failures; the catch covers the lookup. The rows are already
    // committed, so a squad post can never be allowed to fail the save.
    const post = announceSquadPr(env.DB, o.api, user._id, cleanAi(pr.name), formatPrBest(pr)).catch(() => {});
    if (o.defer) o.defer(post);
    else await post;
  }

  return { ...outcome, level: lv?.level ?? 1, xp: lv?.xp ?? 0, leveledUp: lv?.leveledUp ?? false, levelBadge: lv?.freshBadge ?? null };
}
