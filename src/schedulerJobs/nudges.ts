// The user-facing reminders of one hourly pass, one function each. processUser runs them in the
// order of NUDGES (scheduler.ts) and stops at the first that sends, so at most one reminder goes
// out per pass; quiet hours and the daily cap are applied there too. Each function checks its
// own conditions and returns true when it sent (or durably queued) its message.
//
// Not here: trainer alerts and the referral reward (they go to someone else and run every pass),
// and the silent Monday jobs (progression, mesocycle week, quests, reports), which run after.
import { InlineKeyboard } from "grammy";
import type { UserPass } from "./userPass";
import { HTML } from "./shared";
import { escapeHtml, t } from "../locales/i18n";
import { activeChallengeCodes } from "../adapters/d1/v2Gamification";
import { getDailyCheckin, getWater, listInjuriesDue, markInjuryAsked } from "../adapters/d1/v2Tracking";
import { listStrength, workoutLogsSince } from "../adapters/d1/v2Workouts";
import { updateUser } from "../adapters/d1/v2Users";
import { resolveWaterGoal, seasonalChallenge } from "../domain/challenges";
import { trainingWeek } from "../domain/mesocycle";
import { adherenceDeloadDue, weeksSincePlan } from "../domain/deload";
import { getPlanDay } from "../domain/progression";
import { isoWeekKey, streakRisk } from "../domain/records";
import { stalledLifts } from "../domain/analysis";
import { daysBetween } from "../domain/reminderTiming";
import { weighInDue } from "../domain/weighIn";
import type { Weekday } from "../types";
import { renderDay, challengeTitleText } from "../render";
import { surveyKb, surveyRemaining } from "../bot/survey";
import { appKeyboardEnabled } from "../notify/appKeyboard";
import { isoDaysAgo } from "./shared";

export const CHECKIN_HOUR = 20;
export const EVENING_HOUR = 21; // one combined evening survey (water / steps / food / check-in) — 9pm local
export const QUALITY_EVERY_DAYS = 14; // recurring "rate trix + what's missing" quality/feedback ask

const withKb = (kb: InlineKeyboard | undefined) => (kb ? { ...HTML, reply_markup: kb } : HTML);

/**
 * Pre-workout readiness check — on a TRAINING day, in the hour before the reminder hour, so
 * "sleep" means last night and the advice lands before the session. Its window is one hour, so it
 * runs ahead of the reminders that can fire in any hour.
 */
export async function readinessCheck(p: UserPass): Promise<boolean> {
  const { user, db, lang, date, hour, reminderHour, isTrainingDay, loggedToday, remOff, already } = p;
  const readinessHour = Math.max(6, reminderHour - 1);
  if (remOff("wellbeing") || !isTrainingDay || hour < readinessHour || hour >= reminderHour || already("wellbeing")) return false;
  if (loggedToday || (await getDailyCheckin(db, user._id, date))) return false;
  const kb = p.appKb([[{ text: t(lang, "menu_checkin"), view: "progress", fallback: "checkin:start" }]]);
  await p.sendAndMark("wellbeing", t(lang, "reminder_wellbeing"), withKb(kb));
  return true;
}

/**
 * Water on a schedule (opt-in via profile.waterEvery = 2/3/4h): 9:00–20:00 local, every N hours
 * from 9, while today's goal isn't met. Deduped per local HOUR, not per day: a Durable Object woken
 * twice in one hour must not send it twice, and the next slot must still fire.
 */
export async function waterReminder(p: UserPass): Promise<boolean> {
  const { user, db, lang, date, hour, remOff, sent } = p;
  const every = user.profile.waterEvery ?? 0;
  const slot = `${date}T${hour}`;
  if (every < 2 || remOff("water") || hour < 9 || hour > 20 || (hour - 9) % every !== 0 || sent["water"] === slot) return false;
  const goal = resolveWaterGoal(user.profile);
  const ml = (await getWater(db, user._id, date).catch(() => 0)) ?? 0;
  if (ml >= goal) return false;
  const kb = p.appKb([[{ text: t(lang, "nb_open_fuel"), view: "fuel", fallback: "water:add:250" }]]);
  const r = await p.send(t(lang, "water_reminder", { ml, goal }), withKb(kb));
  if (p.durable(r)) p.setSent("water", slot);
  return true;
}

