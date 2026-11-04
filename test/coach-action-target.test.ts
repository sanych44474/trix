// A coach answer can carry up to 4 plan edits addressed by (weekday, index). Applied one after
// another, or after the plan changed, an index points at a different exercise: "delete #2" then
// "delete #3" deleted #2 and then what used to be #4. Each action now carries its target's name,
// the clients send it as expectName, and the plan editor refuses a moved target with 409 "stale".
import { test } from "node:test";
import assert from "node:assert/strict";
import { miniAppCoachActions } from "../src/domain/coachActions";
import { newDb } from "./harness";
import { getOrCreateUser } from "../src/adapters/d1/v2Users";
import { getActivePlan, setActivePlan } from "../src/adapters/d1/v2Plans";
import { handlePlanApi } from "../src/webapp/planApi";
import type { Env, PlanDoc } from "../src/types";

const split = [{ weekday: 1, exercises: [{ name: "Squat" }, { name: "Bench Press" }, { name: "Row" }, { name: "Curl" }] }];

test("coach actions: each targeted action carries the current name of its exercise", () => {
  const out = miniAppCoachActions([
    { label: "Drop bench", kind: "delete", weekday: 1, index: 1 },
    { label: "Drop row", kind: "delete", weekday: 1, index: 2 },
    { label: "Heavier squat", kind: "weight", weekday: 1, index: 0, value: "100" },
    { label: "Add dips", kind: "add", weekday: 1, exercise: "Dips" },
  ], "q", split);
  assert.deepEqual(out.map((a) => a.target), ["Bench Press", "Row", "Squat", undefined]);
});

test("coach actions: an action pointing at an exercise the plan does not have is dropped", () => {
  const out = miniAppCoachActions([
    { label: "Drop #9", kind: "delete", weekday: 1, index: 9 },
    { label: "Swap on Tue", kind: "swap", weekday: 2, index: 0, exercise: "Dips" },
  ], "q", split);
  assert.deepEqual(out, []);
});

test("two coach deletes on one day: the second is refused as stale, not applied to the wrong exercise", async () => {
  const db = newDb();
  await getOrCreateUser(db, 41, 41, "en", "Ann");
  await setActivePlan(db, {
    userId: 41, active: true, status: "active",
    split: [{ weekday: 1, muscleGroup: "Full", exercises: split[0].exercises.map((e) => ({ ...e, sets: "3 × 8", startWeight: "40 kg", technique: "" })) }],
    nutrition: { calories: 2000, protein: 150, fats: 60, carbs: 200 }, supplements: [], methodology: "",
    generatedAt: new Date("2026-01-01T00:00:00.000Z"), schemaVersion: 1,
  } as unknown as PlanDoc);
  const actions = miniAppCoachActions([
    { label: "Drop bench", kind: "delete", weekday: 1, index: 1 },
    { label: "Drop row", kind: "delete", weekday: 1, index: 2 },
  ], "q", split);
  const env = { DB: db, ALLOW_DEBUG_USER: "1", TELEGRAM_BOT_TOKEN: "t" } as unknown as Env;
  // What both clients send for a coach action: weekday, index and the target as expectName.
  const apply = (a: (typeof actions)[number]) => {
    const req = new Request("https://x.test/api/plan?debugUser=41", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "del", weekday: a.weekday, index: a.index, expectName: a.target }),
    });
    return handlePlanApi(req, new URL(req.url), env);
  };
  assert.equal((await apply(actions[0])).status, 200);
  assert.equal((await apply(actions[1])).status, 409, "index 2 is now Curl, not Row");
  const left = (await getActivePlan(db, 41))?.split[0].exercises.map((e) => e.name);
  assert.deepEqual(left, ["Squat", "Row", "Curl"], "Curl survives");
});
