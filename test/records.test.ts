import { test } from "node:test";
import assert from "node:assert/strict";
import {
  badgeProgress,
  challengeMilestones,
  consistencyBoard,
  e1rm,
  isoWeekKey,
  mostImprovedBoard,
  recentPrBoard,
  relativeStrengthBoard,
  streakBoard,
  streakRisk,
  weekStartStr,
  weekStreak,
  workoutMilestones,
  type Competitor,
} from "../src/domain/records";

test("badgeProgress: tracks the nearest numeric-threshold badge family", () => {
  assert.deepEqual(badgeProgress("workouts_10", { workouts: 7 }), { current: 7, needed: 10 });
  assert.deepEqual(badgeProgress("streak_4", { streak: 2 }), { current: 2, needed: 4 });
  assert.deepEqual(badgeProgress("level_10", { level: 6 }), { current: 6, needed: 10 });
});

test("badgeProgress: clamps current to the threshold (already past it, badge just not synced yet)", () => {
  assert.deepEqual(badgeProgress("workouts_10", { workouts: 15 }), { current: 10, needed: 10 });
});

test("badgeProgress: null for event-based badges with no cheap running total", () => {
  assert.equal(badgeProgress("first_pr", { workouts: 5 }), null);
  assert.equal(badgeProgress("perfect_day", {}), null);
  assert.equal(badgeProgress("referral", {}), null);
});

test("badgeProgress: null when the matching count wasn't supplied", () => {
  assert.equal(badgeProgress("streak_12", { workouts: 40 }), null);
});

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

test("streakBoard: ranks by each competitor's own current weekly streak", () => {
  const competitors = new Map<number, Competitor>([
    [1, { userId: 1, name: "A" }],
    [2, { userId: 2, name: "B" }],
    [3, { userId: 3, name: "C" }], // no workouts at all → streak 0, dropped by rank()
  ]);
  const today = "2026-06-10"; // Wednesday
  const dates = [
    { userId: 1, date: "2026-06-02" }, // last week only
    { userId: 2, date: "2026-06-02" },
    { userId: 2, date: "2026-05-27" }, // and the week before → longer streak
  ];
  const board = streakBoard(competitors, dates, today);
  assert.deepEqual(board.map((e) => [e.userId, e.value]), [[2, 2], [1, 1]]);
});

test("recentPrBoard: counts all-time-best lifts set on/after the cutoff, ranked", () => {
  const competitors = new Map<number, Competitor>([
    [1, { userId: 1, name: "A" }],
    [2, { userId: 2, name: "B" }],
  ]);
  const strength = [
    { userId: 1, exercise: "Squat", bestWeight: 100, bestReps: 5, history: [{ date: "2026-06-05", weight: 100, reps: 5 }] },
    { userId: 1, exercise: "Bench", bestWeight: 60, bestReps: 8, history: [{ date: "2026-06-06", weight: 60, reps: 8 }] },
    { userId: 2, exercise: "Deadlift", bestWeight: 120, bestReps: 3, history: [{ date: "2026-04-01", weight: 120, reps: 3 }] }, // before cutoff
  ];
  const board = recentPrBoard(competitors, strength, "2026-06-01");
  assert.deepEqual(board.map((e) => [e.userId, e.value]), [[1, 2]]); // user 2 has none in-window
});

test("workoutMilestones: cumulative thresholds", () => {
  assert.deepEqual(workoutMilestones(1), ["first_workout"]);
  assert.deepEqual(workoutMilestones(10), ["first_workout", "workouts_10"]);
  assert.deepEqual(workoutMilestones(0), []);
});

test("challengeMilestones: cumulative thresholds, separate from workout/PR counters", () => {
  assert.deepEqual(challengeMilestones(0), []);
  assert.deepEqual(challengeMilestones(1), ["first_challenge"]);
  assert.deepEqual(challengeMilestones(5), ["first_challenge", "challenges_5"]);
});

test("streakRisk: an untrained current week puts an established streak at risk", () => {
  // 2026-06-01 is a Monday; weeks are Jun1-7, Jun8-14, Jun15-21. Friday of week 3, nothing
  // logged in it yet, two trained weeks behind it.
  const trained = ["2026-06-02", "2026-06-09"];
  assert.deepEqual(streakRisk(trained, "2026-06-19"), { current: 2, projected: 0, atRisk: true });
});

test("streakRisk: training this week clears the risk", () => {
  const trained = ["2026-06-02", "2026-06-09", "2026-06-16"];
  const r = streakRisk(trained, "2026-06-19");
  assert.equal(r.atRisk, false);
  assert.equal(r.projected, r.current);
});

test("streakRisk: no streak to lose is never 'at risk'", () => {
  assert.equal(streakRisk([], "2026-06-19").atRisk, false);
  // A single trained week that's already over: the grace week keeps current at 1, and losing it
  // is not something to send a rescue message about (the scheduler also requires >= 2).
  assert.equal(streakRisk(["2026-06-09"], "2026-06-19").current, 1);
});

test("streakRisk: a TRAILING miss is at risk even on a long streak (auto-freeze bridges gaps, not slides)", () => {
  // weekStreak's auto-freeze forgives one gap INSIDE a streak, explicitly not a trailing slide
  // with nothing trained after it — so a 6-week streak with nothing logged this week really is
  // on the line. Pinned here because it's exactly the rule a hand-written risk check gets wrong.
  const sixWeeks = ["2026-05-05", "2026-05-12", "2026-05-19", "2026-05-26", "2026-06-02", "2026-06-09"];
  const r = streakRisk(sixWeeks, "2026-06-19");
  assert.equal(r.current, 6);
  assert.equal(r.atRisk, true);
});
