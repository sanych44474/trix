// Athlete limits on automatic progression: a per-exercise ceiling and an off switch. A tester's
// dumbbells stop at 30 kg and the app proposed more every session.
import { test } from "node:test";
import assert from "node:assert/strict";
import { capKey, limitTarget, limitsFor, sanitizeProgression, withCap } from "../src/domain/progressionPrefs";
import { computePlanProgression, nextTarget, nextTargetSet, planNextTargets } from "../src/domain/progression";
import type { PlanDoc, WorkoutLogDoc } from "../src/types";

const range = { low: 8, high: 12 };

test("ceiling: at the ceiling the engine adds reps instead of a load that does not exist", () => {
  const free = nextTargetSet(30, 12, "Dumbbell Press", 8, range);
  assert.deepEqual([free.weight, free.step], [32, "load"], "without a ceiling it adds load");
  const capped = nextTargetSet(30, 12, "Dumbbell Press", 8, range, { cap: 30 });
  assert.deepEqual(capped, { weight: 30, reps: 13, step: "reps" });
  assert.equal(nextTargetSet(30, 20, "Dumbbell Press", 8, range, { cap: 30 }).reps, 21, "past the range it keeps going up");
});

test("ceiling: a step that would pass it lands on it; below the top of the range nothing changes", () => {
  assert.deepEqual(nextTargetSet(29, 12, "Dumbbell Curl", 8, range, { cap: 30 }), { weight: 30, reps: 8, step: "load" });
  assert.deepEqual(nextTargetSet(30, 9, "Dumbbell Press", 8, range, { cap: 30 }), { weight: 30, reps: 10, step: "reps" });
});

test("ceiling: an athlete already above it is never told to go down", () => {
  const t = nextTargetSet(34, 12, "Dumbbell Press", 8, range, { cap: 30 });
  assert.equal(t.weight, 34);
  assert.equal(t.step, "reps");
});

test("auto off: the target is exactly what was done, at any range position", () => {
  assert.deepEqual(nextTargetSet(30, 12, "Row", 8, range, { auto: false }), { weight: 30, reps: 12, step: "hold" });
  assert.deepEqual(nextTargetSet(30, 9, "Row", 6, range, { auto: false }), { weight: 30, reps: 9, step: "hold" });
  assert.deepEqual(nextTargetSet(0, 15, "Push-up", 6, range, { auto: false }), { weight: 0, reps: 15, step: "hold" });
  assert.equal(nextTarget(30, 12, "Row", 8, range, { auto: false }), "30 × 12");
});

test("no limits: the engine is unchanged", () => {
  assert.deepEqual(nextTargetSet(30, 12, "Row", 8, range, {}), nextTargetSet(30, 12, "Row", 8, range));
  assert.deepEqual(limitTarget({ weight: 5, reps: 5, step: "load" }, { weight: 1, reps: 1 }, undefined), { weight: 5, reps: 5, step: "load" });
});

test("prefs: keys ignore case and spacing, the exercise's other names are tried, junk is dropped", () => {
  assert.equal(capKey("  Dumbbell   PRESS "), "dumbbell press");
  const prefs = withCap(undefined, "Dumbbell Press", 30)!;
  assert.deepEqual(limitsFor(prefs, "dumbbell press"), { cap: 30 });
  assert.deepEqual(limitsFor(prefs, "Жим гантелей", "DUMBBELL PRESS"), { cap: 30 }, "the catalog name is tried too");
  assert.deepEqual(limitsFor({ ...prefs, auto: false }, "Row"), { auto: false });
  assert.deepEqual(limitsFor(undefined, "Row"), {});
  assert.equal(withCap(prefs, "Dumbbell Press", null)?.caps, undefined, "null clears it");
  assert.equal(withCap(prefs, "X", -5), null);
  assert.equal(withCap(prefs, "X", 5000), null);
  assert.equal(withCap(prefs, "   ", 20), null);
  assert.deepEqual(sanitizeProgression({ auto: "nope", caps: { A: "30", B: 0, C: 22.3, D: 2000 }, extra: 1 }), { caps: { c: 22.5 } });
  assert.deepEqual(sanitizeProgression(null), {});
});

