// A set weight that is an implausible jump over the athlete's own recent history: most likely a
// typo (800 for 80), not a real lift. Rule: with at least two prior sessions weighing more than 0 kg,
// the new weight must exceed BOTH 1.5 x the heaviest prior weight AND that heaviest weight + 20 kg.
// The 1.5x leg catches big lifts' typos; the +20 kg leg keeps light work (10 -> 25 kg dumbbells) and
// ordinary PRs (80 -> 100 kg) unflagged. Pure, no imports, so the Mini App can use it too.

export const IMPLAUSIBLE_RATIO = 1.5;
export const IMPLAUSIBLE_ADD_KG = 20;
const MIN_HISTORY = 2;

export function isImplausibleJump(weight: number, history: number[]): boolean {
  const prior = history.filter((w) => w > 0);
  if (prior.length < MIN_HISTORY) return false;
  const top = Math.max(...prior);
  return weight > IMPLAUSIBLE_RATIO * top && weight > top + IMPLAUSIBLE_ADD_KG;
}
