// The gap: /deleteme clears ~60 tables' worth of a user's data, but /export only ever returned
// ~7 activity-log domains -- notably not the user's own training plan, despite it being the
// single most personal artifact the product generates for them. This is not full parity with
// deleteUserData (most of its ~60 tables are internal telemetry -- ai_call_logs, idempotency_keys,
// scheduler_dryrun_log -- that were never "your data" to export in the first place; see the
// deliberate-scope note at the top of exportData.ts). It closes the three gaps that clearly ARE
// "your data": the active plan, active injuries, and earned badges.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser } from "../src/adapters/d1/v2Users";
import { setActivePlan } from "../src/adapters/d1/v2Plans";
import { createInjury } from "../src/adapters/d1/v2Tracking";
import { awardAchievement } from "../src/adapters/d1/v2Gamification";
import { upsertWorkoutLog } from "../src/adapters/d1/v2Workouts";
import { buildExportJson, buildExportMd } from "../src/bot/exportData";
import type { PlanDoc, UserDoc, Weekday } from "../src/types";

function plan(userId: number): PlanDoc {
  return {
    userId, active: true, status: "active",
    split: [{ weekday: 3 as Weekday, muscleGroup: "Push", exercises: [{ name: "Overhead Press", sets: "3x8", startWeight: "40kg", technique: "" }] }],
    nutrition: { calories: 2200, protein: 160, fats: 70, carbs: 220 },
    supplements: [], methodology: "", generatedAt: new Date(), schemaVersion: 1,
  } as unknown as PlanDoc;
}

test("buildExportMd: a fresh user with a plan but nothing logged yet is no longer \"nothing to export\"", async () => {
  const db = newDb();
  const user = (await getOrCreateUser(db, 1, 1, "en", "Ann")) as unknown as UserDoc;
  await setActivePlan(db, plan(1));

  const md = await buildExportMd(db, user);
  assert.notEqual(md, null, "a plan with zero logged activity is still exportable data");
  assert.match(md as string, /Overhead Press/);
});

test("buildExportMd: includes the active plan, injuries, and badges sections", async () => {
  const db = newDb();
  const user = (await getOrCreateUser(db, 2, 2, "en", "Bo")) as unknown as UserDoc;
  await setActivePlan(db, plan(2));
  await createInjury(db, { userId: 2, area: "knee", severity: "mild", checkAfter: "2026-01-01", swaps: [] });
  await awardAchievement(db, 2, "first_workout");

  const md = await buildExportMd(db, user) as string;
  assert.match(md, /## Active plan/);
  assert.match(md, /Overhead Press: 3x8/);
  assert.match(md, /## Injuries/);
  assert.match(md, /## Badges/);
});

test("buildExportMd: sections are absent, not empty headers, when there is nothing in them", async () => {
  const db = newDb();
  const user = (await getOrCreateUser(db, 3, 3, "en", "Cy")) as unknown as UserDoc;
  await setActivePlan(db, plan(3)); // only the plan -- no injuries, no badges

  const md = await buildExportMd(db, user) as string;
  assert.match(md, /## Active plan/);
  assert.doesNotMatch(md, /## Injuries/);
  assert.doesNotMatch(md, /## Badges/);
});

test("buildExportJson: a fresh user with only a plan is no longer \"nothing to export\", and the plan/injuries/achievements fields are populated", async () => {
  const db = newDb();
  const user = (await getOrCreateUser(db, 4, 4, "en", "Dee")) as unknown as UserDoc;
  await setActivePlan(db, plan(4));
  await createInjury(db, { userId: 4, area: "shoulder", severity: "strong", checkAfter: "2026-01-01", swaps: [] });
  await awardAchievement(db, 4, "first_pr");

  const json = await buildExportJson(db, user);
  assert.notEqual(json, null);
  const parsed = JSON.parse(json as string) as {
    plan: { split: { exercises: { name: string }[] }[] } | null;
    injuries: { area: string }[];
    achievements: string[];
  };
  assert.equal(parsed.plan?.split[0]?.exercises[0]?.name, "Overhead Press");
  assert.deepEqual(parsed.injuries.map((i) => i.area), ["shoulder"]);
  assert.deepEqual(parsed.achievements, ["first_pr"]);
});

test("buildExportJson: plan/injuries/achievements are present and empty, not omitted, when a user has other exportable data but none of these three", async () => {
  const db = newDb();
  const user = (await getOrCreateUser(db, 5, 5, "en", "Eli")) as unknown as UserDoc;
  await upsertWorkoutLog(db, 5, "2026-09-01", 2, [{ name: "Squat", setsDone: [{ weight: 60, reps: 8 }], skipped: false }], true);

  const json = await buildExportJson(db, user) as string;
  const parsed = JSON.parse(json) as { plan: unknown; injuries: unknown[]; achievements: unknown[] };
  assert.equal(parsed.plan, null);
  assert.deepEqual(parsed.injuries, []);
  assert.deepEqual(parsed.achievements, []);
});