function plan(sets: string, startWeight: string, name = "Dumbbell Press"): PlanDoc {
  return {
    userId: 1, active: true, status: "active",
    split: [{ weekday: 1, muscleGroup: "Push", exercises: [{ name, sets, startWeight, technique: "", metric: "reps", muscles: "chest", role: "primary" }] }],
    nutrition: { calories: 2000, protein: 150, fats: 60, carbs: 200 }, supplements: [], methodology: "", generatedAt: new Date("2026-01-01T00:00:00Z"), schemaVersion: 1,
  } as unknown as PlanDoc;
}
const log = (date: string, name: string, reps: number, weight: number, rpe = 8): WorkoutLogDoc => ({
  date, weekday: 1, completed: true, notes: undefined,
  exercises: [{ name, skipped: false, rpe, setsDone: [{ weight, reps }, { weight, reps }, { weight, reps }] }],
}) as unknown as WorkoutLogDoc;
const topped = [log("2026-11-08", "Dumbbell Press", 12, 30), log("2026-11-01", "Dumbbell Press", 12, 30)];

test("weekly plan: without limits the topped range adds load", () => {
  const r = computePlanProgression(plan("3 × 8–12", "30 kg"), topped, []);
  assert.deepEqual(r.changes.map((c) => [c.field, c.to]), [["weight", "32 kg"]]);
});

test("weekly plan: at the ceiling the rep range grows instead of the weight", () => {
  const r = computePlanProgression(plan("3 × 8–12", "30 kg"), topped, [], { prefs: { caps: { "dumbbell press": 30 } } });
  assert.ok(!r.changes.some((c) => c.field === "weight"), JSON.stringify(r.changes));
  assert.deepEqual(r.changes.map((c) => c.field), ["reps"]);
});

test("weekly plan: below the ceiling the weight rises, but never past it", () => {
  const r = computePlanProgression(plan("3 × 8–12", "29 kg"), [log("2026-11-08", "Dumbbell Press", 12, 29), log("2026-11-01", "Dumbbell Press", 12, 29)], [], { prefs: { caps: { "dumbbell press": 30 } } });
  assert.deepEqual(r.changes.map((c) => c.to), ["30 kg"]);
});

test("weekly plan: auto off changes nothing on a topped range, but still follows what was really lifted", () => {
  const off = computePlanProgression(plan("3 × 8–12", "30 kg"), topped, [], { prefs: { auto: false } });
  assert.deepEqual(off.changes, []);
  const sync = computePlanProgression(plan("3 × 8–12", "25 kg"), [log("2026-11-08", "Dumbbell Press", 9, 30), log("2026-11-01", "Dumbbell Press", 9, 30)], [], { prefs: { auto: false } });
  assert.deepEqual(sync.changes.map((c) => c.to), ["30 kg"], "the plan follows the athlete, it does not push him");
  const bw = computePlanProgression(plan("3 × 8–12", "Bodyweight", "Push-up"), [log("2026-11-08", "Push-up", 12, 0), log("2026-11-01", "Push-up", 12, 0)], [], { prefs: { auto: false } });
  assert.deepEqual(bw.changes, []);
});

test("coach targets quote the limited targets", () => {
  const lines = planNextTargets(plan("3 × 8–12", "30 kg"), topped, 10, { caps: { "dumbbell press": 30 } });
  assert.match(lines[0], /next 30 × 13/);
});

test("wiring: the weekly job and the coach prompt read the athlete's limits", async () => {
  const { readFileSync } = await import("node:fs");
  assert.match(readFileSync("src/schedulerJobs/weeklyProgression.ts", "utf8"), /prefs: user\.profile\.progression/);
  assert.match(readFileSync("src/features/coach/coachContext.ts", "utf8"), /planNextTargets\(plan, recent\.workouts, 10, owner\.profile\.progression\)/);
});

