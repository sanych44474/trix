// The second way into the app: the four body-data questions, then a ready program (no full
// questionnaire); the Today fine-tune card asks the rest later -- recomputing calorie targets once
// a missing calorie input becomes known.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser, getUser, updateUser } from "../src/adapters/d1/v2Users";
import { getActivePlan } from "../src/adapters/d1/v2Plans";
import { handleProfileApi } from "../src/webapp/profileApi";
import { handleProgramsApi } from "../src/webapp/programsApi";
import { profileGaps } from "../src/domain/profileGaps";
import type { UserDoc } from "../src/types";

async function call(handler: (req: Request, url: URL, env: never) => Promise<Response>, db: ReturnType<typeof newDb>, id: number, method: string, path: string, body?: unknown) {
  const p = `${path}?debugUser=${id}`;
  const req = new Request(`https://x${p}`, { method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) });
  return handler(req, new URL(`https://x${p}`), { DB: db, ALLOW_DEBUG_USER: "1", TELEGRAM_BOT_TOKEN: "t" } as never);
}

test("profileGaps: the calorie inputs first, then session length and diet", () => {
  assert.deepEqual(profileGaps({}), ["sex", "age", "heightCm", "weightKg", "lifestyle", "sessionMinutes", "dietPrefs"]);
  assert.deepEqual(profileGaps({ sex: "male", age: 30, heightCm: 180, weightKg: 80, lifestyle: "active", sessionMinutes: 60, dietPrefs: "none" }), []);
});

test("ready-program entry: basics saved, program applied, person onboarded, the rest left for the card", async () => {
  const db = newDb();
  await getOrCreateUser(db, 2, 2, "uk", "Макс");
  await call(handleProfileApi, db, 2, "POST", "/api/profile", { sex: "male", age: 31, heightCm: 182, weightKg: 84.5 });
  const res = await call(handleProgramsApi, db, 2, "POST", "/api/programs", { id: "gym-fullbody-beginner" });
  assert.equal(res.status, 200, await res.clone().text());
  const u = (await getUser(db, 2)) as UserDoc;
  assert.equal(u.onboarded, true);
  assert.ok(await getActivePlan(db, 2));
  assert.equal(u.profile.weightKg, 84.5);
  assert.deepEqual(profileGaps(u.profile), ["lifestyle", "sessionMinutes", "dietPrefs"]);
  assert.ok(u.nutrition && u.nutrition.calories > 1500);
});

test("fine-tune: filling a missing calorie input recomputes the targets; editing a known one does not", async () => {
  const db = newDb();
  await getOrCreateUser(db, 3, 3, "uk", "Іра");
  await updateUser(db, 3, { onboarded: true, profile: { sex: "female", age: 30, heightCm: 165, goal: "fat loss", level: "beginner" }, nutrition: { calories: 9999, protein: 1, fats: 1, carbs: 1 } } as Parameters<typeof updateUser>[2]);
  await call(handleProfileApi, db, 3, "POST", "/api/profile", { weightKg: 62.4, sessionMinutes: 45 });
  let u = (await getUser(db, 3)) as UserDoc;
  assert.equal(u.profile.weightKg, 62.4);
  assert.equal(u.profile.sessionMinutes, 45);
  assert.ok(u.nutrition && u.nutrition.calories < 3000 && u.nutrition.protein > 50, JSON.stringify(u.nutrition));
  // Adaptive corrections live in the stored targets: changing a value that was already set keeps them.
  await updateUser(db, 3, { nutrition: { calories: 1700, protein: 120, fats: 55, carbs: 160 } } as Parameters<typeof updateUser>[2]);
  await call(handleProfileApi, db, 3, "POST", "/api/profile", { weightKg: 61 });
  u = (await getUser(db, 3)) as UserDoc;
  assert.equal(u.nutrition?.calories, 1700);
});
