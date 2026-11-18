// The Monday progression job (src/schedulerJobs/weeklyProgression.ts): what it saves, who it tells, and
// when it stays quiet. The maths is pure (domain/progression.ts); this runs the job against a real
// plan in the test database with a recording sender, the same shape processUser gives it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser, getUser, updateUser } from "../src/adapters/d1/v2Users";
import { getActivePlan, getDraftPlan, setActivePlan } from "../src/adapters/d1/v2Plans";
import { countAdjustmentWeeksSince, recentAdjustments, recordAdjustment } from "../src/adapters/d1/v2PlanHistory";
import { recordDailyCheckin } from "../src/adapters/d1/v2Tracking";
import { weeklyProgression } from "../src/schedulerJobs/weeklyProgression";
import { isoDaysAgo } from "../src/schedulerJobs/shared";
import type { BodyLogDoc, PlanDoc, UserDoc, WorkoutLogDoc } from "../src/types";

const DATE = "2026-06-15"; // a Monday

const benchPlan = (userId: number): PlanDoc => ({
  userId, active: true, status: "active",
  split: [{
    weekday: 1, muscleGroup: "Push", sessionType: "strength", durationMin: 45, warmUp: ["5 min bike"], coolDown: ["stretch"],
    exercises: [{ name: "Bench Press", sets: "3 × 8–12", startWeight: "60 kg", technique: "controlled", metric: "reps", isKeyLift: true, rpe: "8", movementPattern: "push" }],
  }],
  nutrition: { calories: 2200, protein: 160, fats: 70, carbs: 220 },
  supplements: [], methodology: "Linear progression", generatedAt: new Date("2026-05-01T00:00:00.000Z"), schemaVersion: 1,
}) as unknown as PlanDoc;

const session = (date: string, rpe: number): WorkoutLogDoc => ({
  userId: 1, date, weekday: 1, completed: true, createdAt: new Date(0),
  exercises: [{ name: "Bench Press", skipped: false, rpe, setsDone: [{ reps: 12, weight: 60 }, { reps: 12, weight: 60 }, { reps: 12, weight: 60 }] }],
});
const EASY = [session("2026-06-08", 7), session("2026-06-10", 7)]; // both at the top of the range, easy: a double step

async function setup(role: "solo" | "client" = "solo", profile: Partial<UserDoc["profile"]> = {}) {
  const db = newDb();
  await getOrCreateUser(db, 4, 4, "en", "Coach");
  await getOrCreateUser(db, 3, 3, "en", "Client");
  const base = (await getUser(db, 3)) as UserDoc;
  await updateUser(db, 3, { profile: { ...base.profile, ...profile }, ...(role === "client" ? { trainerId: 4, role: "client" } : {}) });
  const user = (await getUser(db, 3)) as UserDoc;
  const plan = benchPlan(3);
  await setActivePlan(db, plan);
  const out = { texts: [] as string[], trainerTexts: [] as Array<{ to: number; kind: string; text: string }>, offers: [] as string[], marked: [] as string[] };
  const sent: Record<string, string> = {};
  const run = (opts: { logs?: WorkoutLogDoc[]; body?: BodyLogDoc[] } = {}) =>
    weeklyProgression({
      db, user, lang: "en", date: DATE, activePlan: plan,
      workouts21: async () => opts.logs ?? EASY,
      send: async (text: string) => { out.texts.push(text); return "sent"; },
      sendTo: async (target: { _id: number }, kind: string, text: string) => { out.trainerTexts.push({ to: target._id, kind, text }); return "sent"; },
      markSent: (k: string) => out.marked.push(k),
      sent,
      sendAndMark: async (key: string) => { out.offers.push(key); },
      bodyAll: async () => opts.body ?? [],
      appKb: () => undefined,
    } as never);
  return { db, user, plan, sent, run, ...out };
}

test("a solo plan is raised: saved, the person told with each change, the week recorded", async () => {
  const s = await setup();
  await s.run();
  assert.deepEqual(s.marked, ["progression"]);
  assert.equal((await getActivePlan(s.db, 3))?.split[0].exercises[0].startWeight, "65 kg", "an easy week doubles the 2.5 kg step");
  assert.equal(s.texts.length, 1);
  assert.match(s.texts[0], /Plan auto-updated/);
  assert.match(s.texts[0], /Bench Press: 60 kg → 65 kg/);
  assert.equal(s.trainerTexts.length, 0, "a solo person has no trainer to tell");
  assert.equal((await recentAdjustments(s.db, 3, 5)).length, 1);
});

