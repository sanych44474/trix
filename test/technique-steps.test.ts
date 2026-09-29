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

test("parseStepsAnswer: a NAME line becomes the name, the rest the steps", async () => {
  const { parseStepsAnswer } = await import("../src/webapp/techniqueSteps");
  assert.deepEqual(parseStepsAnswer("NAME: Розведення гантелей у сторони\nСтань рівно.\nПідніми гантелі до рівня плечей."), {
    name: "Розведення гантелей у сторони",
    steps: ["Стань рівно.", "Підніми гантелі до рівня плечей."],
  });
  assert.deepEqual(parseStepsAnswer("Stand tall.\nRaise the dumbbells."), { steps: ["Stand tall.", "Raise the dumbbells."] });
});
