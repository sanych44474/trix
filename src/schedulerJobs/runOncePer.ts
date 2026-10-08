// The one place that decides "has this periodic job already run this period?". Before this, six
// jobs each kept their own stamp in v2_settings, and none stamped only on success: some stamped
// BEFORE the work (a throw burned the whole period -- the weekly AI model check lost a week), some
// stamped AFTER an attempt that had already failed (buddy duels lost the ISO week, the daily rollup
// lost the day), and every stamp write swallowed its own error.
//
// Contract: the stamp is written only after the job resolves. A job that throws is retried on the
// next tick, at most `maxAttempts` times per period; after that the period is closed anyway and
// the failure stays in error_events, so a permanently failing job costs three tries, not one per
// tick. The cap is also why this is safe for jobs that are not fully idempotent (a half-sent
// batch of nudges is repeated at most twice).
//
// The stamp keeps the exact value each caller used before (an ISO timestamp for a rolling window,
// the period key for a calendar one) so a deploy does not re-run anything. Attempts live in a
// sibling row, `<key>:attempts`, tied to the stamp they started from, so a success resets them.
import { getSetting, setSetting } from "../adapters/d1/v2Admin";
import { logSchedulerError } from "./shared";

export const MAX_ATTEMPTS = 3;

/** `windowMs`: a rolling window since the last success. `periodKey`: a calendar period (an ISO
 * week, a date) computed by the caller; the job has run when the stamp equals it. */
export type GatePeriod = { windowMs: number } | { periodKey: string };

export type GateResult = "ran" | "skipped" | "failed" | "gave_up";

export interface GateOptions {
  key: string;
  period: GatePeriod;
  maxAttempts?: number;
  now?: number;
}

function isDone(stamp: string | null, period: GatePeriod, now: number): boolean {
  if (!stamp) return false;
  if ("periodKey" in period) return stamp === period.periodKey;
  return Date.parse(stamp) >= now - period.windowMs;
}

async function readAttempts(db: D1Database, key: string, scope: string): Promise<number> {
  const raw = await getSetting(db, key).catch(() => null);
  if (!raw) return 0;
  try {
    const v = JSON.parse(raw) as { for?: string; n?: number };
    return v.for === scope && typeof v.n === "number" ? v.n : 0;
  } catch {
    return 0;
  }
}

export async function runOncePer(db: D1Database, opts: GateOptions, job: () => Promise<unknown>): Promise<GateResult> {
  const now = opts.now ?? Date.now();
  const max = opts.maxAttempts ?? MAX_ATTEMPTS;
  const attemptsKey = `${opts.key}:attempts`;

  const stamp = await getSetting(db, opts.key).catch(() => null);
  if (isDone(stamp, opts.period, now)) return "skipped";

  // Attempts belong to one period: the calendar key, or (rolling) the last success they follow.
  const scope = "periodKey" in opts.period ? opts.period.periodKey : (stamp ?? "");
  const prior = await readAttempts(db, attemptsKey, scope);

  const close = async () => {
    const value = "periodKey" in opts.period ? opts.period.periodKey : new Date(now).toISOString();
    await setSetting(db, opts.key, value).catch((e) => logSchedulerError(db, `${opts.key}_stamp`, e));
    if (prior > 0) await setSetting(db, attemptsKey, JSON.stringify({ for: scope, n: 0 })).catch(() => {});
  };

  try {
    await job();
  } catch (e) {
    logSchedulerError(db, opts.key, e);
    const n = prior + 1;
    if (n >= max) {
      await close();
      return "gave_up";
    }
    await setSetting(db, attemptsKey, JSON.stringify({ for: scope, n })).catch(() => {});
    return "failed";
  }
  await close();
  return "ran";
}
