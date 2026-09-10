// Squad membership + the digest's workout read, against real in-memory D1 (same pattern as the
// other repo tests). The scoreboard maths itself is covered by squad.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import {
  deleteSquad,
  deleteUserData,
  getOrCreateUser,
  getSquad,
  joinSquad,
  leaveSquad,
  listSquads,
  squadCompletedDates,
  squadMembers,
  markSquadRecapped,
  squadsDueForRecap,
  squadsForUser,
  upsertSquad,
  upsertWorkoutLog,
} from "../src/db/repos";

const CHAT = -1001234;

async function seed() {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ana");
  await getOrCreateUser(db, 2, 2, "uk", "Bo");
  await upsertSquad(db, CHAT, "Iron Friends", 1);
  await joinSquad(db, CHAT, 1);
  await joinSquad(db, CHAT, 2);
  return db;
}

test("upsertSquad + joinSquad: registers the chat and its members", async () => {
  const db = await seed();
  const squad = await getSquad(db, CHAT);
  assert.equal(squad?.title, "Iron Friends");
  assert.equal(squad?.createdBy, 1);
  const members = await squadMembers(db, CHAT);
  assert.deepEqual(members.map((m) => [m.userId, m.name, m.lang]), [[1, "Ana", "en"], [2, "Bo", "uk"]]);
  assert.deepEqual(await squadsForUser(db, 2), [CHAT]);
});

test("joinSquad is idempotent and upsertSquad refreshes the title without losing members", async () => {
  const db = await seed();
  assert.equal(await joinSquad(db, CHAT, 1), false); // already in → caller stays quiet
  await upsertSquad(db, CHAT, "Iron Friends 2.0", 2);
  assert.equal((await getSquad(db, CHAT))?.title, "Iron Friends 2.0");
  assert.equal((await getSquad(db, CHAT))?.createdBy, 1); // original creator kept
  assert.equal((await squadMembers(db, CHAT)).length, 2);
});

test("leaveSquad removes only that member; deleteSquad clears the whole chat", async () => {
  const db = await seed();
  assert.equal(await leaveSquad(db, CHAT, 2), true);
  assert.equal(await leaveSquad(db, CHAT, 2), false); // no longer in
  assert.deepEqual((await squadMembers(db, CHAT)).map((m) => m.userId), [1]);
  await deleteSquad(db, CHAT);
  assert.equal(await getSquad(db, CHAT), null);
  assert.deepEqual(await listSquads(db), []);
});

test("squadCompletedDates: members only, completed only, inside the window only", async () => {
  const db = await seed();
  await getOrCreateUser(db, 3, 3, "en", "Outsider");
  await upsertWorkoutLog(db, 1, "2026-06-02", 1, [], true);
  await upsertWorkoutLog(db, 1, "2026-05-20", 3, [], true); // before the window
  await upsertWorkoutLog(db, 2, "2026-06-03", 2, [], false); // not completed
  await upsertWorkoutLog(db, 3, "2026-06-02", 1, [], true); // not a member

  const all = await squadCompletedDates(db, CHAT, "2026-06-01");
  assert.deepEqual(all.map((r) => [r.userId, r.date]), [[1, "2026-06-02"]]);
});

test("squadCompletedDates: the upper bound keeps a fresh week out of the Monday recap", async () => {
  const db = await seed();
  await upsertWorkoutLog(db, 1, "2026-06-05", 5, [], true); // last week
  await upsertWorkoutLog(db, 2, "2026-06-08", 1, [], true); // the new week — must not count
  const recap = await squadCompletedDates(db, CHAT, "2026-06-01", "2026-06-08");
  assert.deepEqual(recap.map((r) => [r.userId, r.date]), [[1, "2026-06-05"]]);
});

test("squadsDueForRecap: batched, and a recapped squad drops out until the next week", async () => {
  const db = await seed();
  await upsertSquad(db, -2002, "Second", 1);
  await joinSquad(db, -2002, 1);

  // Both are due, but the batch cap is what keeps the weekly fan-out inside the Workers
  // Free subrequest budget — the rest are picked up on the next cron tick.
  assert.equal((await squadsDueForRecap(db, "2026-W24", 1)).length, 1);
  assert.equal((await squadsDueForRecap(db, "2026-W24", 8)).length, 2);

  await markSquadRecapped(db, CHAT, "2026-W24");
  assert.deepEqual((await squadsDueForRecap(db, "2026-W24", 8)).map((s) => s.chatId), [-2002]);
  // A new week makes it due again.
  assert.equal((await squadsDueForRecap(db, "2026-W25", 8)).length, 2);
});

test("deleting an account leaves the squad standing for everyone else", async () => {
  const db = await seed();
  await deleteUserData(db, 1); // the creator leaves the product entirely
  const squad = await getSquad(db, CHAT);
  assert.ok(squad, "squad survives its creator");
  assert.equal(squad!.createdBy, 0); // tombstoned, never left pointing at a ghost
  assert.deepEqual((await squadMembers(db, CHAT)).map((m) => m.userId), [2]);
});

test("deleting the last member also retires the empty squad", async () => {
  const db = await seed();
  await leaveSquad(db, CHAT, 2);
  await deleteUserData(db, 1);
  assert.equal(await getSquad(db, CHAT), null);
});
