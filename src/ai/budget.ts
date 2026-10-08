// Daily Workers AI budget. Workers AI is free up to 10,000 neurons a day per account (reset 00:00
// UTC), shared by every model -- text, vision, Whisper, FLUX. Each call adds its estimated
// neurons (models.ts) to a per-day counter in v2_settings; once the day's spend reaches the
// budget, Workers AI steps out of the chains until midnight UTC and the external providers carry
// the load. The default budget leaves 20% headroom because the per-call figures are estimates.
import type { Env } from "../types";

export const FREE_DAILY_NEURONS = 10_000;
const DEFAULT_BUDGET = 8_000;

const key = (date = new Date().toISOString().slice(0, 10)) => `wai_neurons:${date}`;

export function dailyBudget(env: Pick<Env, "WORKERSAI_DAILY_NEURONS">): number {
  const n = Number(env.WORKERSAI_DAILY_NEURONS);
  return Number.isFinite(n) && n > 0 ? Math.min(n, FREE_DAILY_NEURONS) : DEFAULT_BUDGET;
}

/** Neurons spent today (estimate). 0 when the counter can't be read. */
export async function neuronsToday(db: D1Database): Promise<number> {
  try {
    const row = await db.prepare("SELECT value FROM v2_settings WHERE key = ?").bind(key()).first<{ value: string }>();
    return Number(row?.value) || 0;
  } catch {
    return 0;
  }
}

/** True while today's spend plus `reserve` (the call about to happen) stays within the budget. */
export async function workersaiAllowed(db: D1Database, env: Pick<Env, "WORKERSAI_DAILY_NEURONS">, reserve = 0): Promise<boolean> {
  return (await neuronsToday(db)) + reserve <= dailyBudget(env);
}

/** Add a call's neurons to today's counter (one atomic upsert). */
export function addNeuronsStmt(db: D1Database, neurons: number): D1PreparedStatement {
  return db
    .prepare("INSERT INTO v2_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + CAST(excluded.value AS INTEGER)")
    .bind(key(), String(Math.max(0, Math.ceil(neurons))));
}

export async function addNeurons(db: D1Database, neurons: number): Promise<void> {
  if (neurons <= 0) return;
  try {
    await addNeuronsStmt(db, neurons).run();
  } catch {
    // best-effort: a lost increment only makes the budget a little more generous
  }
}
