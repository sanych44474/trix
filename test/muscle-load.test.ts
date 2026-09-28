import { test } from "node:test";
import assert from "node:assert/strict";
import { muscleRecovery, planBalance, planSetCount, weeklyMuscleSets } from "../src/domain/muscleLoad";
import { renderPlanBalance } from "../src/render";
import type { PlanDay } from "../src/types";

const row = <T extends { slug: string }>(rows: T[], slug: string) => rows.find((r) => r.slug === slug)!;

test("weekly sets: primary counts in full, a helper as half; only finished workouts in the window", () => {
  const week = weeklyMuscleSets([
    { date: "2026-09-27", done: true, ex: [{ n: "Жим лежачи", s: 4 }, { n: "Присідання", s: 3 }] },
    { date: "2026-09-25", done: true, ex: [{ n: "Віджимання на брусах", s: 2 }] },
    { date: "2026-09-26", done: false, ex: [{ n: "Жим лежачи", s: 5 }] }, // unfinished: not volume
    { date: "2026-09-10", done: true, ex: [{ n: "Жим лежачи", s: 9 }] }, // outside the week
  ], "2026-09-22");
  const chest = row(week, "chest");
  assert.equal(chest.sets, 6, "4 bench + 2 dips, both primary");
  assert.equal(row(week, "triceps").sets, 4, "bench helps (4 → 2) + dips drive (2)");
  assert.equal(row(week, "hamstring").sets, 1.5, "squat helps: 3 → 1.5");
  assert.equal(chest.zone, "below", "under chest MEV 10");
  assert.deepEqual(chest.exercises.map((e) => [e.name, e.sets, e.role]), [["Жим лежачи", 4, "primary"], ["Віджимання на брусах", 2, "primary"]]);
  assert.equal(row(week, "calves").zone, "none", "no MEV → not flagged when untrained");
});

test("recovery: today/yesterday recovering, two days almost, three+ ready; helpers recover a day sooner", () => {
  const rec = muscleRecovery([
    { date: "2026-09-28", done: false, ex: [{ n: "Жим лежачи", s: 2 }] }, // in progress still counts
    { date: "2026-09-26", done: true, ex: [{ n: "Присідання", s: 4 }] },
    { date: "2026-09-24", done: true, ex: [{ n: "Підтягування", s: 4 }] },
  ], "2026-09-28");
  assert.equal(row(rec, "chest").status, "recovering");
  assert.deepEqual(row(rec, "chest").exercises, ["Жим лежачи"]);
  assert.equal(row(rec, "triceps").status, "recovering", "helped the bench today: still tired today");
  assert.equal(row(rec, "quadriceps").status, "almost", "squats two days ago");
  assert.equal(row(rec, "hamstring").status, "ready", "squat only helped them two days ago");
  assert.equal(row(rec, "upper-back").status, "ready", "four days ago");
  assert.equal(row(rec, "calves").daysAgo, null);
});

test("recovery: the most limiting load decides (yesterday as helper beats last week as primary)", () => {
  const rec = muscleRecovery([
    { date: "2026-09-27", done: true, ex: [{ n: "Жим лежачи", s: 3 }] },
    { date: "2026-09-21", done: true, ex: [{ n: "Французький жим", s: 3 }] },
  ], "2026-09-28");
  const triceps = row(rec, "triceps");
  assert.equal(triceps.status, "almost");
  assert.equal(triceps.role, "secondary");
  assert.equal(triceps.daysAgo, 1);
});

const day = (weekday: number, exercises: Array<[string, string?]>) => ({ weekday, exercises: exercises.map(([name, sets]) => ({ name, sets: sets ?? "3 × 10" })) });

test("plan balance: missing muscles get an exercise on the day that trains their neighbours", () => {
  const issues = planBalance([
    day(1, [["Жим лежачи", "4 × 8"], ["Жим гантелей сидячи"], ["Французький жим"]]),
    day(3, [["Присідання", "4 × 8"], ["Жим ногами"], ["Розгинання ніг"]]),
    day(5, [["Тяга штанги в нахилі", "4 × 8"], ["Підтягування"], ["Згинання рук зі штангою"], ["Планка"]]),
  ]);
  const hams = issues.find((i) => i.slug === "hamstring");
  assert.ok(hams, "no hinge or curl anywhere");
  assert.equal(hams!.kind, "imbalance", "squats/leg press give hams some half-sets, far below the quads");
  assert.equal(hams!.suggestion?.uk, "Румунська тяга");
  assert.equal(hams!.suggestion?.weekday, 3, "the leg day");
  assert.ok(!issues.some((i) => i.slug === "chest" || i.slug === "upper-back"), "push/pull are even");
});

test("plan balance: a push-only plan flags back as missing; cardio/yoga plans aren't judged", () => {
  const issues = planBalance([
    day(1, [["Жим лежачи"], ["Жим під кутом"], ["Віджимання"], ["Розгинання рук на блоці"]]),
    day(4, [["Присідання"], ["Румунська тяга"], ["Ягідний місток"], ["Планка"]]),
  ]);
  const back = issues.find((i) => i.slug === "upper-back");
  assert.equal(back?.kind, "missing");
  assert.equal(back?.suggestion?.en, "Dumbbell row");
  assert.deepEqual(planBalance([day(2, [["Біг"], ["Йога-потік"]])]), []);
});

test("planSetCount reads the leading number and defaults to 3", () => {
  assert.equal(planSetCount("4 × 8–10"), 4);
  assert.equal(planSetCount("3x12"), 3);
  assert.equal(planSetCount("AMRAP"), 3);
  assert.equal(planSetCount(undefined), 3);
});

test("renderPlanBalance: a localized note for the bot's plan message, empty when balanced", () => {
  const split = [
    day(1, [["Жим лежачи"], ["Жим під кутом"], ["Віджимання"], ["Розгинання рук на блоці"]]),
    day(4, [["Присідання"], ["Румунська тяга"], ["Ягідний місток"], ["Планка"]]),
  ] as unknown as PlanDay[];
  const uk = renderPlanBalance("uk", split);
  assert.match(uk, /Баланс плану/);
  assert.match(uk, /спину.*Тяга гантелі в нахилі/);
  assert.match(renderPlanBalance("en", split), /Dumbbell row/);
  assert.equal(renderPlanBalance("uk", [day(2, [["Біг"]])] as unknown as PlanDay[]), "");
});