/**
 * 🔥 Streak rescue — late in the week, once per ISO week, only when a real (≥2-week) streak is on
 * the line. streakRisk simulates next Monday through the same rules the user is shown.
 */
export async function streakRescue(p: UserPass): Promise<boolean> {
  const { user, db, lang, date, weekday, hour, reminderHour, remOff, sent } = p;
  const week = isoWeekKey(date);
  if (!user.onboarded || remOff("workout") || weekday < 5 || hour < reminderHour || sent["streak_rescue"] === week) return false;
  const dates = (await workoutLogsSince(db, user._id, isoDaysAgo(120)).catch(() => [])).filter((l) => l.completed).map((l) => l.date);
  const risk = streakRisk(dates, date, user.reminders?.lastVacation);
  if (!risk.atRisk || risk.current < 2) return false;
  const kb = p.appKb([[{ text: t(lang, "app_log_btn"), view: "train", fallback: "log:done" }]]);
  const r = await p.send(t(lang, "streak_rescue", { weeks: risk.current }), withKb(kb));
  // Week-keyed, so marking a dropped send would skip the rescue for the whole week.
  if (p.durable(r)) p.setSent("streak_rescue", week);
  return true;
}

/** Evening survey — one message with a button per daily log not done yet (food, water, steps, check-in). */
export async function eveningSurvey(p: UserPass): Promise<boolean> {
  const { user, db, lang, date, hour, already } = p;
  if (!user.onboarded || hour < EVENING_HOUR || already("survey")) return false;
  const items = await surveyRemaining(db, user, date, lang);
  if (!items.length) return false;
  const kb = p.appKb(items.map((it) => [{ text: it.label, view: it.key === "food" || it.key === "water" ? "fuel" : "progress", fallback: it.cb }])) ?? surveyKb(items);
  await p.sendAndMark("survey", t(lang, "survey_prompt"), { ...HTML, reply_markup: kb });
  return true;
}

/** Day-before heads-up in the evening when TOMORROW is a training day (not while today is still unlogged). */
export async function tomorrowPreview(p: UserPass): Promise<boolean> {
  const { lang, weekday, hour, trainsOn, isTrainingDay, loggedToday, activePlan, remOff, already } = p;
  const tomorrow = (weekday === 7 ? 1 : weekday + 1) as Weekday;
  if (remOff("tomorrow") || hour < CHECKIN_HOUR || !trainsOn(tomorrow) || (isTrainingDay && !loggedToday) || already("tomorrow")) return false;
  const day = activePlan ? getPlanDay(activePlan, tomorrow) : undefined;
  if (!day) return false;
  const text = t(lang, "reminder_tomorrow", { group: day.muscleGroup }) + "\n\n" + renderDay(lang, day, undefined, "none");
  await p.sendAndMark("tomorrow", text, withKb(p.appKb([[{ text: t(lang, "nb_open_plan"), view: "plan" }]])));
  return true;
}

/** Injury follow-up — when a reported injury's check date arrives; re-asks daily until resolved (lastAskedAt). */
export async function injuryFollowUp(p: UserPass): Promise<boolean> {
  const { user, db, lang, date, hour, reminderHour } = p;
  if (hour < reminderHour) return false;
  const due = await listInjuriesDue(db, user._id, date);
  if (!due.length) return false;
  const inj = due[0];
  const area = t(lang, `inj_area_${inj.area}` as Parameters<typeof t>[1]);
  // The score is entered on the injury card in the app; without the app the 4-level scale stays.
  const kb = p.appKb([[{ text: t(lang, "nb_injury"), view: "role" }]]) ?? new InlineKeyboard()
    .text(t(lang, "inj_score_0"), `inj:sc:${inj.id}:0`)
    .text(t(lang, "inj_score_3"), `inj:sc:${inj.id}:3`)
    .row()
    .text(t(lang, "inj_score_6"), `inj:sc:${inj.id}:6`)
    .text(t(lang, "inj_score_8"), `inj:sc:${inj.id}:8`);
  const r = await p.send(t(lang, "inj_check_q", { area }), { ...HTML, reply_markup: kb });
  if (p.durable(r)) await markInjuryAsked(db, inj.id, date);
  return true;
}

