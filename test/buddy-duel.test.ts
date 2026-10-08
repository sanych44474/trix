import { test } from "node:test";
import assert from "node:assert/strict";
import { currentWinStreak, decideDuel } from "../src/domain/buddyDuel";
import { newDb } from "./harness";
import { allBuddyPairs, buddyDuelHistory, buddyWinCount, recordBuddyDuel } from "../src/adapters/d1/v2Gamification";
import { getOrCreateUser, updateUser } from "../src/adapters/d1/v2Users";
import type { UserDoc } from "../src/types";

// ---------- pure domain logic ----------

test("decideDuel: more completed workouts wins, equal counts (including 0-0) tie", () => {
  assert.equal(decideDuel(1, 2, "2026-W20", 3, 1).winnerId, 1);
  assert.equal(decideDuel(1, 2, "2026-W20", 1, 3).winnerId, 2);
  assert.equal(decideDuel(1, 2, "2026-W20", 2, 2).winnerId, null);
  assert.equal(decideDuel(1, 2, "2026-W20", 0, 0).winnerId, null);
});

test("currentWinStreak: consecutive most-recent wins, stops at the first non-win", () => {
  const history = [
    { winnerId: 1 }, // most recent
    { winnerId: 1 },
    { winnerId: null }, // tie breaks the streak
    { winnerId: 1 },
  ];
  assert.equal(currentWinStreak(1, history), 2);
  assert.equal(currentWinStreak(2, history), 0);
  assert.equal(currentWinStreak(1, []), 0);
});

// ---------- DB repo layer (real in-memory D1) ----------

test("allBuddyPairs: returns each mutual pair exactly once, userA < userB", async () => {
  const db = newDb();
  const a = (await getOrCreateUser(db, 1, 1, "uk", "A")) as unknown as UserDoc;
  const b = (await getOrCreateUser(db, 2, 2, "uk", "B")) as unknown as UserDoc;
  await getOrCreateUser(db, 3, 3, "uk", "C"); // unpaired — should not appear
  await updateUser(db, 1, { profile: { ...a.profile, buddyId: 2 } });
  await updateUser(db, 2, { profile: { ...b.profile, buddyId: 1 } });

  assert.deepEqual((await allBuddyPairs(db)).map((p) => [p.userA, p.userB]), [[1, 2]]);
});

test("allBuddyPairs: excludes a stale one-sided link left behind by re-pairing", async () => {
  // bot.ts's /start buddy_<id> handler has no guard against re-pairing with someone new while
  // already paired — user 1 re-pairs with user 3, leaving user 2's buddyId still pointing at 1
  // (stale, one-sided). Only the now-mutual (1,3) pair should come back, not the stale (1,2).
  const db = newDb();
  const a = (await getOrCreateUser(db, 1, 1, "uk", "A")) as unknown as UserDoc;
  const b = (await getOrCreateUser(db, 2, 2, "uk", "B")) as unknown as UserDoc;
  const c = (await getOrCreateUser(db, 3, 3, "uk", "C")) as unknown as UserDoc;
  await updateUser(db, 1, { profile: { ...a.profile, buddyId: 2 } });
  await updateUser(db, 2, { profile: { ...b.profile, buddyId: 1 } });
  await updateUser(db, 1, { profile: { ...a.profile, buddyId: 3 } }); // 1 re-pairs with 3
  await updateUser(db, 3, { profile: { ...c.profile, buddyId: 1 } });

  assert.deepEqual((await allBuddyPairs(db)).map((p) => [p.userA, p.userB]), [[1, 3]]);
});

test("recordBuddyDuel + buddyWinCount + buddyDuelHistory: round-trip and idempotent re-run", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "uk", "A");
  await getOrCreateUser(db, 2, 2, "uk", "B");

  await recordBuddyDuel(db, 1, 2, "2026-W20", 4, 2, 1);
  await recordBuddyDuel(db, 1, 2, "2026-W20", 999, 999, 2); // re-run for the same week — must not overwrite
  await recordBuddyDuel(db, 1, 2, "2026-W21", 1, 3, 2);
  await recordBuddyDuel(db, 1, 2, "2026-W22", 2, 2, null); // tie

  assert.equal(await buddyWinCount(db, 1), 1);
  assert.equal(await buddyWinCount(db, 2), 1);

  const history = await buddyDuelHistory(db, 1, 2);
  assert.deepEqual(history.map((h) => h.weekKey), ["2026-W22", "2026-W21", "2026-W20"]); // most recent first
  assert.equal(history[2].aCount, 4); // confirms the idempotent re-run didn't clobber the original counts
});

// ---------- results go through the notification outbox ----------

test("processBuddyDuels: both sides are told through the outbox, a re-run tells nobody twice, a refused send is queued", async () => {
  const { processBuddyDuels } = await import("../src/schedulerJobs/social");
  const { upsertWorkoutLog } = await import("../src/adapters/d1/v2Workouts");
  const { GrammyError } = await import("grammy");
  const db = newDb();
  const a = (await getOrCreateUser(db, 1, 1, "en", "Ann")) as unknown as UserDoc;
  const b = (await getOrCreateUser(db, 2, 2, "en", "Bob")) as unknown as UserDoc;
  await updateUser(db, 1, { profile: { ...a.profile, buddyId: 2 } });
  await updateUser(db, 2, { profile: { ...b.profile, buddyId: 1 } });

  // The week that just ended is the one before "today": log two workouts for Ann, none for Bob.
  const today = "2026-10-08";
  for (const date of ["2026-09-29", "2026-09-30"]) {
    await upsertWorkoutLog(db, 1, date, 2, [{ name: "Squat", setsDone: [{ reps: 5, weight: 100 }], skipped: false }], true, "x");
  }

  const sent: Array<{ chatId: number; text: string }> = [];
  let limitedFor: number | null = null;
  const bot = { api: { sendMessage: (async (chatId: number, text: string) => {
    if (chatId === limitedFor) throw new GrammyError("x", { ok: false, error_code: 429, description: "slow", parameters: { retry_after: 5 } }, "sendMessage", {});
    sent.push({ chatId, text });
    return {} as never;
  }) as never } };
  const env = { DB: db, TELEGRAM_BOT_TOKEN: "t" } as never;

  limitedFor = 2; // Bob's chat is rate limited this time
  await processBuddyDuels(env, bot as never, today);
  assert.equal(sent.filter((m) => m.chatId === 1).length, 1, "the winner is told");
  const rows = await db.prepare("SELECT kind, status FROM v2_notifications ORDER BY kind").all<{ kind: string; status: string }>();
  const byKind = Object.fromEntries((rows.results ?? []).map((r) => [r.kind, r.status]));
  assert.deepEqual(byKind, { duel_lost: "pending", duel_won: "sent" }, "the loser's message is queued for retry, not lost");

  // The gate may re-run the week after a failure: nobody is told twice.
  limitedFor = null;
  await processBuddyDuels(env, bot as never, today);
  assert.equal(sent.filter((m) => m.chatId === 1).length, 1, "winner not told twice");
  assert.equal(sent.filter((m) => m.chatId === 2).length, 0, "the queued message is the retry sweep's job, not re-sent here");
});
