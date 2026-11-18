// src/domain/deload.ts, the threshold rules: when a deload is suggested, how old a plan is, when
// wellbeing counts as poor, when adherence is low. Each threshold is tested on the value that just
// passes and the one that just fails. (The readiness advice has its own file, readiness.test.ts.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { adherenceDeloadDue, deloadDue, deloadSets, poorWellbeing, weeksSincePlan } from "../src/domain/deload";
import type { DailyCheckinDoc, StrengthRecordDoc, WorkoutLogDoc } from "../src/types";

const TODAY = "2026-06-02";
const ago = (days: number) => new Date(Date.parse(TODAY) - days * 86_400_000).toISOString().slice(0, 10);
const lift = (...daysAgo: number[]) =>
  ({ userId: 1, exercise: "Bench Press", history: daysAgo.map((d) => ({ date: ago(d), weight: 60, reps: 8 })) }) as unknown as StrengthRecordDoc;

test("deloadDue: a 42-day span is the edge, 41 days is not enough", () => {
  assert.equal(deloadDue([lift(42, 20, 1)], TODAY), true);
  assert.equal(deloadDue([lift(41, 20, 1)], TODAY), false);
  assert.equal(deloadDue([lift(60, 30, 1)], TODAY), true);
});

test("deloadDue: the lift must have been touched within 14 days, 15 is stale", () => {
  assert.equal(deloadDue([lift(60, 30, 14)], TODAY), true);
  assert.equal(deloadDue([lift(60, 30, 15)], TODAY), false);
  assert.equal(deloadDue([lift(60, 30, 0)], TODAY), true, "trained today");
});

test("deloadDue: three data points is the least that counts as a training history", () => {
  assert.equal(deloadDue([lift(50, 1)], TODAY), false, "two points over 49 days");
  assert.equal(deloadDue([lift(50, 20, 1)], TODAY), true);
  assert.equal(deloadDue([lift(50)], TODAY), false);
});

test("deloadDue: any one active lift is enough, and a lift with no history is ignored", () => {
  const empty = { userId: 1, exercise: "Squat", history: [] } as unknown as StrengthRecordDoc;
  assert.equal(deloadDue([], TODAY), false);
  assert.equal(deloadDue([empty], TODAY), false);
  assert.equal(deloadDue([lift(50, 40, 30), lift(60, 30, 2), empty], TODAY), true, "the stale one does not hide the active one");
});

test("weeksSincePlan: whole weeks only, and a plan dated in the future is week 0", () => {
  assert.equal(weeksSincePlan(TODAY, TODAY), 0);
  assert.equal(weeksSincePlan(ago(6), TODAY), 0);
  assert.equal(weeksSincePlan(ago(7), TODAY), 1);
  assert.equal(weeksSincePlan(ago(13), TODAY), 1);
  assert.equal(weeksSincePlan(ago(14), TODAY), 2);
  assert.equal(weeksSincePlan(ago(-3), TODAY), 0);
});

const checkin = (energy: number, sleep: number, stress: number): DailyCheckinDoc => ({ userId: 1, date: TODAY, energy, sleep, stress, createdAt: new Date(0) });

test("poorWellbeing: energy or sleep averaging 2 is poor, 2.5 is not", () => {
  assert.equal(poorWellbeing([checkin(2, 4, 1)]), true);
  assert.equal(poorWellbeing([checkin(4, 2, 1)]), true);
  assert.equal(poorWellbeing([checkin(2, 3, 1), checkin(3, 3, 1)]), false, "avg 2.5");
  assert.equal(poorWellbeing([checkin(1, 3, 1), checkin(3, 3, 1)]), true, "avg 2.0");
  assert.equal(poorWellbeing([checkin(3, 3, 1)]), false);
});

test("poorWellbeing: stress averaging 4 is poor, 3.5 is not", () => {
  assert.equal(poorWellbeing([checkin(4, 4, 4)]), true);
  assert.equal(poorWellbeing([checkin(4, 4, 3), checkin(4, 4, 4)]), false, "avg 3.5");
  assert.equal(poorWellbeing([checkin(4, 4, 5), checkin(4, 4, 3)]), true, "avg 4.0");
});

test("poorWellbeing: a 0 means not rated and is left out of the average", () => {
  assert.equal(poorWellbeing([checkin(0, 4, 1), checkin(4, 4, 1)]), false, "energy 0 and 4 average 4, not 2");
  assert.equal(poorWellbeing([checkin(4, 0, 1), checkin(4, 4, 1)]), false, "sleep 0 and 4");
  assert.equal(poorWellbeing([checkin(0, 0, 0)]), false);
  assert.equal(poorWellbeing([]), false);
});

const sessions = (done: number, skipped: number) =>
  [...Array(done).fill(true), ...Array(skipped).fill(false)].map((completed) => ({ userId: 1, date: TODAY, weekday: 1, exercises: [], completed, createdAt: new Date(0) }) as WorkoutLogDoc);

test("adherenceDeloadDue: four sessions are the least judged, and half done is not poor", () => {
  assert.equal(adherenceDeloadDue(sessions(0, 3)), false, "three sessions are too few");
  assert.equal(adherenceDeloadDue(sessions(0, 4)), true, "four, none done");
  assert.equal(adherenceDeloadDue(sessions(2, 2)), false, "exactly half is the edge: not below it");
  assert.equal(adherenceDeloadDue(sessions(1, 3)), true);
  assert.equal(adherenceDeloadDue([]), false);
});

test("adherenceDeloadDue: both limits can be changed", () => {
  assert.equal(adherenceDeloadDue(sessions(0, 2), { minSessions: 2 }), true);
  assert.equal(adherenceDeloadDue(sessions(0, 1), { minSessions: 2 }), false);
  assert.equal(adherenceDeloadDue(sessions(3, 1), { threshold: 0.8 }), true, "75% is below 80%");
  assert.equal(adherenceDeloadDue(sessions(4, 1), { threshold: 0.8 }), false, "80% is the edge");
});

test("deloadSets: about 40% fewer sets, never below one, rep range and separator kept", () => {
  assert.equal(deloadSets("4 × 8-10"), "2 × 8-10");
  assert.equal(deloadSets("5 x 5"), "3 x 5");
  assert.equal(deloadSets("3 x 10"), "2 x 10");
  assert.equal(deloadSets("1 × 12"), "1 × 12");
  assert.equal(deloadSets("2 × 12"), "1 × 12");
  assert.equal(deloadSets("AMRAP"), "AMRAP");
  assert.equal(deloadSets("  4 × 8"), "2 × 8", "leading spaces are fine");
});
