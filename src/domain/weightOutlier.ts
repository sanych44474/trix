// A set weight that is an implausible jump over the athlete's own recent history: most likely a
// typo (800 for 80), not a real lift. Rule: with at least two prior sessions weighing more than 0 kg,
// the new weight must exceed BOTH 1.5 x the heaviest prior weight AND that heaviest weight + 20 kg.
// The 1.5x leg catches big lifts' typos; the +20 kg leg keeps light work (10 -> 25 kg dumbbells) and
// ordinary PRs (80 -> 100 kg) unflagged. Pure, no imports, so the Mini App can use it too.

export const IMPLAUSIBLE_RATIO = 1.5;
export const IMPLAUSIBLE_ADD_KG = 20;
const MIN_HISTORY = 2;

/** The weight (kg) above which a typed set weight is implausible for this history, or null when
 *  there is not enough history to judge. A weight strictly above it is the implausible one. */
export function implausibleAbove(history: number[]): number | null {
  const prior = history.filter((w) => w > 0);
  if (prior.length < MIN_HISTORY) return null;
  const top = Math.max(...prior);
  return Math.max(IMPLAUSIBLE_RATIO * top, top + IMPLAUSIBLE_ADD_KG);
}

export function isImplausibleJump(weight: number, history: number[]): boolean {
  const threshold = implausibleAbove(history);
  return threshold !== null && weight > threshold;
}
