import { test } from "node:test";
import assert from "node:assert/strict";
import { FEEL_RPE, parseFeel } from "../src/domain/sessionFeel";
import { nextTarget } from "../src/domain/progression";

test("session feel maps onto the effort the progression reads", () => {
  assert.equal(parseFeel("hard"), "hard");
  assert.equal(parseFeel("meh"), null);
  // easy -> a double step, ok -> a normal one, hard -> hold
  assert.equal(nextTarget(60, 8, "Bench Press", FEEL_RPE.easy), "60 × 10");
  assert.equal(nextTarget(60, 8, "Bench Press", FEEL_RPE.ok), "60 × 9");
  assert.equal(nextTarget(60, 8, "Bench Press", FEEL_RPE.hard), "60 × 8");
});
