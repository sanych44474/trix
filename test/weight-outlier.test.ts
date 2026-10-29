import { test } from "node:test";
import assert from "node:assert/strict";
import { isImplausibleJump } from "../src/domain/weightOutlier";

test("isImplausibleJump: 80, 80 then 800 is a typo", () => {
  assert.equal(isImplausibleJump(800, [80, 80]), true);
});

test("isImplausibleJump: real PR of a few kg passes (80 -> 100)", () => {
  assert.equal(isImplausibleJump(100, [80, 80]), false);
});

test("isImplausibleJump: light dumbbells 10 -> 25 pass (25 is not above max + 20)", () => {
  assert.equal(isImplausibleJump(25, [10, 10]), false);
});

test("isImplausibleJump: 10 -> 31 is flagged (both legs exceeded)", () => {
  assert.equal(isImplausibleJump(31, [10, 10]), true);
});

test("isImplausibleJump: 80 -> 130 is flagged, 80 -> 120 is not (boundary)", () => {
  assert.equal(isImplausibleJump(130, [80, 80]), true);
  assert.equal(isImplausibleJump(120, [80, 80]), false);
});

test("isImplausibleJump: needs at least two prior sessions", () => {
  assert.equal(isImplausibleJump(800, []), false);
  assert.equal(isImplausibleJump(800, [80]), false);
});

test("isImplausibleJump: zero-weight history does not count as a session", () => {
  assert.equal(isImplausibleJump(800, [0, 0, 80]), false);
  assert.equal(isImplausibleJump(800, [0, 80, 80]), true);
});

test("isImplausibleJump: bodyweight (0 kg) history and entries are never flagged", () => {
  assert.equal(isImplausibleJump(50, [0, 0]), false);
  assert.equal(isImplausibleJump(0, [80, 80]), false);
});

test("isImplausibleJump: judged against the heaviest prior weight, not the last", () => {
  assert.equal(isImplausibleJump(130, [80, 100]), false);
  assert.equal(isImplausibleJump(130, [80, 60]), true);
});