/** Rating + "what's missing" ask, every QUALITY_EVERY_DAYS at the reminder hour. */
export async function qualityAsk(p: UserPass): Promise<boolean> {
  const { env, user, lang, date, hour, reminderHour, remOff, sent } = p;
  if (!user.onboarded || remOff("quality") || hour < reminderHour || daysBetween(sent["quality"], date) < QUALITY_EVERY_DAYS) return false;
  // Rating and "what's missing" both go through the feedback form in the app's Settings.
  const kb = p.appKb([[{ text: t(lang, "nb_rate"), view: "settings" }]]) ?? new InlineKeyboard()
    .text("⭐", "qr:1").text("⭐⭐", "qr:2").text("⭐⭐⭐", "qr:3")
    .row()
    .text("⭐⭐⭐⭐", "qr:4").text("⭐⭐⭐⭐⭐", "qr:5");
  await p.sendAndMark("quality", t(lang, appKeyboardEnabled(env) ? "reminder_quality_app" : "reminder_quality"), { ...HTML, reply_markup: kb });
  return true;
}

/** Morning weigh-in (domain/weighIn): weight trackers only, 3+ days since the last weigh-in. */
export async function weighInNudge(p: UserPass): Promise<boolean> {
  const { user, lang, date, hour, remOff, sent } = p;
  if (!user.onboarded || remOff("weighin")) return false;
  const body = await p.bodyAll();
  const gap = weighInDue({
    today: date, hour,
    weightDates: body.filter((b) => typeof b.weight === "number" && (b.weight as number) > 0).map((b) => b.date),
    hasGoalWeight: !!user.profile.goalWeight,
    lastSent: sent["weighin"],
  });
  if (gap === null) return false;
  const kb = p.appKb([[{ text: t(lang, "weighin_log_btn"), view: "progress", fallback: "wi:log" }]])
    ?? new InlineKeyboard().text(t(lang, "weighin_log_btn"), "wi:log").text(t(lang, "weighin_off_btn"), "wi:off");
  await p.sendAndMark("weighin", t(lang, gap > 0 ? "reminder_weighin" : "reminder_weighin_first", { n: gap }), { ...HTML, reply_markup: kb });
  return true;
}

/** Weekly measurements — Sunday at the reminder hour, once. */
export async function sundayMeasure(p: UserPass): Promise<boolean> {
  const { lang, weekday, hour, reminderHour, remOff, already } = p;
  if (remOff("measure") || weekday !== 7 || hour < reminderHour || already("measure")) return false;
  await p.sendAndMark("measure", t(lang, "reminder_measure"), withKb(p.appKb([[{ text: t(lang, "menu_measure"), view: "progress", fallback: "menu:measure" }]])));
  return true;
}

/** The month's seasonal challenge, announced on days 1–3 to anyone not in it yet. */
export async function seasonalChallengeNudge(p: UserPass): Promise<boolean> {
  const { user, db, lang, date, hour, reminderHour, remOff, sent } = p;
  if (remOff("digest") || !user.onboarded || Number(date.slice(8, 10)) > 3 || hour < reminderHour || (sent["season"] ?? "").slice(0, 7) === date.slice(0, 7)) return false;
  const season = seasonalChallenge(date);
  const joined = await activeChallengeCodes(db, user._id, date).catch(() => new Set<string>());
  if (joined.has(season.code)) { p.markSent("season"); return false; }
  const kb = p.appKb([[{ text: t(lang, "chal_season_join_btn"), view: "role", fallback: `chal:join:${season.code}` }]]);
  await p.sendAndMark("season", t(lang, "chal_season_announce", { title: escapeHtml(`${season.emoji} ${challengeTitleText(lang, season)}`) }), withKb(kb));
  return true;
}

