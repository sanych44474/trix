// Workout logging core: parse free-text sets, the shared save pipeline (log write + PR
// detection + workout/PR-count badges — also used by the Mini App's save route via
// applyWorkoutSave), and the post-save UX (momentum recap, PR/badge celebration, trainer
// notify, next-session preview). Extracted from bot.ts (god-file split; same barrel seam via
// bot.ts's `export * from "./bot/workoutSave"`).
import { InlineKeyboard, type Api } from "grammy";
import { logInfo } from "../log";
import type { Env, ExerciseMetric, Lang, LoggedExercise, PlanDay, SetEntry, UserDoc, Weekday } from "../types";
import { getActivePlan, updateActivePlanSplit } from "../adapters/d1/v2Plans";
import { adoptLoggedWeights } from "../domain/startWeights";
import {
  countCompletedWorkouts, listStrength,
  upsertStrengthRecord, upsertWorkoutLog, workoutLogsSince,
} from "../adapters/d1/v2Workouts";
import { awardAchievement } from "../adapters/d1/v2Gamification";
import { getUser, updateUser } from "../adapters/d1/v2Users";
import { bestSetForMetric, fmtDistance, fmtDuration, metricOfSets } from "../domain/setFormat";
import { localParts } from "../domain/localTime";
import { nextTargetGuidance } from "../domain/progression";
import { normalizeExercise, parseWorkoutText } from "../domain/workoutText";
import { prMilestones, rankOf, weekStartStr, weekStreak, workoutMilestones } from "../domain/records";
import { cleanAi, escapeHtml, t } from "../locales/i18n";
import { announceSquadPr } from "./squad";
import { upcomingSessions } from "../render";
import { badgeLabel, computeBoards } from "../features/gamification/boards";
import { advanceLevel } from "../features/gamification/level";
import { enqueueAndDeliver } from "../schedulerOutbox";
import { localCutoff } from "./report";
import { reactToUser, type MyContext, HTML, type TKey, reply, setMode } from "../adapters/telegram/context";
import { menuBtn } from "./keyboards";

