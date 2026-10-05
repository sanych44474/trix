import { test } from "node:test";
import assert from "node:assert/strict";
import { pickQuests, questProgress } from "../src/domain/quests";

const day = (date: string, ex: Array<[string, number]>) => ({ date, done: true, ex: ex.map(([n, s]) => ({ n, s })) });
const WEEK = "2026-09-28"; // a Monday
const pushWeek = [day("2026-09-22", [["Жим лежачи", 12], ["Жим гантелей сидячи", 8]]), day("2026-09-25", [["Жим лежачи", 10]])];

test("quests: workouts from the plan, the lagging muscle from last week, one rotating habit", () => {
  const q = pickQuests(WEEK, pushWeek, 3);
  assert.equal(q.length, 3);
  assert.deepEqual(q[0], { code: "workouts", kind: "workouts", target: 3 });
  assert.equal(q[1]!.kind, "muscle_sets");
  assert.ok(q[1]!.muscle && q[1]!.target > 0 && q[1]!.code === `muscle_sets:${q[1]!.muscle}`);
  assert.ok(["water_days", "food_days", "steps_days"].includes(q[2]!.kind));
  // Deterministic within the week, rotating across weeks.
  assert.deepEqual(pickQuests(WEEK, pushWeek, 3), q);
  const kinds = new Set(["2026-09-28", "2026-10-05", "2026-10-12"].map((w) => pickQuests(w, [], 0).at(-1)!.kind));
  assert.equal(kinds.size, 3);
});

test("quests: no plan and an idle last week start small, and skip the muscle quest", () => {
  const q = pickQuests(WEEK, [], 0);
  assert.equal(q[0]!.target, 2);
  assert.equal(q.length, 2);
  assert.equal(pickQuests(WEEK, [], 9)[0]!.target, 6, "capped at 6");
});

test("quest progress counts this week only, and marks done at the target", () => {
  const quests = pickQuests(WEEK, pushWeek, 2);
  const muscle = quests[1]!;
  const logs = [...pushWeek, day("2026-09-29", [["Жим лежачи", 5]]), day("2026-10-01", [["Присідання", 4]])];
  const p = questProgress(quests, WEEK, { logs, waterDays: 5, foodDays: 5, stepsDays: 5 });
  assert.equal(p[0]!.current, 2);
  assert.equal(p[0]!.done, true);
  assert.equal(p[2]!.done, true);
  assert.equal(muscle.kind, "muscle_sets");
  assert.ok(p[1]!.current < muscle.target);
});

test("pickQuests: a day of last week back-filled this week doesn't change this week's quests", () => {
  const before = [{ date: "2026-09-22", done: true, ex: [{ n: "Bench Press", s: 6 }], loggedOn: "2026-09-22" }];
  const backfill = { date: "2026-09-24", done: true, ex: [{ n: "Squat", s: 6 }, { n: "Romanian Deadlift", s: 6 }], loggedOn: "2026-09-30" };
  assert.deepEqual(pickQuests("2026-09-28", [...before, backfill], 3), pickQuests("2026-09-28", before, 3));
});
