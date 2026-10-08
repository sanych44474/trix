// One quest week, evaluated once: evaluateWeekQuests (pure) and settleQuests (record + the
// quest_sweep badge). The Today card and the Monday close job both go through these now, so the
// rule "all quests done, newly recorded -> badge, exactly once" has one test instead of two copies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser } from "../src/adapters/d1/v2Users";
import { settleQuests } from "../src/adapters/d1/v2Gamification";
import { evaluateWeekQuests } from "../src/domain/questWeek";
import type { UserDoc, WorkoutLogDoc } from "../src/types";

const WEEK = "2026-10-05"; // a Monday

test("settleQuests: records the done quests and awards quest_sweep once, only when every quest is done", async () => {
  const db = newDb();
  await getOrCreateUser(db, 9501, 9501, "en", "T");
  const quests = [{ code: "q1" }, { code: "q2" }, { code: "q3" }];

  const partial = await settleQuests(db, 9501, WEEK, { quests, done: ["q1", "q2"] });
  assert.deepEqual(partial, { fresh: ["q1", "q2"], sweep: false });

  const finished = await settleQuests(db, 9501, WEEK, { quests, done: ["q1", "q2", "q3"] });
  assert.deepEqual(finished, { fresh: ["q3"], sweep: true }, "only the new quest is fresh; completing the set earns the badge");

  const replay = await settleQuests(db, 9501, WEEK, { quests, done: ["q1", "q2", "q3"] });
  assert.deepEqual(replay, { fresh: [], sweep: false }, "settling a recorded week is a no-op, no second badge");
});

test("settleQuests: a week with no quests, or none done, records nothing and awards nothing", async () => {
  const db = newDb();
  await getOrCreateUser(db, 9502, 9502, "en", "T");
  assert.deepEqual(await settleQuests(db, 9502, WEEK, { quests: [], done: [] }), { fresh: [], sweep: false });
  assert.deepEqual(await settleQuests(db, 9502, WEEK, { quests: [{ code: "q1" }], done: [] }), { fresh: [], sweep: false });
});

test("settleQuests: weeks are independent", async () => {
  const db = newDb();
  await getOrCreateUser(db, 9503, 9503, "en", "T");
  const quests = [{ code: "q1" }];
  assert.deepEqual((await settleQuests(db, 9503, "2026-09-28", { quests, done: ["q1"] })).fresh, ["q1"]);
  assert.deepEqual((await settleQuests(db, 9503, WEEK, { quests, done: ["q1"] })).fresh, ["q1"], "the same code in another week is new");
});

const doc = (date: string): WorkoutLogDoc => ({ userId: 1, date, weekday: 1, completed: true, exercises: [], rawText: "", createdAt: new Date() } as unknown as WorkoutLogDoc);
const profile = { trainingWeekdays: [1, 3, 5] } as UserDoc["profile"];

test("evaluateWeekQuests: logged days stop at the end of the week (a close job for last week ignores this week)", () => {
  const week = evaluateWeekQuests(profile, WEEK, {
    workouts: [doc("2026-10-01"), doc("2026-10-06"), doc("2026-10-12")], // last week, in the week, next week
    nutrition: [],
    steps: [],
    water: [],
  });
  assert.deepEqual(week.logs.map((l) => l.date).sort(), ["2026-10-01", "2026-10-06"]);
  assert.ok(week.quests.length >= 1 && week.quests.length <= 3, "up to three quests a week");
  assert.deepEqual(week.done, week.quests.filter((q) => q.done).map((q) => q.code));
});
