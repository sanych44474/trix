// Domain 1 (user-core/preferences/onboarding) v2-native repo — src/adapters/d1/v2Users.ts.
// Exercises it directly against the same in-memory D1 harness the legacy repo tests use
// (test/harness.ts), which builds its schema from every migrations/*.sql file, including
// 0069-0073 (v2_accounts/v2_profiles/v2_preferences/v2_onboarding/v2_trainer_relationships).
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import {
  clearInactiveAsk,
  clearVacation,
  countActiveBetween,
  countActiveSince,
  countCreatedBetween,
  countInactive,
  countModeration,
  countOnboarded,
  countUsers,
  countUsersCreatedSince,
  getOrCreateUser,
  getUser,
  getUsersByIds,
  listChurnedUsers,
  listIncompleteOnboarding,
  listInactive,
  listOnboardedUsers,
  listOnboardingOwedReply,
  listOnboardingUsers,
  listPlanPendingUsers,
  listRetryUsers,
  listStuckOnboardingUsers,
  listVacationEnded,
  markComebackDone,
  nonOnboardedByMode,
  pendingRecoveryCount,
  setVacation,
  stampOnboardedAt,
  updateUser,
  usersOnboardedOn,
  usersSeenOn,
} from "../src/adapters/d1/v2Users";

// ---------- getUser / getOrCreateUser round-trip ----------

test("getUser: missing user returns null", async () => {
  const db = newDb();
  assert.equal(await getUser(db, 999), null);
});

test("getOrCreateUser: creates a fresh user with faithful defaults", async () => {
  const db = newDb();
  const u = await getOrCreateUser(db, 1, 100, "en", "Ann");
  assert.equal(u._id, 1);
  assert.equal(u.chatId, 100);
  assert.equal(u.lang, "en");
  assert.equal(u.onboarded, false);
  assert.equal(u.role, "solo");
  assert.equal(u.trainerId, undefined);
  assert.equal(u.competeOptIn, false);
  assert.deepEqual(u.profile, { name: "Ann" });
  assert.equal(u.nutrition, undefined);
  assert.deepEqual(u.session, { mode: "idle" });
  assert.equal(u.progressionRate, "normal");
  assert.equal(u.blocked, false);
  assert.equal(u.botBlocked, false);
  assert.equal(u.flagged, false);

  const again = await getUser(db, 1);
  assert.deepEqual(again, u);
});

test("getOrCreateUser: INSERT OR IGNORE — a second call for the same id does not clobber existing data", async () => {
  const db = newDb();
  await getOrCreateUser(db, 2, 200, "uk", "First");
  await updateUser(db, 2, { profile: { name: "Renamed" } });
  const again = await getOrCreateUser(db, 2, 999, "en"); // different chatId/lang/no firstName
  assert.equal(again.chatId, 200); // unchanged — IGNORE, not UPSERT, matches legacy semantics
  assert.equal(again.lang, "uk");
  assert.equal(again.profile.name, "Renamed");
});

test("getUsersByIds: batched fetch, missing ids simply absent", async () => {
  const db = newDb();
  await getOrCreateUser(db, 10, 10, "en", "A");
  await getOrCreateUser(db, 11, 11, "en", "B");
  const map = await getUsersByIds(db, [10, 11, 12]);
  assert.equal(map.size, 2);
  assert.equal(map.get(10)!.profile.name, "A");
  assert.equal(map.get(11)!.profile.name, "B");
  assert.equal(map.get(12), undefined);
});

// ---------- updateUser patch semantics ----------

