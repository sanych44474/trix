// Reading a plan exercise's prescribed sets, reps and weight ("4 × 8–10", "60 kg"), used by the
// bot's guided logger and the Mini App logger. Moved from bot/guidedLog.ts.


import { DURATION_ONLY } from "../../domain/muscleLoad";

// Plan display strings → numeric prefill hints for the guided logger (user types freely).
export function planSetsCount(sets: string): number {
  if (DURATION_ONLY.test(sets || "")) return 1; // "20-25 min" is one cardio block, not 20 sets
  const m = /^\s*(\d+)/.exec(sets || "");
  const n = m ? parseInt(m[1], 10) : 0;
  return n > 0 && n <= 20 ? n : 3;
}
export function planRepsMid(sets: string): number {
  const m = /[x×х*]\s*(\d+)(?:\s*[-–]\s*(\d+))?/i.exec(sets || ""); // Latin x, ×, Cyrillic х
  if (!m) return 8;
  const lo = parseInt(m[1], 10);
  const hi = m[2] ? parseInt(m[2], 10) : lo;
  return Math.max(1, Math.round((lo + hi) / 2));
}
export function planWeight(startWeight: string): number {
  const m = /(\d+(?:[.,]\d+)?)/.exec(startWeight || "");
  return m ? parseFloat(m[1].replace(",", ".")) : 0;
}
