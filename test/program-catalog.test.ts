// The ready-program catalog (src/domain/programCatalog.ts): 45 programs, 15 per place, three
// load levels per style, well-formed plans in both languages, and real progression in load.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PROGRAMS, buildProgram, catalogBankEntries } from "../src/domain/programCatalog";
import { selectBest } from "../src/domain/planBank";
import { adaptPlan, finishGeneratedSplit } from "../src/domain/planAdapt";
import { planSetsCount } from "../src/bot/guidedLog";
import type { UserProfile } from "../src/types";

test("catalog: 15 programs per place, men / women / everyone, three load levels each", () => {
  assert.equal(PROGRAMS.length, 45);
  for (const place of ["gym", "dumbbells", "bodyweight"] as const) {
    const here = PROGRAMS.filter((p) => p.place === place);
    assert.equal(here.length, 15, place);
    for (const audience of ["men", "women"] as const) assert.ok(here.some((p) => p.audience === audience), `${place} has ${audience}`);
    for (const level of ["beginner", "intermediate", "advanced"] as const) assert.equal(here.filter((p) => p.level === level).length, 5, `${place} ${level}`);
  }
  assert.equal(new Set(PROGRAMS.map((p) => p.id)).size, 45, "ids are unique");
});

test("catalog: every program builds in both languages with sane days and exercises", () => {
  for (const p of PROGRAMS) {
    for (const lang of ["en", "uk"] as const) {
      const plan = buildProgram(p.id, lang)!;
      assert.ok(plan, p.id);
      assert.equal(plan.split.length, p.daysPerWeek, `${p.id} days`);
      assert.equal(new Set(plan.split.map((d) => d.weekday)).size, plan.split.length, `${p.id} distinct weekdays`);
      for (const day of plan.split) {
        assert.ok(day.exercises.length >= 4 && day.exercises.length <= 7, `${p.id} ${day.muscleGroup}: ${day.exercises.length}`);
        for (const ex of day.exercises) {
          assert.match(ex.sets, /^\d × [\d-]+s?$/, `${p.id} ${ex.name} sets "${ex.sets}"`);
          assert.ok(ex.name && ex.canonicalName && ex.technique && ex.rest, `${p.id} ${ex.name} fields`);
        }
      }
    }
  }
});

test("catalog: no equipment means no weights; home dumbbell plans use no machines", () => {
  for (const p of PROGRAMS.filter((x) => x.place !== "gym")) {
    const plan = buildProgram(p.id, "en")!;
    const names = plan.split.flatMap((d) => d.exercises.map((e) => e.name)).join(" | ");
    assert.doesNotMatch(names, /barbell|machine|cable|pulldown|leg press|bench press/i, p.id);
    if (p.place === "bodyweight") {
      assert.ok(plan.split.every((d) => d.exercises.every((e) => !/kg$/.test(e.startWeight))), `${p.id} has no loads`);
    }
  }
});

test("catalog: load grows with the level (volume and exercises per session)", () => {
  const volume = (id: string) => buildProgram(id, "en")!.split.reduce((n, d) => n + d.exercises.reduce((m, e) => m + planSetsCount(e.sets), 0), 0) / buildProgram(id, "en")!.split.length;
  for (const style of new Set(PROGRAMS.map((p) => p.styleId))) {
    const [b, i, a] = ["beginner", "intermediate", "advanced"].map((lvl) => volume(`${style}-${lvl}`));
    assert.ok(b < i && i <= a, `${style}: sets per session ${b} < ${i} <= ${a}`);
  }
});

test("catalog: in the plan bank, picked for a matching profile and adapted to the person", () => {
  const entries = catalogBankEntries();
  assert.ok(entries.length > 45, "programs for everyone appear for both sexes");
  const profile: UserProfile = { sex: "female", goal: "build glutes, muscle", level: "intermediate", daysPerWeek: 4, trainingWeekdays: [1, 2, 4, 5], equipment: "gym", weightKg: 62 };
  const match = selectBest(entries, profile, 7)!;
  assert.equal(match.entry.sex, "female");
  assert.equal(match.entry.equipment, "gym");
  const plan = adaptPlan(match.entry.plan.uk, profile, 7, { finishFor: "uk" });
  assert.equal(plan.split.length, 4);
  assert.ok(plan.split.flatMap((d) => d.exercises).length > 0);
  assert.ok(finishGeneratedSplit(plan.split, profile, "uk").length === 4);
});
