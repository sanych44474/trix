// Queries that run on every trainer request, every minute or every hour must use an index, not
// scan their table. Checked with EXPLAIN QUERY PLAN against the real migrations.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";

// The harness's D1 wrapper treats a non-SELECT as a write, so EXPLAIN goes to node:sqlite directly.
function plan(db: ReturnType<typeof newDb>, sql: string, ...params: unknown[]): string {
  const rows = db.raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...(params as never[])) as Array<{ detail: string }>;
  return rows.map((row) => row.detail).join(" | ");
}

test("listClients: the trainer's clients come from an index, not a scan of every relationship", async () => {
  const p = plan(newDb(), "SELECT clientId FROM v2_trainer_relationships WHERE trainerId = ? AND status = 'active'", 1);
  assert.doesNotMatch(p, /^SCAN|\| SCAN/, p);
  assert.match(p, /USING (COVERING )?INDEX/, p);
});

test("pendingRecoveryCount (every minute): reads unfinished onboardings only", async () => {
  const p = plan(newDb(), `SELECT COUNT(*) AS n FROM v2_onboarding
       WHERE status != 'completed' AND (sessionRetryAfter IS NOT NULL OR sessionMode IN ('onboarding','plan_pending'))`);
  assert.doesNotMatch(p, /SCAN v2_onboarding$|SCAN v2_onboarding \|/, p);
  assert.match(p, /INDEX idx_v2_onboarding_open/, p);
});

test("listVacationEnded (every hour): finds ended vacations through an index", async () => {
  const p = plan(newDb(), "SELECT id FROM v2_accounts a WHERE a.vacationUntil IS NOT NULL AND a.vacationUntil <= ?", "2026-11-04");
  assert.match(p, /INDEX idx_v2_accounts_vacation/, p);
});
