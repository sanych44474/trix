import { test } from "node:test";
import assert from "node:assert/strict";
import { choose, firstOpenStep, isAnswered, parseDraft, stepsFor, toRequest, type Answers } from "../apps/mini-app/src/logic/onboardingWizard";
import { en } from "../apps/mini-app/src/i18n/en";

const full: Answers = {
  sex: "female", age: 27, heightCm: 168, weightKg: 58.4, goal: "recomposition", level: "beginner",
  trainingWeekdays: [5, 1, 3], sessionMinutes: 60, equipment: "full gym", lifestyle: "moderate",
  sleepSchedule: "morning", dietPrefs: "none", limitations: "none",
};

test("onboarding steps: one question each, lifts only past beginner, sharing only for a trainer's client", () => {
  const ids = (a: Answers, client: boolean) => stepsFor(a, client).map((s) => s.id);
  assert.deepEqual(ids({}, false), ["sex", "age", "height", "weight", "goal", "level", "days", "duration", "equipment", "lifestyle", "sleep", "diet", "limits"]);
  assert.ok(ids({ level: "intermediate" }, false).includes("lifts"));
  assert.ok(!ids({ level: "beginner" }, false).includes("lifts"));
  assert.equal(ids({}, true).at(-1), "share");
});

test("onboarding steps: every label and question key exists in the catalog", () => {
  const keys = new Set(Object.keys(en));
  for (const step of stepsFor({ level: "advanced" }, true)) {
    assert.ok(keys.has(step.q), step.q);
    if (step.hint) assert.ok(keys.has(step.hint), step.hint);
    if (step.number) assert.ok(keys.has(step.number.unit), step.number.unit);
    for (const o of step.options ?? []) assert.ok(keys.has(o.label), o.label);
  }
});

test("numbers must be inside the range the API accepts", () => {
  const age = stepsFor({}, false).find((s) => s.id === "age")!;
  assert.equal(isAnswered(age, { age: 12 }), false);
  assert.equal(isAnswered(age, { age: 30 }), true);
  assert.equal(isAnswered(age, { age: Number.NaN }), false);
  const weight = stepsFor({}, false).find((s) => s.id === "weight")!;
  assert.equal(isAnswered(weight, { weightKg: 301 }), false);
});

test("switching to beginner drops lifts typed earlier", () => {
  const level = stepsFor({}, false).find((s) => s.id === "level")!;
  const a = choose(level, { level: "advanced", lifts: { bench: 100 } }, "beginner");
  assert.equal(a.lifts, undefined);
});

test("a draft resumes at the first unanswered question", () => {
  assert.equal(firstOpenStep({}, false), 0);
  assert.equal(firstOpenStep({ sex: "male", age: 30 }, false), 2);
  assert.equal(firstOpenStep(full, true), stepsFor(full, true).length - 1); // only the sharing question left
});

test("request: null until complete; sorted days, rounded numbers, 'none' lifts for beginners", () => {
  assert.equal(toRequest({ ...full, sessionMinutes: undefined }, false), null);
  const body = toRequest(full, false, "Europe/Kyiv")!;
  assert.deepEqual(body.trainingWeekdays, [1, 3, 5]);
  assert.equal(body.weightKg, 58.4);
  assert.equal(body.baselineLifts, "none");
  assert.equal(body.timezone, "Europe/Kyiv");
  assert.equal("share" in body, false);
});

test("request: lifts become text, and a client's sharing choice maps to body/health flags", () => {
  const body = toRequest({ ...full, level: "intermediate", lifts: { bench: 60, deadlift: 100 }, share: "body" }, true)!;
  assert.equal(body.baselineLifts, "bench 60kg, deadlift 100kg");
  assert.deepEqual(body.share, { body: true, health: false });
  assert.deepEqual(toRequest({ ...full, share: "both" }, true)!.share, { body: true, health: true });
  assert.deepEqual(toRequest({ ...full, share: "none" }, true)!.share, { body: false, health: false });
  assert.equal(toRequest(full, true), null); // the sharing question is required for a client
});

test("a malformed draft is ignored", () => {
  assert.deepEqual(parseDraft("{oops"), {});
  assert.deepEqual(parseDraft("[1,2]"), {});
  assert.deepEqual(parseDraft(null), {});
  assert.deepEqual(parseDraft('{"sex":"male"}'), { sex: "male" });
});
