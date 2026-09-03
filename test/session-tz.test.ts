import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionTimeFor } from "../src/domain/sessionTz";

test("same/missing zones return the stored time unchanged", () => {
  assert.deepEqual(sessionTimeFor("2026-07-10", 14, "Europe/Kyiv", "Europe/Kyiv"), { date: "2026-07-10", hour: 14 });
  assert.deepEqual(sessionTimeFor("2026-07-10", 14, null, "Europe/Kyiv"), { date: "2026-07-10", hour: 14 });
  assert.deepEqual(sessionTimeFor("2026-07-10", 14, "Europe/Kyiv", undefined), { date: "2026-07-10", hour: 14 });
});

test("Kyiv → London is 2 hours earlier in summer", () => {
  assert.deepEqual(sessionTimeFor("2026-07-10", 14, "Europe/Kyiv", "Europe/London"), { date: "2026-07-10", hour: 12 });
});

test("conversion can cross a date boundary", () => {
  // 01:00 in Kyiv (UTC+3 in July) = 22:00 the previous day in UTC.
  assert.deepEqual(sessionTimeFor("2026-07-10", 1, "Europe/Kyiv", "UTC"), { date: "2026-07-09", hour: 22 });
});

test("winter offsets apply (Kyiv is UTC+2 in January)", () => {
  assert.deepEqual(sessionTimeFor("2026-01-15", 10, "Europe/Kyiv", "UTC"), { date: "2026-01-15", hour: 8 });
});

test("bad zone id falls back to the stored time", () => {
  assert.deepEqual(sessionTimeFor("2026-07-10", 14, "Not/AZone", "UTC"), { date: "2026-07-10", hour: 14 });
});
