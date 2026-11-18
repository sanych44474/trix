// Re-pairing with a new buddy while already paired must not leave a stale, one-sided link
// behind (found while reviewing allBuddyPairs() for the weekly buddy-duel sweep — see
// db/repos/workouts.ts's comment). Real in-memory D1 + fake ctx, same pattern as
// prospect-invite.test.ts. Pairing is a request (/start buddy_<id>) that the other person accepts
// (bot/buddyRequest.ts), so each pairing below is a request plus an Accept.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb, makeCtx } from "./harness";
import { cmdStart } from "../src/bot/start";
import { answerBuddyRequest } from "../src/bot/buddyRequest";
import { getOrCreateUser, getUser, updateUser } from "../src/adapters/d1/v2Users";
import type { UserDoc } from "../src/types";

/** `from` asks `to` with /start buddy_<to>, then `to` taps Accept. */
async function pair(db: ReturnType<typeof newDb>, from: number, to: number) {
  const { ctx } = makeCtx(db, (await getUser(db, from))! as unknown as Record<string, unknown>);
  await cmdStart(ctx as never, `buddy_${to}`);
  const { ctx: accepter } = makeCtx(db, (await getUser(db, to))! as unknown as Record<string, unknown>);
  await answerBuddyRequest(accepter as never, String(from), true);
}

test("buddy request + accept: re-pairing unlinks the old buddy instead of leaving a stale link", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "One");
  await getOrCreateUser(db, 2, 2, "en", "Two");
  await getOrCreateUser(db, 3, 3, "en", "Three");

  // 1 and 2 pair up first.
  await pair(db, 1, 2);
  assert.equal((await getUser(db, 1))?.profile.buddyId, 2);
  assert.equal((await getUser(db, 2))?.profile.buddyId, 1);

  // 1 re-pairs with 3 — 2's old link must be cleared, not left pointing at 1.
  await pair(db, 1, 3);

  assert.equal((await getUser(db, 1))?.profile.buddyId, 3);
  assert.equal((await getUser(db, 3))?.profile.buddyId, 1);
  assert.equal((await getUser(db, 2))?.profile.buddyId, undefined);
});

test("buddy request + accept: unlinking doesn't touch a third party's unrelated pairing", async () => {
  const db = newDb();
  const u1 = (await getOrCreateUser(db, 1, 1, "en", "One")) as unknown as UserDoc;
  const u2 = (await getOrCreateUser(db, 2, 2, "en", "Two")) as unknown as UserDoc;
  await getOrCreateUser(db, 3, 3, "en", "Three");
  await getOrCreateUser(db, 4, 4, "en", "Four");

  // 1<->2 paired; independently, 2 gets manually re-pointed at 4 without going through 1's
  // side (simulating a state where 2's old link (to 1) is already stale before 1 re-pairs) —
  // 1 should NOT clear 4's buddyId when 1 re-pairs, since 2's link no longer points back at 1.
  await updateUser(db, 1, { profile: { ...u1.profile, buddyId: 2 } });
  await updateUser(db, 2, { profile: { ...u2.profile, buddyId: 4 } });

  await pair(db, 1, 3);

  assert.equal((await getUser(db, 1))?.profile.buddyId, 3);
  assert.equal((await getUser(db, 3))?.profile.buddyId, 1);
  assert.equal((await getUser(db, 2))?.profile.buddyId, 4); // untouched — 2 never pointed back at 1
  assert.equal((await getUser(db, 4))?.profile.buddyId, undefined); // 4 never had a buddy set
});
