import { test } from "node:test";
import assert from "node:assert/strict";
import { currentWinStreak, decideDuel } from "../src/domain/buddyDuel";
import { newDb } from "./harness";
import {
  allBuddyPairs,
  buddyDuelHistory,
  buddyWinCount,
  getOrCreateUser,
  recordBuddyDuel,
  updateUser,
} from "../src/db/repos";
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

  assert.deepEqual(await allBuddyPairs(db), [{ userA: 1, userB: 2 }]);
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
