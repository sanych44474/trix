import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAiPlanResponse, parsePlanDoc, parsePlanSplit, PlanValidationError, PLAN_SCHEMA_VERSION } from "../src/domain/plan-schema";
import type { PlanDoc } from "../src/types";

function validPlan(): PlanDoc {
  return {
    userId: 1,
    active: true,
    status: "active",
    split: [
      {
        weekday: 1,
        muscleGroup: "chest",
        exercises: [
          { name: "Bench Press", sets: "3 x 8", startWeight: "60 kg", technique: "Lower to chest, press up." },
        ],
      },
    ],
    nutrition: { calories: 2200, protein: 160, fats: 70, carbs: 220 },
    supplements: [],
    methodology: "linear progression",
    generatedAt: new Date(),
    schemaVersion: PLAN_SCHEMA_VERSION,
  };
}

test("parsePlanDoc: accepts a well-formed plan", () => {
  const parsed = parsePlanDoc(validPlan());
  assert.equal(parsed.userId, 1);
  assert.equal(parsed.split[0].exercises[0].name, "Bench Press");
});

test("parsePlanDoc: rejects a plan with a corrupted split (not an array)", () => {
  const bad = { ...validPlan(), split: "not-an-array" };
  assert.throws(() => parsePlanDoc(bad), PlanValidationError);
});

test("parsePlanDoc: rejects an exercise missing the required technique field", () => {
  const bad = validPlan();
  // @ts-expect-error deliberately malformed for the test
  delete bad.split[0].exercises[0].technique;
  assert.throws(() => parsePlanDoc(bad), PlanValidationError);
});

test("parsePlanDoc: rejects a weekday outside 1-7", () => {
  const bad = validPlan();
  bad.split[0].weekday = 0 as never;
  assert.throws(() => parsePlanDoc(bad), PlanValidationError);
});

test("parsePlanDoc: defaults schemaVersion when the row predates versioning", () => {
  const raw = validPlan() as unknown as Record<string, unknown>;
  delete raw.schemaVersion;
  const parsed = parsePlanDoc(raw);
  assert.equal(parsed.schemaVersion, PLAN_SCHEMA_VERSION);
});

test("parseAiPlanResponse: accepts the raw AI shape (no userId/active/status/generatedAt)", () => {
  const raw = {
    split: [{ weekday: 1, muscleGroup: "chest", exercises: [{ name: "Bench Press", sets: "3x8", startWeight: "60kg", technique: "Press." }] }],
    nutrition: { calories: 2000, protein: 150, fats: 60, carbs: 200 },
    supplements: [],
    methodology: "linear",
  };
  const parsed = parseAiPlanResponse(raw);
  assert.equal(parsed.split.length, 1);
});

test("parseAiPlanResponse: rejects a response missing nutrition", () => {
  const raw = { split: [], supplements: [], methodology: "x" };
  assert.throws(() => parseAiPlanResponse(raw), PlanValidationError);
});

test("parsePlanSplit: accepts a bare split array", () => {
  const split = validPlan().split;
  const parsed = parsePlanSplit(split);
  assert.equal(parsed.length, 1);
});

test("parsePlanSplit: rejects a split with a duplicate-shaped but malformed day", () => {
  assert.throws(() => parsePlanSplit([{ weekday: 1 }]), PlanValidationError);
});
