import { test } from "node:test";
import assert from "node:assert/strict";
import { targetsForDay } from "../apps/mini-app/src/logic/dayTargets";

const train = { calories: 2500, protein: 160, fats: 70, carbs: 300 };
const rest = { calories: 2100, protein: 160, fats: 70, carbs: 200 };

test("targetsForDay: rest target on a non-training day when the plan has one", () => {
  assert.deepEqual(targetsForDay(true, train, rest), { targets: train, rest: false });
  assert.deepEqual(targetsForDay(false, train, rest), { targets: rest, rest: true });
  assert.deepEqual(targetsForDay(false, train, undefined), { targets: train, rest: false });
});
