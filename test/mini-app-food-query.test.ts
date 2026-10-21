// Search offers the AI dish breakdown for multi-ingredient queries (tester feedback 2026-10-21).
import { test } from "node:test";
import assert from "node:assert/strict";
import { looksLikeDish } from "../apps/mini-app/src/logic/foodQuery";

test("a list of ingredients is a dish; one product is not", () => {
  assert.equal(looksLikeDish("Лаваш цільнозерновий з хамоном, сиром камамбер, грушею та крем сиром"), true);
  assert.equal(looksLikeDish("oats with milk"), true);
  assert.equal(looksLikeDish("гречка + курка"), true);
  assert.equal(looksLikeDish("груша"), false);
  assert.equal(looksLikeDish("лаваш цільнозерновий"), false);
  assert.equal(looksLikeDish("сир кисломолочний 5%"), false);
});
