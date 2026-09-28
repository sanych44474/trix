import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSteps } from "../src/webapp/techniqueSteps";

test("parseSteps: one step per line, list markers and blank lines dropped, at most six", () => {
  assert.deepEqual(parseSteps("1. Стань рівно.\n\n- Візьми гантелі.\n2) Підніми до рівня плечей.\n•  Опусти повільно."), [
    "Стань рівно.", "Візьми гантелі.", "Підніми до рівня плечей.", "Опусти повільно.",
  ]);
  assert.equal(parseSteps(Array.from({ length: 9 }, (_, i) => `Step number ${i}`).join("\n")).length, 6);
  assert.deepEqual(parseSteps("ok\n\n"), [], "fragments under 4 characters are noise");
});
