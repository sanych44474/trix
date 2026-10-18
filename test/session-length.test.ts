import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateSessionMinutes } from "../src/domain/sessionLength";

test("estimateSessionMinutes: empty day is 0", () => {
  assert.equal(estimateSessionMinutes([]), 0);
});

test("estimateSessionMinutes: uses the plan's sets and rest", () => {
  // 5 min warm-up + 4×40 s + 3×120 s = 300 + 160 + 360 = 820 s -> 15 min
  assert.equal(estimateSessionMinutes([{ sets: "4 × 6-10", rest: "2 min" }]), 15);
  // shorter rest -> shorter session
  const long = estimateSessionMinutes(Array.from({ length: 6 }, () => ({ sets: "4 × 8", rest: "3 min" })));
  const short = estimateSessionMinutes(Array.from({ length: 6 }, () => ({ sets: "4 × 8", rest: "60s" })));
  assert.ok(long > short, `${long} > ${short}`);
  assert.equal(long % 5, 0);
});

test("estimateSessionMinutes: missing rest falls back to 90 s", () => {
  // 300 + 3×40 + 2×90 = 600 s -> 10 min
  assert.equal(estimateSessionMinutes([{ sets: "3 × 10" }]), 10);
});
