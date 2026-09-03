import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser, getUser, updateUser } from "../src/db/repos";
import { handleProfileApi, handleOnboardingApi } from "../src/webapp/profileApi";
import type { UserDoc } from "../src/types";

function req(method: string, path: string, body?: unknown) {
  return new Request(`https://x${path}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}),
  });
}
async function call(
  handler: (req: Request, url: URL, env: unknown) => Promise<Response>,
  db: ReturnType<typeof newDb>,
  userId: number | null,
  method: string,
  path: string,
  body?: unknown,
) {
  const full = userId ? `${path}${path.includes("?") ? "&" : "?"}debugUser=${userId}` : path;
  return handler(req(method, full, body), new URL(`https://x${full}`), { DB: db, TELEGRAM_BOT_TOKEN: "t" });
}

test("handleProfileApi: unauthorized without a resolvable user", async () => {
  const db = newDb();
  const res = await call(handleProfileApi, db, null, "GET", "/api/profile");
  assert.equal(res.status, 401);
});

test("handleProfileApi: GET returns defaults for a fresh profile", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const res = await call(handleProfileApi, db, 1, "GET", "/api/profile");
  const body = (await res.json()) as { profile: { reminderHour: number; trainingWeekdays: unknown[]; share: unknown } };
  assert.equal(res.status, 200);
  assert.equal(body.profile.reminderHour, 9);
  assert.deepEqual(body.profile.trainingWeekdays, []);
  assert.equal(body.profile.share, null); // solo, not a client
});

test("handleProfileApi: POST accepts a valid patch and rejects out-of-enum values silently (field just not written)", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const res = await call(handleProfileApi, db, 1, "POST", "/api/profile", {
    name: "  Bohdan  ", goal: "muscle gain", level: "advanced", goal_typo: "nonsense",
    equipment: "not a real option", // invalid → ignored, not an error
    reminderHour: 20, waterGoalMl: 2350, trainingWeekdays: [3, 1, 1, 9, 5],
  });
  assert.equal(res.status, 200);
  const u = (await getUser(db, 1)) as UserDoc;
  assert.equal(u.profile.name, "Bohdan");
  assert.equal(u.profile.goal, "muscle gain");
  assert.equal(u.profile.level, "advanced");
  assert.equal(u.profile.equipment, undefined); // rejected silently, not stored
  assert.equal(u.profile.reminderHour, 20);
  assert.equal(u.profile.waterGoalMl, 2350); // rounds to nearest 50
  assert.deepEqual(u.profile.trainingWeekdays, [1, 3, 5]); // deduped + sorted, 9 dropped
  assert.equal(u.profile.daysPerWeek, 3);
});

test("handleProfileApi: quiet hours only apply when both bounds are valid together", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  await call(handleProfileApi, db, 1, "POST", "/api/profile", { quietFrom: 22, quietTo: 7 });
  let u = (await getUser(db, 1)) as UserDoc;
  assert.equal(u.profile.quietFrom, 22);
  assert.equal(u.profile.quietTo, 7);

  await call(handleProfileApi, db, 1, "POST", "/api/profile", { quietFrom: null, quietTo: null });
  u = (await getUser(db, 1)) as UserDoc;
  assert.equal(u.profile.quietFrom, undefined);
  assert.equal(u.profile.quietTo, undefined);
});

test("handleProfileApi: share consent is only writable for a client, never for a solo user", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann"); // role defaults to solo
  await call(handleProfileApi, db, 1, "POST", "/api/profile", { share: { body: true, health: true } });
  const solo = (await getUser(db, 1)) as UserDoc;
  assert.equal(solo.profile.shareWithTrainer, undefined);

  await updateUser(db, 1, { role: "client" });
  await call(handleProfileApi, db, 1, "POST", "/api/profile", { share: { body: true, health: false } });
  const client = (await getUser(db, 1)) as UserDoc;
  assert.deepEqual(client.profile.shareWithTrainer, { body: true, health: false });
});

test("handleProfileApi: malformed JSON body is a 400, not a crash", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const res = await handleProfileApi(
    new Request("https://x/api/profile?debugUser=1", { method: "POST", body: "{not json", headers: { "content-type": "application/json" } }),
    new URL("https://x/api/profile?debugUser=1"),
    { DB: db } as never,
  );
  assert.equal(res.status, 400);
});

// ---------------- onboarding-as-web-form ----------------

test("handleOnboardingApi: rejects an incomplete submission (missing required fields)", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const res = await call(handleOnboardingApi, db, 1, "POST", "/api/onboarding", { sex: "male", age: 30 });
  assert.equal(res.status, 400);
});

test("handleOnboardingApi: a complete submission parks the session for the plan-gen sweep", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const res = await call(handleOnboardingApi, db, 1, "POST", "/api/onboarding", {
    sex: "female", age: 28, heightCm: 165, weightKg: 60,
    goal: "fat loss", level: "beginner", equipment: "full gym",
    trainingWeekdays: [1, 3, 5],
  });
  assert.equal(res.status, 200);
  const u = (await getUser(db, 1)) as UserDoc;
  assert.equal(u.session.mode, "plan_pending");
  assert.equal(u.profile.sex, "female");
  assert.equal(u.profile.limitations, "none"); // defaulted when omitted
});

test("handleOnboardingApi: an already-onboarded user is refused", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  await updateUser(db, 1, { onboarded: true });
  const res = await call(handleOnboardingApi, db, 1, "POST", "/api/onboarding", {
    sex: "male", age: 30, goal: "strength", level: "beginner", equipment: "full gym", trainingWeekdays: [1],
  });
  assert.equal(res.status, 400);
});
