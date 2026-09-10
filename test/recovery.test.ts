import { test } from "node:test";
import assert from "node:assert/strict";
import { recoveryScore } from "../src/domain/recovery";

const NEUTRAL = { checkin: null, conditioningZone: "optimal" as const, avgRpe: null, groupsAboveMav: 0 };

test("recoveryScore: no data at all is a clean 100, not penalized for missing signals", () => {
  const r = recoveryScore(NEUTRAL);
  assert.deepEqual(r, { score: 100, label: "great", factors: [] });
});

test("recoveryScore: each bad check-in axis is its own penalty", () => {
  const r = recoveryScore({ ...NEUTRAL, checkin: { energy: 1, sleep: 5, stress: 1 } });
  assert.equal(r.score, 85);
  assert.deepEqual(r.factors, ["low energy in your last check-in"]);
});

test("recoveryScore: a good check-in (no bad axis) costs nothing", () => {
  const r = recoveryScore({ ...NEUTRAL, checkin: { energy: 4, sleep: 4, stress: 2 } });
  assert.equal(r.score, 100);
});

test("recoveryScore: below/optimal conditioning never penalizes, only 'above' does", () => {
  assert.equal(recoveryScore({ ...NEUTRAL, conditioningZone: "below" }).score, 100);
  assert.equal(recoveryScore({ ...NEUTRAL, conditioningZone: "optimal" }).score, 100);
  assert.equal(recoveryScore({ ...NEUTRAL, conditioningZone: "above" }).score, 80);
});

test("recoveryScore: volume above MAV scales with how many groups, capped at 30", () => {
  assert.equal(recoveryScore({ ...NEUTRAL, groupsAboveMav: 1 }).score, 90);
  assert.equal(recoveryScore({ ...NEUTRAL, groupsAboveMav: 2 }).score, 80);
  assert.equal(recoveryScore({ ...NEUTRAL, groupsAboveMav: 6 }).score, 70); // capped, not -60
});

test("recoveryScore: factors are ordered heaviest penalty first", () => {
  const r = recoveryScore({
    checkin: { energy: 1, sleep: 5, stress: 5 }, // energy(15) + stress(15)
    conditioningZone: "above", // 20
    avgRpe: 9.2, // 15
    groupsAboveMav: 3, // 30
  });
  assert.deepEqual(r.factors, [
    "3 muscle group(s) trained past the weekly volume landmark",
    "cardio load well past the weekly landmark",
    "low energy in your last check-in",
    "high stress in your last check-in",
    "recent sessions have been grinding (RPE 9+)",
  ]);
  assert.equal(r.score, 5); // 100 - 30 - 20 - 15 - 15 - 15
});

test("recoveryScore: clamps at 0, never negative", () => {
  const r = recoveryScore({
    checkin: { energy: 1, sleep: 1, stress: 5 },
    conditioningZone: "above",
    avgRpe: 9.5,
    groupsAboveMav: 6,
  });
  assert.equal(r.score, 0);
  assert.equal(r.label, "poor");
});

test("recoveryScore: label thresholds", () => {
  assert.equal(recoveryScore({ ...NEUTRAL, groupsAboveMav: 1 }).label, "great"); // 90
  assert.equal(recoveryScore({ ...NEUTRAL, conditioningZone: "above", groupsAboveMav: 1 }).label, "good"); // 70
  assert.equal(recoveryScore({ ...NEUTRAL, conditioningZone: "above", groupsAboveMav: 3 }).label, "fair"); // 100-20-30=50
  assert.equal(recoveryScore({ ...NEUTRAL, conditioningZone: "above", groupsAboveMav: 3, avgRpe: 9.5 }).label, "poor"); // 50-15=35
});
