import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser } from "../src/adapters/d1/v2Users";
import { insertFeedback, listFeedback, updateFeedback } from "../src/adapters/d1/v2Admin";

test("feedback triage: auto category on insert, status filter and counts, close/reopen", async () => {
  const db = newDb();
  await getOrCreateUser(db, 5, 5, "uk", "Ann");
  await insertFeedback(db, { userId: 5, text: "Таймер скидається", date: "2026-10-05" });
  await insertFeedback(db, { userId: 5, text: "Додайте темну тему", date: "2026-10-05" });
  let r = await listFeedback(db, "new");
  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.rows.map((x) => x.category).sort(), ["bug", "idea"]);
  assert.equal(r.rows[0]!.name, "Ann");
  const bug = r.rows.find((x) => x.category === "bug")!;
  const before = await updateFeedback(db, bug.id, { status: "done" });
  assert.equal(before!.status, "new");
  r = await listFeedback(db, "new");
  assert.equal(r.rows.length, 1);
  assert.deepEqual(r.counts, { new: 1, done: 1, wontfix: 0 });
  await updateFeedback(db, bug.id, { category: "complaint", status: "new" });
  r = await listFeedback(db, "all");
  assert.equal(r.rows.find((x) => x.id === bug.id)!.category, "complaint");
  assert.equal(await updateFeedback(db, 9999, { status: "done" }), null);
});
