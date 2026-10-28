import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { logDryRun, pruneDryRunLog } from "../src/durable/dryrunLog";

test("pruneDryRunLog: drops rows older than the cutoff, keeps recent ones", async () => {
  const db = newDb();
  await logDryRun(db as never, "user", 1, "send", { text: "old" });
  db.raw.exec("UPDATE scheduler_dryrun_log SET createdAt = '2026-01-01T00:00:00.000Z'");
  await logDryRun(db as never, "user", 1, "send", { text: "new" });
  await pruneDryRunLog(db as never, "2026-06-01T00:00:00.000Z");
  const rows = db.raw.prepare("SELECT detail FROM scheduler_dryrun_log").all() as { detail: string }[];
  assert.deepEqual(rows.map((r) => JSON.parse(r.detail).text), ["new"]);
});