test("one ceiling for all dumbbell exercises applies to each, and an exercise's own wins", async () => {
  const { DUMBBELL_CAP_KEY, isDumbbellOnly, limitsFor } = await import("../src/domain/progressionPrefs");
  assert.equal(isDumbbellOnly("Dumbbell Bench Press"), true);
  assert.equal(isDumbbellOnly("Гантельний жим"), true);
  assert.equal(isDumbbellOnly("Barbell Squat"), false);
  assert.equal(isDumbbellOnly("Cable Fly"), false);
  const prefs = { caps: { [DUMBBELL_CAP_KEY]: 30, "dumbbell curl": 20 } };
  assert.deepEqual(limitsFor(prefs, "Dumbbell Bench Press"), { cap: 30, shared: true });
  assert.deepEqual(limitsFor(prefs, "Dumbbell Curl"), { cap: 20 });
  assert.deepEqual(limitsFor(prefs, "Barbell Squat"), {});
});

// ---- edges of the ceiling rules (found by mutation: the tests above checked typical values only)

test("sanitizeProgression: a ceiling must be above 0 and at most 1000 kg, and is kept to the nearest half kilo", () => {
  const kept = (kg: unknown) => sanitizeProgression({ caps: { curl: kg } }).caps?.curl;
  assert.equal(kept(1000), 1000, "the top of the range is allowed");
  assert.equal(kept(1000.5), undefined);
  assert.equal(kept(0), undefined);
  assert.equal(kept(-5), undefined);
  assert.equal(kept("30"), undefined, "a string is not a number");
  assert.equal(kept(Number.NaN), undefined);
  assert.equal(kept(Number.POSITIVE_INFINITY), undefined);
  assert.equal(kept(0.5), 0.5);
  assert.equal(kept(30.2), 30);
  assert.equal(kept(30.3), 30.5);
  assert.equal(kept(30.75), 31);
});

test("sanitizeProgression: at most 60 ceilings are kept, an empty name is skipped, junk input is empty", () => {
  const many = Object.fromEntries(Array.from({ length: 61 }, (_, i) => [`exercise ${i}`, 10]));
  assert.equal(Object.keys(sanitizeProgression({ caps: many }).caps ?? {}).length, 60);
  const sixty = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`exercise ${i}`, 10]));
  assert.equal(Object.keys(sanitizeProgression({ caps: sixty }).caps ?? {}).length, 60);
  assert.equal(sanitizeProgression({ caps: { "   ": 20 } }).caps, undefined);
  for (const junk of [null, undefined, "x", 5, [], { caps: "x" }, { caps: null }, {}]) assert.deepEqual(sanitizeProgression(junk), {}, JSON.stringify(junk));
  assert.deepEqual(sanitizeProgression({ auto: true }), {}, "on is the default, so it is not stored");
  assert.deepEqual(sanitizeProgression({ auto: false }), { auto: false });
  assert.deepEqual(sanitizeProgression({ auto: "no", unknown: 1 }), {});
});

test("withCap: set, replace and clear; a bad value changes nothing", () => {
  assert.deepEqual(withCap(undefined, "Curl", 20), { caps: { curl: 20 } });
  assert.deepEqual(withCap({ caps: { curl: 20 } }, " CURL ", 25), { caps: { curl: 25 } }, "same exercise, any spelling");
  assert.deepEqual(withCap({ caps: { curl: 20 } }, "Curl", null), {});
  assert.equal(withCap(undefined, "Curl", 1000)?.caps?.curl, 1000);
  assert.equal(withCap(undefined, "Curl", 1001), null);
  assert.equal(withCap(undefined, "Curl", 0), null);
  assert.equal(withCap(undefined, "Curl", -1), null);
  assert.equal(withCap(undefined, "Curl", Number.NaN), null);
  assert.equal(withCap(undefined, "   ", 20), null, "no exercise name");
  assert.deepEqual(withCap({ auto: false }, "Curl", 20), { auto: false, caps: { curl: 20 } }, "the off switch is kept");
});

