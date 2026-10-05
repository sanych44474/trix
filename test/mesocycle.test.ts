import { test } from "node:test";
import assert from "node:assert/strict";
import { advanceMesocycle, defaultMesocycle, deloadProgressionHold, phaseGuidance, trainingWeek } from "../src/domain/mesocycle";

test("mesocycle: a deload after every block, alternating hypertrophy and strength", () => {
  let m: ReturnType<typeof defaultMesocycle> = defaultMesocycle(4);
  assert.deepEqual(m, { phase: "hypertrophy", weekInBlock: 1, blockLength: 4 });
  const seen: string[] = [];
  for (let i = 0; i < 10; i++) { seen.push(`${m.phase}${m.weekInBlock}`); m = advanceMesocycle(m); }
  assert.deepEqual(seen, ["hypertrophy1", "hypertrophy2", "hypertrophy3", "hypertrophy4", "deload1", "strength1", "strength2", "strength3", "strength4", "deload1"]);
  assert.equal(m.phase, "hypertrophy");
  assert.equal(m.after, undefined);
});

test("mesocycle: a plan left in the old 4-week peak gets at most one week of it", () => {
  const m = advanceMesocycle({ phase: "peak", weekInBlock: 1, blockLength: 4 });
  assert.equal(m.phase, "deload");
  // a legacy deload without "after" goes back to hypertrophy
  assert.equal(advanceMesocycle({ phase: "deload", weekInBlock: 1, blockLength: 4 }).phase, "hypertrophy");
});

test("trainingWeek: the plan's mesocycle decides; without one, every deloadInterval weeks", () => {
  const meso = { phase: "deload" as const, weekInBlock: 1, blockLength: 4, after: "hypertrophy" as const };
  assert.equal(trainingWeek({ mesocycle: meso, generatedAt: "2026-01-01" }, "2026-01-29").deload, true);
  assert.equal(trainingWeek({ mesocycle: { phase: "strength", weekInBlock: 2, blockLength: 4 }, generatedAt: "2026-01-01" }, "2026-01-29").deload, false);
  assert.equal(trainingWeek({ generatedAt: "2026-01-01" }, "2026-01-29").deload, true); // week 4
  assert.equal(trainingWeek({ generatedAt: "2026-01-01" }, "2026-01-22").deload, false);
});

test("deloadProgressionHold: the deload week and the week after it", () => {
  const plan = { generatedAt: "2026-01-01" };
  assert.equal(deloadProgressionHold(plan, "2026-01-29"), true); // deload week
  assert.equal(deloadProgressionHold(plan, "2026-02-05"), true); // its light logs are last week's
  assert.equal(deloadProgressionHold(plan, "2026-02-12"), false);
  assert.equal(deloadProgressionHold({ ...plan, mesocycle: { phase: "strength", weekInBlock: 1, blockLength: 4 } }, "2026-02-12"), true);
  assert.equal(deloadProgressionHold({ ...plan, mesocycle: { phase: "strength", weekInBlock: 2, blockLength: 4 } }, "2026-02-12"), false);
});

test("mesocycle: phase guidance provides reps/intensity/emoji", () => {
  assert.equal(phaseGuidance("strength").reps, "3–6");
  assert.ok(phaseGuidance("deload").intensity.length > 0);
});