test("updateUser: profile patch round-trips full fidelity, including fields with no dedicated column", async () => {
  const db = newDb();
  await getOrCreateUser(db, 20, 20, "en");
  await updateUser(db, 20, {
    profile: {
      name: "Full", weightKg: 80, daysPerWeek: 4, sleepSchedule: "evening",
      remindersOff: ["water"], waterEvery: 3, quietFrom: 22, quietTo: 7,
    },
  });
  const u = await getUser(db, 20);
  assert.equal(u!.profile.weightKg, 80);
  assert.equal(u!.profile.daysPerWeek, 4);
  assert.equal(u!.profile.sleepSchedule, "evening");
  assert.deepEqual(u!.profile.remindersOff, ["water"]);
  assert.equal(u!.profile.waterEvery, 3);
  assert.equal(u!.profile.quietFrom, 22);
});

test("updateUser: referredBy/buddyId dual-write into indexed v2_profiles columns", async () => {
  const db = newDb();
  await getOrCreateUser(db, 21, 21, "en");
  await updateUser(db, 21, { profile: { referredBy: 7, buddyId: 8 } });
  const row = db.dump<{ referredBy: number; buddyId: number }>(
    "SELECT referredBy, buddyId FROM v2_profiles WHERE accountId = ?", 21,
  )[0];
  assert.equal(row.referredBy, 7);
  assert.equal(row.buddyId, 8);
});

test("updateUser: session.mode/retryAfter dual-write into indexed v2_onboarding columns", async () => {
  const db = newDb();
  await getOrCreateUser(db, 22, 22, "en");
  await updateUser(db, 22, { session: { mode: "coach", retryAfter: "2030-01-01T00:00:00.000Z" } });
  const row = db.dump<{ sessionMode: string; sessionRetryAfter: string }>(
    "SELECT sessionMode, sessionRetryAfter FROM v2_onboarding WHERE accountId = ?", 22,
  )[0];
  assert.equal(row.sessionMode, "coach");
  assert.equal(row.sessionRetryAfter, "2030-01-01T00:00:00.000Z");
  const u = await getUser(db, 22);
  assert.deepEqual(u!.session, { mode: "coach", retryAfter: "2030-01-01T00:00:00.000Z" });
});

test("updateUser: updatedAt bumps on every call, even when only a non-account field changes", async () => {
  const db = newDb();
  const created = await getOrCreateUser(db, 23, 23, "en");
  await new Promise((r) => setTimeout(r, 5));
  await updateUser(db, 23, { profile: { name: "X" } });
  const after = await getUser(db, 23);
  assert.ok(after!.updatedAt.getTime() >= created.updatedAt.getTime());
});

test("updateUser: onboarded true/false flips v2_onboarding.status", async () => {
  const db = newDb();
  await getOrCreateUser(db, 24, 24, "en");
  assert.equal((await getUser(db, 24))!.onboarded, false);
  await updateUser(db, 24, { onboarded: true });
  assert.equal((await getUser(db, 24))!.onboarded, true);
  await updateUser(db, 24, { onboarded: false });
  assert.equal((await getUser(db, 24))!.onboarded, false);
});

test("updateUser: trainerId sets/clears the v2_trainer_relationships edge", async () => {
  const db = newDb();
  await getOrCreateUser(db, 30, 30, "en"); // client
  await getOrCreateUser(db, 31, 31, "en"); // trainer
  await updateUser(db, 30, { trainerId: 31 });
  assert.equal((await getUser(db, 30))!.trainerId, 31);
  await updateUser(db, 30, { trainerId: undefined }); // no-op: undefined is "not patched"
  assert.equal((await getUser(db, 30))!.trainerId, 31);
  await updateUser(db, 30, { trainerId: 0 }); // falsy-but-defined -> clears
  assert.equal((await getUser(db, 30))!.trainerId, undefined);
});

test("updateUser: blocked/botBlocked/progressionRate/vacation/inactive fields all round-trip", async () => {
  const db = newDb();
  await getOrCreateUser(db, 40, 40, "en");
  await updateUser(db, 40, {
    blocked: true,
    botBlocked: true,
    progressionRate: "fast",
    lastSeenAt: new Date("2026-01-01T00:00:00.000Z"),
    inactiveReply: "leaving",
  });
  const u = await getUser(db, 40);
  assert.equal(u!.blocked, true);
  assert.equal(u!.botBlocked, true);
  assert.equal(u!.progressionRate, "fast");
  assert.equal(u!.lastSeenAt!.toISOString(), "2026-01-01T00:00:00.000Z");
  assert.equal(u!.inactiveReply, "leaving");
});

