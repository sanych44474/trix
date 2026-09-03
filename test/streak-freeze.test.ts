import { test } from "node:test";
import assert from "node:assert/strict";
import { weekStreak, recentPrCount } from "../src/domain/records";

// Mondays: 2026-06-01, 06-08, 06-15, 06-22, 06-29; today = Thu 2026-07-02.
const TODAY = "2026-07-02";

test("weekStreak: vacation week is skipped, not broken", () => {
  // trained weeks of Jun 1 and Jun 8, vacation Jun 15-28 (two empty weeks), trained this week
  const dates = ["2026-06-02", "2026-06-10", "2026-07-01"];
  assert.equal(weekStreak(dates, TODAY), 1); // without freeze the gap breaks it
  const frozen = { from: "2026-06-15", until: "2026-06-28" };
  assert.equal(weekStreak(dates, TODAY, frozen), 3); // frozen weeks bridge the gap
});

test("weekStreak: frozen weeks add nothing by themselves", () => {
  // only vacation, no workouts at all
  assert.equal(weekStreak([], TODAY, { from: "2026-06-15", until: "2026-06-28" }), 0);
});

test("weekStreak: grace week still works with freeze", () => {
  // nothing this week yet; last week trained; week before frozen; before that trained
  const dates = ["2026-06-24", "2026-06-10"];
  const frozen = { from: "2026-06-15", until: "2026-06-21" };
  assert.equal(weekStreak(dates, TODAY, frozen), 2); // two trained weeks bridged by the frozen one
  assert.equal(weekStreak(dates, TODAY), 1); // without freeze the gap cuts it to last week only
});

test("recentPrCount: counts lifts whose all-time best falls in the window", () => {
  const records = [
    {
      metric: "reps",
      bestWeight: 80,
      history: [
        { date: "2026-06-01", weight: 70, reps: 8 },
        { date: "2026-06-30", weight: 80, reps: 8 }, // all-time best, in window
      ],
    },
    {
      metric: "reps",
      bestWeight: 100,
      history: [
        { date: "2026-05-01", weight: 100, reps: 5 }, // best is old
        { date: "2026-06-30", weight: 90, reps: 5 },
      ],
    },
    { metric: "time", bestWeight: 0, history: [] }, // non-reps ignored
  ];
  assert.equal(recentPrCount(records, "2026-06-26"), 1);
});

test("weekStreak: auto-freeze bridges ONE missed week inside an established streak", () => {
  // trained: this week + 4 consecutive weeks before the gap (May 25, Jun 1, 8, 15... gap Jun 22-28)
  const dates = ["2026-07-01", "2026-06-17", "2026-06-10", "2026-06-03", "2026-05-27"];
  // gap = week of Jun 22; older side has 4 consecutive trained weeks -> bridged
  assert.equal(weekStreak(dates, TODAY), 5);
});

test("weekStreak: no auto-freeze when the older side is shorter than 4 weeks", () => {
  // trained this week; gap last-1; only 3 older weeks
  const dates = ["2026-07-01", "2026-06-17", "2026-06-10", "2026-06-03"];
  assert.equal(weekStreak(dates, TODAY), 1);
});

test("weekStreak: only one gap is forgiven per streak", () => {
  // this week, gap, 4 weeks, ANOTHER gap, more weeks — second gap must break it
  const dates = ["2026-07-01", "2026-06-17", "2026-06-10", "2026-06-03", "2026-05-27", "2026-05-13", "2026-05-06"];
  // first gap (Jun 22) bridged; second gap (May 18) breaks -> 1 + 4 = 5
  assert.equal(weekStreak(dates, TODAY), 5);
});

test("weekStreak: a trailing slide (no recent training) is not protected", () => {
  // nothing this week or last week (grace covers only one); 5 older weeks
  const dates = ["2026-06-17", "2026-06-10", "2026-06-03", "2026-05-27", "2026-05-20"];
  // grace eats the current week, gap at last week has streak=0 on the recent side -> no bridge
  assert.equal(weekStreak(dates, TODAY), 0);
});
