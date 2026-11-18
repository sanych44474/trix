// src/domain/records.ts, the edges: ISO week numbers around the year end, which weeks a vacation
// freezes, what counts as a new record, how the boards order and break ties, and the exact count at
// which each badge is earned. Each rule is tested on the value that just passes and the one that
// just fails (written after a mutation run showed the typical-value tests could not tell them apart).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  badgeProgress,
  challengeMilestones,
  consistencyBoard,
  isoWeekKey,
  mostImprovedBoard,
  prMilestones,
  rankOf,
  recentPrCount,
  relativeStrengthBoard,
  streakMilestones,
  streakRisk,
  totalWorkoutsBoard,
  weekRangeOffset,
  weekStreak,
  workoutMilestones,
} from "../src/domain/records";

test("isoWeekKey: Thursday decides the year, so the year ends in week 52 or 53 and starts in week 1", () => {
  assert.equal(isoWeekKey("2026-01-01"), "2026-W01", "a Thursday: week 1 of its own year");
  assert.equal(isoWeekKey("2025-12-29"), "2026-W01", "the Monday before it already belongs to 2026");
  assert.equal(isoWeekKey("2026-01-04"), "2026-W01", "Sunday ends week 1");
  assert.equal(isoWeekKey("2026-01-05"), "2026-W02");
  assert.equal(isoWeekKey("2026-03-04"), "2026-W10");
  assert.equal(isoWeekKey("2026-12-31"), "2026-W53", "2026 has 53 weeks");
  assert.equal(isoWeekKey("2027-01-03"), "2026-W53", "the Sunday after: still 2026");
  assert.equal(isoWeekKey("2027-01-04"), "2027-W01");
  assert.equal(isoWeekKey("2024-12-30"), "2025-W01");
  assert.equal(isoWeekKey("2021-01-03"), "2020-W53");
  assert.equal(isoWeekKey("not a date"), "0000-W00");
});

// Today is Wednesday 2026-06-10. Weeks back from this week: 0 = Jun 8-14, 1 = Jun 1-7, 2 = May 25-31,
// 3 = May 18-24, 4 = May 11-17. Trained in weeks 1, 3 and 4; week 2 is the gap.
const TODAY = "2026-06-10";
const TRAINED = ["2026-06-02", "2026-05-19", "2026-05-12"];

test("weekStreak: without a vacation the gap ends the streak at 1", () => {
  assert.equal(weekStreak(TRAINED, TODAY), 1);
});

test("weekStreak: a vacation that touches the gap week on its first or last day skips it", () => {
  const freeze = (from: string, until: string) => weekStreak(TRAINED, TODAY, { from, until });
  assert.equal(freeze("2026-05-25", "2026-05-25"), 3, "ends on the week's Monday");
  assert.equal(freeze("2026-05-31", "2026-05-31"), 3, "starts on the week's Sunday");
  assert.equal(freeze("2026-05-20", "2026-05-24"), 1, "ends the day before the week starts");
  assert.equal(freeze("2026-06-01", "2026-06-02"), 1, "starts the day after the week ends");
  assert.equal(freeze("2026-05-01", "2026-06-30"), 3, "covers it fully");
});

test("streakRisk: a streak is at risk when an empty week would break it, and not once this week is trained", () => {
  assert.deepEqual(streakRisk(["2026-06-02"], TODAY), { current: 1, projected: 0, atRisk: true });
  assert.deepEqual(streakRisk(["2026-06-02", "2026-06-09"], TODAY), { current: 2, projected: 2, atRisk: false });
  assert.deepEqual(streakRisk([], TODAY), { current: 0, projected: 0, atRisk: false }, "nothing to lose");
});

const bench = (history: Array<[string, number, number]>, metric?: string) => ({
  metric,
  bestWeight: Math.max(0, ...history.map(([, w]) => w)),
  history: history.map(([date, weight, reps]) => ({ date, weight, reps })),
});

test("recentPrCount: counts a lift only when its all-time best (by estimated 1RM) falls on or after the date", () => {
  assert.equal(recentPrCount([bench([["2026-05-01", 80, 5], ["2026-06-05", 100, 5]])], "2026-06-01"), 1);
  assert.equal(recentPrCount([bench([["2026-05-01", 100, 5], ["2026-06-05", 80, 5]])], "2026-06-01"), 0, "the best is the old one");
  assert.equal(recentPrCount([bench([["2026-06-01", 100, 5]])], "2026-06-01"), 1, "on the date counts");
  assert.equal(recentPrCount([bench([["2026-05-31", 100, 5]])], "2026-06-01"), 0, "the day before does not");
  assert.equal(recentPrCount([bench([["2026-06-05", 100, 1]]), bench([["2026-06-06", 60, 8]]), bench([["2026-04-01", 60, 8]])], "2026-06-01"), 2);
});

