// Menstrual-cycle phase math. Pure — takes an opt-in profile + today's date, returns which
// phase the user is in and the day-of-cycle. Used by the coach context (so advice can adapt
// carbs / load around the phase) and the "Cycle" settings view. No side effects.
//
// Model: a simple 4-bucket split against the classical 28-day cycle, scaled to the user's
// configured length. Menstruation days 1..5 (from last period start), late follicular 6..13,
// ovulation 14..16, luteal 17..end. Real cycles vary — this is a scaffold, not a diagnosis.

export type CyclePhase = "menstruation" | "follicular" | "ovulation" | "luteal";

export interface CyclePhaseInfo {
  phase: CyclePhase;
  day: number; // 1-based day of cycle
  cycleLength: number; // effective length used (defaults to 28)
}

function isoDaysBetween(a: string, b: string): number {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 0;
  return Math.floor((tb - ta) / 86_400_000);
}

/** Returns the cycle phase for `today` given the user's last-period start; null if the profile
 *  is not opted in, has no start date, or the numbers don't parse. Never throws. */
export function computeCyclePhase(
  profile: { cycleTracking?: boolean; lastPeriodStart?: string; cycleLengthDays?: number; sex?: "male" | "female" },
  today: string,
): CyclePhaseInfo | null {
  if (!profile.cycleTracking || profile.sex !== "female" || !profile.lastPeriodStart) return null;
  const cycleLength = Math.min(45, Math.max(20, profile.cycleLengthDays ?? 28));
  const delta = isoDaysBetween(profile.lastPeriodStart, today);
  if (!Number.isFinite(delta)) return null;
  // Modulo the cycle so a stale "last period start" still returns a sensible phase — the user
  // may have forgotten to log the next start; the schedule keeps advancing on its own.
  const day = ((delta % cycleLength) + cycleLength) % cycleLength + 1; // 1..cycleLength
  const ovulationCenter = Math.round(cycleLength / 2);
  let phase: CyclePhase;
  if (day <= 5) phase = "menstruation";
  else if (day < ovulationCenter - 1) phase = "follicular";
  else if (day <= ovulationCenter + 1) phase = "ovulation";
  else phase = "luteal";
  return { phase, day, cycleLength };
}

/** Short English label for coach-context injection (kept English so the AI prompt stays uniform). */
export function phaseLabel(phase: CyclePhase): string {
  return phase;
}

/** Rough training / nutrition guidance per phase — a compact hint the coach can weave into replies. */
export function phaseHint(phase: CyclePhase): string {
  switch (phase) {
    case "menstruation": return "energy may be low; consider a lighter session, prioritize sleep and iron-rich food";
    case "follicular": return "energy and recovery peak; good window for heavier lifts and PRs";
    case "ovulation": return "strong performance; watch joint laxity on max lifts";
    case "luteal": return "PMS may raise fatigue and carb cravings; bump complex carbs modestly, reduce intensity if needed";
  }
}
