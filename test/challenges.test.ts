import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHALLENGES,
  challengeByCode,
  challengeCurrent,
  challengeStatus,
  progressBar,
  type ChallengeData,
} from "../src/domain/challenges";

const data: ChallengeData = { workouts: 3, nutritionDays: 5, stepsSum: 42000, waterDays: 2 };

test("challengeByCode: resolves known codes, undefined otherwise", () => {
  assert.equal(challengeByCode("w4")?.metric, "workouts");
  assert.equal(challengeByCode("nope"), undefined);
});

test("challengeCurrent: picks the metric the template tracks", () => {
  assert.equal(challengeCurrent(challengeByCode("w4")!, data), 3);
  assert.equal(challengeCurrent(challengeByCode("nut7")!, data), 5);
  assert.equal(challengeCurrent(challengeByCode("steps70")!, data), 42000);
  assert.equal(challengeCurrent(challengeByCode("water5")!, data), 2);
  assert.equal(challengeCurrent(challengeByCode("consist12")!, data), 3); // also workouts
});

test("challengeStatus: caps percent at 100 and flags done", () => {
  const tpl = challengeByCode("w4")!; // target 4
  assert.deepEqual(challengeStatus(tpl, 2), { current: 2, target: 4, pct: 50, done: false });
  assert.deepEqual(challengeStatus(tpl, 4), { current: 4, target: 4, pct: 100, done: true });
  assert.deepEqual(challengeStatus(tpl, 9), { current: 9, target: 4, pct: 100, done: true });
});

test("progressBar: 10 cells, fills proportionally", () => {
  assert.equal(progressBar(0), "▱▱▱▱▱▱▱▱▱▱");
  assert.equal(progressBar(100), "▰▰▰▰▰▰▰▰▰▰");
  assert.equal(progressBar(50).length, 10);
  assert.equal([...progressBar(50)].filter((c) => c === "▰").length, 5);
});

test("CHALLENGES: codes are unique and have i18n-able fields", () => {
  const codes = CHALLENGES.map((c) => c.code);
  assert.equal(new Set(codes).size, codes.length);
  for (const c of CHALLENGES) {
    assert.ok(c.target > 0 && c.windowDays > 0 && c.emoji.length > 0);
  }
});
