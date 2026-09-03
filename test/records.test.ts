import { test } from "node:test";
import assert from "node:assert/strict";
import {
  consistencyBoard,
  e1rm,
  isoWeekKey,
  mostImprovedBoard,
  relativeStrengthBoard,
  weekStartStr,
  weekStreak,
  workoutMilestones,
  type Competitor,
} from "../src/domain/records";

test("e1rm: Epley, bodyweight sets excluded", () => {
  assert.equal(Math.round(e1rm(100, 5)), 117);
  assert.equal(e1rm(0, 10), 0);
  assert.equal(e1rm(50, 0), 0);
});

test("isoWeekKey + weekStartStr are consistent within a week", () => {
  // 2026-06-01 is a Monday.
  assert.equal(weekStartStr("2026-06-03"), "2026-06-01");
  assert.equal(isoWeekKey("2026-06-01"), isoWeekKey("2026-06-07")); // same ISO week
  assert.notEqual(isoWeekKey("2026-06-07"), isoWeekKey("2026-06-08")); // Sun vs next Mon
});

test("weekStreak: consecutive weeks with a grace for the current week", () => {
  const today = "2026-06-10"; // Wednesday
  // workouts last week + the week before, nothing yet this week → streak 2 (grace).
  const dates = ["2026-06-02", "2026-05-27"];
  assert.equal(weekStreak(dates, today), 2);
  // a gap two weeks back breaks it.
  assert.equal(weekStreak(["2026-06-02"], today), 1);
  assert.equal(weekStreak([], today), 0);
});

test("consistencyBoard: counts only this-week completed workouts, ranked", () => {
  const competitors = new Map<number, Competitor>([
    [1, { userId: 1, name: "A" }],
    [2, { userId: 2, name: "B" }],
  ]);
  const dates = [
    { userId: 1, date: "2026-06-02" },
    { userId: 1, date: "2026-06-04" },
    { userId: 2, date: "2026-06-03" },
    { userId: 2, date: "2026-05-20" }, // before week start → ignored
  ];
  const board = consistencyBoard(competitors, dates, "2026-06-01");
  assert.deepEqual(board.map((e) => [e.userId, e.value]), [[1, 2], [2, 1]]);
});

test("relativeStrengthBoard: e1RM per bodyweight, needs a bodyweight", () => {
  const competitors = new Map<number, Competitor>([
    [1, { userId: 1, name: "A", weightKg: 80 }],
    [2, { userId: 2, name: "B" }], // no bodyweight → excluded
  ]);
  const strength = [
    { userId: 1, exercise: "Bench", bestWeight: 100, bestReps: 5, history: [] },
    { userId: 2, exercise: "Bench", bestWeight: 120, bestReps: 5, history: [] },
  ];
  const board = relativeStrengthBoard(competitors, strength);
  assert.equal(board.length, 1);
  assert.equal(board[0].userId, 1);
  assert.equal(board[0].detail, "Bench");
});

test("mostImprovedBoard: needs a prior baseline before the cutoff", () => {
  const competitors = new Map<number, Competitor>([[1, { userId: 1, name: "A" }]]);
  const strength = [
    {
      userId: 1,
      exercise: "Squat",
      bestWeight: 0,
      bestReps: 0,
      history: [
        { date: "2026-05-01", weight: 100, reps: 5 }, // prior best
        { date: "2026-06-09", weight: 110, reps: 5 }, // recent (after cutoff)
      ],
    },
  ];
  const board = mostImprovedBoard(competitors, strength, "2026-06-03");
  assert.equal(board.length, 1);
  assert.ok(board[0].value > 0);
});

test("workoutMilestones: cumulative thresholds", () => {
  assert.deepEqual(workoutMilestones(1), ["first_workout"]);
  assert.deepEqual(workoutMilestones(10), ["first_workout", "workouts_10"]);
  assert.deepEqual(workoutMilestones(0), []);
});
