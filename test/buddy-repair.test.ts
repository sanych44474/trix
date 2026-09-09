// Re-pairing with a new buddy while already paired must not leave a stale, one-sided link
// behind (found while reviewing allBuddyPairs() for the weekly buddy-duel sweep — see
// db/repos/workouts.ts's comment). Real in-memory D1 + fake ctx, same pattern as
// prospect-invite.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb, makeCtx } from "./harness";
import { cmdStart } from "../src/bot";
import { getOrCreateUser, getUser, updateUser } from "../src/db/repos";
import type { UserDoc } from "../src/types";

test("cmdStart buddy_<id>: re-pairing unlinks the old buddy instead of leaving a stale link", async () => {
  const db = newDb();
  const u1 = (await getOrCreateUser(db, 1, 1, "en", "One")) as unknown as UserDoc;
  const u2 = (await getOrCreateUser(db, 2, 2, "en", "Two")) as unknown as UserDoc;
  await getOrCreateUser(db, 3, 3, "en", "Three");

  // 1 and 2 pair up first.
  const { ctx: ctx1 } = makeCtx(db, u1 as unknown as Record<string, unknown>);
  await cmdStart(ctx1 as never, "buddy_2");
  assert.equal((await getUser(db, 1))?.profile.buddyId, 2);
  assert.equal((await getUser(db, 2))?.profile.buddyId, 1);

  // 1 re-pairs with 3 — 2's old link must be cleared, not left pointing at 1.
  const u1Reloaded = (await getUser(db, 1))!;
  const { ctx: ctx1b } = makeCtx(db, u1Reloaded as unknown as Record<string, unknown>);
  await cmdStart(ctx1b as never, "buddy_3");

  assert.equal((await getUser(db, 1))?.profile.buddyId, 3);
  assert.equal((await getUser(db, 3))?.profile.buddyId, 1);
  assert.equal((await getUser(db, 2))?.profile.buddyId, undefined);
});

test("cmdStart buddy_<id>: unlinking doesn't touch a third party's unrelated pairing", async () => {
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

  const u1Reloaded = (await getUser(db, 1))!;
  const { ctx } = makeCtx(db, u1Reloaded as unknown as Record<string, unknown>);
  await cmdStart(ctx as never, "buddy_3");

  assert.equal((await getUser(db, 1))?.profile.buddyId, 3);
  assert.equal((await getUser(db, 3))?.profile.buddyId, 1);
  assert.equal((await getUser(db, 2))?.profile.buddyId, 4); // untouched — 2 never pointed back at 1
  assert.equal((await getUser(db, 4))?.profile.buddyId, undefined); // 4 never had a buddy set
});