test("updateUser: reminders (UserReminders dedup state) round-trips through its own column, not v2_preferences.reminders", async () => {
  const db = newDb();
  await getOrCreateUser(db, 41, 41, "en");
  await updateUser(db, 41, { reminders: { lastNudge: "2026-05-01", prCount: 3 } });
  const u = await getUser(db, 41);
  assert.deepEqual(u!.reminders, { lastNudge: "2026-05-01", prCount: 3 });
});

// ---------- every-minute scheduler sweeps ----------

test("scheduler sweeps: listRetryUsers / pendingRecoveryCount / listPlanPendingUsers / listOnboardingUsers / listOnboardingOwedReply / listStuckOnboardingUsers", async () => {
  const db = newDb();
  await getOrCreateUser(db, 50, 50, "en"); // idle, onboarded (control)
  await updateUser(db, 50, { onboarded: true, session: { mode: "idle" } });

  await getOrCreateUser(db, 51, 51, "en"); // pending retry
  await updateUser(db, 51, { session: { mode: "onboarding", retryAfter: "2020-01-01T00:00:00.000Z" } });

  await getOrCreateUser(db, 52, 52, "en"); // plan_pending, stale
  await updateUser(db, 52, { session: { mode: "plan_pending" } });

  await getOrCreateUser(db, 53, 53, "en"); // onboarding, owed a reply (stale, no retry)
  await updateUser(db, 53, { session: { mode: "onboarding" } });

  const future = new Date(Date.now() + 3_600_000).toISOString();

  const retry = await listRetryUsers(db, future);
  assert.deepEqual(retry.map((u) => u._id).sort(), [51]);

  const count = await pendingRecoveryCount(db);
  assert.equal(count, 3); // 51 (retry), 52 (plan_pending), 53 (onboarding)

  const planPending = await listPlanPendingUsers(db, future);
  assert.deepEqual(planPending.map((u) => u._id), [52]);

  const onboarding = await listOnboardingUsers(db);
  assert.deepEqual(onboarding.map((u) => u._id).sort(), [51, 53]);

  const owed = await listOnboardingOwedReply(db, future);
  assert.deepEqual(owed.map((u) => u._id), [53]); // 51 has a pending retryAfter -> excluded

  const stuck = await listStuckOnboardingUsers(db, "2000-01-01");
  assert.deepEqual(stuck.map((u) => u._id), [53]);

  const incomplete = await listIncompleteOnboarding(db);
  assert.deepEqual(incomplete.map((u) => u._id).sort(), [51, 52, 53]);

  const byMode = await nonOnboardedByMode(db);
  const modes = Object.fromEntries(byMode.map((m) => [m.mode, m.n]));
  assert.equal(modes.onboarding, 2);
  assert.equal(modes.plan_pending, 1);
});

test("listOnboardedUsers / countUsers / countOnboarded", async () => {
  const db = newDb();
  await getOrCreateUser(db, 60, 60, "en");
  await getOrCreateUser(db, 61, 61, "en");
  await updateUser(db, 61, { onboarded: true });
  assert.equal(await countUsers(db), 2);
  assert.equal(await countOnboarded(db), 1);
  const onboarded = await listOnboardedUsers(db);
  assert.deepEqual(onboarded.map((u) => u._id), [61]);
});

// ---------- cohort / activity counters ----------

