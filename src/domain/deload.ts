// When to back off: deload timing (calendar, records, adherence), deload sets, and readiness
// advice from the day's check-in.
import { trainingWeek } from "./mesocycle";
import type { DailyCheckinDoc, PlanDoc, StrengthRecordDoc, WorkoutLogDoc } from "../types";

/** Deload is suggested if the user has been progressing ≥ 42 days on any key lift. */
export function deloadDue(records: StrengthRecordDoc[], today: string): boolean {
  const todayMs = Date.parse(today);
  return records.some((r) => {
    const first = r.history[0];
    const last = r.history[r.history.length - 1];
    if (!first || !last) return false;
    const days = (todayMs - Date.parse(first.date)) / 86_400_000;
    // A 6-week SPAN is not the same as 6 weeks of training: without this, one lift logged once
    // 42+ days ago and never touched since was enough to tell the user "you've been progressing
    // for 6-8 weeks, consider a deload" — asserting a training block that never happened. The
    // lift also has to be genuinely active (touched within the last two weeks) and to have real
    // history behind it, not a single ancient data point.
    const staleDays = (todayMs - Date.parse(last.date)) / 86_400_000;
    return days >= 42 && staleDays <= 14 && r.history.length >= 3;
  });
}

/** How many full weeks the plan has been running. */
export function weeksSincePlan(generatedAt: string, today: string): number {
  const days = (Date.parse(today) - Date.parse(generatedAt)) / 86_400_000;
  return days < 0 ? 0 : Math.floor(days / 7);
}

/** Automatic deload week for this plan (see domain/mesocycle trainingWeek, the single source). */
export function shouldDeload(plan: PlanDoc, today: string): boolean {
  return trainingWeek(plan, today).deload;
}

/** Drop an exercise's set count by ~40% for a deload week, keeping the rep range.
 * "4 × 8-10" → "2 × 8-10". Leaves set strings that don't start with "N ×" untouched. */
export function deloadSets(sets: string): string {
  return sets.replace(/^\s*(\d+)\s*([x×])/i, (_m, n: string, sep: string) => {
    const reduced = Math.max(1, Math.round(Number(n) * 0.6));
    return `${reduced} ${sep}`;
  });
}

/** Low energy, poor sleep, or high stress across the given check-ins. The single definition of
 * "not a day/week to push", shared by the weekly progression hold below and the same-day
 * readiness advice (readinessAdvice) — two different thresholds for the same idea would let the
 * bot tell you to back off today while still ratcheting the plan up for the week. */
export function poorWellbeing(checkins: DailyCheckinDoc[]): boolean {
  const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const energy = avg(checkins.map((c) => c.energy).filter((n) => n > 0));
  const sleep = avg(checkins.map((c) => c.sleep).filter((n) => n > 0));
  const stress = avg(checkins.map((c) => c.stress).filter((n) => n > 0));
  return (energy > 0 && energy <= 2) || (sleep > 0 && sleep <= 2) || stress >= 4;
}

export type Readiness = "ok" | "easy" | "light";

/** How hard to go TODAY, from today's check-in alone. `light` (≈-15% or drop a set) needs two
 * bad signals or a rock-bottom one; `easy` (≈-10%) is the single-bad-signal case, which is also
 * exactly what poorWellbeing() holds the weekly progression for. No check-in → "ok": absence of
 * data is not evidence of a bad day, and nagging someone who simply didn't log would train them
 * to ignore the line. */
export function readinessAdvice(checkin: DailyCheckinDoc | null | undefined): Readiness {
  if (!checkin) return "ok";
  const { energy, sleep, stress } = checkin;
  const bad = [energy > 0 && energy <= 2, sleep > 0 && sleep <= 2, stress >= 4].filter(Boolean).length;
  const rockBottom = energy === 1 || sleep === 1 || stress === 5;
  if (bad >= 2 || (bad >= 1 && rockBottom)) return "light";
  if (bad >= 1) return "easy";
  return "ok";
}

/** True when recent logged sessions show poor adherence (lots of skips/grinding) — a sign the
 * trainee needs a lighter week even before the calendar deload is due. Looks at logged sessions
 * only: needs at least `minSessions` rows and a completed-ratio below `threshold`. */
export function adherenceDeloadDue(
  logs: WorkoutLogDoc[],
  opts: { minSessions?: number; threshold?: number } = {},
): boolean {
  const minSessions = opts.minSessions ?? 4;
  const threshold = opts.threshold ?? 0.5;
  if (logs.length < minSessions) return false;
  const completed = logs.filter((l) => l.completed).length;
  return completed / logs.length < threshold;
}

// ---------- compliance (trainer view) ----------
