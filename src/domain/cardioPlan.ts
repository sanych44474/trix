// Structured conditioning: HR zones (from age) + a small library of interval/tempo/LISS
// session templates. Pure + testable; the bot renders these into a followable session and the
// existing cardio logger records the actual time/distance afterwards.

export interface HrZone { z: number; name: string; loPct: number; hiPct: number }

// Standard 5-zone model as % of max HR (max ≈ 220 − age, Fox formula).
export const HR_ZONES: HrZone[] = [
  { z: 1, name: "recovery", loPct: 50, hiPct: 60 },
  { z: 2, name: "endurance", loPct: 60, hiPct: 70 },
  { z: 3, name: "tempo", loPct: 70, hiPct: 80 },
  { z: 4, name: "threshold", loPct: 80, hiPct: 90 },
  { z: 5, name: "vo2max", loPct: 90, hiPct: 100 },
];

export function maxHr(age: number): number {
  return Math.max(150, Math.round(220 - age));
}

/** BPM range for a zone at the given age. */
export function zoneBpm(age: number, z: number): { lo: number; hi: number } {
  const zone = HR_ZONES[Math.max(0, Math.min(4, z - 1))];
  const hr = maxHr(age);
  return { lo: Math.round((hr * zone.loPct) / 100), hi: Math.round((hr * zone.hiPct) / 100) };
}

export interface CardioStep { label: string; minutes: number; zone: number; reps?: number }
export interface CardioTemplate {
  key: string;
  emoji: string;
  totalMin: number; // approximate total duration
  steps: CardioStep[]; // reps>1 means the step repeats (an interval set)
}

// A compact, universal library — works on any modality (bike/row/run/…): the zone is the target.
export const CARDIO_TEMPLATES: CardioTemplate[] = [
  { key: "liss", emoji: "🚶", totalMin: 40, steps: [{ label: "steady", minutes: 40, zone: 2 }] },
  { key: "tempo", emoji: "🏃", totalMin: 35, steps: [
    { label: "warmup", minutes: 8, zone: 2 },
    { label: "tempo", minutes: 20, zone: 3 },
    { label: "cooldown", minutes: 7, zone: 1 },
  ] },
  { key: "intervals", emoji: "⚡", totalMin: 32, steps: [
    { label: "warmup", minutes: 8, zone: 2 },
    { label: "hard", minutes: 1, zone: 4, reps: 8 },
    { label: "easy", minutes: 2, zone: 2, reps: 8 }, // paired with the line above (8 rounds)
    { label: "cooldown", minutes: 8, zone: 1 },
  ] },
  { key: "vo2", emoji: "🔥", totalMin: 29, steps: [
    { label: "warmup", minutes: 10, zone: 2 },
    { label: "max", minutes: 3, zone: 5, reps: 4 },
    { label: "recover", minutes: 3, zone: 1, reps: 4 },
    { label: "cooldown", minutes: 6, zone: 1 },
  ] },
];

export function cardioTemplateByKey(key: string): CardioTemplate | undefined {
  return CARDIO_TEMPLATES.find((c) => c.key === key);
}
