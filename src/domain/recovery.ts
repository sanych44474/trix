// A single recovery score combining every readiness signal the app already has -- pure, no DB.
// Deliberately does NOT reach for HRV/resting heart rate: this app has no wearable integration
// (a considered exclusion, not an oversight), and a recovery score built partly on data the app
// doesn't have would either silently omit it (confusing) or fabricate a placeholder (worse). Every
// input here is either self-reported (the daily check-in) or already derived from logged training
// (conditioning load, RPE, muscle-group volume) -- see domain/{progression,conditioning,analysis}.ts.
export interface RecoveryInputs {
  checkin: { energy: number; sleep: number; stress: number } | null; // latest daily check-in, 1-5 each; null = none logged
  conditioningZone: "below" | "optimal" | "above"; // this week's cardio load vs the aerobic landmark
  avgRpe: number | null; // mean session RPE over the last few logged workouts, 0-10; null = no RPE data
  groupsAboveMav: number; // muscle groups currently trained past MAV (weeklyVolume's "above" zone)
}

export type RecoveryLabel = "great" | "good" | "fair" | "poor";

export interface RecoveryScore {
  score: number; // 0-100, higher = more recovered
  label: RecoveryLabel;
  factors: string[]; // what pulled the score down, heaviest first -- empty when score is 100
}

const LABEL_THRESHOLDS: [number, RecoveryLabel][] = [
  [80, "great"],
  [60, "good"],
  [40, "fair"],
];

function labelFor(score: number): RecoveryLabel {
  for (const [min, label] of LABEL_THRESHOLDS) if (score >= min) return label;
  return "poor";
}

/**
 * Absence of data is never treated as a bad sign (no check-in logged, no RPE recorded) --
 * matching this codebase's existing readinessAdvice philosophy: nagging someone with a low score
 * for simply not having logged anything would train them to stop logging, not to recover better.
 * Each present signal is weighted independently, so a user missing one data point (e.g. no RPE
 * this week) still gets an honest score from what IS known, not a penalty for the gap itself.
 */
export function recoveryScore(inputs: RecoveryInputs): RecoveryScore {
  let score = 100;
  const penalties: { amount: number; factor: string }[] = [];

  if (inputs.checkin) {
    const { energy, sleep, stress } = inputs.checkin;
    if (energy > 0 && energy <= 2) penalties.push({ amount: 15, factor: "low energy in your last check-in" });
    if (sleep > 0 && sleep <= 2) penalties.push({ amount: 15, factor: "poor sleep in your last check-in" });
    if (stress >= 4) penalties.push({ amount: 15, factor: "high stress in your last check-in" });
  }

  if (inputs.conditioningZone === "above") {
    penalties.push({ amount: 20, factor: "cardio load well past the weekly landmark" });
  }

  if (inputs.avgRpe !== null && inputs.avgRpe >= 9) {
    penalties.push({ amount: 15, factor: "recent sessions have been grinding (RPE 9+)" });
  }

  if (inputs.groupsAboveMav > 0) {
    const amount = Math.min(30, inputs.groupsAboveMav * 10);
    penalties.push({ amount, factor: `${inputs.groupsAboveMav} muscle group(s) trained past the weekly volume landmark` });
  }

  penalties.sort((a, b) => b.amount - a.amount);
  for (const p of penalties) score -= p.amount;
  score = Math.max(0, Math.min(100, score));

  return { score, label: labelFor(score), factors: penalties.map((p) => p.factor) };
}
