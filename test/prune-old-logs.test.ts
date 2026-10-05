// pruneOldLogs — the weekly 90-day telemetry sweep, for the trainer tables that would otherwise
// grow unbounded (v2-admin.test.ts covers the telemetry tables). Real
// in-memory D1 against the actual migrations, same pattern as trainer-notes.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { pruneOldLogs } from "../src/adapters/d1/v2Admin";
import { getOrCreateUser } from "../src/adapters/d1/v2Users";

const OLD = "2020-01-01T00:00:00.000Z";
const RECENT = new Date().toISOString();
const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString();

async function count(db: Awaited<ReturnType<typeof newDb>>, table: string): Promise<number> {
  const r = await db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).first<{ c: number }>();
  return r?.c ?? 0;
}

test("pruneOldLogs: trainer messages and note history older than the cutoff go, recent ones stay", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "uk", "Coach");
  await getOrCreateUser(db, 2, 2, "uk", "Ann");

  await db.batch([
    db.prepare("INSERT INTO v2_messages (fromAccountId, toAccountId, text, createdAt) VALUES (1, 2, 'old', ?)").bind(OLD),
    db.prepare("INSERT INTO v2_messages (fromAccountId, toAccountId, text, createdAt) VALUES (1, 2, 'new', ?)").bind(RECENT),
    db.prepare("INSERT INTO v2_client_note_history (trainerId, clientId, field, value, savedAt) VALUES (1, 2, 'note', 'old', ?)").bind(OLD),
    db.prepare("INSERT INTO v2_client_note_history (trainerId, clientId, field, value, savedAt) VALUES (1, 2, 'note', 'new', ?)").bind(RECENT),
  ]);

  await pruneOldLogs(db, cutoff, cutoff.slice(0, 10));

  for (const table of ["v2_messages", "v2_client_note_history"]) {
    assert.equal(await count(db, table), 1, `${table} should have exactly the recent row left`);
  }
});
