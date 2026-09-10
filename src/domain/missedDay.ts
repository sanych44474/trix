// Smart reschedule for a single missed planned training day — pure, no DB. Distinct from
// atrisk.ts's missedConsecutiveWorkouts (which waits for TWO consecutive misses before alerting
// a trainer): this fires on the very first miss, for the solo/trainer-own user themselves, and
// picks which recovery option to lead with instead of just flagging the gap.
export type MissedDayOption = "makeup" | "shorten" | "deload";

/**
 * Rank the three recovery options for a single missed day, given how busy the recent stretch
 * has been and whether today's own readiness is already poor. Order is "lead with this one":
 *  - Poor recovery today (sleep/energy/stress already bad) → deload leads. Piling a catch-up
 *    session onto a day the body is already flagging is how a missed Tuesday becomes a strained
 *    Wednesday.
 *  - A genuinely busy recent stretch (missing >= 40% of planned days over the last ~2 weeks) →
 *    shorten leads. A full make-up session competes with whatever caused the miss in the first
 *    place; a smaller ask is the one actually likely to happen.
 *  - An isolated miss with good recovery → makeup leads. Nothing is stopping a full session, and
 *    treating every skip as a reason to shrink the plan trains the user to expect shrinking.
 * All three are always returned (never hide an option), just reordered.
 */
export function rankMissedDayOptions(args: { recentMissRate: number; poorRecovery: boolean }): MissedDayOption[] {
  if (args.poorRecovery) return ["deload", "shorten", "makeup"];
  if (args.recentMissRate >= 0.4) return ["shorten", "makeup", "deload"];
  return ["makeup", "shorten", "deload"];
}

/** Fraction of planned days missed in `dates` (already filtered to planned, past dates within
 * the lookback window) — 0 when nothing was planned yet (a brand-new plan shouldn't read as
 * "busy" just because it has no history). */
export function recentMissRate(plannedDates: string[], completedDates: ReadonlySet<string>): number {
  if (!plannedDates.length) return 0;
  const missed = plannedDates.filter((d) => !completedDates.has(d)).length;
  return missed / plannedDates.length;
}
