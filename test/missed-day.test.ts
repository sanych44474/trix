import { test } from "node:test";
import assert from "node:assert/strict";
import { rankMissedDayOptions, recentMissRate } from "../src/domain/missedDay";

test("rankMissedDayOptions: poor recovery leads with deload regardless of busyness", () => {
  assert.deepEqual(rankMissedDayOptions({ recentMissRate: 0, poorRecovery: true }), ["deload", "shorten", "makeup"]);
  assert.deepEqual(rankMissedDayOptions({ recentMissRate: 0.6, poorRecovery: true }), ["deload", "shorten", "makeup"]);
});

test("rankMissedDayOptions: a busy stretch (>=40% missed) leads with shorten", () => {
  assert.deepEqual(rankMissedDayOptions({ recentMissRate: 0.4, poorRecovery: false }), ["shorten", "makeup", "deload"]);
  assert.deepEqual(rankMissedDayOptions({ recentMissRate: 0.8, poorRecovery: false }), ["shorten", "makeup", "deload"]);
});

test("rankMissedDayOptions: an isolated miss with good recovery leads with makeup", () => {
  assert.deepEqual(rankMissedDayOptions({ recentMissRate: 0, poorRecovery: false }), ["makeup", "shorten", "deload"]);
  assert.deepEqual(rankMissedDayOptions({ recentMissRate: 0.39, poorRecovery: false }), ["makeup", "shorten", "deload"]);
});

test("rankMissedDayOptions: all three options are always present, just reordered", () => {
  for (const args of [{ recentMissRate: 0, poorRecovery: false }, { recentMissRate: 1, poorRecovery: true }]) {
    const ranked = rankMissedDayOptions(args);
    assert.deepEqual([...ranked].sort(), ["deload", "makeup", "shorten"]);
  }
});

test("recentMissRate: fraction of planned days missed", () => {
  assert.equal(recentMissRate(["2026-06-01", "2026-06-03", "2026-06-05"], new Set(["2026-06-01"])), 2 / 3);
  assert.equal(recentMissRate(["2026-06-01"], new Set(["2026-06-01"])), 0);
});

test("recentMissRate: no planned days yet reads as not-busy, not maximally busy", () => {
  assert.equal(recentMissRate([], new Set()), 0);
});
