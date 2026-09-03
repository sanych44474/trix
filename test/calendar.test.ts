import { test } from "node:test";
import assert from "node:assert/strict";
import { monthGrid, nextMonth, prevMonth, monthTitle, dayMarker, ymOf } from "../src/domain/calendar";

test("monthGrid: Monday-first, null padding, full weeks", () => {
  const g = monthGrid("2024-02"); // leap year → 29 days; Feb 1 2024 = Thursday
  assert.ok(g.every((w) => w.length === 7));
  // Feb 1 is Thursday → first row has 3 nulls (Mon,Tue,Wed) then 2024-02-01
  assert.deepEqual(g[0].slice(0, 4), [null, null, null, "2024-02-01"]);
  const flat = g.flat().filter(Boolean);
  assert.equal(flat.length, 29);
  assert.equal(flat[flat.length - 1], "2024-02-29");
});

test("monthGrid: non-leap February has 28 days", () => {
  assert.equal(monthGrid("2026-02").flat().filter(Boolean).length, 28);
});

test("prev/next month wrap the year", () => {
  assert.equal(nextMonth("2026-12"), "2027-01");
  assert.equal(prevMonth("2026-01"), "2025-12");
  assert.equal(nextMonth("2026-07"), "2026-08");
  assert.equal(ymOf("2026-07-15"), "2026-07");
});

test("monthTitle: localized", () => {
  assert.equal(monthTitle("2026-07", "en"), "July 2026");
  assert.equal(monthTitle("2026-07", "uk"), "Липень 2026");
});

test("dayMarker: priority session > completed > missed > planned > plain", () => {
  const base = { today: "2026-07-15", plannedWeekdays: new Set([3]), logs: new Map(), sessionDates: new Set<string>() };
  // 2026-07-15 is a Wednesday (planned) and today → wrapped, planned marker
  assert.equal(dayMarker("2026-07-15", base), "[•15]");
  // session wins
  assert.equal(dayMarker("2026-07-08", { ...base, sessionDates: new Set(["2026-07-08"]) }), "🤝8");
  // completed
  assert.equal(dayMarker("2026-07-08", { ...base, logs: new Map([["2026-07-08", { completed: true }]]) }), "✅8");
  // missed planned past (Wed 2026-07-08 < today, planned, not logged)
  assert.equal(dayMarker("2026-07-08", base), "✖️8");
  // planned future (Wed 2026-07-22 > today)
  assert.equal(dayMarker("2026-07-22", base), "•22");
  // plain unplanned day
  assert.equal(dayMarker("2026-07-16", base), "16");
});
