import { test } from "node:test";
import assert from "node:assert/strict";
import { advanceMesocycle, defaultMesocycle, phaseGuidance } from "../src/domain/mesocycle";

test("mesocycle: advances within a block then rolls to the next phase", () => {
  let m = defaultMesocycle(4);
  assert.deepEqual(m, { phase: "hypertrophy", weekInBlock: 1, blockLength: 4 });
  m = advanceMesocycle(m); assert.equal(m.weekInBlock, 2);
  m = advanceMesocycle(m); m = advanceMesocycle(m); // week 4
  assert.equal(m.weekInBlock, 4);
  m = advanceMesocycle(m); // roll to strength
  assert.deepEqual(m, { phase: "strength", weekInBlock: 1, blockLength: 4 });
});

test("mesocycle: full cycle order hypertrophy→strength→peak→deload→hypertrophy", () => {
  let m = { phase: "peak" as const, weekInBlock: 4, blockLength: 4 };
  m = advanceMesocycle(m);
  assert.equal(m.phase, "deload");
  assert.equal(m.weekInBlock, 1);
  // deload is always one week regardless of blockLength
  m = advanceMesocycle(m);
  assert.equal(m.phase, "hypertrophy");
});

test("mesocycle: phase guidance provides reps/intensity/emoji", () => {
  assert.equal(phaseGuidance("strength").reps, "3–6");
  assert.ok(phaseGuidance("deload").intensity.length > 0);
});
