import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { pruneDryRunLog } from "../src/adapters/d1/schedulerDryrunLog";

test("pruneDryRunLog: drops rows older than the cutoff, keeps recent ones", async () => {
  const db = newDb();
  const insert = db.raw.prepare("INSERT INTO scheduler_dryrun_log (source, entityId, kind, detail, createdAt) VALUES ('user', 1, 'send', ?, ?)");
  insert.run(JSON.stringify({ text: "old" }), "2026-01-01T00:00:00.000Z");
  insert.run(JSON.stringify({ text: "new" }), "2026-07-01T00:00:00.000Z");
  await pruneDryRunLog(db as never, "2026-06-01T00:00:00.000Z");
  const rows = db.raw.prepare("SELECT detail FROM scheduler_dryrun_log").all() as { detail: string }[];
  assert.deepEqual(rows.map((r) => JSON.parse(r.detail).text), ["new"]);
});
