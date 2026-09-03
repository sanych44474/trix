// Bot Records — pure scoring helpers for the global leaderboards.
// No DB access here; the repo layer feeds raw rows in, this computes boards.

export interface StrengthRow {
  userId: number;
  exercise: string;
  bestWeight: number;
  bestReps: number;
  history: { date: string; weight: number; reps: number }[];
}

export interface Competitor {
  userId: number;
  name: string; // resolved display name / alias / "Анонім"
  sex?: "male" | "female";
  weightKg?: number; // latest bodyweight, for relative strength
}

export interface BoardEntry {
  userId: number;
  name: string;
  value: number; // raw score (count / ratio / percent)
  detail?: string; // pre-formatted extra (e.g. exercise name, "×N reps")
}

/** Epley estimated 1-rep max. Bodyweight sets (weight 0) return 0 (no external load). */
export function e1rm(weight: number, reps: number): number {
  if (weight <= 0 || reps <= 0) return 0;
  return weight * (1 + reps / 30);
}

/** ISO week key "YYYY-Www" for a YYYY-MM-DD date (Thursday-of-week rule). */
export function isoWeekKey(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "0000-W00";
  // Shift to the Thursday of the current ISO week.
  const day = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const ftDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ftDay + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Monday (YYYY-MM-DD) of the ISO week containing the given date. */
export function weekStartStr(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

/** The ISO week key N weeks before the given date. */
export function weekKeyOffset(todayStr: string, weeksBack: number): string {
  const d = new Date(`${todayStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - weeksBack * 7);
  return isoWeekKey(d.toISOString().slice(0, 10));
}

/** [Monday, Sunday] (YYYY-MM-DD) of the ISO week N weeks before the given date. */
function weekRangeOffset(todayStr: string, weeksBack: number): { from: string; to: string } {
  const d = new Date(`${todayStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - weeksBack * 7);
  const from = weekStartStr(d.toISOString().slice(0, 10));
  const end = new Date(`${from}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  return { from, to: end.toISOString().slice(0, 10) };
}

/** Consecutive weeks (counting back from this week) that have ≥1 workout.
 * The current week is a grace period: if it's empty we still start from last week.
 * An empty week that overlaps the `frozen` vacation window is SKIPPED — an agreed pause
 * must not break the streak (it adds nothing either).
 * AUTO STREAK-FREEZE (Duolingo-style): ONE missed week inside an established streak does
 * not burn it — the bridge is "earned" by ≥4 consecutive trained weeks on the far (older)
 * side of the gap, and at most one gap per streak is forgiven. A pure trailing slide
 * (nothing trained since the gap) is NOT protected. */
export function weekStreak(
  workoutDates: string[],
  todayStr: string,
  frozen?: { from: string; until: string },
): number {
  const weeks = new Set(workoutDates.map(isoWeekKey));
  const isFrozen = (i: number) => {
    if (!frozen) return false;
    const w = weekRangeOffset(todayStr, i);
    return frozen.from <= w.to && frozen.until >= w.from;
  };
  let streak = 0;
  let i = 0;
  let graceUsed = false;
  let autoFreezeUsed = false;
  for (;;) {
    if (weeks.has(weekKeyOffset(todayStr, i))) {
      streak++;
      i++;
      continue;
    }
    if (i === 0 && !graceUsed) {
      // grace: allow the in-progress week to be empty
      graceUsed = true;
      i++;
      continue;
    }
    if (isFrozen(i)) {
      i++;
      continue;
    }
    if (!autoFreezeUsed && streak >= 1) {
      let older = 0;
      while (weeks.has(weekKeyOffset(todayStr, i + 1 + older))) older++;
      if (older >= 4) {
        autoFreezeUsed = true;
        i++;
        continue;
      }
    }
    break;
  }
  return streak;
}

/** How many tracked lifts hit their ALL-TIME best (by e1RM) on/after `sinceDate` —
 * "N new PRs this week" for the shareable card. Weighted rep lifts only. */
export function recentPrCount(
  records: { metric?: string; bestWeight: number; history: { date: string; weight: number; reps: number }[] }[],
  sinceDate: string,
): number {
  let n = 0;
  for (const r of records) {
    if ((r.metric ?? "reps") !== "reps" || r.bestWeight <= 0) continue;
    let best: { date: string; weight: number; reps: number } | null = null;
    for (const h of r.history) {
      if (h.weight <= 0 || h.reps <= 0) continue;
      if (!best || e1rm(h.weight, h.reps) > e1rm(best.weight, best.reps)) best = h;
    }
    if (best && best.date >= sinceDate) n++;
  }
  return n;
}

/** Best estimated 1RM a user reached in a date window (inclusive lower bound). */
function bestE1rmInWindow(
  history: { date: string; weight: number; reps: number }[],
  fromStr?: string,
  toExclusiveStr?: string,
): number {
  let best = 0;
  for (const h of history) {
    if (fromStr && h.date < fromStr) continue;
    if (toExclusiveStr && h.date >= toExclusiveStr) continue;
    best = Math.max(best, e1rm(h.weight, h.reps));
  }
  return best;
}

/** 🔥 Weekly consistency — completed workouts since weekStart, per user, ranked. */
export function consistencyBoard(
  competitors: Map<number, Competitor>,
  workoutDates: { userId: number; date: string }[],
  weekStartStr: string,
): BoardEntry[] {
  const counts = new Map<number, number>();
  for (const w of workoutDates) {
    if (w.date < weekStartStr) continue;
    if (!competitors.has(w.userId)) continue;
    counts.set(w.userId, (counts.get(w.userId) ?? 0) + 1);
  }
  return rank(competitors, counts);
}

/** 🗂 All-time most completed workouts, per user, ranked. */
export function totalWorkoutsBoard(
  competitors: Map<number, Competitor>,
  workoutDates: { userId: number; date: string }[],
): BoardEntry[] {
  const counts = new Map<number, number>();
  for (const w of workoutDates) {
    if (!competitors.has(w.userId)) continue;
    counts.set(w.userId, (counts.get(w.userId) ?? 0) + 1);
  }
  return rank(competitors, counts);
}

/** 💪 All-time relative strength — best e1RM / bodyweight across the user's lifts. */
export function relativeStrengthBoard(
  competitors: Map<number, Competitor>,
  strength: StrengthRow[],
): BoardEntry[] {
  const best = new Map<number, { ratio: number; exercise: string }>();
  for (const s of strength) {
    const c = competitors.get(s.userId);
    if (!c?.weightKg || c.weightKg <= 0) continue;
    const ratio = e1rm(s.bestWeight, s.bestReps) / c.weightKg;
    if (ratio <= 0) continue;
    const cur = best.get(s.userId);
    if (!cur || ratio > cur.ratio) best.set(s.userId, { ratio, exercise: s.exercise });
  }
  const entries: BoardEntry[] = [];
  for (const [userId, v] of best) {
    const c = competitors.get(userId)!;
    entries.push({ userId, name: c.name, value: v.ratio, detail: v.exercise });
  }
  return entries.sort((a, b) => b.value - a.value);
}

/** 📈 Weekly most-improved — best % e1RM gain in the last 7 days vs the prior best. */
export function mostImprovedBoard(
  competitors: Map<number, Competitor>,
  strength: StrengthRow[],
  cutoffStr: string,
): BoardEntry[] {
  const best = new Map<number, { pct: number; exercise: string }>();
  for (const s of strength) {
    if (!competitors.has(s.userId)) continue;
    const prior = bestE1rmInWindow(s.history, undefined, cutoffStr);
    if (prior <= 0) continue; // need a baseline to measure improvement
    const recent = bestE1rmInWindow(s.history, cutoffStr, undefined);
    if (recent <= prior) continue;
    const pct = ((recent - prior) / prior) * 100;
    const cur = best.get(s.userId);
    if (!cur || pct > cur.pct) best.set(s.userId, { pct, exercise: s.exercise });
  }
  const entries: BoardEntry[] = [];
  for (const [userId, v] of best) {
    const c = competitors.get(userId)!;
    entries.push({ userId, name: c.name, value: v.pct, detail: v.exercise });
  }
  return entries.sort((a, b) => b.value - a.value);
}

function rank(competitors: Map<number, Competitor>, counts: Map<number, number>): BoardEntry[] {
  const entries: BoardEntry[] = [];
  for (const [userId, value] of counts) {
    if (value <= 0) continue;
    const c = competitors.get(userId);
    if (!c) continue;
    entries.push({ userId, name: c.name, value });
  }
  return entries.sort((a, b) => b.value - a.value);
}

/** 1-based rank of a user within a board, or 0 if absent. */
export function rankOf(board: BoardEntry[], userId: number): number {
  const i = board.findIndex((e) => e.userId === userId);
  return i < 0 ? 0 : i + 1;
}

// ---------- achievements ----------

// Badge codes → locale key suffix "badge_<code>" (label) carries its own emoji.
export const BADGES = [
  "first_workout",
  "workouts_10",
  "workouts_50",
  "workouts_100",
  "first_pr",
  "prs_10",
  "prs_25",
  "perfect_day",
  "streak_4",
  "streak_12",
  "balanced_week",
  "level_5",
  "level_10",
  "referral",
] as const;
export type BadgeCode = (typeof BADGES)[number];

/** Personal-record milestones — badges earned at a lifetime count of PRs set. */
export function prMilestones(prCount: number): BadgeCode[] {
  const out: BadgeCode[] = [];
  if (prCount >= 10) out.push("prs_10");
  if (prCount >= 25) out.push("prs_25");
  return out;
}

/** Workout-count badges earned at a given lifetime completed-workout total. */
export function workoutMilestones(total: number): BadgeCode[] {
  const out: BadgeCode[] = [];
  if (total >= 1) out.push("first_workout");
  if (total >= 10) out.push("workouts_10");
  if (total >= 50) out.push("workouts_50");
  if (total >= 100) out.push("workouts_100");
  return out;
}

/** Streak badges earned at a given week-streak length. */
export function streakMilestones(streak: number): BadgeCode[] {
  const out: BadgeCode[] = [];
  if (streak >= 4) out.push("streak_4");
  if (streak >= 12) out.push("streak_12");
  return out;
}
