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
  // Seasonal (monthly) challenges run over the calendar month, whenever one joins.
  season?: { month: string; start: string; end: string }; // month = YYYY-MM
}

// Order = display order in the "join" list. w2 leads on purpose — an easy first win for
// someone new or coming back off a lapse, before the harder/longer ones.
export const CHALLENGES: ChallengeTemplate[] = [
  { code: "w2", metric: "workouts", target: 2, windowDays: 7, emoji: "🌱" },
  { code: "w4", metric: "workouts", target: 4, windowDays: 7, emoji: "💪" },
  { code: "nut7", metric: "nutrition_days", target: 7, windowDays: 7, emoji: "🍎" },
  { code: "steps70", metric: "steps_sum", target: 70000, windowDays: 7, emoji: "👟" },
  { code: "water5", metric: "water_days", target: 5, windowDays: 7, emoji: "💧" },
  { code: "consist12", metric: "workouts", target: 12, windowDays: 30, emoji: "🔥" },
  { code: "nut21", metric: "nutrition_days", target: 21, windowDays: 30, emoji: "🥗" },
  { code: "steps150", metric: "steps_sum", target: 150000, windowDays: 14, emoji: "🚶" },
  { code: "water20", metric: "water_days", target: 20, windowDays: 30, emoji: "🌊" },
];

// The monthly seasonal challenge: one per calendar month, rotating through these, announced by
// the bot on the month's first days (scheduler.ts) with its own badges (season_win, season_3).
// Targets are per month; progress counts from the 1st, so joining late isn't a penalty.
const SEASONS: Array<{ metric: ChallengeMetric; target: number; emoji: string }> = [
  { metric: "workouts", target: 12, emoji: "🗓" },
  { metric: "water_days", target: 20, emoji: "💧" },
  { metric: "steps_sum", target: 200_000, emoji: "👟" },
  { metric: "nutrition_days", target: 20, emoji: "🥗" },
];
const SEASON_CODE = /^season_(\d{4})_(\d{2})$/;

/** The seasonal challenge of the month `date` (YYYY-MM-DD) falls in. */
export function seasonalChallenge(date: string): ChallengeTemplate {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const pick = SEASONS[(y * 12 + (m - 1)) % SEASONS.length]!;
  const month = date.slice(0, 7);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    code: `season_${month.replace("-", "_")}`,
    ...pick,
    windowDays: days,
    season: { month, start: `${month}-01`, end: `${month}-${String(days).padStart(2, "0")}` },
  };
}

export function isSeasonCode(code: string): boolean {
  return SEASON_CODE.test(code);
}

export function challengeByCode(code: string): ChallengeTemplate | undefined {
  const season = SEASON_CODE.exec(code);
  if (season) {
    const month = Number(season[2]);
    return month >= 1 && month <= 12 ? seasonalChallenge(`${season[1]}-${season[2]}-01`) : undefined;
  }
  return CHALLENGES.find((c) => c.code === code);
}

/** [start, end] (inclusive) a challenge joined on `today` runs over. */
export function challengeWindow(tpl: ChallengeTemplate, today: string): { start: string; end: string } {
  if (tpl.season) return { start: tpl.season.start, end: tpl.season.end };
  const end = new Date(Date.parse(`${today}T00:00:00Z`) + (tpl.windowDays - 1) * 86_400_000).toISOString().slice(0, 10);
  return { start: today, end };
}

/** Title key + vars for a template: the fixed ones have their own key, seasons one per metric
 * (`month` is 1–12; render.ts's challengeTitleText turns it into the month's name). */
export function challengeTitleParts(tpl: ChallengeTemplate): { key: string; vars: Record<string, string | number> } {
  if (!tpl.season) return { key: `chal_${tpl.code}_title`, vars: {} };
  return { key: `chal_season_${tpl.metric}_title`, vars: { n: tpl.target.toLocaleString("en-US").replace(/,/g, " "), month: Number(tpl.season.month.slice(5)) } };
}

/** Seasonal badges earned at a lifetime count of seasonal wins. */
export function seasonMilestones(wins: number): Array<"season_win" | "season_3"> {
  const out: Array<"season_win" | "season_3"> = [];
  if (wins >= 1) out.push("season_win");
  if (wins >= 3) out.push("season_3");
  return out;
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
