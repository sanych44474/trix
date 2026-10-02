import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTIVATE_H, REMIND_H, staleDraftStep } from "../src/staleDrafts";

test("staleDraftStep: wait, remind once, then activate; no trainer activates at once", () => {
  assert.equal(staleDraftStep(REMIND_H - 1, true, false), null);
  assert.equal(staleDraftStep(REMIND_H, true, false), "remind");
  assert.equal(staleDraftStep(REMIND_H + 5, true, true), null);
  assert.equal(staleDraftStep(ACTIVATE_H, true, true), "activate");
  assert.equal(staleDraftStep(ACTIVATE_H, true, false), "activate");
  assert.equal(staleDraftStep(0, false, false), "activate");
});
