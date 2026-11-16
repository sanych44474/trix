import { test } from "node:test";
import assert from "node:assert/strict";
import { hasActivePlan, isNoPlanError, noPlanAction } from "../apps/mini-app/src/logic/noPlan";
import { ApiError } from "../apps/mini-app/src/api";

test("no plan, onboarded athlete (left their trainer, or a build failed): build the plan", () => {
  assert.equal(noPlanAction({ role: "solo", onboarded: true }), "build");
  assert.equal(noPlanAction({ role: "trainer", onboarded: true }), "build");
});

test("no plan, trainer who never did the questionnaire: open the questionnaire", () => {
  assert.equal(noPlanAction({ role: "trainer", onboarded: false }), "questionnaire");
  assert.equal(noPlanAction({ role: "solo", onboarded: false }), "questionnaire");
});

test("no plan, client who still has a trainer: the trainer is preparing it, no button", () => {
  assert.equal(noPlanAction({ role: "client", onboarded: true }), "trainer");
});

test("no plan while the first plan is being built: say so, no button", () => {
  assert.equal(noPlanAction({ role: "trainer", onboarded: false, planPending: true }), "building");
});

test("the dashboard has a plan only when the plan has days", () => {
  assert.equal(hasActivePlan({ split: [] }), false);
  assert.equal(hasActivePlan({ split: [{ weekday: 1, group: "legs", n: 4 }] }), true);
});

test("GET /plan's 404 no_plan is the no-plan state; every other failure stays an error", () => {
  assert.equal(isNoPlanError(new ApiError("not_found", "no_plan", 404)), true);
  assert.equal(isNoPlanError(new ApiError("not_found", "not found", 404)), false, "a missing client is not 'no plan'");
  assert.equal(isNoPlanError(new ApiError("dependency_unavailable", "no_plan", 503)), false);
  assert.equal(isNoPlanError(new Error("no_plan")), false);
  assert.equal(isNoPlanError(null), false);
});
