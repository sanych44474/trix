// friendIds() — improvement #8 from the production-readiness list moved this off a
// json_extract(profile, '$.referredBy') scan (no index possible on a JSON path) onto a real
// dual-written, indexed `referredBy` column (see migration 0056, same fix 0037 already did for
// session.mode/retryAfter). Real in-memory D1 against the actual migrations.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { friendIds, getOrCreateUser, updateUser } from "../src/db/repos";
import type { UserDoc } from "../src/types";

test("friendIds: bidirectional — includes the inviter and everyone this user invited", async () => {
  const db = newDb();
  const inviter = (await getOrCreateUser(db, 1, 1, "uk", "Inviter")) as unknown as UserDoc;
  const me = (await getOrCreateUser(db, 2, 2, "uk", "Me")) as unknown as UserDoc;
  const invitee = (await getOrCreateUser(db, 3, 3, "uk", "Invitee")) as unknown as UserDoc;
  await getOrCreateUser(db, 4, 4, "uk", "Stranger");

  await updateUser(db, 2, { profile: { ...me.profile, referredBy: 1 } });
  await updateUser(db, 3, { profile: { ...invitee.profile, referredBy: 2 } });

  assert.deepEqual(new Set(await friendIds(db, 2)), new Set([1, 3]));
  assert.deepEqual(await friendIds(db, 4), []);
  void inviter;
});

test("friendIds: the dual-written referredBy column matches the profile JSON", async () => {
  const db = newDb();
  const me = (await getOrCreateUser(db, 1, 1, "uk", "Me")) as unknown as UserDoc;
  await getOrCreateUser(db, 2, 2, "uk", "Friend");
  await updateUser(db, 1, { profile: { ...me.profile, referredBy: 2 } });

  const row = await db.prepare("SELECT referredBy FROM users WHERE id = ?").bind(1).first<{ referredBy: number | null }>();
  assert.equal(row?.referredBy, 2);
});
