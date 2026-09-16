// v2-native client-supplied idempotency keys for Mini App POST actions (Domain 9 of the v2
// cutover — see docs/adr/0001-v2-seams-and-staged-cutover.md). Faithful port of
// src/db/repos/idempotency.ts: same exported names/signatures, same claim/replay/takeover
// semantics (see migrations/0063/0064 for why this exists and why it's a claim, not a plain
// get-then-execute-then-record) — but reads/writes ONLY v2_idempotency
// (migrations/0070_v2_long_tail.sql), which is already schema-identical to legacy
// idempotency_keys (accountId/key/status/response/state/createdAt vs userId/key/status/
// response/state/createdAt) — no migration needed for this module, unlike the rest of this
// domain.
//
// This module's callers (src/webapp/v2Api.ts, miscApi.ts, settingsApi.ts, trainerApi.ts,
// workoutApi.ts) span BOTH the v2-native (`/api/v2/*`) and legacy (`/api/*`) Mini App surfaces —
// idempotency-key handling is generic request middleware, not domain data, and every real user
// has a v2_accounts row regardless of which surface they hit (Domain 1's getOrCreateUser writes
// one for every account; 0069's backfill gave every pre-existing legacy user one too), so
// repointing ALL of those callers here — not just the v2-native ones — is safe and is the
// point: it stops the v2-native API surface from writing its idempotency claims into a legacy
// table that the freeze (docs/adr/0001) will eventually make read-only.
import type { DB } from "../../db/repos/shared";
import { nowIso } from "../../db/repos/shared";

const WINDOW_HOURS = 24; // a retry hours later is a NEW action, not a duplicate of the first
const CLAIM_STALE_MS = 30_000; // a request realistically never runs this long -- an older
// "processing" row means the original claimant crashed between claiming and completing, so it's
// safe to take over rather than leave the key permanently wedged until the 24h window lapses.

export interface CachedResponse {
  status: number;
  response: unknown;
}

export type ClaimResult =
  | { claimed: true } // this call owns the key -- run the handler, then completeIdempotencyClaim
  | { claimed: false; cached: CachedResponse } // another attempt already finished -- replay it
  | { claimed: false; cached: null }; // another attempt is genuinely in flight right now -- retry shortly

/** Atomically claims (accountId, key) before the handler runs. See the module comment for why
 * this replaced a plain get-then-execute-then-record flow. */
export async function claimIdempotencyKey(db: DB, userId: number, key: string): Promise<ClaimResult> {
  try {
    await db
      .prepare("INSERT INTO v2_idempotency (accountId, key, response, status, state, createdAt) VALUES (?, ?, '{}', 0, 'processing', ?)")
      .bind(userId, key, nowIso())
      .run();
    return { claimed: true };
  } catch {
    // Assume a PK conflict -- the only realistic cause of an INSERT failure on this table. Read
    // the existing row back to decide what to tell the caller.
    const cutoff = new Date(Date.now() - WINDOW_HOURS * 3_600_000).toISOString();
    let row: { response: string; status: number; state: string; createdAt: string } | null;
    try {
      row = await db
        .prepare("SELECT response, status, state, createdAt FROM v2_idempotency WHERE accountId = ? AND key = ? AND createdAt >= ?")
        .bind(userId, key, cutoff)
        .first();
    } catch {
      return { claimed: true }; // couldn't even read back -- fail open rather than block the action
    }
    if (!row) return { claimed: true }; // past the replay window -- this is a fresh action
    if (row.state === "done") {
      try {
        return { claimed: false, cached: { status: row.status, response: JSON.parse(row.response) } };
      } catch {
        return { claimed: true }; // corrupt row (should never happen) -- treat as a fresh action
      }
    }
    // Still "processing". Take over an abandoned claim rather than wedge this key until the 24h
    // window lapses; a genuinely in-flight one gets a 409-style "try again shortly" instead of a
    // duplicate side effect.
    if (Date.parse(row.createdAt) < Date.now() - CLAIM_STALE_MS) {
      await db
        .prepare("UPDATE v2_idempotency SET createdAt = ? WHERE accountId = ? AND key = ? AND state = 'processing'")
        .bind(nowIso(), userId, key)
        .run()
        .catch(() => {});
      return { claimed: true };
    }
    return { claimed: false, cached: null };
  }
}

/** Records the real result under a key this call already owns (claimIdempotencyKey returned
 * `{ claimed: true }`). */
export async function completeIdempotencyClaim(db: DB, userId: number, key: string, status: number, response: unknown): Promise<void> {
  await db
    .prepare("UPDATE v2_idempotency SET response = ?, status = ?, state = 'done', createdAt = ? WHERE accountId = ? AND key = ?")
    .bind(JSON.stringify(response), status, nowIso(), userId, key)
    .run();
}

/** Runs `run()` under an idempotency claim when `idemKey` is given (a plain passthrough when it
 * isn't). Centralizes the claim -> run -> complete flow so a handler doesn't re-implement the
 * three ClaimResult branches inline every time it needs this. */
export async function runIdempotent<T>(
  db: DB,
  userId: number,
  idemKey: string | null | undefined,
  run: () => Promise<{ status: number; body: T }>,
): Promise<{ status: number; body: T | { error: string } }> {
  if (!idemKey) return run();
  const claim = await claimIdempotencyKey(db, userId, idemKey).catch(() => ({ claimed: true }) as const);
  if (!claim.claimed) {
    if (claim.cached) return { status: claim.cached.status, body: claim.cached.response as T };
    return { status: 409, body: { error: "processing" } }; // another attempt with this key is in flight
  }
  const result = await run();
  await completeIdempotencyClaim(db, userId, idemKey, result.status, result.body).catch(() => {});
  return result;
}

/** Telemetry-style cleanup, called from the same weekly prune pass as error_logs/ai_call_logs
 * (scheduler.ts). Keys are only ever meant to survive WINDOW_HOURS; the 90-day cutoff shared
 * with everything else in that pass is generous on purpose (cheap, and a stray row costs nothing). */
export async function pruneIdempotencyKeys(db: DB, beforeIso: string): Promise<void> {
  await db.prepare("DELETE FROM v2_idempotency WHERE createdAt < ?").bind(beforeIso).run();
}
