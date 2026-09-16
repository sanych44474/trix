// Domain 8 (buddy/achievements/challenges/leaderboard/squads) v2-native repo —
// src/adapters/d1/v2Gamification.ts. Exercises it directly against the same in-memory D1 harness
// the legacy repo tests use (test/harness.ts), which builds its schema from every migrations/*.sql
// file, including 0069/0070/0080 (v2_achievements/v2_challenges/v2_squads/v2_squad_members/
// v2_buddy_duels) and the v2_profiles.buddyId/referredBy columns Domain 1's v2Users.ts writes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser, updateUser } from "../src/adapters/d1/v2Users";
import {
  activeChallengeCodes,
  activeChallenges,
  allBuddyPairs,
  awardAchievement,
  buddyDuelHistory,
  buddyWinCount,
  competitorBodyweights,
  competitorStrength,
  competitorWorkoutDates,
  countCompletedChallenges,
  deleteSquad,
  friendIds,
  getSquad,
  joinChallenge,
  joinSquad,
  leaveSquad,
  listAchievements,
  listCompetitors,
  listSquads,
  markChallengeDone,
  markSquadRecapped,
  markSquadWoken,
  recordBuddyDuel,
  squadCompletedDates,
  squadMembers,
  squadsDueForRecap,
  squadsForUser,
  squadsNeedingWake,
  upsertSquad,
} from "../src/adapters/d1/v2Gamification";

// ---------- achievements ----------

test("awardAchievement: INSERT OR IGNORE — first grant returns true, repeat returns false", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en");
  assert.equal(await awardAchievement(db, 1, "first_workout"), true);
  assert.equal(await awardAchievement(db, 1, "first_workout"), false);
  assert.deepEqual(await listAchievements(db, 1), ["first_workout"]);
});

test("listAchievements: ordered by earnedAt ascending", async () => {
  const db = newDb();
  await getOrCreateUser(db, 2, 2, "en");
  await awardAchievement(db, 2, "first_workout");
  await new Promise((r) => setTimeout(r, 5));
  await awardAchievement(db, 2, "workouts_10");
  assert.deepEqual(await listAchievements(db, 2), ["first_workout", "workouts_10"]);
});

// ---------- friendIds (referrals) ----------

test("friendIds: the inviter + everyone invited, deduped, self excluded", async () => {
  const db = newDb();
  await getOrCreateUser(db, 10, 10, "en"); // inviter of 11
  await getOrCreateUser(db, 11, 11, "en");
  await getOrCreateUser(db, 12, 12, "en");
  await updateUser(db, 11, { profile: { referredBy: 10 } });
  await updateUser(db, 12, { profile: { referredBy: 11 } }); // 11 invited 12
  const friends = await friendIds(db, 11);
  assert.deepEqual(friends.sort(), [10, 12]);
});

// ---------- buddy pairs / duels ----------

test("allBuddyPairs: only TRUE mutual pairs, smaller id first — a stale one-sided link is excluded", async () => {
  const db = newDb();
  await getOrCreateUser(db, 20, 20, "en");
  await getOrCreateUser(db, 21, 21, "en");
  await getOrCreateUser(db, 22, 22, "en"); // stale: points at 20, but 20 doesn't point back
  await updateUser(db, 20, { profile: { buddyId: 21 } });
  await updateUser(db, 21, { profile: { buddyId: 20 } });
  await updateUser(db, 22, { profile: { buddyId: 20 } });

  const pairs = await allBuddyPairs(db);
  // node:sqlite rows come back null-prototype -- compare plain-object shape, not prototype.
  assert.deepEqual(pairs.map((p) => ({ userA: p.userA, userB: p.userB })), [{ userA: 20, userB: 21 }]);
});

test("recordBuddyDuel / buddyWinCount / buddyDuelHistory", async () => {
  const db = newDb();
  await getOrCreateUser(db, 30, 30, "en");
  await getOrCreateUser(db, 31, 31, "en");
  await recordBuddyDuel(db, 30, 31, "2026-W01", 3, 1, 30);
  await recordBuddyDuel(db, 30, 31, "2026-W02", 0, 2, 31);
  // Re-running the same week is a no-op (idempotent sweep retry) — ON CONFLICT DO NOTHING.
  await recordBuddyDuel(db, 30, 31, "2026-W01", 99, 99, 99);

  assert.equal(await buddyWinCount(db, 30), 1);
  assert.equal(await buddyWinCount(db, 31), 1);

  const history = await buddyDuelHistory(db, 31, 30); // order of args doesn't matter — normalized internally
  assert.deepEqual(
    history.map((h) => h.weekKey),
    ["2026-W02", "2026-W01"],
  );
  assert.equal(history[1].aCount, 3); // untouched by the duplicate-week retry
});

