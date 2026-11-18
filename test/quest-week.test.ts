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

// ---- the habit quest: 5 days a week of water, food or steps. Which one it is rotates by week:
// 2026-10-05 water, 2026-10-12 food, 2026-10-19 steps. Each counter is tested on its edge.
const WATER_WEEK = "2026-10-05";
const FOOD_WEEK = "2026-10-12";
const STEPS_WEEK = "2026-10-19";
const day = (week: string, n: number) => new Date(Date.parse(`${week}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const goals = { trainingWeekdays: [1, 3, 5], waterGoalMl: 2000, stepsGoal: 8000 } as UserDoc["profile"];
const habitOf = (week: string, data: Partial<Parameters<typeof evaluateWeekQuests>[2]>, profile = goals) => {
  const quest = evaluateWeekQuests(profile, week, { workouts: [], nutrition: [], steps: [], water: [], ...data }).quests.find((q) => q.kind !== "workouts");
  assert.ok(quest, "the habit quest is always there");
  return quest;
};

test("habit quest: five days is the target, four is not", () => {
  const water = (n: number) => Array.from({ length: n }, (_, i) => ({ date: day(WATER_WEEK, i), ml: 2000 }));
  assert.deepEqual([habitOf(WATER_WEEK, { water: water(5) }).kind, habitOf(WATER_WEEK, { water: water(5) }).target], ["water_days", 5]);
  assert.equal(habitOf(WATER_WEEK, { water: water(5) }).done, true);
  assert.equal(habitOf(WATER_WEEK, { water: water(4) }).done, false);
  assert.equal(habitOf(WATER_WEEK, { water: water(4) }).current, 4);
});

test("habit quest, water: a day counts at exactly the goal and not a millilitre below", () => {
  const at = (ml: number) => habitOf(WATER_WEEK, { water: [{ date: day(WATER_WEEK, 0), ml }] }).current;
  assert.equal(at(2000), 1);
  assert.equal(at(1999), 0);
  assert.equal(habitOf(WATER_WEEK, { water: [{ date: day(WATER_WEEK, 0), ml: 1500 }] }, { ...goals, waterGoalMl: 1500 }).current, 1, "the person's own goal is used");
});

test("habit quest, steps: a day counts at exactly the goal; the default is 8000", () => {
  const at = (steps: number, profile = goals) => habitOf(STEPS_WEEK, { steps: [{ date: day(STEPS_WEEK, 0), steps }] }, profile);
  assert.equal(at(8000).kind, "steps_days");
  assert.equal(at(8000).current, 1);
  assert.equal(at(7999).current, 0);
  const noGoal = { trainingWeekdays: [1, 3, 5] } as UserDoc["profile"];
  assert.equal(at(8000, noGoal).current, 1);
  assert.equal(at(7999, noGoal).current, 0);
  assert.equal(at(5000, { ...goals, stepsGoal: 5000 }).current, 1, "the person's own goal is used");
});

test("habit quest, food: a day counts with at least one meal, and a day is counted once", () => {
  const meal = { date: day(FOOD_WEEK, 0), meals: [{}] };
  assert.equal(habitOf(FOOD_WEEK, { nutrition: [meal] }).kind, "food_days");
  assert.equal(habitOf(FOOD_WEEK, { nutrition: [meal] }).current, 1);
  assert.equal(habitOf(FOOD_WEEK, { nutrition: [{ date: day(FOOD_WEEK, 0), meals: [] }] }).current, 0, "an empty day is not a food day");
  assert.equal(habitOf(FOOD_WEEK, { nutrition: [meal, { ...meal, meals: [{}, {}] }] }).current, 1, "two rows for one date are one day");
  assert.equal(habitOf(FOOD_WEEK, { nutrition: [meal, { date: day(FOOD_WEEK, 1), meals: [{}] }] }).current, 2);
});

test("habit quest: only the week's own days count (the day before and the day after are outside)", () => {
  const rows = (week: string, offsets: number[]) => offsets.map((n) => ({ date: day(week, n), ml: 2000, steps: 9000, meals: [{}] }));
  assert.equal(habitOf(WATER_WEEK, { water: rows(WATER_WEEK, [-1, 0, 6, 7]) }).current, 2, "water: Sunday before and Monday after are out");
  assert.equal(habitOf(STEPS_WEEK, { steps: rows(STEPS_WEEK, [-1, 0, 6, 7]) }).current, 2, "steps");
  assert.equal(habitOf(FOOD_WEEK, { nutrition: rows(FOOD_WEEK, [-1, 0, 6, 7]) }).current, 2, "food");
});

test("workouts quest: the target is the plan's training days (2 to 6), and the week's logs count", () => {
  const plan = (days: number[]) => ({ ...goals, trainingWeekdays: days });
  const quest = (days: number[], done: string[], split?: Array<{ weekday: number }>) =>
    evaluateWeekQuests(plan(days), WATER_WEEK, { workouts: done.map(doc), nutrition: [], steps: [], water: [], split }).quests.find((q) => q.kind === "workouts")!;
  assert.equal(quest([1, 3, 5], []).target, 3);
  assert.equal(quest([1], []).target, 2, "never below 2");
  assert.equal(quest([1, 2, 3, 4, 5, 6, 7], []).target, 6, "never above 6");
  assert.equal(quest([1, 3, 5], [], [{ weekday: 2 }, { weekday: 4 }]).target, 2, "the active plan's days win over the profile's");
  const three = ["2026-10-05", "2026-10-07", "2026-10-09"];
  assert.equal(quest([1, 3, 5], three).done, true);
  assert.equal(quest([1, 3, 5], three.slice(0, 2)).done, false);
  assert.equal(quest([1, 3, 5], three.slice(0, 2)).current, 2);
  assert.equal(quest([1, 3, 5], ["2026-10-05", "2026-10-05", "2026-10-07"]).current, 2, "two workouts on one day are one day");
});
