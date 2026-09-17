import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser } from "../src/adapters/d1/v2Users";
import { logSchedulerError } from "../src/scheduler";

// The three cutover DOs (src/durable/{user,squad,global}Scheduler.ts) each now wrap their
// real-send call in `.catch((err) => logSchedulerError(db, "<kind>", err, id))` -- mirroring
// the cron path's own error handling (scheduler.ts's per-job try/catch), so a real error after
// a scheduler_cutover_* flag flips still reaches error_logs/owner-report instead of only a raw
// uncaught exception in Workers Logs. Forcing a genuine exception through the full DO/alarm
// stack (real grammY Bot, real fetch to Telegram) isn't a clean, network-free, deterministic
// test given how defensively processUser/postSquadDigest/runGlobalJobs already catch their own
// sub-steps -- this instead directly verifies the primitive those three one-line wrappers all
// rely on: that logSchedulerError persists the exact (kind, entityId, message) shape a reader
// of /ownerreport → Errors would see, for each of the three kind tags used at those call sites.

/** logSchedulerError fires the write without awaiting it (fire-and-forget .catch(() => {})) --
 * poll for the expected row count instead of a fixed delay, since the harness's async D1 shim
 * can take more than one microtask tick per write. */
async function pollErrorEvents(db: ReturnType<typeof newDb>, expected: number) {
  let rows: { accountId: number | null; kind: string; message: string }[] = [];
  for (let i = 0; i < 50 && rows.length < expected; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    rows = db.dump<{ accountId: number | null; kind: string; message: string }>(
      "SELECT accountId, kind, message FROM v2_error_events ORDER BY id ASC",
    );
  }
  return rows;
}

test("logSchedulerError persists a queryable row for each of the three cutover-branch kinds", async () => {
  const db = newDb();
  const user = await getOrCreateUser(db, 42, 42, "en", "Ann");
  const squadOwner = await getOrCreateUser(db, 7, 7, "en", "Squad Owner");

  logSchedulerError(db, "schedule_user", new Error("processUser blew up"), user._id);
  // squad_recaps must attribute to the squad's CREATOR account id (a real v2_accounts row), not
  // the squad's Telegram chatId -- see the regression test below for why that distinction matters.
  logSchedulerError(db, "squad_recaps", new Error("postSquadDigest blew up"), squadOwner._id);
  logSchedulerError(db, "global_jobs", new Error("runGlobalJobs blew up")); // no single entity to attribute to

  const rows = await pollErrorEvents(db, 3);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].kind, "schedule_user");
  assert.equal(rows[0].accountId, user._id);
  assert.match(rows[0].message, /processUser blew up/);
  assert.equal(rows[1].kind, "squad_recaps");
  assert.equal(rows[1].accountId, squadOwner._id);
  assert.equal(rows[2].kind, "global_jobs");
  assert.equal(rows[2].accountId, null);
});

test("regression: v2_error_events.accountId has a real FK to v2_accounts -- an id that isn't one is silently dropped", async () => {
  // This is exactly the bug an earlier draft of the squad_recaps wrapper had: passing the
  // squad's Telegram chatId (e.g. -1001234567890) as the "userId" argument. chatId is not a
  // v2_accounts.id, the FK rejects the insert, and logSchedulerError's own internal
  // .catch(() => {}) swallows that failure -- so the error-logging fix would have silently
  // logged NOTHING in production, while looking correct in any test that doesn't check this.
  const db = newDb();
  const notAnAccountId = -1001234567890;
  logSchedulerError(db, "squad_recaps", new Error("would have been dropped"), notAnAccountId);

  await new Promise((resolve) => setTimeout(resolve, 100));
  const rows = db.dump<{ kind: string }>("SELECT kind FROM v2_error_events");
  assert.equal(rows.length, 0, "an id that fails the accountId FK must not silently vanish unnoticed by this test");
});