// ---------- leaderboard raw-row queries ----------

test("listCompetitors: only competeOptIn users, with profile/alias/lang", async () => {
  const db = newDb();
  await getOrCreateUser(db, 40, 4000, "en", "Ann");
  await getOrCreateUser(db, 41, 4001, "uk", "Bob");
  await updateUser(db, 40, { competeOptIn: true, alias: "AnnA" });

  const rows = await listCompetitors(db);
  assert.deepEqual(
    rows.map((r) => r.userId),
    [40],
  );
  assert.equal(rows[0].alias, "AnnA");
  assert.equal(rows[0].chatId, 4000);
  assert.equal(JSON.parse(rows[0].profile).name, "Ann");
});

test("competitorWorkoutDates: only completed sessions for opted-in users", async () => {
  const db = newDb();
  await getOrCreateUser(db, 50, 50, "en");
  await getOrCreateUser(db, 51, 51, "en"); // not opted in
  await updateUser(db, 50, { competeOptIn: true });
  db.prepare(
    "INSERT INTO v2_workout_sessions (accountId, date, weekday, completed, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(50, "2026-06-01", 1, 1, "2026-06-01T00:00:00.000Z", "2026-06-01T00:00:00.000Z").run();
  db.prepare(
    "INSERT INTO v2_workout_sessions (accountId, date, weekday, completed, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(50, "2026-06-02", 2, 0, "2026-06-02T00:00:00.000Z", "2026-06-02T00:00:00.000Z").run(); // not completed
  db.prepare(
    "INSERT INTO v2_workout_sessions (accountId, date, weekday, completed, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(51, "2026-06-01", 1, 1, "2026-06-01T00:00:00.000Z", "2026-06-01T00:00:00.000Z").run(); // not opted in

  const dates = await competitorWorkoutDates(db);
  // node:sqlite rows come back null-prototype -- compare plain-object shape, not prototype.
  assert.deepEqual(dates.map((d) => ({ userId: d.userId, date: d.date })), [{ userId: 50, date: "2026-06-01" }]);
});

test("competitorStrength: strength records scoped to opted-in users", async () => {
  const db = newDb();
  await getOrCreateUser(db, 60, 60, "en");
  await updateUser(db, 60, { competeOptIn: true });
  db.prepare(
    "INSERT INTO v2_strength_records (accountId, exercise, bestWeight, bestReps, metric, history, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).bind(60, "bench", 100, 5, "reps", "[]", "2026-06-01T00:00:00.000Z").run();

  const rows = await competitorStrength(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].userId, 60);
  assert.equal(rows[0].exercise, "bench");
});

test("competitorBodyweights: latest weight per opted-in user (ASC scan, last write wins)", async () => {
  const db = newDb();
  await getOrCreateUser(db, 70, 70, "en");
  await updateUser(db, 70, { competeOptIn: true });
  db.prepare("INSERT INTO v2_measurements (accountId, date, weight, measurements) VALUES (?, ?, ?, '{}')").bind(70, "2026-05-01", 80).run();
  db.prepare("INSERT INTO v2_measurements (accountId, date, weight, measurements) VALUES (?, ?, ?, '{}')").bind(70, "2026-06-01", 78).run();

  const weights = await competitorBodyweights(db);
  assert.equal(weights.get(70), 78);
});

// ---------- challenges ----------

test("joinChallenge / activeChallenges / activeChallengeCodes / markChallengeDone / countCompletedChallenges", async () => {
  const db = newDb();
  await getOrCreateUser(db, 80, 80, "en");
  await joinChallenge(db, 80, "water_7", "2026-06-01", "2026-06-07");
  await joinChallenge(db, 80, "steps_10k_5", "2026-06-01", "2026-05-31"); // already-ended window

  const active = await activeChallenges(db, 80, "2026-06-03");
  assert.deepEqual(
    active.map((c) => c.code),
    ["water_7"],
  );
  const codes = await activeChallengeCodes(db, 80, "2026-06-03");
  assert.deepEqual([...codes], ["water_7"]);

  await markChallengeDone(db, active[0].id);
  assert.equal(await countCompletedChallenges(db, 80), 1);
  // markChallengeDone is idempotent: completedAt IS NULL guard means a second call is a no-op.
  const beforeCount = await countCompletedChallenges(db, 80);
  await markChallengeDone(db, active[0].id);
  assert.equal(await countCompletedChallenges(db, 80), beforeCount);
  assert.deepEqual(await activeChallenges(db, 80, "2026-06-03"), []);
});

// ---------- squads ----------

test("upsertSquad / joinSquad / leaveSquad / getSquad / listSquads", async () => {
  const db = newDb();
  await getOrCreateUser(db, 90, 90, "en");
  await getOrCreateUser(db, 91, 91, "en");
  const chat = -100;

  await upsertSquad(db, chat, "Gym Buddies", 90);
  assert.equal(await joinSquad(db, chat, 90), true);
  assert.equal(await joinSquad(db, chat, 90), false); // already in — ON CONFLICT DO NOTHING

  const squad = await getSquad(db, chat);
  assert.equal(squad?.title, "Gym Buddies");
  assert.equal(squad?.createdBy, 90);

  await upsertSquad(db, chat, "Renamed", 90); // title refresh, same chat
  assert.equal((await getSquad(db, chat))?.title, "Renamed");

  assert.equal(await joinSquad(db, chat, 91), true);
  assert.deepEqual((await listSquads(db)).map((s) => s.chatId), [chat]);

  assert.equal(await leaveSquad(db, chat, 91), true);
  assert.equal(await leaveSquad(db, chat, 91), false); // already gone
});

test("squadMembers: display name/alias/lang for every member", async () => {
  const db = newDb();
  await getOrCreateUser(db, 100, 100, "uk", "Oleh");
  const chat = -101;
  await upsertSquad(db, chat, null, 100);
  await joinSquad(db, chat, 100);
  const members = await squadMembers(db, chat);
  // node:sqlite rows come back null-prototype -- compare plain-object shape, not prototype.
  assert.deepEqual(
    members.map((m) => ({ userId: m.userId, name: m.name, alias: m.alias, lang: m.lang })),
    [{ userId: 100, name: "Oleh", alias: null, lang: "uk" }],
  );
});

test("squadsForUser / squadCompletedDates", async () => {
  const db = newDb();
  await getOrCreateUser(db, 110, 110, "en");
  const chatA = -110;
  const chatB = -111;
  await upsertSquad(db, chatA, null, 110);
  await upsertSquad(db, chatB, null, 110);
  await joinSquad(db, chatA, 110);
  await joinSquad(db, chatB, 110);

  assert.deepEqual((await squadsForUser(db, 110)).sort(), [chatB, chatA].sort());

  db.prepare(
    "INSERT INTO v2_workout_sessions (accountId, date, weekday, completed, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(110, "2026-06-01", 1, 1, "x", "x").run();
  db.prepare(
    "INSERT INTO v2_workout_sessions (accountId, date, weekday, completed, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(110, "2026-06-08", 1, 1, "x", "x").run(); // outside the [since, until) window below

  const dates = await squadCompletedDates(db, chatA, "2026-05-25", "2026-06-05");
  // node:sqlite rows come back null-prototype -- compare plain-object shape, not prototype.
  assert.deepEqual(dates.map((d) => ({ userId: d.userId, date: d.date })), [{ userId: 110, date: "2026-06-01" }]);
});

test("squadsDueForRecap / markSquadRecapped", async () => {
  const db = newDb();
  await getOrCreateUser(db, 120, 120, "en");
  const chat = -120;
  await upsertSquad(db, chat, null, 120);

  let due = await squadsDueForRecap(db, "2026-W20", 10);
  assert.deepEqual(due.map((s) => s.chatId), [chat]);

  await markSquadRecapped(db, chat, "2026-W20");
  due = await squadsDueForRecap(db, "2026-W20", 10);
  assert.deepEqual(due, []);

  due = await squadsDueForRecap(db, "2026-W21", 10); // a new week is due again
  assert.deepEqual(due.map((s) => s.chatId), [chat]);
});

test("squadsNeedingWake / markSquadWoken", async () => {
  const db = newDb();
  await getOrCreateUser(db, 130, 130, "en");
  const chat = -130;
  await upsertSquad(db, chat, null, 130);

  assert.deepEqual((await squadsNeedingWake(db, 10)).map((s) => s.chatId), [chat]);
  await markSquadWoken(db, chat);
  assert.deepEqual(await squadsNeedingWake(db, 10), []);
});

test("deleteSquad: removes the squad and its membership together", async () => {
  const db = newDb();
  await getOrCreateUser(db, 140, 140, "en");
  const chat = -140;
  await upsertSquad(db, chat, null, 140);
  await joinSquad(db, chat, 140);

  await deleteSquad(db, chat);

  assert.equal(await getSquad(db, chat), null);
  assert.deepEqual(await squadsForUser(db, 140), []);
});