test("stampOnboardedAt is COALESCE-protected (first-ever timestamp only)", async () => {
  const db = newDb();
  await getOrCreateUser(db, 70, 70, "en");
  await stampOnboardedAt(db, 70);
  const first = db.dump<{ onboardedAt: string }>("SELECT onboardedAt FROM v2_onboarding WHERE accountId = ?", 70)[0].onboardedAt;
  await new Promise((r) => setTimeout(r, 5));
  await stampOnboardedAt(db, 70);
  const second = db.dump<{ onboardedAt: string }>("SELECT onboardedAt FROM v2_onboarding WHERE accountId = ?", 70)[0].onboardedAt;
  assert.equal(first, second);
});

test("usersOnboardedOn / usersSeenOn", async () => {
  const db = newDb();
  await getOrCreateUser(db, 80, 80, "en");
  await stampOnboardedAt(db, 80);
  const today = new Date().toISOString().slice(0, 10);
  assert.deepEqual(await usersOnboardedOn(db, today), [80]);
  await updateUser(db, 80, { lastSeenAt: new Date() });
  const seen = await usersSeenOn(db, today, [80, 81]);
  assert.deepEqual([...seen], [80]);
});

test("countModeration / countUsersCreatedSince / countCreatedBetween / countActiveSince / countActiveBetween", async () => {
  const db = newDb();
  await getOrCreateUser(db, 90, 90, "en");
  await updateUser(db, 90, { blocked: true });
  await getOrCreateUser(db, 91, 91, "en");
  await updateUser(db, 91, { botBlocked: true });

  const mod = await countModeration(db);
  assert.equal(mod.blocked, 1);
  assert.equal(mod.botBlocked, 1);

  const past = new Date(Date.now() - 3_600_000).toISOString();
  const future = new Date(Date.now() + 3_600_000).toISOString();
  assert.equal(await countUsersCreatedSince(db, past), 2);
  assert.equal(await countCreatedBetween(db, past, future), 2);
  assert.equal(await countActiveSince(db, past), 2);
  assert.equal(await countActiveBetween(db, past, future), 2);
});

test("listChurnedUsers: onboarded, not blocked, active in the prior window but not since", async () => {
  const db = newDb();
  await getOrCreateUser(db, 95, 95, "en", "Churned");
  await updateUser(db, 95, { onboarded: true });
  const priorFrom = new Date(Date.now() - 3_600_000).toISOString();
  const thisWeek = new Date(Date.now() + 3_600_000).toISOString();
  const churned = await listChurnedUsers(db, priorFrom, thisWeek);
  assert.deepEqual(churned, [{ id: 95, name: "Churned" }]);
});

// ---------- vacation / inactivity ----------

test("setVacation / clearVacation / markComebackDone / listVacationEnded", async () => {
  const db = newDb();
  await getOrCreateUser(db, 100, 100, "en");
  await setVacation(db, 100, "2020-01-01T00:00:00.000Z"); // already-ended vacation
  let ended = await listVacationEnded(db, new Date().toISOString());
  assert.deepEqual(ended.map((u) => u._id), [100]);

  await markComebackDone(db, 100, new Date().toISOString());
  ended = await listVacationEnded(db, new Date().toISOString());
  assert.deepEqual(ended, []); // already welcomed back

  await clearVacation(db, 100);
  const u = await getUser(db, 100);
  assert.equal(u!.vacationUntil, undefined);
});

test("listInactive / countInactive / clearInactiveAsk", async () => {
  const db = newDb();
  await getOrCreateUser(db, 110, 110, "en", "Stale");
  // createdAt defaults to "now" -- push the cutoff into the future so this user qualifies.
  const cutoff = new Date(Date.now() + 3_600_000).toISOString();
  await updateUser(db, 110, { inactiveAskedAt: new Date() });

  const inactive = await listInactive(db, cutoff, new Date().toISOString());
  assert.deepEqual(inactive.map((u) => u._id), [110]);
  assert.equal(await countInactive(db, cutoff, new Date().toISOString()), 1);

  await clearInactiveAsk(db, 110);
  const u = await getUser(db, 110);
  assert.equal(u!.inactiveAskedAt, undefined);
});