test("a trainer's client is not changed: the change waits as a draft and the trainer is told", async () => {
  const s = await setup("client");
  await s.run();
  assert.equal((await getActivePlan(s.db, 3))?.split[0].exercises[0].startWeight, "60 kg", "the active plan is untouched");
  const draft = await getDraftPlan(s.db, 3);
  assert.equal(draft?.split[0].exercises[0].startWeight, "65 kg");
  assert.equal(draft?.authoredBy, 4, "the draft is the trainer's to review");
  assert.equal(s.texts.length, 0, "the client is not messaged");
  assert.equal(s.trainerTexts.length, 1);
  assert.deepEqual([s.trainerTexts[0].to, s.trainerTexts[0].kind], [4, "progression_trainer"]);
  assert.match(s.trainerTexts[0].text, /Client/);
  assert.match(s.trainerTexts[0].text, /Bench Press: 60 kg → 65 kg/);
  assert.equal((await recentAdjustments(s.db, 3, 5)).length, 1);
});

test("one session is not enough to change anything, and nothing is said", async () => {
  const s = await setup();
  await s.run({ logs: [session("2026-06-10", 7)] });
  assert.equal((await getActivePlan(s.db, 3))?.split[0].exercises[0].startWeight, "60 kg");
  assert.equal(s.texts.length, 0);
  assert.equal(s.trainerTexts.length, 0);
  assert.equal((await recentAdjustments(s.db, 3, 5)).length, 0);
  assert.deepEqual(s.marked, ["progression"], "the check still counts for today");
});

test("poor wellbeing holds every increase, and the person is told why instead of getting silence", async () => {
  const s = await setup();
  await recordDailyCheckin(s.db, 3, isoDaysAgo(1), 1, 4, 2); // energy 1 of 5
  await s.run();
  assert.equal((await getActivePlan(s.db, 3))?.split[0].exercises[0].startWeight, "60 kg");
  assert.equal(s.texts.length, 1);
  assert.doesNotMatch(s.texts[0], /Plan auto-updated/);
  const reason = (await recentAdjustments(s.db, 3, 5))[0];
  assert.ok(JSON.stringify(reason).includes("reason"), "the hold is recorded with its reason");
  const quietClient = await setup("client");
  await recordDailyCheckin(quietClient.db, 3, isoDaysAgo(1), 1, 4, 2);
  await quietClient.run();
  assert.equal(quietClient.texts.length + quietClient.trainerTexts.length, 0, "a client is not told about a hold");
});

test("level-up offer: fast pace and four weeks of progress, once a month, solo only", async () => {
  // One session in the logs: this run changes nothing, so it adds no week of its own to the count.
  const ONE = [session("2026-06-10", 7)];
  const s = await setup();
  for (const week of [1, 2, 3, 4]) await recordAdjustment(s.db, 3, week, "[]");
  assert.equal(await countAdjustmentWeeksSince(s.db, 3, isoDaysAgo(42)), 4);
  await s.run({ logs: ONE });
  assert.ok(s.offers.includes("levelup"), "offered");

  const three = await setup();
  for (const week of [1, 2, 3]) await recordAdjustment(three.db, 3, week, "[]");
  await three.run({ logs: ONE });
  assert.ok(!three.offers.includes("levelup"), "three weeks is not enough");

  const recent = await setup();
  for (const week of [1, 2, 3, 4]) await recordAdjustment(recent.db, 3, week, "[]");
  recent.sent.levelup = "2026-05-17"; // 29 days before DATE
  await recent.run({ logs: ONE });
  assert.ok(!recent.offers.includes("levelup"), "offered 29 days ago: too soon");
  recent.sent.levelup = "2026-05-16"; // 30 days
  await recent.run({ logs: ONE });
  assert.ok(recent.offers.includes("levelup"), "30 days is the edge");

  const client = await setup("client");
  for (const week of [1, 2, 3, 4]) await recordAdjustment(client.db, 3, week, "[]");
  await client.run({ logs: ONE });
  assert.ok(!client.offers.includes("levelup"), "a trainer's client is not offered a level");
});

test("goal-reached offer: a finished cut that has levelled off, once a month, solo only", async () => {
  const plateau = [["2026-05-01", 90], ["2026-05-15", 88.5], ["2026-05-22", 88.2], ["2026-05-29", 88]].map(([date, weight]) => ({ date, weight })) as unknown as BodyLogDoc[];
  const s = await setup("solo", { goal: "fat loss" });
  await s.run({ body: plateau });
  assert.ok(s.offers.includes("goalreached"));

  const wrongGoal = await setup("solo", { goal: "muscle gain" });
  await wrongGoal.run({ body: plateau });
  assert.ok(!wrongGoal.offers.includes("goalreached"), "a gain goal is not met by losing weight");

  const soon = await setup("solo", { goal: "fat loss" });
  soon.sent.goalreached = "2026-05-17";
  await soon.run({ body: plateau });
  assert.ok(!soon.offers.includes("goalreached"), "29 days ago");
  soon.sent.goalreached = "2026-05-16";
  await soon.run({ body: plateau });
  assert.ok(soon.offers.includes("goalreached"), "30 days");

  const client = await setup("client", { goal: "fat loss" });
  await client.run({ body: plateau });
  assert.ok(!client.offers.includes("goalreached"));
});
