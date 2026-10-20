// Signup -> first workout -> second workout: where new people drop off. Computed from state (the
// account, onboarding, plan and workout tables), not from per-step events, so it covers accounts
// created before any funnel event existed. "Started onboarding" is the one step with no state of
// its own (adapters/d1/funnel.ts). Pure; test/funnel.test.ts.

/** One account's milestones. Dates are YYYY-MM-DD (workouts are logged by local date). */
export interface FunnelAccount {
  signupDate: string;
  started: boolean;
  onboarded: boolean;
  /** Had a plan activated (a trainer's unapproved draft is not a plan yet). */
  planned: boolean;
  firstWorkout: string | null;
  secondWorkout: string | null;
}

export const FUNNEL_STEPS = ["signup", "started", "onboarded", "plan", "workout1", "workout2_7d"] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];

/** A second workout counts as "came back" only within this many days of the first. */
export const RETURN_WINDOW_DAYS = 7;

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);

/** The furthest step this account reached. Steps are monotonic: a later step implies the earlier
 * ones, so an account that trained but has no "started" event (it predates the event) is not shown
 * as dropping out before it began. */
function reached(a: FunnelAccount): number {
  if (a.firstWorkout && a.secondWorkout && daysBetween(a.firstWorkout, a.secondWorkout) <= RETURN_WINDOW_DAYS) return 5;
  if (a.firstWorkout) return 4;
  if (a.planned) return 3;
  if (a.onboarded) return 2;
  if (a.started) return 1;
  return 0;
}

export interface Funnel {
  /** Accounts that reached each step, in FUNNEL_STEPS order. counts[0] is the cohort size. */
  counts: number[];
  /** Median days from signup to the first workout, among those who had one; null if nobody did. */
  medianDaysToFirstWorkout: number | null;
}

export function computeFunnel(accounts: FunnelAccount[]): Funnel {
  const counts = FUNNEL_STEPS.map(() => 0);
  const days: number[] = [];
  for (const a of accounts) {
    const r = reached(a);
    for (let i = 0; i <= r; i++) counts[i]++;
    if (a.firstWorkout) days.push(Math.max(0, daysBetween(a.signupDate, a.firstWorkout)));
  }
  days.sort((x, y) => x - y);
  const mid = days.length >> 1;
  const median = days.length === 0 ? null : days.length % 2 ? days[mid] : (days[mid - 1] + days[mid]) / 2;
  return { counts, medianDaysToFirstWorkout: median };
}
