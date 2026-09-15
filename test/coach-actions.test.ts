import assert from "node:assert/strict";
import test from "node:test";
import { validateCoachActionForApply, validateCoachEditResult } from "../src/domain/coachActions";

test("coach edit contract accepts a valid weight action", () => {
  assert.doesNotThrow(() => validateCoachEditResult({
    reply: "Increase the load slightly next time.",
    actions: [{ label: "Add 2.5 kg", kind: "weight", weekday: 1, index: 0, value: "52.5 kg" }],
  }));
});

test("coach edit contract rejects actions missing their target", () => {
  assert.throws(
    () => validateCoachEditResult({ reply: "I can adjust it.", actions: [{ label: "Adjust", kind: "weight", weekday: 1, index: 0 }] }),
    /value is required/,
  );
});

test("coach action click cannot change the action kind", () => {
  assert.throws(
    () => validateCoachActionForApply({ label: "Delete", kind: "delete", weekday: 1, index: 0 }, "weight"),
    /does not match callback/,
  );
});

test("coach action click accepts only bounded plan coordinates", () => {
  assert.throws(
    () => validateCoachActionForApply({ label: "Delete", kind: "delete", weekday: 8, index: 0 }, "delete"),
    /weekday/,
  );
});
