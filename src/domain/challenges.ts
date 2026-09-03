// Challenges — pure templates + progress math. No DB. The repo layer feeds raw counts in.
// A challenge is a consistency goal over a fixed window; progress is recomputed live from logs
// (so it's always correct even if a log is edited/deleted), and only enrollment is persisted.

export type ChallengeMetric = "workouts" | "nutrition_days" | "steps_sum" | "water_days";

export interface ChallengeTemplate {
  code: string;
  metric: ChallengeMetric;
  target: number;
  windowDays: number;
  emoji: string;
}

// Order = display order in the "join" list.
export const CHALLENGES: ChallengeTemplate[] = [
  { code: "w4", metric: "workouts", target: 4, windowDays: 7, emoji: "💪" },
  { code: "nut7", metric: "nutrition_days", target: 7, windowDays: 7, emoji: "🍎" },
  { code: "steps70", metric: "steps_sum", target: 70000, windowDays: 7, emoji: "👟" },
  { code: "water5", metric: "water_days", target: 5, windowDays: 7, emoji: "💧" },
  { code: "consist12", metric: "workouts", target: 12, windowDays: 30, emoji: "🔥" },
];

export function challengeByCode(code: string): ChallengeTemplate | undefined {
  return CHALLENGES.find((c) => c.code === code);
}

/** Raw counts computed by the repo layer over a challenge's [startDate, endDate] window. */
export interface ChallengeData {
  workouts: number; // completed workout days
  nutritionDays: number; // days food was logged
  stepsSum: number; // total steps
  waterDays: number; // days the water goal was met
}

/** Daily water goal (ml) from bodyweight — single source for the bot and the Mini App. */
export function waterGoalMl(weightKg?: number): number {
  if (!weightKg || weightKg <= 0) return 2500;
  return Math.max(1500, Math.round((weightKg * 35) / 100) * 100);
}

/** Personal override first, formula as fallback — use this wherever a profile is at hand. */
export function resolveWaterGoal(profile: { waterGoalMl?: number; weightKg?: number }): number {
  return profile.waterGoalMl && profile.waterGoalMl > 0 ? profile.waterGoalMl : waterGoalMl(profile.weightKg);
}

export const DEFAULT_STEPS_GOAL = 8000;

export function resolveStepsGoal(profile: { stepsGoal?: number }): number {
  return profile.stepsGoal && profile.stepsGoal > 0 ? profile.stepsGoal : DEFAULT_STEPS_GOAL;
}

/** Pure window aggregation for challenge progress; callers prefetch the four log arrays. */
export function challengeWindowCounts(
  logs: {
    workouts: { date: string; completed: boolean }[];
    nutrition: { date: string }[];
    steps: { date: string; steps: number }[];
    water: { date: string; ml: number }[];
  },
  startDate: string,
  endDate: string,
  waterGoal: number,
): ChallengeData {
  const inWin = (d: string) => d >= startDate && d <= endDate;
  return {
    workouts: new Set(logs.workouts.filter((l) => l.completed && inWin(l.date)).map((l) => l.date)).size,
    nutritionDays: new Set(logs.nutrition.filter((l) => inWin(l.date)).map((l) => l.date)).size,
    stepsSum: logs.steps.filter((l) => inWin(l.date)).reduce((s, l) => s + l.steps, 0),
    waterDays: logs.water.filter((w) => inWin(w.date) && w.ml >= waterGoal).length,
  };
}

/** Pick the metric value this template tracks out of the gathered window data. */
export function challengeCurrent(tpl: ChallengeTemplate, data: ChallengeData): number {
  switch (tpl.metric) {
    case "workouts":
      return data.workouts;
    case "nutrition_days":
      return data.nutritionDays;
    case "steps_sum":
      return data.stepsSum;
    case "water_days":
      return data.waterDays;
  }
}

export interface ChallengeStatus {
  current: number;
  target: number;
  pct: number; // 0..100, capped
  done: boolean;
}

export function challengeStatus(tpl: ChallengeTemplate, current: number): ChallengeStatus {
  const pct = tpl.target > 0 ? Math.min(100, Math.round((current / tpl.target) * 100)) : 0;
  return { current, target: tpl.target, pct, done: current >= tpl.target };
}

/** A 10-cell unicode progress bar for the given percentage (0..100). */
export function progressBar(pct: number): string {
  const filled = Math.max(0, Math.min(10, Math.round(pct / 10)));
  return "▰".repeat(filled) + "▱".repeat(10 - filled);
}
