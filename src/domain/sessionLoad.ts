// What a finished session moved and roughly what it burned, for the workout summary in the Mini App
// and on Android. Computed here once and returned with the save (SaveResult.volumeKg / .kcal), so
// both clients show the same numbers; a client only falls back to its own weight × reps sum when
// the save is queued offline.
//
// Volume used to be weight × reps, so a pull-up logged as 0 kg added nothing and a client asked
// "does volume count my pull-ups?" (tester report). Bodyweight moves now count the share of body
// weight the move lifts. The shares are the usual estimates from force-plate studies (a push-up
// loads ~64% of body weight, a pull-up or dip all of it), rounded; abs work and anything not in the
// table still counts nothing, which under-reports rather than inflates.
//
// Calories are an estimate and are labelled as one: MET × body weight × hours (2024 Compendium of
// Physical Activities: resistance training 3.5 MET light, 5.0 moderate, 6.0 vigorous). There is no
// heart rate, so effort comes from the session's RPE. No body weight in the profile, no estimate.
import type { SetEntry } from "../types";

interface Share {
  pattern: RegExp;
  /** Fraction of body weight the move lifts. */
  share: number;
  /** Logged weight is added on top (a belt on pull-ups or dips). False: the move counts only when
   *  logged at 0 kg, because a loaded "squat" or "lunge" means a barbell and the bar is the load. */
  addsLoad: boolean;
}

const ASSISTED = /assist|гравітрон|гравитрон|з допомогою|с помощью|резинк/u;

// Order matters: the first match wins ("віджимання на брусах" is a dip, not a push-up).
const SHARES: Share[] = [
  { pattern: /muscle[- ]?up|вихід силою|выход силой/u, share: 1, addsLoad: true },
  { pattern: /pull[- ]?up|chin[- ]?up|підтягуван|подтягиван/u, share: 1, addsLoad: true },
  { pattern: /\bdips?\b|бруси|брусах|брусья|брусьях/u, share: 0.95, addsLoad: true },
  { pattern: /inverted row|australian|австралійськ|австралийск/u, share: 0.5, addsLoad: true },
  { pattern: /knee push[- ]?up|push[- ]?ups? .*knees|з колін|с колен/u, share: 0.49, addsLoad: false },
  { pattern: /push[- ]?up|press[- ]?up|віджиман|отжиман/u, share: 0.64, addsLoad: true },
  { pattern: /pistol|пістолет|пистолет/u, share: 0.7, addsLoad: false },
  { pattern: /squat|присідан|приседан|lunge|випад|выпад|step[- ]?up|зашагуван|зашагиван/u, share: 0.7, addsLoad: false },
];

/** The bodyweight share for an exercise name, or null when it is not a bodyweight move we know. */
export function bodyweightShare(name: string): Share | null {
  const n = name.toLowerCase();
  if (ASSISTED.test(n)) return null;
  const hit = SHARES.find((s) => s.pattern.test(n));
  return hit && hit.share > 0 ? hit : null;
}

/** Kilograms one set moved: (logged weight [+ body weight share]) × reps. Timed and distance sets move 0. */
export function setVolumeKg(name: string, set: SetEntry, bodyweightKg?: number): number {
  const reps = set.reps > 0 ? set.reps : 0;
  if (!reps) return 0;
  const weight = set.weight > 0 ? set.weight : 0;
  // An assisted move (band, gravitron): the logged weight is the help, not a load lifted. It
  // counts what is left of the body weight, or nothing when the body weight is unknown.
  if (ASSISTED.test(name.toLowerCase())) return bodyweightKg && bodyweightKg > 0 ? Math.max(0, bodyweightKg - weight) * reps : 0;
  const bw = bodyweightKg && bodyweightKg > 0 ? bodyweightShare(name) : null;
  if (bw && (bw.addsLoad || weight === 0)) return (weight + bw.share * (bodyweightKg as number)) * reps;
  return weight * reps;
}

interface LoadEntry {
  name: string;
  sets: SetEntry[];
  rpe?: number;
}

/** The session's volume in kg, rounded. */
export function sessionVolumeKg(entries: LoadEntry[], bodyweightKg?: number): number {
  let total = 0;
  for (const e of entries) for (const s of e.sets) total += setVolumeKg(e.name, s, bodyweightKg);
  return Math.round(total);
}

/** Seconds per set when the session had no clock (a backfilled day): work plus a usual rest. */
const SEC_PER_SET_ESTIMATE = 150;
const MAX_ESTIMATE_SEC = 3 * 3600;

/** MET for the session's hardest logged effort (RPE 1–10); unknown effort is moderate. */
export function sessionMet(rpes: number[]): number {
  const valid = rpes.filter((r) => r > 0 && r <= 10);
  if (!valid.length) return 5;
  const top = Math.max(...valid);
  if (top >= 8) return 6;
  if (top <= 6) return 3.5;
  return 5;
}

/**
 * Estimated kcal for the session, rounded to 5; null without a body weight or any logged set.
 * Uses the measured duration when there is one, else SEC_PER_SET_ESTIMATE per set.
 */
export function sessionKcal(entries: LoadEntry[], bodyweightKg: number | undefined, durationSec?: number): number | null {
  if (!bodyweightKg || bodyweightKg <= 0) return null;
  const sets = entries.reduce((n, e) => n + e.sets.filter((s) => s.reps > 0 || (s.seconds ?? 0) > 0 || (s.meters ?? 0) > 0).length, 0);
  if (!sets) return null;
  const sec = durationSec && durationSec > 0 ? durationSec : Math.min(MAX_ESTIMATE_SEC, sets * SEC_PER_SET_ESTIMATE);
  const rpes = entries.flatMap((e) => [e.rpe ?? 0, ...e.sets.map((s) => s.rpe ?? 0)]);
  const kcal = sessionMet(rpes) * bodyweightKg * (sec / 3600);
  return Math.max(5, Math.round(kcal / 5) * 5);
}