test("recentPrCount: bodyweight, timed and empty sets are not records", () => {
  const since = "2026-06-01";
  assert.equal(recentPrCount([bench([["2026-06-05", 0, 12]])], since), 0, "bodyweight: bestWeight 0");
  assert.equal(recentPrCount([{ bestWeight: 100, history: [{ date: "2026-06-05", weight: 0, reps: 10 }] }], since), 0, "a 0 kg set has no 1RM");
  assert.equal(recentPrCount([{ bestWeight: 100, history: [{ date: "2026-06-05", weight: 100, reps: 0 }] }], since), 0, "0 reps has no 1RM");
  assert.equal(recentPrCount([bench([["2026-06-05", 100, 5]], "time")], since), 0, "a timed lift");
  assert.equal(recentPrCount([bench([["2026-06-05", 100, 5]], "distance")], since), 0, "a distance lift");
  assert.equal(recentPrCount([bench([["2026-06-05", 100, 5]], "reps")], since), 1);
  assert.equal(recentPrCount([], since), 0);
});

const people = new Map([
  [1, { userId: 1, name: "Ann", weightKg: 50 }],
  [2, { userId: 2, name: "Bob", weightKg: 100 }],
  [3, { userId: 3, name: "Cy" }],
]);
const lift = (userId: number, exercise: string, bestWeight: number, history: Array<[string, number]>) => ({
  userId, exercise, bestWeight, bestReps: 1, history: history.map(([date, weight]) => ({ date, weight, reps: 1 })),
});

test("mostImprovedBoard: percent gain of the recent best over the prior best, biggest first", () => {
  const board = mostImprovedBoard(people, [
    lift(1, "Bench", 110, [["2026-05-01", 100], ["2026-06-05", 110]]),
    lift(2, "Squat", 120, [["2026-05-01", 100], ["2026-06-05", 120]]),
  ], "2026-06-01");
  assert.deepEqual(board.map((e) => [e.name, e.value, e.detail]), [["Bob", 20, "Squat"], ["Ann", 10, "Bench"]]);
});

test("mostImprovedBoard: no baseline, no gain, or an unknown person means no entry; the cutoff day is recent", () => {
  const rows = (history: Array<[string, number]>, userId = 1) => mostImprovedBoard(people, [lift(userId, "Bench", 110, history)], "2026-06-01");
  assert.equal(rows([["2026-06-05", 110]]).length, 0, "nothing before the cutoff: no baseline to measure from");
  assert.equal(rows([["2026-05-01", 100], ["2026-06-05", 100]]).length, 0, "an equal best is not an improvement");
  assert.equal(rows([["2026-05-01", 100], ["2026-06-05", 90]]).length, 0, "a lower one is not either");
  assert.equal(rows([["2026-05-01", 100], ["2026-06-05", 110]], 99).length, 0, "not on the board");
  assert.equal(rows([["2026-05-01", 100], ["2026-06-01", 110]]).length, 1, "a set on the cutoff day is recent, not prior");
  assert.equal(rows([["2026-05-31", 100], ["2026-06-01", 110]])[0].value, 10);
});

test("mostImprovedBoard: one entry per person, the better lift, the first of equals", () => {
  const board = (lifts: ReturnType<typeof lift>[]) => mostImprovedBoard(people, lifts, "2026-06-01");
  const small = lift(1, "Curl", 110, [["2026-05-01", 100], ["2026-06-05", 110]]);
  const big = lift(1, "Press", 130, [["2026-05-01", 100], ["2026-06-05", 130]]);
  assert.deepEqual(board([small, big]).map((e) => [e.value, e.detail]), [[30, "Press"]]);
  assert.deepEqual(board([big, small]).map((e) => [e.value, e.detail]), [[30, "Press"]], "order does not matter");
  const twin = lift(1, "Row", 110, [["2026-05-01", 100], ["2026-06-05", 110]]);
  assert.equal(board([small, twin])[0].detail, "Curl", "equal gains keep the first");
});

test("relativeStrengthBoard: best 1RM over body weight, the heavier ratio first, ties keep the first lift", () => {
  const board = relativeStrengthBoard(people, [
    lift(1, "Deadlift", 100, []), // 100 / 50 = 2.0
    lift(2, "Squat", 150, []), // 1.5
    lift(3, "Bench", 80, []), // no body weight: not ranked
  ]);
  assert.deepEqual(board.map((e) => [e.name, e.value]), [["Ann", 2], ["Bob", 1.5]]);
  const two = relativeStrengthBoard(people, [lift(1, "Bench", 60, []), lift(1, "Deadlift", 100, []), lift(1, "Curl", 100, [])]);
  assert.deepEqual(two.map((e) => [e.value, e.detail]), [[2, "Deadlift"]], "the best lift, the first of two equal ones");
  assert.equal(relativeStrengthBoard(people, [lift(1, "Bench", 0, [])]).length, 0, "0 kg is no ratio");
  assert.equal(relativeStrengthBoard(people, [lift(99, "Bench", 100, [])]).length, 0);
});

test("rankOf: 1-based place on a board, 0 when absent", () => {
  const board = [{ userId: 7, name: "a", value: 3 }, { userId: 8, name: "b", value: 2 }];
  assert.equal(rankOf(board, 7), 1);
  assert.equal(rankOf(board, 8), 2);
  assert.equal(rankOf(board, 9), 0);
  assert.equal(rankOf([], 7), 0);
});

