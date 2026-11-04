// The trainer's side of the two client -> trainer loops: a routed question and the "finished a
// workout" ping. Both used to carry one number of context, so every reply began with the trainer
// opening the client card. They now carry the client snapshot (domain/clientSnapshot.ts): the
// week against the plan, the last workouts with best sets, and the quests the client finished.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser, getUser, updateUser } from "../src/adapters/d1/v2Users";
import { linkClient } from "../src/adapters/d1/v2Trainer";
import { setActivePlan } from "../src/adapters/d1/v2Plans";
import { upsertWorkoutLog } from "../src/adapters/d1/v2Workouts";
import { rawTelegramApi } from "../src/adapters/telegram/rawApi";
import { completeWorkout } from "../src/features/workout/completeWorkout";
import { loadClientSnapshot, snapshotBlock } from "../src/features/trainer/clientSnapshot";
import { handleV2Api } from "../src/webapp/v2Api";
import { localParts } from "../src/domain/localTime";
import type { Env, PlanDoc, UserDoc, Weekday } from "../src/types";

const TRAINER = 8101;
const CLIENT = 8102;
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Telegram sends are captured; every other outbound call (the AI draft) fails, as offline. */
function stubNetwork() {
  const real = globalThis.fetch;
  const sent: Array<{ chat_id: number; text: string; reply_markup?: unknown }> = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (String(url).includes("/sendMessage")) {
      sent.push(JSON.parse(String(init?.body)));
      return json(200, { ok: true, result: { message_id: 1 } });
    }
    throw new Error("no network in tests");
  }) as typeof fetch;
  return { sent, restore: () => { globalThis.fetch = real; } };
}

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekdayOf = (date: string) => (((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1) as Weekday;

function plan(userId: number, weekday: Weekday): PlanDoc {
  return {
    userId,
    active: true,
    status: "active",
    split: [{
      weekday,
      muscleGroup: "Груди/Трицепс",
      exercises: [
        { name: "Bench Press", sets: "3 × 8", startWeight: "80 kg", technique: "", metric: "reps" },
        { name: "Dips", sets: "3 × 12", startWeight: "—", technique: "", metric: "reps" },
        { name: "Cable Fly", sets: "3 × 15", startWeight: "20 kg", technique: "", metric: "reps" },
      ],
    }],
    nutrition: { calories: 2200, protein: 160, fats: 70, carbs: 220 },
    supplements: [],
    methodology: "",
    generatedAt: new Date("2026-01-01T00:00:00.000Z"),
    schemaVersion: 1,
  } as unknown as PlanDoc;
}

/** A trainer and their client (UTC), the client's plan trains today's weekday. */
async function seed(lang: "en" | "uk" = "uk") {
  const db = newDb();
  const today = localParts("UTC").date;
  await getOrCreateUser(db, TRAINER, TRAINER, lang, "Coach");
  await getOrCreateUser(db, CLIENT, CLIENT, lang, "Віктор");
  await updateUser(db, TRAINER, { role: "trainer" });
  await linkClient(db, CLIENT, TRAINER);
  const client = (await getUser(db, CLIENT)) as UserDoc;
  await updateUser(db, CLIENT, { role: "client", trainerId: TRAINER, profile: { ...client.profile, timezone: "UTC", trainingWeekdays: [weekdayOf(today)] } });
  await setActivePlan(db, plan(CLIENT, weekdayOf(today)));
  return { db, today };
}

test("snapshot loader: the client's week, quests and last workout come from their own rows", async () => {
  const { db, today } = await seed();
  await upsertWorkoutLog(db, CLIENT, today, weekdayOf(today), [
    { name: "Bench Press", setsDone: [{ weight: 80, reps: 8 }, { weight: 82.5, reps: 6 }], skipped: false, rpe: 8 },
    { name: "Dips", setsDone: [{ weight: 0, reps: 12 }], skipped: false },
  ], true, undefined, { durationSec: 3000 });
  const s = await loadClientSnapshot(db, (await getUser(db, CLIENT)) as UserDoc);
  assert.equal(s.weekDone, 1);
  assert.equal(s.weekPlanned, 1);
  assert.equal(s.recent[0].label, "Груди/Трицепс");
  assert.equal(s.recent[0].planned, 3);
  assert.ok(s.quests.length > 0, "the week's quests are evaluated");
  const block = snapshotBlock("uk", s);
  assert.match(block, /Цей тиждень: 1\/1 тренувань/);
  assert.match(block, /Груди\/Трицепс — 2\/3 впр\., 50 хв, RPE 8 · Bench Press 82\.5x6, Dips BWx12/);
});

test("finished workout: the trainer's ping names the day, what was done and the week, with a reply button to the client", async () => {
  const { db, today } = await seed();
  const e = { DB: db, TELEGRAM_BOT_TOKEN: "1:t", WORKER_URL: "https://w.example" } as unknown as Env;
  const net = stubNetwork();
  try {
    await completeWorkout(e, (await getUser(db, CLIENT)) as UserDoc, [
      { name: "Bench Press", sets: [{ weight: 80, reps: 8 }] },
      { name: "Dips", sets: [{ weight: 0, reps: 12 }] },
    ], { date: today, weekday: weekdayOf(today), rawText: "bench, dips", api: rawTelegramApi(e) });
  } finally { net.restore(); }
  const ping = net.sent.find((m) => m.chat_id === TRAINER);
  assert.ok(ping, "the trainer got a message");
  assert.match(ping.text, /<b>Віктор<\/b> завершив тренування/);
  assert.match(ping.text, /Груди\/Трицепс — 2\/3 впр\. · Bench Press 80x8, Dips BWx12/);
  assert.match(ping.text, /Цей тиждень: 1\/1 тренувань/);
  const button = JSON.stringify(ping.reply_markup);
  assert.match(button, /client=8102/, "the button opens this client's card in the trainer workspace");
});

test("routed question: the trainer's message carries the client's context, and the inbox returns it", async () => {
  const { db, today } = await seed("en");
  await upsertWorkoutLog(db, CLIENT, addDays(today, 0), weekdayOf(today), [
    { name: "Bench Press", setsDone: [{ weight: 80, reps: 8 }], skipped: false },
  ], true);
  // No WORKER_URL: the ?debugUser= bypass is live for the HTTP entry point.
  const e = { DB: db, ALLOW_DEBUG_USER: "1", TELEGRAM_BOT_TOKEN: "1:t" } as unknown as Env;
  const net = stubNetwork();
  try {
    const ask = new Request(`https://example.test/api/v2/coach/ask?debugUser=${CLIENT}`, {
      method: "POST",
      headers: { "Idempotency-Key": "trainer-context-0001" },
      body: JSON.stringify({ question: "Should I add weight on bench?" }),
    });
    const res = await handleV2Api(ask, new URL(ask.url), e, ctx);
    assert.equal(res.status, 200);
  } finally { net.restore(); }
  const msg = net.sent.find((m) => m.chat_id === TRAINER);
  assert.ok(msg, "the trainer got the question");
  assert.match(msg.text, /Should I add weight on bench\?/);
  assert.match(msg.text, /This week: 1\/1 workouts/);
  assert.match(msg.text, /Груди\/Трицепс — 1\/3 ex\. · Bench Press 80x8/);

  const inbox = new Request(`https://example.test/api/v2/trainer/questions?debugUser=${TRAINER}`);
  const listed = await handleV2Api(inbox, new URL(inbox.url), e, ctx);
  assert.equal(listed.status, 200);
  const body = await listed.json() as { data: { questions: Array<{ status: string; context?: { weekDone: number; weekPlanned: number; recent: Array<{ label: string | null; top: string[] }> } }> } };
  const q = body.data.questions[0];
  assert.equal(q.status, "pending");
  assert.equal(q.context?.weekDone, 1);
  assert.equal(q.context?.weekPlanned, 1);
  assert.equal(q.context?.recent[0].label, "Груди/Трицепс");
  assert.deepEqual(q.context?.recent[0].top, ["Bench Press 80x8"]);
});
