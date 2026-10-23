// The onboarding question set and its validation (src/domain/onboardingQuestions.ts and
// onboardingAnswers.ts), plus the routes that serve and submit it. One range per field: age 13-100
// everywhere (the Mini App and native wizards' range), so the profile PATCH and the onboarding
// submit no longer disagree.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser, getUser } from "../src/adapters/d1/v2Users";
import { handleOnboardingApi, handleProfileApi } from "../src/webapp/profileApi";
import { AGE_RANGE, QUESTIONS, basicQuestions, visibleQuestions } from "../src/domain/onboardingQuestions";
import { missingCoreFields, validateAnswers } from "../src/domain/onboardingAnswers";
import type { UserDoc } from "../src/types";

const ids = (qs: { id: string }[]) => qs.map((q) => q.id);

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
  return handler(req(method, full, body), new URL(`https://x${full}`), { DB: db, ALLOW_DEBUG_USER: "1", TELEGRAM_BOT_TOKEN: "t" });
}

const CORE = { sex: "male", age: 30, heightCm: 180, weightKg: 80, goal: "strength", level: "intermediate", equipment: "full gym", dietPrefs: "none", lifestyle: "active", sessionMinutes: 60, sleepSchedule: "evening", trainingWeekdays: [1, 3, 5], limitations: "none" };

test("question set: lifts only past beginner, sharing only for a trainer's client", () => {
  assert.ok(!ids(visibleQuestions({ level: "beginner" }, false)).includes("lifts"));
  assert.ok(ids(visibleQuestions({ level: "advanced" }, false)).includes("lifts"));
  assert.ok(!ids(visibleQuestions({}, false)).includes("lifts"));
  assert.ok(!ids(visibleQuestions({ level: "advanced" }, false)).includes("share"));
  assert.equal(ids(visibleQuestions({ level: "beginner" }, true)).at(-1), "share");
});

test("question set: the basics are sex, age, height and weight, in that order", () => {
  assert.deepEqual(ids(basicQuestions()), ["sex", "age", "height", "weight"]);
});

test("question set: one range per field, age 13-100", () => {
  assert.deepEqual(AGE_RANGE, { min: 13, max: 100 });
  const age = QUESTIONS.find((q) => q.id === "age")!;
  assert.deepEqual([age.number!.min, age.number!.max], [13, 100]);
});

test("validate (patch mode): invalid values are reported but the valid ones are kept", () => {
  const { patch, errors } = validateAnswers({ age: 120, goal: "nonsense", weightKg: 80.04, sessionMinutes: 60 }, { mode: "patch", isClient: false });
  assert.equal(patch.age, undefined);
  assert.equal(patch.goal, undefined);
  assert.equal(patch.weightKg, 80);
  assert.equal(patch.sessionMinutes, 60);
  assert.deepEqual(errors, { age: "out_of_range", goal: "invalid" });
});

test("validate (patch mode): limitations may be cleared, onboarding defaults them to 'none'", () => {
  assert.equal(validateAnswers({ limitations: "  " }, { mode: "patch", isClient: false }).patch.limitations, "");
  assert.equal(validateAnswers({ limitations: "  " }, { mode: "onboarding", isClient: false }).patch.limitations, "none");
});

test("validate (onboarding mode): beginners get baselineLifts 'none'; sleep and lifts are onboarding-only", () => {
  const { patch } = validateAnswers({ level: "beginner", sleepSchedule: "morning", baselineLifts: "bench 60kg" }, { mode: "onboarding", isClient: false });
  assert.equal(patch.baselineLifts, "bench 60kg");
  assert.equal(patch.sleepSchedule, "morning");
  assert.equal(validateAnswers({ level: "beginner" }, { mode: "onboarding", isClient: false }).patch.baselineLifts, "none");
  assert.equal(validateAnswers({ sleepSchedule: "morning" }, { mode: "patch", isClient: false }).patch.sleepSchedule, undefined);
});

test("validate: the device timezone is taken only when the profile has none, and an invalid one is an error", () => {
  assert.equal(validateAnswers({ timezone: "Europe/Kyiv" }, { mode: "onboarding", isClient: false }).patch.timezone, "Europe/Kyiv");
  assert.equal(validateAnswers({ timezone: "Europe/Kyiv" }, { mode: "onboarding", isClient: false, currentTimezone: "UTC" }).patch.timezone, undefined);
  assert.deepEqual(validateAnswers({ timezone: "Mars/Olympus" }, { mode: "onboarding", isClient: false }).errors, { timezone: "invalid" });
});

test("validate: sharing is stored for a client only", () => {
  const share = { share: { body: true, health: false } };
  assert.deepEqual(validateAnswers(share, { mode: "onboarding", isClient: true }).patch.shareWithTrainer, { body: true, health: false });
  assert.equal(validateAnswers(share, { mode: "onboarding", isClient: false }).patch.shareWithTrainer, undefined);
});

test("validate: trainingWeekdays are deduplicated, sorted and set daysPerWeek", () => {
  const { patch } = validateAnswers({ trainingWeekdays: [5, 1, 1, 9] }, { mode: "patch", isClient: false });
  assert.deepEqual(patch.trainingWeekdays, [1, 5]);
  assert.equal(patch.daysPerWeek, 2);
});

test("missingCoreFields lists what the plan generator needs", () => {
  assert.deepEqual(missingCoreFields({}), ["sex", "age", "goal", "level", "trainingWeekdays", "equipment"]);
  assert.deepEqual(missingCoreFields(CORE), []);
});

test("GET /onboarding/questions serves the question set; it needs a user", async () => {
  const db = newDb();
  assert.equal((await call(handleOnboardingApi, db, null, "GET", "/api/onboarding/questions")).status, 401);
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const res = await call(handleOnboardingApi, db, 1, "GET", "/api/onboarding/questions");
  assert.equal(res.status, 200);
  const body = (await res.json()) as { questions: { id: string; showWhen: string; number?: { min: number; max: number } }[] };
  assert.deepEqual(ids(body.questions), QUESTIONS.map((q) => q.id));
  assert.deepEqual(body.questions.find((q) => q.id === "age")!.number, { ...AGE_RANGE, step: 1, unit: "obu_years", placeholder: "30" });
  assert.equal(body.questions.find((q) => q.id === "share")!.showWhen, "trainerClient");
});

test("POST /onboarding: an out-of-range required answer is incomplete, and the response names the field", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const res = await call(handleOnboardingApi, db, 1, "POST", "/api/onboarding", { ...CORE, age: 120 });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string; fields: Record<string, string> };
  assert.equal(body.error, "incomplete");
  assert.deepEqual(body.fields, { age: "out_of_range" });
  assert.notEqual(((await getUser(db, 1)) as UserDoc).session.mode, "plan_pending");
});

test("POST /onboarding: a complete submission is accepted", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const res = await call(handleOnboardingApi, db, 1, "POST", "/api/onboarding", { ...CORE, timezone: "Europe/Kyiv" });
  assert.equal(res.status, 200);
  const u = (await getUser(db, 1)) as UserDoc;
  assert.equal(u.session.mode, "plan_pending");
  assert.equal(u.profile.timezone, "Europe/Kyiv");
});

test("PATCH /profile: age 101-120 is no longer accepted (same range as onboarding)", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const res = await call(handleProfileApi, db, 1, "POST", "/api/profile", { age: 110 });
  assert.equal(res.status, 200);
  assert.equal(((await getUser(db, 1)) as UserDoc).profile.age, undefined);
});
