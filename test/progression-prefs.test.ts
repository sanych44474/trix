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

test("Android: the ceiling's strings exist in both languages and the UI is wired to the view model", async () => {
  const { readFileSync } = await import("node:fs");
  const res = "mobile/shared/src/commonMain/composeResources";
  const names = ["wk_train_cap_btn", "wk_cap_save_btn", "wk_cap_clear_btn", "wk_cap_note", "ac_prog_eyebrow", "ac_prog_title", "ac_prog_auto", "ac_prog_caps_title", "ac_prog_caps_empty", "ac_prog_cap_remove", "wk_cap_all_dumbbells", "ac_prog_cap_all_dumbbells"];
  for (const dir of ["values", "values-uk"]) {
    const all = ["strings_workout.xml", "strings_account.xml"].map((f) => readFileSync(`${res}/${dir}/${f}`, "utf8")).join("\n");
    for (const n of names) assert.match(all, new RegExp(`name="${n}"`), `${dir}: ${n}`);
  }
  const kt = "mobile/shared/src/commonMain/kotlin/app/hacklimits/shared";
  assert.match(readFileSync(`${kt}/workout/ui/FocusView.kt`, "utf8"), /CapControl\(ex, onSet = \{ kg, all -> vm\.setCap\(ex\.index, kg, all\)/);
  assert.match(readFileSync(`${kt}/ui/MoreScreen.kt`, "utf8"), /ProgressionSection\(settings\.progression, s\.busy, vm::setAutoProgression, vm::removeCap\)/);
  assert.match(readFileSync(`${kt}/data/WorkoutApi.kt`, "utf8"), /put\("action", "progression"\)/);
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