export async function handleWorkoutLog(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const sets = parseWorkoutText(text);
  // Couldn't read any sets → ask to rephrase, stay in log mode, don't save an empty log.
  if (!sets.length) {
    await reply(ctx, t(lang, "log_unreadable"));
    return;
  }
  const { date, weekday } = localParts(ctx.user.profile.timezone);

  // Canonical names: this weekday's plan exercises + the user's existing records,
  // so "bench" and "bench press" map to one tracked lift.
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  const existing = await listStrength(ctx.db, ctx.user._id);
  const candidates = [
    ...(plan?.split.flatMap((d) => d.exercises.map((e) => e.name)) ?? []),
    // canonical English names so an English-typed log matches a localized plan exercise
    ...(plan?.split.flatMap((d) => d.exercises.map((e) => e.canonicalName).filter((n): n is string => !!n)) ?? []),
    ...existing.map((r) => r.exercise),
  ];

  const byExercise = new Map<string, SetEntry[]>();
  const rpeByExercise = new Map<string, number>();
  for (const s of sets) {
    const name = normalizeExercise(s.exercise, candidates);
    const arr = byExercise.get(name) ?? [];
    arr.push({
      reps: s.reps,
      weight: s.weight,
      ...(typeof s.seconds === "number" ? { seconds: s.seconds } : {}),
      ...(typeof s.meters === "number" ? { meters: s.meters } : {}),
      // Persist the per-set RPE too — the exercise-level max is a summary, not the ground truth.
      ...(typeof s.rpe === "number" ? { rpe: s.rpe } : {}),
    });
    byExercise.set(name, arr);
    if (typeof s.rpe === "number") rpeByExercise.set(name, Math.max(rpeByExercise.get(name) ?? 0, s.rpe));
  }
  await finalizeWorkoutLog(ctx, date, weekday as Weekday, byExercise, rpeByExercise, text);
}

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
        await enqueueAndDeliver(env, { api: o.api }, {
          userId: trainer._id,
          chatId: trainer.chatId,
          kind: "trainer_workout_done",
          idempotencyKey: `${o.date}:${user._id}`,
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

/** Persist a completed workout, update strength records, and send ONE consolidated coach recap
 * (roadmap item 6) instead of the up-to-4 separate messages this used to send (saved+summary,
 * PR, badges, next session): what was saved, PR/badges, per-key-lift "what to do next time"
 * (nextTargetGuidance — RPE-autoregulated, previously shown only on the standalone /records
 * screen), and the next session preview. Trainer notification and a rare level-up stay separate
 * messages: the trainer notify targets a different chat entirely, and a level-up is a distinct,
 * infrequent cross-feature celebration (also fired from nutrition logging) not worth threading
 * through every caller just to fold into this one. Clears any in-progress button-logging draft
 * and returns the user to idle. */
export async function finalizeWorkoutLog(
  ctx: MyContext,
  date: string,
  weekday: Weekday,
  byExercise: Map<string, SetEntry[]>,
  rpeByExercise: Map<string, number>,
  rawText: string,
) {
  const lang = ctx.user.lang;
  const entries: WorkoutSaveEntry[] = [...byExercise.entries()].map(([name, sets]) => ({
    name,
    sets,
    ...(rpeByExercise.has(name) ? { rpe: rpeByExercise.get(name)! } : {}),
  }));
  // The chat can log a past day too (cmdLogPast); a correction is not "just trained".
  const isPastEdit = date !== localParts(ctx.user.profile.timezone).date;
  const outcome = await completeWorkout(ctx.env, ctx.user, entries, {
    date, weekday, rawText, isPastEdit, api: ctx.api, defer: (work) => ctx.waitUntil(work),
  });

  await setMode(ctx, "idle"); // resets session to {mode} — also clears any logDraft

  const sections: string[] = [t(lang, "log_saved")];

  // Momentum: this week's count + streak, and flag a bonus (off-plan) session.
  try {
    const tz = ctx.user.profile.timezone;
    const [recent, plan] = await Promise.all([
      workoutLogsSince(ctx.db, ctx.user._id, localCutoff(tz, 45)),
      getActivePlan(ctx.db, ctx.user._id),
    ]);
    const doneDates = recent.filter((l) => l.completed).map((l) => l.date);
    const thisWeek = doneDates.filter((d) => d >= weekStartStr(date)).length;
    const streak = weekStreak(doneDates, date, ctx.user.reminders?.lastVacation);
    const planWeekdays = new Set((plan?.split ?? []).map((d) => d.weekday));
    const bonus = planWeekdays.size > 0 && !planWeekdays.has(weekday);
    sections.push(t(lang, "log_saved_summary", { week: thisWeek, streak, bonus: bonus ? t(lang, "log_bonus") : "" }));
  } catch {
    /* momentum line is optional */
  }

  const { lines: celebration, kb } = await celebrationLines(ctx, outcome);
  sections.push(...celebration);

  const guidancePlan = await getActivePlan(ctx.db, ctx.user._id).catch(() => null);
  const guidance = nextTargetGuidance(outcome.exercises, outcome.prExercises, 3, guidancePlan);
  if (guidance.length) {
    const guidanceLines = guidance.map((g) => {
      const flag = g.overload ? ` ${t(lang, "recap_overload_flag")}` : "";
      return `• <b>${escapeHtml(g.name)}</b> → 🎯 ${escapeHtml(g.target)}${flag}`;
    });
    sections.push(`${t(lang, "recap_next_target_title")}\n${guidanceLines.join("\n")}`);
  }

  const next = await nextSessionText(ctx);
  if (next) sections.push(next);

  // A new record gets the 🎉 effect and 🏆 on their message; any other finished workout 🔥.
  const record = outcome.prExercises.length > 0;
  await reactToUser(ctx, record ? "🏆" : "🔥");
  await reply(ctx, sections.join("\n\n"), kb ?? menuBtn(lang), record ? "celebrate" : "fire");
  if (outcome.leveledUp) await reply(ctx, t(lang, "levelup_msg", { level: outcome.level, xp: outcome.xp }), undefined, "celebrate");
}

/** Share + invite offered at a celebration moment (PR, badge, level-up). */
function celebrationShareKb(lang: Lang): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(lang, "wcard_btn"), "share:week")
    .text(t(lang, "menu_invite"), "invite");
}

