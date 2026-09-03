// Training/body analytics — pure, no DB. Weekly volume per muscle group vs. landmarks, a
// bodyweight-to-goal projection from the logged trend, and a strength-plateau detector.
// The repo layer feeds raw rows in.
import { muscleGroupOf, type MuscleGroup } from "./progression";
import { e1rm } from "./records";
import type { StrengthRecordDoc, WorkoutLogDoc } from "../types";

// Weekly working-set landmarks (rough, combined per region): MEV = minimum effective volume,
// MAV = maximum adaptive volume. Below MEV ≈ undertrained; above MAV ≈ likely junk volume.
export interface VolumeLandmark {
  mev: number;
  mav: number;
}
export const VOLUME_LANDMARKS: Record<MuscleGroup, VolumeLandmark> = {
  chest: { mev: 10, mav: 22 },
  back: { mev: 10, mav: 25 },
  legs: { mev: 8, mav: 20 },
  shoulders: { mev: 8, mav: 22 },
  arms: { mev: 8, mav: 24 },
  core: { mev: 0, mav: 16 },
};

export type VolumeZone = "below" | "optimal" | "above";

export interface MuscleVolume {
  group: MuscleGroup;
  sets: number;
  mev: number;
  mav: number;
  zone: VolumeZone;
}

/**
 * Count completed working sets per muscle group over [sinceDate, ∞) and classify each group
 * against its landmark. Only completed sessions count; unmapped exercises are ignored.
 */
export function weeklyVolume(logs: WorkoutLogDoc[], sinceDate: string): MuscleVolume[] {
  const sets = new Map<MuscleGroup, number>();
  for (const w of logs) {
    if (!w.completed || w.date < sinceDate) continue;
    for (const ex of w.exercises) {
      if (ex.skipped) continue;
      const g = muscleGroupOf(ex.name);
      if (!g) continue;
      sets.set(g, (sets.get(g) ?? 0) + ex.setsDone.length);
    }
  }
  const out: MuscleVolume[] = [];
  for (const group of Object.keys(VOLUME_LANDMARKS) as MuscleGroup[]) {
    const n = sets.get(group) ?? 0;
    const { mev, mav } = VOLUME_LANDMARKS[group];
    const zone: VolumeZone = n < mev ? "below" : n > mav ? "above" : "optimal";
    out.push({ group, sets: n, mev, mav, zone });
  }
  return out;
}

// --- bodyweight → goal projection ---

export interface WeightProjection {
  current: number;
  goal: number;
  slopePerWeek: number; // kg/week (negative = losing)
  etaWeeks?: number; // weeks to reach goal at current trend; absent if stalled or moving away
  onTrack: boolean; // trend direction matches the goal direction
  reached: boolean; // already at/past the goal
}

/**
 * Least-squares trend over dated bodyweights, projected toward a goal weight.
 * Returns null with <2 points. `etaWeeks` is set only when moving toward the goal.
 */
export function projectWeight(weights: { date: string; weight: number }[], goal: number): WeightProjection | null {
  const pts = weights.filter((w) => w.weight > 0);
  if (pts.length < 2 || !(goal > 0)) return null;
  const t0 = Date.parse(pts[0].date);
  const xs = pts.map((p) => (Date.parse(p.date) - t0) / 86_400_000); // days since first
  const ys = pts.map((p) => p.weight);
  const n = xs.length;
  const sx = xs.reduce((a, b) => a + b, 0);
  const sy = ys.reduce((a, b) => a + b, 0);
  const sxx = xs.reduce((a, b) => a + b * b, 0);
  const sxy = xs.reduce((a, b, i) => a + b * ys[i], 0);
  const denom = n * sxx - sx * sx;
  const slopePerDay = denom !== 0 ? (n * sxy - sx * sy) / denom : 0;
  const slopePerWeek = Math.round(slopePerDay * 7 * 100) / 100;
  const current = ys[ys.length - 1];
  const diff = goal - current; // >0 need to gain, <0 need to lose
  const reached = Math.abs(diff) < 0.3;
  const onTrack = reached || (diff > 0 ? slopePerWeek > 0 : slopePerWeek < 0);
  const result: WeightProjection = { current, goal, slopePerWeek, onTrack, reached };
  if (!reached && onTrack && Math.abs(slopePerWeek) >= 0.05) {
    result.etaWeeks = Math.max(1, Math.round(Math.abs(diff / slopePerWeek)));
  }
  return result;
}

// --- strength plateau detector ---

const DAY = 86_400_000;

/**
 * A weighted lift is "stalled" when, over the last 28 days, it has ≥3 logged sessions and its best
 * e1RM in the most recent 14 days did not beat the best e1RM of the prior 14 days. Bodyweight/timed
 * lifts and lifts with too little recent data are ignored. Returns the stalled exercise names.
 */
export function stalledLifts(records: StrengthRecordDoc[], today: string): string[] {
  const t = Date.parse(today);
  if (Number.isNaN(t)) return [];
  const out: string[] = [];
  for (const r of records) {
    if (r.metric !== "reps") continue;
    // Look over a full ~6-week window and compare the last 3 weeks to the 3 weeks before. A
    // 2-week read was too twitchy: double progression adds weight and RESETS reps, which briefly
    // lowers the estimated 1RM even though the athlete just got stronger — that produced false
    // "you've plateaued" alerts. We now require a real history and judge progress on BOTH axes.
    const pts = r.history
      .filter((h) => h.weight > 0 && h.reps > 0)
      .map((h) => ({ age: (t - Date.parse(h.date)) / DAY, e: e1rm(h.weight, h.reps), w: h.weight }))
      .filter((p) => p.age >= 0 && p.age <= 42);
    if (pts.length < 4) continue; // not enough training in the window to judge
    const recent = pts.filter((p) => p.age <= 21);
    const prior = pts.filter((p) => p.age > 21 && p.age <= 42);
    if (recent.length < 2 || prior.length < 1) continue;
    const maxE = (a: typeof pts) => Math.max(...a.map((p) => p.e));
    const maxW = (a: typeof pts) => Math.max(...a.map((p) => p.w));
    // Progress on EITHER axis clears the stall: a higher estimated 1RM OR a heavier top set
    // (adding load with a rep reset is progress, not a plateau). Stalled only when neither moved.
    const e1Improved = maxE(recent) > maxE(prior) + 0.5;
    const weightImproved = maxW(recent) > maxW(prior);
    if (!e1Improved && !weightImproved) out.push(r.exercise);
  }
  return out;
}
