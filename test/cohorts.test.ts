import { test } from "node:test";
import assert from "node:assert/strict";
import { biggestDrop, cohortRetention } from "../src/domain/cohorts";

const TODAY = "2026-09-30";

test("cohorts: grouped by signup week, newest first, with an all row", () => {
  const rows = cohortRetention([
    { joined: "2026-07-06", trainedWeeks: [0, 1, 3, 7] }, // Monday
    { joined: "2026-07-08", trainedWeeks: [0] },          // same week
    { joined: "2026-07-13", trainedWeeks: [] },
    { joined: "2026-09-28", trainedWeeks: [0] },          // two days ago: too young for anything
  ], TODAY);
  assert.deepEqual(rows.map((r) => r.cohort), ["2026-09-28", "2026-07-13", "2026-07-06", "all"]);
  assert.deepEqual(rows[2], { cohort: "2026-07-06", size: 2, rates: [100, 50, 50, 50] });
  assert.deepEqual(rows[1]!.rates, [0, 0, 0, 0]);
  assert.deepEqual(rows[0]!.rates, [null, null, null, null], "nobody has finished week 1 yet");
  // The all row only counts members old enough for each week.
  assert.deepEqual(rows[3], { cohort: "all", size: 4, rates: [67, 33, 33, 33] });
});

test("cohorts: a young cohort is judged only on the weeks it has lived through", () => {
  const [row] = cohortRetention([{ joined: "2026-09-09", trainedWeeks: [0, 1] }], TODAY); // 21 days
  assert.deepEqual(row!.rates, [100, 100, null, null]);
  assert.deepEqual(cohortRetention([], TODAY), []);
});

test("biggest drop: the steepest fall between consecutive weeks", () => {
  assert.deepEqual(biggestDrop({ cohort: "all", size: 10, rates: [70, 30, 25, null] }), { from: 1, to: 2, fromRate: 70, toRate: 30 });
  assert.equal(biggestDrop({ cohort: "all", size: 1, rates: [50, 50, null, null] }), null);
  assert.equal(biggestDrop(undefined), null);
});
