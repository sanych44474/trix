// Which day a workout may be saved for, and the stale-form check a trainer's save goes through
// (src/domain/editWindow.ts, ADR-0018).
import { test } from "node:test";
import assert from "node:assert/strict";
import { EDIT_WINDOW_DAYS, editDateError, isStaleBase } from "../src/domain/editWindow";

const TODAY = "2026-11-23";

test("today and up to 14 days back are editable; the day before that and any future day are not", () => {
  assert.equal(EDIT_WINDOW_DAYS, 14);
  assert.equal(editDateError(TODAY, TODAY), null);
  assert.equal(editDateError("2026-11-09", TODAY), null, "14 days back");
  assert.equal(editDateError("2026-11-08", TODAY), "too old", "15 days back");
  assert.equal(editDateError("2026-11-24", TODAY), "future date");
  assert.equal(editDateError("2026-11-20", TODAY, 2), "too old", "a narrower window");
});

test("only a real calendar date is accepted", () => {
  assert.equal(editDateError("2026-02-30", "2026-03-05"), "bad date", "V8 would read it as 2 March");
  assert.equal(editDateError("2026-13-01", TODAY), "bad date");
  assert.equal(editDateError("23.11.2026", TODAY), "bad date");
  assert.equal(editDateError("", TODAY), "bad date");
});

test("a form is stale when the day was saved after it was opened, or saved for the first time since", () => {
  assert.equal(isStaleBase(null, null), false, "nothing logged then or now");
  assert.equal(isStaleBase("2026-11-23T09:00:00.000Z", "2026-11-23T09:00:00.000Z"), false, "unchanged");
  assert.equal(isStaleBase(null, "2026-11-23T09:00:00.000Z"), true, "the client logged the day meanwhile");
  assert.equal(isStaleBase("2026-11-23T09:00:00.000Z", "2026-11-23T09:05:00.000Z"), true, "saved again meanwhile");
  assert.equal(isStaleBase("2026-11-23T09:00:00.000Z", null), true, "the day was cleared meanwhile");
});
