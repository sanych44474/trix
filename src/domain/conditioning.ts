// Conditioning (cardio) load — pure, no DB. The strength side of the app has always had a load
// model (weeklyVolume vs MEV/MAV in domain/analysis.ts), but cardio was only ever *logged*: it
// never reached the progression engine or the readiness advice, so the bot could happily add
// weight to Monday's squat after a week with four long runs in it. This module gives conditioning
// the same treatment — a weekly load read with landmarks, and a short-term strain signal.
import type { WorkoutLogDoc } from "../types";
import { exerciseMetric, type Readiness } from "./progression";

/**
 * Weekly aerobic landmarks in minutes. 150 min/week of moderate activity is the WHO/ACSM
 * baseline; past ~300 min/week concurrent cardio starts measurably competing with strength and
 * hypertrophy adaptations (the "interference effect"), which is where we stop adding load.
 * The session count is a second gate for logs that carry no duration at all.
 */
export const CONDITIONING_LANDMARK = { targetMin: 150, highMin: 300, highSessions: 6 };

export type ConditioningZone = "below" | "optimal" | "above";

export interface ConditioningWeek {
  sessions: number; // distinct days containing conditioning work
  minutes: number; // only from sets that actually carry a duration
  meters: number;
  untimedSets: number; // distance logged with no time — real work the minute total can't see
  zone: ConditioningZone;
}

/** Whether a logged exercise counts as conditioning. Distance/duration cardio ("Rowing", "Run",
 * "Bike") does; a timed isometric ("Plank", "Dead hang") does not — that is core work, and
 * exerciseMetric already separates the two ("distance" vs "time"). */
export function isConditioning(name: string): boolean {
  return exerciseMetric({ name }) === "distance";
}

/** Aggregate conditioning work over [sinceDate, ∞). Only completed sessions count. */
export function conditioningWeek(logs: WorkoutLogDoc[], sinceDate: string): ConditioningWeek {
  const days = new Set<string>();
  let seconds = 0;
  let meters = 0;
  let untimedSets = 0;
  for (const w of logs) {
    if (!w.completed || w.date < sinceDate) continue;
    let any = false;
    for (const ex of w.exercises) {
      if (ex.skipped || !ex.setsDone?.length || !isConditioning(ex.name)) continue;
      any = true;
      for (const s of ex.setsDone) {
        if (s.seconds && s.seconds > 0) seconds += s.seconds;
        else untimedSets++;
        if (s.meters && s.meters > 0) meters += s.meters;
      }
    }
    if (any) days.add(w.date);
  }
  const sessions = days.size;
  const minutes = Math.round(seconds / 60);
  // Deliberately NOT estimating minutes for untimed distance: a 6 min/km guess is roughly right
  // for a run and roughly triple the truth for a bike, and a wrong load number is worse than a
  // missing one. Untimed sets are surfaced instead, so the UI can ask for the duration.
  const zone: ConditioningZone =
    minutes > CONDITIONING_LANDMARK.highMin || sessions >= CONDITIONING_LANDMARK.highSessions
      ? "above"
      : minutes >= CONDITIONING_LANDMARK.targetMin
        ? "optimal"
        : "below";
  return { sessions, minutes, meters, untimedSets, zone };
}

/** Enough conditioning last week that stacking a strength increase on top is the wrong call.
 * Only the "above" zone holds — being under the aerobic baseline is a nudge, never a brake. */
export function conditioningOverload(week: ConditioningWeek): boolean {
  return week.zone === "above";
}

const DAY = 86_400_000;
// A single session big enough to still be costing recovery a day later.
const HARD_MINUTES = 45;
const HARD_METERS = 8000;

/** Was there a hard conditioning session in the last `days` days (today included)? Long runs and
 * intervals are a recovery cost the same way a heavy squat day is — today's readiness should know
 * about yesterday's 10K even when the check-in looks fine. */
export function recentConditioningStrain(logs: WorkoutLogDoc[], today: string, days = 2): boolean {
  const t = Date.parse(today);
  if (Number.isNaN(t)) return false;
  for (const w of logs) {
    if (!w.completed) continue;
    const age = (t - Date.parse(w.date)) / DAY;
    if (!(age >= 0 && age < days)) continue;
    let seconds = 0;
    let meters = 0;
    for (const ex of w.exercises) {
      if (ex.skipped || !ex.setsDone?.length || !isConditioning(ex.name)) continue;
      for (const s of ex.setsDone) {
        seconds += s.seconds ?? 0;
        meters += s.meters ?? 0;
      }
    }
    if (seconds / 60 >= HARD_MINUTES || meters >= HARD_METERS) return true;
  }
  return false;
}

/** Today's readiness with conditioning folded in: a hard recent session pushes a clean "ok" down
 * to "easy", but never overrides a worse verdict the check-in already reached. */
export function readinessWithConditioning(base: Readiness, strained: boolean): Readiness {
  return base === "ok" && strained ? "easy" : base;
}
