// Client-note history (Phase 4.1) and the trainer<->client message thread read path (Phase 4.2)
// — real in-memory D1 against the actual migrations, same pattern as buddy-api.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser } from "../src/db/repos";
import {
  getClientNote,
  insertMessage,
  listClientNoteHistory,
  listMessages,
  setClientCard,
  setClientNote,
} from "../src/db/repos/trainer";

test("setClientNote: overwriting archives the previous value instead of losing it", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "uk", "Coach");
  await getOrCreateUser(db, 2, 2, "uk", "Ann");
  await setClientNote(db, 1, 2, "shoulder impingement, avoid overhead press");
  await setClientNote(db, 1, 2, "shoulder cleared, back to overhead press");
  assert.equal(await getClientNote(db, 1, 2), "shoulder cleared, back to overhead press");
  const hist = await listClientNoteHistory(db, 1, 2);
  assert.equal(hist.length, 1);
  assert.equal(hist[0].field, "note");
  assert.equal(hist[0].value, "shoulder impingement, avoid overhead press");
});

test("setClientNote: first save has nothing to archive", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "uk", "Coach");
  await getOrCreateUser(db, 2, 2, "uk", "Ann");
  await setClientNote(db, 1, 2, "first note");
  assert.deepEqual(await listClientNoteHistory(db, 1, 2), []);
});

test("setClientCard: overwriting healthNotes archives the old value under its own field", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "uk", "Coach");
  await getOrCreateUser(db, 2, 2, "uk", "Ann");
  await setClientCard(db, 1, 2, { healthNotes: "knee pain 2026-01" });
  await setClientCard(db, 1, 2, { healthNotes: "knee resolved" });
  const hist = await listClientNoteHistory(db, 1, 2, "healthNotes");
  assert.equal(hist.length, 1);
  assert.equal(hist[0].value, "knee pain 2026-01");
  // personalNotes was never touched, so no history entry for it.
  assert.deepEqual(await listClientNoteHistory(db, 1, 2, "personalNotes"), []);
});

test("listMessages: returns the thread oldest-first, both directions, scoped to the pair", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "uk", "Coach");
  await getOrCreateUser(db, 2, 2, "uk", "Ann");
  await getOrCreateUser(db, 3, 3, "uk", "Other Client");
  await insertMessage(db, 1, 2, "how's the shoulder?");
  await insertMessage(db, 2, 1, "much better, thanks");
  await insertMessage(db, 1, 3, "unrelated message to a different client");
  const thread = await listMessages(db, 1, 2);
  assert.deepEqual(thread.map((m) => m.text), ["how's the shoulder?", "much better, thanks"]);
});
