import { test } from "node:test";
import assert from "node:assert/strict";
import { daysBetween, defaultQuietHours, isQuietHour, nudgesSentToday, suggestReminderHour } from "../src/domain/reminderTiming";

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

test("default quiet hours: 22:00–07:00 for an ordinary reminder hour", () => {
  assert.deepEqual(defaultQuietHours(18), { from: 22, to: 7 });
  assert.equal(isQuietHour(23, 18), true);
  assert.equal(isQuietHour(3, 18), true);
  assert.equal(isQuietHour(7, 18), false);
  assert.equal(isQuietHour(21, 18), false);
});

test("default quiet hours never swallow the person's own reminder hour", () => {
  // Late reminder: the night starts an hour after it.
  assert.equal(isQuietHour(22, 22), false);
  assert.equal(isQuietHour(23, 22), true);
  assert.equal(isQuietHour(23, 23), false);
  // Early reminder: the night ends an hour before it (room for the readiness check).
  assert.deepEqual(defaultQuietHours(6), { from: 22, to: 5 });
  assert.equal(isQuietHour(5, 6), false);
  assert.equal(isQuietHour(6, 6), false);
  assert.equal(isQuietHour(0, 0), false);
});

test("own quiet hours win over the default, including windows across midnight", () => {
  assert.equal(isQuietHour(21, 18, 21, 8), true);
  assert.equal(isQuietHour(7, 18, 21, 8), true);
  assert.equal(isQuietHour(8, 18, 21, 8), false);
  assert.equal(isQuietHour(14, 18, 13, 15), true);
  assert.equal(isQuietHour(15, 18, 13, 15), false);
  // from === to means "not set": the default applies.
  assert.equal(isQuietHour(23, 18, 10, 10), true);
  assert.equal(isQuietHour(12, 18, 10, 10), false);
});

test("daily nudge counter resets on a new day and tolerates junk", () => {
  assert.equal(nudgesSentToday(undefined, "2026-10-06"), 0);
  assert.equal(nudgesSentToday("2026-10-06:2", "2026-10-06"), 2);
  assert.equal(nudgesSentToday("2026-10-05:3", "2026-10-06"), 0);
  assert.equal(nudgesSentToday("2026-10-06:x", "2026-10-06"), 0);
});
