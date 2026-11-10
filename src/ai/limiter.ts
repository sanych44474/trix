// Atomic AI admission: one conditional upsert per call, before any provider is tried.
//
// The per-user limit used to count v2_ai_calls rows, which are written after a call finishes.
// A burst of parallel requests all read the same count and all went through, and nothing capped
// the whole service: a few heavy users together could drain the shared free-tier quotas (Gemini,
// Groq, Workers AI) for everyone. Each admission now increments a counter row in v2_settings with
// `ON CONFLICT DO UPDATE ... WHERE value < cap RETURNING value`: D1 runs it as one write, so two
// requests can never both take the last slot, and no row coming back means the cap is reached.
//
// - Per user: USER_CALLS_PER_WINDOW logical calls per fixed 5-minute window.
// - Whole service: DAILY_CALLS logical calls per UTC day.
// Both fail open when the counter can't be written: the limiter must never be a new reason a
// legitimate call fails. Old windows and days are pruned weekly (pruneOldLogs).
import type { DB } from "../adapters/d1/shared";

export const USER_WINDOW_MS = 5 * 60_000;
export const USER_CALLS_PER_WINDOW = 20;
export const DAILY_CALLS = 5_000;

/** Fixed-width window number, so keys sort by time ("ai_rl:005894112:42"). */
const windowNo = (now: number) => String(Math.floor(now / USER_WINDOW_MS)).padStart(9, "0");
export const userKey = (userId: number, now: number) => `ai_rl:${windowNo(now)}:${userId}`;
export const dayKey = (now: number) => `ai_day:${new Date(now).toISOString().slice(0, 10)}`;

/** Takes one slot under `key` if fewer than `cap` are taken. True when admitted. */
async function take(db: DB, key: string, cap: number): Promise<boolean> {
  const row = await db
    .prepare(
      `INSERT INTO v2_settings (key, value) VALUES (?, '1')
       ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1 WHERE CAST(value AS INTEGER) < ?
       RETURNING value`,
    )
    .bind(key, cap)
    .first<{ value: string | number }>();
  return row != null;
}

export type Admission = "ok" | "user" | "global";

/** Admit one AI call for this user (or an anonymous system call when userId is null). */
export async function admitAiCall(db: DB, userId: number | null | undefined, now = Date.now()): Promise<Admission> {
  try {
    if (userId != null && !(await take(db, userKey(userId, now), USER_CALLS_PER_WINDOW))) return "user";
    if (!(await take(db, dayKey(now), DAILY_CALLS))) return "global";
    return "ok";
  } catch {
    return "ok";
  }
}

/** Statements that drop counters for windows and days before `now` (weekly prune). */
export function pruneCounterStmts(db: DB, now = Date.now()): D1PreparedStatement[] {
  return [
    db.prepare("DELETE FROM v2_settings WHERE key LIKE 'ai_rl:%' AND key < ?").bind(`ai_rl:${windowNo(now)}`),
    db.prepare("DELETE FROM v2_settings WHERE key LIKE 'ai_day:%' AND key < ?").bind(dayKey(now)),
  ];
}
