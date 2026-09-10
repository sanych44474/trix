import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONDITIONING_LANDMARK,
  conditioningOverload,
  conditioningWeek,
  isConditioning,
  readinessWithConditioning,
  recentConditioningStrain,
} from "../src/domain/conditioning";
import type { SetEntry, WorkoutLogDoc } from "../src/types";

const clog = (
  date: string,
  exercises: { name: string; sets: SetEntry[]; skipped?: boolean }[],
  completed = true,
): WorkoutLogDoc => ({
  userId: 1,
  date,
  weekday: 1,
  completed,
  createdAt: new Date(0),
  exercises: exercises.map((e) => ({ name: e.name, skipped: e.skipped ?? false, setsDone: e.sets })),
});

const mins = (n: number): SetEntry => ({ reps: 0, weight: 0, seconds: n * 60 });

test("isConditioning: distance cardio counts, timed core holds do not", () => {
  assert.equal(isConditioning("Rowing machine"), true);
  assert.equal(isConditioning("Біг"), true);
  assert.equal(isConditioning("Plank"), false); // "time" metric — core work, not conditioning
  assert.equal(isConditioning("Bench Press"), false);
  assert.equal(isConditioning("Barbell Row"), false); // bare "row" is a back lift, not the erg
});

test("conditioningWeek: sums duration and distance inside the window only", () => {
  const logs = [
    clog("2026-06-20", [{ name: "Running", sets: [mins(30)] }]),
    clog("2026-06-22", [{ name: "Rowing machine", sets: [{ reps: 0, weight: 0, seconds: 1200, meters: 5000 }] }]),
    clog("2026-06-10", [{ name: "Running", sets: [mins(90)] }]), // before window → ignored
  ];
  const w = conditioningWeek(logs, "2026-06-17");
  assert.equal(w.sessions, 2);
  assert.equal(w.minutes, 50);
  assert.equal(w.meters, 5000);
  assert.equal(w.zone, "below"); // under the 150 min baseline
});

test("conditioningWeek: ignores incomplete sessions, skipped and non-cardio exercises", () => {
  const logs = [
    clog("2026-06-20", [{ name: "Running", sets: [mins(60)] }], false), // not completed
    clog("2026-06-21", [{ name: "Running", sets: [mins(60)], skipped: true }]),
    clog("2026-06-21", [{ name: "Squat", sets: [{ reps: 5, weight: 100 }] }]),
  ];
  const w = conditioningWeek(logs, "2026-06-17");
  assert.deepEqual([w.sessions, w.minutes], [0, 0]);
});

test("conditioningWeek: untimed distance is counted as a session and flagged, never guessed at", () => {
  const logs = [clog("2026-06-20", [{ name: "Running", sets: [{ reps: 0, weight: 0, meters: 10_000 }] }])];
  const w = conditioningWeek(logs, "2026-06-17");
  assert.equal(w.sessions, 1);
  assert.equal(w.meters, 10_000);
  assert.equal(w.minutes, 0); // no duration logged → no invented pace
  assert.equal(w.untimedSets, 1);
});

test("conditioningWeek: past the high landmark the zone flips to 'above'", () => {
  const logs = [clog("2026-06-20", [{ name: "Cycling", sets: [mins(CONDITIONING_LANDMARK.highMin + 10)] }])];
  const w = conditioningWeek(logs, "2026-06-17");
  assert.equal(w.zone, "above");
  assert.equal(conditioningOverload(w), true);
});

test("conditioningWeek: many short untimed sessions still read as 'above'", () => {
  // Six cardio days with no durations logged: minutes can't see it, the session count can.
  const logs = Array.from({ length: 6 }, (_, i) =>
    clog(`2026-06-2${i}`, [{ name: "Run", sets: [{ reps: 0, weight: 0, meters: 3000 }] }]),
  );
  const w = conditioningWeek(logs, "2026-06-17");
  assert.equal(w.sessions, 6);
  assert.equal(w.zone, "above");
});

test("conditioningOverload: only the 'above' zone brakes progression", () => {
  assert.equal(conditioningOverload({ sessions: 0, minutes: 0, meters: 0, untimedSets: 0, zone: "below" }), false);
  assert.equal(conditioningOverload({ sessions: 3, minutes: 180, meters: 0, untimedSets: 0, zone: "optimal" }), false);
});

test("recentConditioningStrain: a long session yesterday counts, a week ago does not", () => {
  const long = [{ name: "Running", sets: [mins(50)] }];
  assert.equal(recentConditioningStrain([clog("2026-06-19", long)], "2026-06-20"), true);
  assert.equal(recentConditioningStrain([clog("2026-06-13", long)], "2026-06-20"), false);
  // A short jog is not a strain signal.
  assert.equal(recentConditioningStrain([clog("2026-06-19", [{ name: "Running", sets: [mins(20)] }])], "2026-06-20"), false);
  // Distance alone can carry it when no duration was logged.
  const far = [{ name: "Running", sets: [{ reps: 0, weight: 0, meters: 10_000 }] }];
  assert.equal(recentConditioningStrain([clog("2026-06-19", far)], "2026-06-20"), true);
});

test("recentConditioningStrain: sets across the session add up", () => {
  const intervals = [{ name: "Ski erg", sets: [mins(16), mins(16), mins(16)] }];
  assert.equal(recentConditioningStrain([clog("2026-06-20", intervals)], "2026-06-20"), true);
});

test("readinessWithConditioning: softens a clean day, never overrides a worse verdict", () => {
  assert.equal(readinessWithConditioning("ok", true), "easy");
  assert.equal(readinessWithConditioning("ok", false), "ok");
  assert.equal(readinessWithConditioning("light", true), "light"); // check-in already said worse
});
