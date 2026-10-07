// Level-ups and goal completion: when a user moves to the next level, and when a fat-loss or
// gain goal counts as reached.
import type { ProgressionRate } from "../types";

/** The next experience level up, or null at the top. */
export function nextLevel(level: ProgressionLevel): ProgressionLevel | null {
  if (level === "beginner") return "intermediate";
  if (level === "intermediate") return "advanced";
  return null;
}

export type ProgressionLevel = "beginner" | "intermediate" | "advanced";

/** Ready to graduate to a harder plan when the trainee has clearly outgrown the current one:
 * training pace is "fast" AND progression fired in ≥ `minWeeks` of the recent weeks, and a
 * higher level exists. The caller offers a button — it is never auto-applied. */
export function shouldLevelUp(
  level: ProgressionLevel,
  rate: ProgressionRate,
  progressionWeeks: number,
  minWeeks = 4,
): boolean {
  return nextLevel(level) !== null && rate === "fast" && progressionWeeks >= minWeeks;
}

export const FATLOSS_GOAL_RE = /(fat|схуд|похуд|loss|cut|lean|обезжир)/i;

export const GAIN_GOAL_RE = /(muscle|mass|gain|bulk|набір|набор|мас|муск|гіпертроф|hypertroph)/i;

/** Shared: bodyweight moved `minDelta` kg in `dir` over ≥`minSpanDays`, then plateaued — the
 * last 3 weigh-ins (spanning ≥2 weeks) vary < 0.8 kg. */
export function bodyweightSettled(weights: { date: string; weight: number }[], dir: "down" | "up", minDelta: number, minSpanDays: number): boolean {
  const pts = weights.filter((w) => w.weight > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (pts.length < 4) return false;
  const span = (Date.parse(pts[pts.length - 1].date) - Date.parse(pts[0].date)) / 86_400_000;
  const delta = dir === "down" ? pts[0].weight - pts[pts.length - 1].weight : pts[pts.length - 1].weight - pts[0].weight;
  if (span < minSpanDays || delta < minDelta) return false;
  const recent = pts.slice(-3);
  const recentSpan = (Date.parse(recent[2].date) - Date.parse(recent[0].date)) / 86_400_000;
  if (recentSpan < 14) return false;
  return Math.max(...recent.map((r) => r.weight)) - Math.min(...recent.map((r) => r.weight)) < 0.8;
}

/** A cut is "done" — fat-loss goal, lost ≥2 kg over ≥4 weeks, now plateaued. */
export function fatLossGoalReached(goal: string | undefined, weights: { date: string; weight: number }[]): boolean {
  return FATLOSS_GOAL_RE.test(goal ?? "") && bodyweightSettled(weights, "down", 2, 28);
}

/** A bulk is "done" — muscle-gain goal, gained ≥3 kg over ≥6 weeks, now plateaued. */
export function gainGoalReached(goal: string | undefined, weights: { date: string; weight: number }[]): boolean {
  return GAIN_GOAL_RE.test(goal ?? "") && bodyweightSettled(weights, "up", 3, 42);
}