test("withCap: the 60th ceiling fits, the 61st is refused, and an existing one can still change", () => {
  const sixty = { caps: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`exercise ${i}`, 10])) };
  assert.equal(withCap({ caps: Object.fromEntries(Array.from({ length: 59 }, (_, i) => [`exercise ${i}`, 10])) }, "one more", 10) !== null, true);
  assert.equal(withCap(sixty, "one more", 10), null);
  assert.equal(withCap(sixty, "exercise 3", 12)?.caps?.["exercise 3"], 12);
});

test("limitsFor: a zero ceiling is no ceiling, the exercise's own beats the shared one, undefined names are skipped", () => {
  assert.deepEqual(limitsFor({ caps: { curl: 0 } }, "Curl"), {});
  assert.deepEqual(limitsFor({ caps: { "@dumbbell": 0 } }, "Dumbbell Curl"), {});
  assert.deepEqual(limitsFor({ caps: { curl: 20 } }, undefined, "Curl"), { cap: 20 }, "tries each name it is known by");
  assert.deepEqual(limitsFor({ auto: false }, "Curl"), { auto: false });
  assert.deepEqual(limitsFor({ auto: true, caps: {} }, "Curl"), {});
  assert.deepEqual(limitsFor({ caps: { "@dumbbell": 30 } }, "Barbell Row"), {}, "the shared ceiling is for dumbbell-only exercises");
  assert.deepEqual(limitsFor(undefined, "Curl"), {});
});

test("limitTarget: only a load step that goes past the ceiling is changed", () => {
  const best = { weight: 25, reps: 10 };
  // a reps step is never touched, even with a ceiling below the weight
  assert.deepEqual(limitTarget({ weight: 40, reps: 8, step: "reps" }, best, { cap: 30 }), { weight: 40, reps: 8, step: "reps" });
  assert.deepEqual(limitTarget({ weight: 40, reps: 8, step: "hold" }, best, { cap: 30 }), { weight: 40, reps: 8, step: "hold" });
  // no ceiling: untouched
  assert.deepEqual(limitTarget({ weight: 40, reps: 8, step: "load" }, best, {}), { weight: 40, reps: 8, step: "load" });
  // a load step that lands exactly on the ceiling is fine
  assert.deepEqual(limitTarget({ weight: 30, reps: 8, step: "load" }, best, { cap: 30 }), { weight: 30, reps: 8, step: "load" });
  // past the ceiling, still below it now: land on the ceiling, keep the rest of the step
  assert.deepEqual(limitTarget({ weight: 32.5, reps: 8, step: "load" }, best, { cap: 30 }), { weight: 30, reps: 8, step: "load" });
});

test("limitTarget: at the ceiling it adds reps (two on an easy session), and the off switch holds everything", () => {
  const next = { weight: 32.5, reps: 8, step: "load" as const };
  assert.deepEqual(limitTarget(next, { weight: 30, reps: 10 }, { cap: 30 }), { weight: 30, reps: 11, step: "reps" });
  assert.deepEqual(limitTarget(next, { weight: 30, reps: 10 }, { cap: 30 }, true), { weight: 30, reps: 12, step: "reps" });
  assert.deepEqual(limitTarget(next, { weight: 35, reps: 6 }, { cap: 30 }), { weight: 35, reps: 7, step: "reps" }, "already above it: stay, add reps");
  assert.deepEqual(limitTarget(next, { weight: 25, reps: 10 }, { auto: false, cap: 30 }, true), { weight: 25, reps: 10, step: "hold" });
  assert.deepEqual(limitTarget(next, { weight: 25, reps: 10 }, undefined), next);
});
