import { test } from "node:test";
import assert from "node:assert/strict";
import { weightChartModel } from "../apps/mini-app/src/logic/weightChart";

const pts = [
  { date: "2026-09-05", kg: 74.0 },
  { date: "2026-09-12", kg: 73.4 },
  { date: "2026-09-19", kg: 73.8 },
  { date: "2026-10-05", kg: 73.2 },
];

test("weightChartModel: real kg scale, x by date, delta and span", () => {
  const m = weightChartModel(pts)!;
  assert.ok(m.min <= 73.2 && m.max >= 74);
  assert.ok(m.max - m.min >= 2);
  assert.equal(m.pts[0]!.x, 0);
  assert.equal(m.pts[3]!.x, 100);
  assert.ok(m.pts[0]!.y > m.pts[3]!.y); // heavier is higher
  assert.equal(m.deltaKg, -0.8);
  assert.equal(m.spanDays, 30);
});

test("weightChartModel: a nearby goal is drawn, a far one isn't; one point is no chart", () => {
  assert.ok(weightChartModel(pts, 70)!.goalY !== undefined);
  assert.equal(weightChartModel(pts, 55)!.goalY, undefined);
  assert.equal(weightChartModel([pts[0]!]), null);
});
