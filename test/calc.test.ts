import { test } from "node:test";
import assert from "node:assert/strict";
import { platePlan, warmupRamp, DEFAULT_BAR } from "../src/domain/calc";

test("platePlan: exact load on a 100kg target with a 20kg bar", () => {
  const p = platePlan(100)!;
  assert.ok(p);
  assert.equal(p.loaded, 100);
  assert.equal(p.leftover, 0);
  // per side = 40kg = 25 + 15
  assert.deepEqual(p.perSide, [25, 15]);
});

test("platePlan: reports leftover when not exactly loadable", () => {
  const p = platePlan(101)!; // per side 40.5 → 25+15, 0.5 unmatched per side → 1kg total leftover
  assert.equal(p.loaded, 100);
  assert.equal(p.leftover, 1);
});

test("platePlan: bar-only target", () => {
  const p = platePlan(20)!;
  assert.deepEqual(p.perSide, []);
  assert.equal(p.loaded, 20);
});

test("platePlan: below-bar target returns null", () => {
  assert.equal(platePlan(15), null);
});

test("warmupRamp: ramps empty bar → ~40/60/80% toward working weight", () => {
  const ramp = warmupRamp(100);
  assert.ok(ramp.length >= 3);
  assert.equal(ramp[0].weight, DEFAULT_BAR); // first set = empty bar
  assert.equal(ramp[0].pct, 0);
  // strictly increasing loads
  for (let i = 1; i < ramp.length; i++) assert.ok(ramp[i].weight > ramp[i - 1].weight);
  // last warm-up stays below the working weight
  assert.ok(ramp[ramp.length - 1].weight < 100);
});

test("warmupRamp: light working weight collapses to a single empty-bar set", () => {
  const ramp = warmupRamp(20);
  assert.equal(ramp.length, 1);
  assert.equal(ramp[0].weight, DEFAULT_BAR);
});
