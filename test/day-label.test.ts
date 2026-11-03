import { test } from "node:test";
import assert from "node:assert/strict";
import { addGroupToLabel, DAY_LABEL_MAX, normalizeDayLabel } from "../src/domain/dayLabel";

test("day label: trimmed, inner whitespace and line breaks collapse to single spaces", () => {
  assert.equal(normalizeDayLabel("  Ноги / Спина  "), "Ноги / Спина");
  assert.equal(normalizeDayLabel("Upper\n\tA"), "Upper A");
  assert.equal(normalizeDayLabel("Push\u2028day"), "Push day");
});

test("day label: empty, blank or non-string input is refused", () => {
  assert.equal(normalizeDayLabel(""), null);
  assert.equal(normalizeDayLabel("   \n "), null);
  assert.equal(normalizeDayLabel(undefined), null);
  assert.equal(normalizeDayLabel(42), null);
});

test("day label: cut to DAY_LABEL_MAX code points without splitting an emoji", () => {
  const long = "Груди".repeat(20);
  assert.equal(Array.from(normalizeDayLabel(long)!).length, DAY_LABEL_MAX);
  const emoji = `${"a".repeat(DAY_LABEL_MAX - 1)}💪💪`;
  assert.equal(normalizeDayLabel(emoji), `${"a".repeat(DAY_LABEL_MAX - 1)}💪`);
});

test("day label: HTML-looking text is kept as typed (renderers escape it)", () => {
  assert.equal(normalizeDayLabel("Chest & <Triceps>"), "Chest & <Triceps>");
});

test("day label chips: a group joins the draft with '/', once", () => {
  assert.equal(addGroupToLabel("", "Груди"), "Груди");
  assert.equal(addGroupToLabel("Груди", "Руки"), "Груди/Руки");
  assert.equal(addGroupToLabel(" Груди / Руки ", "Груди"), " Груди / Руки ", "already there: the draft is left as typed");
  assert.equal(addGroupToLabel("Upper A", "Core"), "Upper A/Core");
});
