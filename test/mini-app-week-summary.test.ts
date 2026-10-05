import { test } from "node:test";
import assert from "node:assert/strict";
import { lastWeekSummary } from "../apps/mini-app/src/logic/weekSummary";

test("lastWeekSummary: the previous Mon–Sun, workouts vs plan, weight vs the week before, records, focus", () => {
  const s = lastWeekSummary({
    today: "2026-10-07", // Wednesday → last week is 09-28..10-04
    days: [{ date: "2026-09-28", s: "done" }, { date: "2026-09-30", s: "done" }, { date: "2026-10-02", s: "missed" }, { date: "2026-10-05", s: "done" }],
    plannedWeekdays: [1, 3, 5],
    weights: [{ date: "2026-09-22", kg: 75 }, { date: "2026-09-24", kg: 75.4 }, { date: "2026-09-29", kg: 74.6 }, { date: "2026-10-03", kg: 74.4 }],
    foodDays: [{ date: "2026-09-28", kcal: 2100 }, { date: "2026-09-29", kcal: 0 }, { date: "2026-10-01", kcal: 2300 }],
    exercises: [
      { name: "Жим лежачи", points: [{ date: "2026-09-21", e1rm: 80 }, { date: "2026-09-28", e1rm: 84 }] },
      { name: "Присідання", points: [{ date: "2026-09-21", e1rm: 120 }, { date: "2026-09-30", e1rm: 118 }] },
    ],
  });
  assert.equal(s.start, "2026-09-28");
  assert.equal(s.end, "2026-10-04");
  assert.equal(s.workouts, 2);
  assert.equal(s.planned, 3);
  assert.equal(s.weightDelta, -0.7);
  assert.equal(s.foodDays, 2);
  assert.deepEqual(s.records, ["Жим лежачи"]);
  assert.equal(s.focus, "workouts");
});
