// src/domain/levelGoals.ts: when a person is offered the next level, and when a cut or a bulk counts as
// done. The rules are thresholds, so each one is tested on both sides of its edge: the value that just
// passes and the value that just fails. A test on a "typical" value cannot tell > from >=.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fatLossGoalReached, gainGoalReached, nextLevel, shouldLevelUp } from "../src/domain/levelGoals";

/** Weigh-ins on the given day offsets from 2026-01-01. Input order is kept (the rule sorts by date). */
const weighIns = (points: Array<[day: number, kg: number]>) =>
  points.map(([day, weight]) => ({ date: new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10), weight }));

test("nextLevel walks the ladder and stops at the top", () => {
  assert.equal(nextLevel("beginner"), "intermediate");
  assert.equal(nextLevel("intermediate"), "advanced");
  assert.equal(nextLevel("advanced"), null);
});

test("shouldLevelUp: needs a fast pace, 4 progression weeks, and a level above", () => {
  assert.equal(shouldLevelUp("beginner", "fast", 4), true);
  assert.equal(shouldLevelUp("intermediate", "fast", 4), true);
  assert.equal(shouldLevelUp("beginner", "fast", 3), false);
  assert.equal(shouldLevelUp("beginner", "normal", 6), false);
  assert.equal(shouldLevelUp("beginner", "slow", 6), false);
  assert.equal(shouldLevelUp("advanced", "fast", 6), false);
});

test("shouldLevelUp: the week threshold can be changed, and its edge is inclusive", () => {
  assert.equal(shouldLevelUp("beginner", "fast", 2, 2), true);
  assert.equal(shouldLevelUp("beginner", "fast", 1, 2), false);
  assert.equal(shouldLevelUp("beginner", "fast", 6, 6), true);
  assert.equal(shouldLevelUp("beginner", "fast", 5, 6), false);
});

// A cut that has just finished: 2 kg lost over exactly 28 days, the last three weigh-ins 14 days apart
// within 0.8 kg. Every condition sits on its edge, so changing one value breaks exactly one rule.
const CUT = (over: Partial<Record<"first" | "firstKg" | "recent0" | "recent0Kg" | "lastKg", number>> = {}) =>
  weighIns([
    [over.first ?? 0, over.firstKg ?? 90],
    [over.recent0 ?? 14, over.recent0Kg ?? 88.5],
    [21, 88.2],
    [28, over.lastKg ?? 88],
  ]);

test("fatLossGoalReached: a cut on the edge of every threshold counts", () => {
  assert.equal(fatLossGoalReached("fat loss", CUT()), true);
});

test("fatLossGoalReached: each threshold fails just past its edge", () => {
  assert.equal(fatLossGoalReached("fat loss", CUT({ first: 1 })), false, "27 days is too short a cut");
  assert.equal(fatLossGoalReached("fat loss", CUT({ lastKg: 88.1 })), false, "1.9 kg is too little");
  assert.equal(fatLossGoalReached("fat loss", CUT({ recent0: 15 })), false, "the plateau spans 13 days, not 14");
  assert.equal(fatLossGoalReached("fat loss", CUT({ recent0Kg: 89 })), false, "the last three vary by 1 kg: still losing");
  assert.equal(fatLossGoalReached("fat loss", CUT({ recent0Kg: 88.7 })), true, "0.7 kg of variation is a plateau");
});

test("fatLossGoalReached: needs four weigh-ins, ignores zeros, does not care about input order", () => {
  assert.equal(fatLossGoalReached("fat loss", weighIns([[0, 90], [14, 88.5], [28, 88]])), false, "three weigh-ins are not enough");
  assert.equal(fatLossGoalReached("fat loss", [{ date: "2025-12-20", weight: 0 }, ...CUT()]), true, "a 0 kg entry before the first weigh-in is ignored");
  assert.equal(fatLossGoalReached("fat loss", [...CUT()].reverse()), true, "sorted by date, not by order given");
});

test("fatLossGoalReached: a gain is not a cut, and a missing goal is not a cut goal", () => {
  const gaining = weighIns([[0, 80], [14, 81.5], [21, 81.8], [28, 82]]);
  assert.equal(fatLossGoalReached("fat loss", gaining), false);
  assert.equal(fatLossGoalReached("muscle gain", CUT()), false);
  assert.equal(fatLossGoalReached(undefined, CUT()), false);
  for (const goal of ["cut", "lean", "weight loss", "схуднення", "похудеть", "обезжирити"]) assert.equal(fatLossGoalReached(goal, CUT()), true, goal);
});

// A bulk on the edge: 3 kg over exactly 42 days, last three weigh-ins 14 days apart.
const BULK = (over: Partial<Record<"first" | "lastKg" | "recent0Kg", number>> = {}) =>
  weighIns([
    [over.first ?? 0, 70],
    [28, over.recent0Kg ?? 72.5],
    [35, 72.8],
    [42, over.lastKg ?? 73],
  ]);

test("gainGoalReached: a bulk on the edge of every threshold counts, just past it does not", () => {
  assert.equal(gainGoalReached("muscle gain", BULK()), true);
  assert.equal(gainGoalReached("muscle gain", BULK({ first: 1 })), false, "41 days is too short");
  assert.equal(gainGoalReached("muscle gain", BULK({ lastKg: 72.9 })), false, "2.9 kg is too little");
  assert.equal(gainGoalReached("muscle gain", BULK({ recent0Kg: 71.9 })), false, "still gaining fast: not a plateau");
});

test("gainGoalReached: a loss is not a bulk, and the goal words are recognised", () => {
  assert.equal(gainGoalReached("muscle gain", weighIns([[0, 80], [28, 78.5], [35, 78.2], [42, 78]])), false);
  assert.equal(gainGoalReached("fat loss", BULK()), false);
  assert.equal(gainGoalReached(undefined, BULK()), false);
  for (const goal of ["bulk", "mass", "набір маси", "набор массы", "гіпертрофія"]) assert.equal(gainGoalReached(goal, BULK()), true, goal);
});
