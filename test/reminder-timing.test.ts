import { test } from "node:test";
import assert from "node:assert/strict";
import { daysBetween, suggestReminderHour } from "../src/domain/reminderTiming";

test("consistent evening logger with a morning reminder → suggests pre-workout hour", () => {
  assert.equal(suggestReminderHour([19, 20, 19, 19, 20, 19], 8), 18);
});

test("too few samples → null", () => {
  assert.equal(suggestReminderHour([19, 20, 19], 8), null);
});

test("noisy pattern → null", () => {
  assert.equal(suggestReminderHour([7, 12, 19, 22, 9, 15], 8), null);
});

test("already close to current setting → null", () => {
  assert.equal(suggestReminderHour([19, 19, 20, 19, 19], 18), null);
});

test("clamped into 6..22", () => {
  assert.equal(suggestReminderHour([5, 5, 6, 5, 5], 12), 6);
  assert.equal(suggestReminderHour([23, 23, 23, 23, 23], 12), 22);
});

test("daysBetween: unset → Infinity (always due)", () => {
  assert.equal(daysBetween(undefined, "2026-09-04"), Infinity);
});

test("daysBetween: counts whole days between two ISO dates", () => {
  assert.equal(daysBetween("2026-08-21", "2026-09-04"), 14);
  assert.equal(daysBetween("2026-09-04", "2026-09-04"), 0);
});