/** PR + badge text for the coach recap — everything except the actual `reply()`, so
 * finalizeWorkoutLog can fold this into one message instead of the celebration living as its
 * own separate send. The squad-announce side effect still fires independently (a different
 * chat entirely, not something a "one message" merge could apply to). */
async function celebrationLines(ctx: MyContext, outcome: WorkoutSaveOutcome): Promise<{ lines: string[]; kb?: InlineKeyboard }> {
  const lang = ctx.user.lang;
  const { prHit, freshBadges: fresh } = outcome;
  const lines: string[] = [];
  let kb: InlineKeyboard | undefined;

  if (prHit) {
    let msg: string;
    if (prHit.metric === "time") {
      msg = t(lang, "pr_hit_time", { ex: cleanAi(prHit.name), value: fmtDuration(prHit.seconds ?? 0) });
    } else if (prHit.metric === "distance") {
      msg = t(lang, "pr_hit_distance", { ex: cleanAi(prHit.name), value: fmtDistance(prHit.meters ?? 0) });
    } else {
      msg = t(lang, "pr_hit", { ex: cleanAi(prHit.name), weight: prHit.weight, reps: prHit.reps });
    }
    // Global ranking is strength-only (relative e1RM); time/distance PRs aren't ranked yet.
    if (prHit.metric === "reps" && ctx.user.competeOptIn) {
      const r = rankOf((await computeBoards(ctx.db)).relative, ctx.user._id);
      if (r) msg += " " + t(lang, "pr_rank", { n: r });
    }
    // Extra praise — a rotating, celebratory line (plus the running PR count, already bumped
    // on ctx.user by applyWorkoutSave).
    const prCount = ctx.user.reminders?.prCount ?? 0;
    msg += "\n" + t(lang, `pr_praise${(prCount % 3) + 1}` as TKey, { n: prCount });
    lines.push(msg);
    // A personal record is the moment someone actually wants to tell people. Offering the share
    // and invite here is the whole reason the referral machinery exists — buried in a settings
    // menu it never fires, because nobody opens settings feeling proud.
    kb = celebrationShareKb(lang);
    // The squad hears about it too, but that is completeWorkout's job now, for both surfaces.
  }
  if (fresh.length) {
    lines.push(t(lang, "badge_unlocked", { badges: fresh.map((c) => badgeLabel(lang, c)).join(", ") }));
    kb ??= celebrationShareKb(lang);
  }
  return { lines, kb };
}

// After a workout is logged/skipped, surface the next dated session (complete & advance).
export async function showNextSession(ctx: MyContext) {
  const text = await nextSessionText(ctx);
  if (text) await reply(ctx, text);
}

async function nextSessionText(ctx: MyContext): Promise<string | null> {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  if (!plan) return null;
  const tz = ctx.user.profile.timezone;
  const logs = (await workoutLogsSince(ctx.db, ctx.user._id, localCutoff(tz, 14))).map((l) => ({
    date: l.date,
    completed: l.completed,
  }));
  // Next session strictly after today.
  const next = upcomingSessions(lang, plan, tz, logs, 1, true)[0];
  if (!next) return null;
  return `${t(lang, "next_session")}\n\n🏋️ <b>${escapeHtml(next.label)} — ${escapeHtml(next.day.muscleGroup)}</b>\n` + renderDayInline(next.day);
}

export function renderDayInline(day: PlanDay): string {
  return day.exercises.map((e, i) => `${i + 1}. ${escapeHtml(e.name)} — ${escapeHtml(e.sets)}`).join("\n");
}

// Notify the client's trainer that the client logged/skipped today's workout.
export async function notifyTrainerWorkout(ctx: MyContext, done: boolean, exerciseCount: number) {
  if (ctx.user.role !== "client" || !ctx.user.trainerId) return;
  const trainer = await getUser(ctx.db, ctx.user.trainerId);
  if (!trainer) return;
  const who = escapeHtml(ctx.user.profile.name ?? `id ${ctx.user._id}`);
  const key = done ? "trainer_notify_done" : "trainer_notify_skip";
  await ctx.api.sendMessage(trainer.chatId, t(trainer.lang, key, { name: who, n: exerciseCount }), HTML).catch(() => {});
}