test("badges: each count earns its badge exactly at the threshold", () => {
  assert.deepEqual(prMilestones(9), []);
  assert.deepEqual(prMilestones(10), ["prs_10"]);
  assert.deepEqual(prMilestones(24), ["prs_10"]);
  assert.deepEqual(prMilestones(25), ["prs_10", "prs_25"]);
  assert.deepEqual(workoutMilestones(0), []);
  assert.deepEqual(workoutMilestones(1), ["first_workout"]);
  assert.deepEqual(workoutMilestones(9), ["first_workout"]);
  assert.deepEqual(workoutMilestones(10), ["first_workout", "workouts_10"]);
  assert.deepEqual(workoutMilestones(49), ["first_workout", "workouts_10"]);
  assert.deepEqual(workoutMilestones(50), ["first_workout", "workouts_10", "workouts_50"]);
  assert.deepEqual(workoutMilestones(99), ["first_workout", "workouts_10", "workouts_50"]);
  assert.deepEqual(workoutMilestones(100), ["first_workout", "workouts_10", "workouts_50", "workouts_100"]);
  assert.deepEqual(streakMilestones(3), []);
  assert.deepEqual(streakMilestones(4), ["streak_4"]);
  assert.deepEqual(streakMilestones(11), ["streak_4"]);
  assert.deepEqual(streakMilestones(12), ["streak_4", "streak_12"]);
  assert.deepEqual(challengeMilestones(0), []);
  assert.deepEqual(challengeMilestones(1), ["first_challenge"]);
  assert.deepEqual(challengeMilestones(4), ["first_challenge"]);
  assert.deepEqual(challengeMilestones(5), ["first_challenge", "challenges_5"]);
});

test("badgeProgress: shows count out of the threshold, never past it, and nothing for badges without a counter", () => {
  assert.deepEqual(badgeProgress("workouts_10", { workouts: 7 }), { current: 7, needed: 10 });
  assert.deepEqual(badgeProgress("workouts_10", { workouts: 40 }), { current: 10, needed: 10 });
  assert.deepEqual(badgeProgress("workouts_50", { workouts: 20 }), { current: 20, needed: 50 });
  assert.deepEqual(badgeProgress("workouts_100", { workouts: 20 }), { current: 20, needed: 100 });
  assert.deepEqual(badgeProgress("streak_4", { streak: 2 }), { current: 2, needed: 4 });
  assert.deepEqual(badgeProgress("streak_12", { streak: 5 }), { current: 5, needed: 12 });
  assert.deepEqual(badgeProgress("streak_12", { streak: 30 }), { current: 12, needed: 12 });
  assert.deepEqual(badgeProgress("level_5", { level: 3 }), { current: 3, needed: 5 });
  assert.deepEqual(badgeProgress("level_10", { level: 3 }), { current: 3, needed: 10 });
  assert.equal(badgeProgress("workouts_10", {}), null, "the count was not supplied");
  assert.equal(badgeProgress("workouts_10", { workouts: 0 })?.current, 0, "0 is a count");
  assert.equal(badgeProgress("first_workout", { workouts: 5 }), null, "an event badge");
});

test("weekRangeOffset: Monday to Sunday of the week N weeks back, from any weekday", () => {
  assert.deepEqual(weekRangeOffset("2026-06-10", 0), { from: "2026-06-08", to: "2026-06-14" });
  assert.deepEqual(weekRangeOffset("2026-06-10", 1), { from: "2026-06-01", to: "2026-06-07" });
  assert.deepEqual(weekRangeOffset("2026-06-10", 2), { from: "2026-05-25", to: "2026-05-31" });
  assert.deepEqual(weekRangeOffset("2026-06-08", 1), { from: "2026-06-01", to: "2026-06-07" }, "from a Monday: exactly seven days, not eight");
  assert.deepEqual(weekRangeOffset("2026-06-14", 0), { from: "2026-06-08", to: "2026-06-14" }, "a Sunday belongs to the week that began the Monday before");
});

test("totalWorkoutsBoard and consistencyBoard: count workouts per person, ignore strangers, biggest first", () => {
  const dates = [
    { userId: 1, date: "2026-06-01" }, { userId: 1, date: "2026-06-03" }, { userId: 1, date: "2026-06-09" },
    { userId: 2, date: "2026-06-09" }, { userId: 99, date: "2026-06-09" },
  ];
  assert.deepEqual(totalWorkoutsBoard(people, dates).map((e) => [e.name, e.value]), [["Ann", 3], ["Bob", 1]]);
  assert.deepEqual(consistencyBoard(people, dates, "2026-06-09").map((e) => [e.name, e.value]), [["Ann", 1], ["Bob", 1]], "the week start itself counts");
  assert.deepEqual(consistencyBoard(people, dates, "2026-06-10"), [], "nothing from that day on");
  assert.deepEqual(totalWorkoutsBoard(people, []), []);
});
