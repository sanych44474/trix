// The node:sqlite harness must answer db.batch like D1: reads return rows per statement, and a
// failing statement rolls back the whole batch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser } from "../src/adapters/d1/v2Users";

const insert = (db: ReturnType<typeof newDb>, accountId: number, kind: string) =>
  db.prepare("INSERT INTO v2_inbox (accountId, kind, params, createdAt) VALUES (?, ?, ?, ?)")
    .bind(accountId, kind, "{}", "2026-10-21T00:00:00Z");

async function newDbWithUsers(...ids: number[]) {
  const db = newDb();
  for (const id of ids) await getOrCreateUser(db, id, id, "en", `user${id}`);
  return db;
}

test("batch with two SELECTs returns each statement's rows in D1 result shape", async () => {
  const db = await newDbWithUsers(1, 2);
  insert(db, 1, "message").run();
  insert(db, 1, "badge").run();
  insert(db, 2, "message").run();

  const [rows, count] = await db.batch<{ id: number; kind: string } | { n: number }>([
    db.prepare("SELECT id, kind FROM v2_inbox WHERE accountId = ? ORDER BY id").bind(1),
    db.prepare("SELECT COUNT(*) AS n FROM v2_inbox WHERE accountId = ?").bind(1),
  ]);

  assert.equal(rows.success, true);
  assert.deepEqual(rows.results.map((r) => (r as { kind: string }).kind), ["message", "badge"]);
  assert.equal(rows.meta.changes, 0);
  assert.equal(count.success, true);
  assert.deepEqual(count.results.map((r) => ({ ...r })), [{ n: 2 }]);
});

test("batch with an INSERT then a failing statement rolls the INSERT back and throws", async () => {
  const db = await newDbWithUsers(7);
  await assert.rejects(
    db.batch([
      insert(db, 7, "message"),
      db.prepare("SELECT * FROM no_such_table"),
    ]),
  );
  assert.equal(db.dump("SELECT id FROM v2_inbox WHERE accountId = 7").length, 0);
});

test("batch write results carry meta.changes", async () => {
  const db = await newDbWithUsers(3);
  const [res] = await db.batch([insert(db, 3, "message")]);
  assert.equal(res.meta.changes, 1);
  assert.deepEqual(res.results, []);
});
