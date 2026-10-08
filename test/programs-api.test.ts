// Ready programs API (src/webapp/programsApi.ts): list in the viewer's language, apply one as the
// active plan on the person's own days, and keep a trainer's client on the trainer's plan.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser, getUser, updateUser } from "../src/adapters/d1/v2Users";
import { getActivePlan } from "../src/adapters/d1/v2Plans";
import { handleProgramsApi, programWeekdays } from "../src/webapp/programsApi";
import type { UserDoc } from "../src/types";

async function call(db: ReturnType<typeof newDb>, id: number, method: string, body?: unknown) {
  const p = `/api/programs?debugUser=${id}`;
  const req = new Request(`https://x${p}`, { method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) });
  return handleProgramsApi(req, new URL(`https://x${p}`), { DB: db, ALLOW_DEBUG_USER: "1", TELEGRAM_BOT_TOKEN: "t" } as never);
}

test("programs: listed in the viewer's language with their days", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "uk", "Оля");
  const body = (await (await call(db, 1, "GET")).json()) as { programs: Array<{ id: string; name: string; days: Array<{ exercises: unknown[] }> }> };
  assert.equal(body.programs.length, 45);
  assert.match(body.programs[0].name, /Зал/);
  assert.ok(body.programs.every((p) => p.days.length > 0 && p.days.every((d) => d.exercises.length > 0)));
});

test("programs: applying makes it the active plan on the person's own training days", async () => {
  const db = newDb();
  await getOrCreateUser(db, 2, 2, "en", "Ann");
  await updateUser(db, 2, { profile: { sex: "female", level: "beginner", weightKg: 60, trainingWeekdays: [2, 4, 6, 7] } } as Parameters<typeof updateUser>[2]);
  const res = await call(db, 2, "POST", { id: "db-glutes-beginner" });
  assert.equal(res.status, 200);
  assert.deepEqual(((await res.json()) as { weekdays: number[] }).weekdays, [2, 4, 6]);
  const plan = await getActivePlan(db, 2);
  assert.deepEqual(plan?.split.map((d) => d.weekday), [2, 4, 6]);
  assert.match(plan!.split[0].muscleGroup, /Glutes/);
  const u = (await getUser(db, 2)) as UserDoc;
  assert.equal(u.onboarded, true);
  assert.deepEqual(u.profile.trainingWeekdays, [2, 4, 6]);
});

test("programs: a trainer's client can't replace the trainer's plan; unknown ids are 404", async () => {
  const db = newDb();
  await getOrCreateUser(db, 10, 10, "en", "Coach");
  await updateUser(db, 10, { role: "trainer" });
  await getOrCreateUser(db, 3, 3, "en", "Client");
  await updateUser(db, 3, { role: "client", trainerId: 10 });
  assert.equal((await call(db, 3, "POST", { id: "gym-fullbody-beginner" })).status, 403);
  await getOrCreateUser(db, 4, 4, "en", "Solo");
  assert.equal((await call(db, 4, "POST", { id: "nope" })).status, 404);
});

test("programWeekdays: own days when there are enough, else the program's", () => {
  assert.deepEqual(programWeekdays([5, 1, 3, 7], [1, 3, 5]), [1, 3, 5]);
  assert.deepEqual(programWeekdays([2, 6], [1, 3, 5]), [1, 3, 5]);
  assert.deepEqual(programWeekdays(undefined, [1, 2, 4, 5]), [1, 2, 4, 5]);
});