/** Plateau heads-up — Monday, at most every 2 weeks, naming the stuck lifts. */
export async function plateauNudge(p: UserPass): Promise<boolean> {
  const { user, db, lang, date, weekday, hour, reminderHour, remOff, sent } = p;
  if (remOff("plateau") || weekday !== 1 || hour < reminderHour || daysBetween(sent["plateau"], date) < 14) return false;
  const stalled = stalledLifts(await listStrength(db, user._id), date);
  if (!stalled.length) return false;
  const lifts = stalled.slice(0, 2).join(", ");
  const kb = p.appKb([[{ text: t(lang, "menu_coach"), view: "coach", params: { ask: t(lang, "ask_plateau", { lifts }) }, fallback: "menu:coach" }]]);
  await p.sendAndMark("plateau", t(lang, "plateau_nudge", { lifts: stalled.slice(0, 2).map(escapeHtml).join(", ") }), withKb(kb));
  return true;
}

/** Cycle-tracking setup — Monday, once a week, for women who haven't set it up. */
export async function cycleNudge(p: UserPass): Promise<boolean> {
  const { user, lang, weekday, hour, reminderHour, already } = p;
  if (weekday !== 1 || hour < reminderHour || !user.onboarded || user.profile.sex !== "female" || already("cycle_nudge")) return false;
  if (user.profile.cycleTracking && user.profile.lastPeriodStart) return false;
  await p.sendAndMark("cycle_nudge", t(lang, "cycle_nudge"), withKb(p.appKb([[{ text: t(lang, "cycle_nudge_btn"), view: "settings", fallback: "set:cycle" }]])));
  return true;
}

/** Deload — Monday: the plan's own deload week, or several missed/grinding sessions lately. */
export async function deloadNudge(p: UserPass): Promise<boolean> {
  const { user, lang, date, weekday, hour, reminderHour, activePlan, already } = p;
  if (weekday !== 1 || hour < reminderHour || user.role === "client" || already("deload") || !activePlan) return false;
  const calendarDue = trainingWeek(activePlan, date).deload;
  const adherenceDue = !calendarDue && adherenceDeloadDue(await p.workouts21());
  if (!calendarDue && !adherenceDue) return false;
  // deload_week says "you've trained hard for ~7 weeks": only true if sessions were logged.
  const trainedRecently = calendarDue ? (await p.workouts21()).some((l) => l.completed) : false;
  const kb = p.appKb([[{ text: t(lang, "menu_coach"), view: "coach", params: { ask: t(lang, "ask_deload") }, fallback: "menu:coach" }]]);
  await p.sendAndMark("deload", t(lang, calendarDue && trainedRecently ? "deload_week" : "deload_adherence"), withKb(kb));
  return true;
}

/** Two-week check-in — Monday of every 2nd plan week; the answer goes to the AI coach. */
export async function adaptiveCheckin(p: UserPass): Promise<boolean> {
  const { user, db, lang, date, weekday, hour, reminderHour, activePlan, already } = p;
  if (weekday !== 1 || hour < reminderHour || user.role === "client" || already("adaptive_checkin") || !activePlan) return false;
  const w = weeksSincePlan(activePlan.generatedAt.toISOString().slice(0, 10), date);
  if (w <= 0 || w % 2 !== 0) return false;
  const kb = p.appKb([[{ text: t(lang, "nb_reply"), view: "coach", params: { ask: t(lang, "ask_adaptive") } }]]);
  if (kb) {
    await p.sendAndMark("adaptive_checkin", t(lang, "adaptive_checkin_app"), { ...HTML, reply_markup: kb });
  } else {
    // Without the app the reply comes in the chat, so park the session for it.
    await p.sendAndMark("adaptive_checkin", t(lang, "adaptive_checkin_prompt"));
    user.session = { ...user.session, mode: "checkin_adaptive" };
    await updateUser(db, user._id, { session: user.session });
  }
  return true;
}
