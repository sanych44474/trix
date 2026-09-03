import { test } from "node:test";
import assert from "node:assert/strict";
import { computeXp, levelFromXp, xpForLevel } from "../src/domain/gamification";

test("computeXp: weights per activity", () => {
  assert.equal(computeXp({ workouts: 0, nutrition: 0, checkins: 0, steps: 0, badges: 0 }), 0);
  assert.equal(computeXp({ workouts: 10, nutrition: 5, checkins: 4, steps: 2, badges: 1 }), 10 * 50 + 5 * 10 + 4 * 5 + 2 * 5 + 100);
});

test("xpForLevel: quadratic thresholds", () => {
  assert.equal(xpForLevel(1), 0);
  assert.equal(xpForLevel(2), 500);
  assert.equal(xpForLevel(3), 1500);
  assert.equal(xpForLevel(5), 5000);
});

test("levelFromXp: boundaries and progress within a level", () => {
  assert.deepEqual(levelFromXp(0), { level: 1, xp: 0, intoLevel: 0, needed: 500 });
  assert.deepEqual(levelFromXp(499), { level: 1, xp: 499, intoLevel: 499, needed: 500 });
  assert.deepEqual(levelFromXp(500), { level: 2, xp: 500, intoLevel: 0, needed: 1000 });
  const lv = levelFromXp(2000);
  assert.equal(lv.level, 3);
  assert.equal(lv.intoLevel, 500);
  assert.equal(lv.needed, 1500);
});
