// Workout logging core: parse free-text sets, the shared save pipeline (log write + PR
// detection + workout/PR-count badges — also used by the Mini App's save route via
// applyWorkoutSave), and the post-save UX (momentum recap, PR/badge celebration, trainer
// notify, next-session preview). Extracted from bot.ts (god-file split; same barrel seam via
// bot.ts's `export * from "./bot/workoutSave"`).
import { InlineKeyboard } from "grammy";
import type { ExerciseMetric, Lang, LoggedExercise, PlanDay, SetEntry, UserDoc, Weekday } from "../types";
import {
  awardAchievement, countCompletedWorkouts, getActivePlan, getUser, listStrength, updateUser,
  upsertStrengthRecord, upsertWorkoutLog, workoutLogsSince,
} from "../db/repos";
import { bestSetForMetric, fmtDistance, fmtDuration, localParts, metricOfSets, normalizeExercise, parseWorkoutText } from "../domain/progression";
import { prMilestones, rankOf, weekStartStr, weekStreak, workoutMilestones } from "../domain/records";
import { cleanAi, escapeHtml, t } from "../locales/i18n";
import { upcomingSessions } from "../render";
import { badgeLabel, computeBoards } from "./boards";
import { maybeCelebrateLevel } from "./router";
import { localCutoff } from "./report";
import { type MyContext, HTML, type TKey, menuBtn, reply, setMode } from "../bot";

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
}

export interface PrHit {
  name: string;
  metric: ExerciseMetric;
  weight: number;
  reps: number;
  seconds?: number;
  meters?: number;
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
): Promise<WorkoutSaveOutcome> {
  const exercises: LoggedExercise[] = entries.map((e) => ({
    name: e.name,
    setsDone: e.sets,
    skipped: false,
    ...(e.rpe !== undefined ? { rpe: e.rpe } : {}),
  }));
  await upsertWorkoutLog(db, user._id, date, weekday, exercises, true, rawText);

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

/** Persist a completed workout (text- or button-built), update strength records, and run the
 * shared post-save UX: celebration, trainer notification, next-session preview. Clears any
 * in-progress button-logging draft and returns the user to idle. */
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
  const outcome = await applyWorkoutSave(ctx.db, ctx.user, entries, date, weekday, rawText);

  await setMode(ctx, "idle"); // resets session to {mode} — also clears any logDraft
  // Momentum recap: this week's count + streak, and flag a bonus (off-plan) session.
  let saved = t(lang, "log_saved");
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
    saved += `\n\n${t(lang, "log_saved_summary", { week: thisWeek, streak, bonus: bonus ? t(lang, "log_bonus") : "" })}`;
  } catch {
    /* recap is optional */
  }
  await reply(ctx, saved, menuBtn(lang));
  await celebrateRecords(ctx, outcome);
  await notifyTrainerWorkout(ctx, true, outcome.exercises.length);
  await showNextSession(ctx);
}

// Celebrate a new PR (with a global rank if opted in) and any freshly-earned badges.
/** Share + invite offered at a celebration moment (PR, badge, level-up). */
function celebrationShareKb(lang: Lang): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(lang, "wcard_btn"), "share:week")
    .text(t(lang, "menu_invite"), "invite");
}

export async function celebrateRecords(ctx: MyContext, outcome: WorkoutSaveOutcome) {
  const lang = ctx.user.lang;
  const { prHit, freshBadges: fresh } = outcome;

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
    // A personal record is the moment someone actually wants to tell people. Offering the share
    // and invite here is the whole reason the referral machinery exists — buried in a settings
    // menu it never fires, because nobody opens settings feeling proud.
    await reply(ctx, msg, celebrationShareKb(lang));
  }
  if (fresh.length) {
    await reply(ctx, t(lang, "badge_unlocked", { badges: fresh.map((c) => badgeLabel(lang, c)).join(", ") }), celebrationShareKb(lang));
  }
  await maybeCelebrateLevel(ctx);
}

// After a workout is logged/skipped, surface the next dated session (complete & advance).
export async function showNextSession(ctx: MyContext) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  if (!plan) return;
  const tz = ctx.user.profile.timezone;
  const logs = (await workoutLogsSince(ctx.db, ctx.user._id, localCutoff(tz, 14))).map((l) => ({
    date: l.date,
    completed: l.completed,
  }));
  // Next session strictly after today.
  const next = upcomingSessions(lang, plan, tz, logs, 1, true)[0];
  if (next) {
    await reply(
      ctx,
      `${t(lang, "next_session")}\n\n🏋️ <b>${escapeHtml(next.label)} — ${escapeHtml(next.day.muscleGroup)}</b>\n` + renderDayInline(next.day),
    );
  }
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
