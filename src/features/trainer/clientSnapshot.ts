// Loads a client's snapshot (domain/clientSnapshot.ts) and renders it for the trainer's Telegram
// messages. Every read is best-effort: a snapshot is context next to a message, so a failed read
// shrinks it and never blocks the question or the workout save it rides on.
import type { DB } from "../../adapters/d1/shared";
import { workoutLogsSince } from "../../adapters/d1/v2Workouts";
import { nutritionLogsSince } from "../../adapters/d1/v2Nutrition";
import { stepLogsSince, waterLogsSince } from "../../adapters/d1/v2Tracking";
import { getActivePlan } from "../../adapters/d1/v2Plans";
import { buildClientSnapshot, SNAPSHOT_DAYS, type ClientSnapshot, type WorkoutBrief } from "../../domain/clientSnapshot";
import { evaluateWeekQuests } from "../../domain/questWeek";
import { plannedDayCount } from "../../domain/quests";
import { localParts } from "../../domain/localTime";
import { weekStartStr } from "../../domain/records";
import { escapeHtml, t } from "../../locales/i18n";
import { questLabel, weekdayName } from "../../render/telegramText";
import type { Lang, UserDoc } from "../../types";

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export async function loadClientSnapshot(db: DB, client: UserDoc, now: Date = new Date()): Promise<ClientSnapshot> {
  const today = localParts(client.profile.timezone, now).date;
  const weekStart = weekStartStr(today);
  // Workouts reach back far enough for both the 14-day window and the quest pick (the week before).
  const since = [addDays(today, -(SNAPSHOT_DAYS - 1)), addDays(weekStart, -7)].sort()[0];
  const [workouts, nutrition, steps, water, plan] = await Promise.all([
    workoutLogsSince(db, client._id, since).catch(() => []),
    nutritionLogsSince(db, client._id, weekStart).catch(() => []),
    stepLogsSince(db, client._id, weekStart).catch(() => []),
    waterLogsSince(db, client._id, weekStart).catch(() => []),
    getActivePlan(db, client._id).catch(() => null),
  ]);
  const week = evaluateWeekQuests(client.profile, weekStart, { workouts, nutrition, steps, water, split: plan?.split });
  return buildClientSnapshot({
    today,
    weekStart,
    workouts,
    split: plan?.split,
    plannedDays: plannedDayCount(client.profile.trainingWeekdays, plan?.split),
    quests: week.quests,
  });
}

/** "Tue 03.11 · Груди/Трицепс — 6/7 ex., 52 min · Bench Press 80x8, Dips BWx12" (HTML-escaped). */
function workoutLine(lang: Lang, w: WorkoutBrief): string {
  const head = [`${weekdayName(lang, w.weekday)} ${w.date.slice(8, 10)}.${w.date.slice(5, 7)}`, ...(w.label ? [escapeHtml(w.label)] : [])].join(" · ");
  const facts = [
    w.planned !== null ? t(lang, "tsnap_ex", { done: w.done, planned: w.planned }) : t(lang, "tsnap_ex_noplan", { done: w.done }),
    ...(w.durationMin ? [t(lang, "tsnap_min", { n: w.durationMin })] : []),
    ...(w.rpe ? [`RPE ${w.rpe}`] : []),
    ...(w.completed ? [] : [t(lang, "tsnap_unfinished")]),
  ].join(", ");
  return `${head} — ${facts}${w.top.length ? ` · ${escapeHtml(w.top.join(", "))}` : ""}`;
}

/** The week line plus the quests the client has finished ("🎯 Quests 1/3: Hamstrings: 6 sets this week"). */
function weekLines(lang: Lang, s: ClientSnapshot): string[] {
  const week = s.weekPlanned > 0 ? t(lang, "tsnap_week", { done: s.weekDone, planned: s.weekPlanned }) : t(lang, "tsnap_week_noplan", { done: s.weekDone });
  const lines = [week];
  if (s.quests.length) {
    const done = s.quests.filter((q) => q.done).map((q) => `✅ ${questLabel(lang, q)}`);
    lines.push(`${t(lang, "tsnap_quests", { done: s.questsDone, total: s.quests.length })}${done.length ? `: ${done.join("; ")}` : ""}`);
  }
  return lines;
}

/** Context block under a routed question: the week, quests and the last workouts. */
export function snapshotBlock(lang: Lang, s: ClientSnapshot): string {
  const lines = weekLines(lang, s);
  if (!s.recent.length) lines.push(t(lang, "tsnap_none", { n: SNAPSHOT_DAYS }));
  for (const w of s.recent) lines.push(`🏋️ ${workoutLine(lang, w)}`);
  if (s.daysSinceLast !== null && s.daysSinceLast >= 4) lines.push(t(lang, "tsnap_gap", { n: s.daysSinceLast }));
  return lines.join("\n");
}

/** The "client finished a workout" ping: what they did, then how the week stands. */
export function workoutDoneText(lang: Lang, clientName: string, s: ClientSnapshot, date: string): string {
  const today = s.recent.find((w) => w.date === date);
  return [
    t(lang, "trainer_notify_workout", { name: clientName }),
    ...(today ? [`🏋️ ${workoutLine(lang, today)}`] : []),
    ...weekLines(lang, s),
  ].join("\n");
}
