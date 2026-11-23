// A trainer logging a client's workout and turning a voice command into a proposal (ADR-0018,
// src/webapp/trainerLogApi.ts). Driven through handleV2Api, the seam both apps call, so the route
// table, auth, idempotency and the response envelope are the production ones.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser, updateUser } from "../src/adapters/d1/v2Users";
import { setActivePlan } from "../src/adapters/d1/v2Plans";
import { getWorkoutLog, putWorkoutDraft } from "../src/adapters/d1/v2Workouts";
import { localParts } from "../src/domain/localTime";
import { handleV2Api } from "../src/webapp/v2Api";
import type { Env, PlanDoc } from "../src/types";

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
type Db = ReturnType<typeof newDb>;
type Run = (model: string, input: unknown) => Promise<unknown>;

const TRAINER = 10;
const CLIENT = 20;
const OTHER_TRAINER = 11;
const OTHERS_CLIENT = 21;
const SOLO = 30;

interface Data {
  exercises?: Array<{ name: string }>;
  draft?: unknown;
  client?: unknown;
  saved?: Array<{ name: string }>;
  savedAt?: string;
  savedByTrainer?: boolean;
  prExercises?: string[];
  totalWorkouts?: number;
  kind?: string;
  reply?: string;
  entries?: Array<{ name: string; sets: unknown[] }>;
  actions?: Array<{ kind: string; target?: string }>;
  version?: string;
}

let keySeq = 0;
async function call(db: Db, userId: number | null, method: string, path: string, body?: unknown, opts: { run?: Run; key?: string } = {}) {
  const sep = path.includes("?") ? "&" : "?";
  const full = `https://x${path}${userId ? `${sep}debugUser=${userId}` : ""}`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (method === "POST") headers["Idempotency-Key"] = opts.key ?? `trainer-log-${++keySeq}-${Date.now()}`;
  const req = new Request(full, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const env = { DB: db, ALLOW_DEBUG_USER: "1", TELEGRAM_BOT_TOKEN: "t", ...(opts.run ? { AI: { run: opts.run } } : {}) } as unknown as Env;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 })) as typeof fetch;
  try {
    const res = await handleV2Api(req, new URL(full), env, ctx);
    const json = (await res.json()) as { data?: Record<string, unknown>; error?: { code?: string; message?: string } };
    return { status: res.status, data: (json.data ?? {}) as Data, error: json.error };
  } finally {
    globalThis.fetch = realFetch;
  }
}

const benchPlan = (userId: number): PlanDoc => ({
  userId, active: true, status: "active",
  split: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
    weekday, muscleGroup: "Full", sessionType: "strength", durationMin: 45, warmUp: [], coolDown: [],
    exercises: [
      { name: "Bench Press", sets: "3 × 8–12", startWeight: "60 kg", technique: "", metric: "reps" },
      { name: "Barbell Squat", sets: "3 × 5", startWeight: "80 kg", technique: "", metric: "reps" },
    ],
  })),
  nutrition: { calories: 2200, protein: 160, fats: 70, carbs: 220 },
  supplements: [], methodology: "", generatedAt: new Date("2026-05-01T00:00:00.000Z"), schemaVersion: 1,
}) as unknown as PlanDoc;

async function setup(opts: { clientTz?: string } = {}) {
  const db = newDb();
  for (const [id, name] of [[TRAINER, "Coach Ann"], [OTHER_TRAINER, "Coach Bob"]] as const) {
    await getOrCreateUser(db, id, id, "en", name);
    await updateUser(db, id, { role: "trainer", profile: { name } });
  }
  for (const [id, trainerId] of [[CLIENT, TRAINER], [OTHERS_CLIENT, OTHER_TRAINER]] as const) {
    await getOrCreateUser(db, id, id, "en", "Cli");
    await updateUser(db, id, { role: "client", trainerId, onboarded: true, profile: { name: "Cli", ...(opts.clientTz ? { timezone: opts.clientTz } : {}) } });
  }
  await getOrCreateUser(db, SOLO, SOLO, "en", "Solo");
  await setActivePlan(db, benchPlan(CLIENT));
  return db;
}

const today = (tz?: string) => localParts(tz).date;
const daysAgo = (n: number, tz?: string) => new Date(Date.parse(`${today(tz)}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
const ENTRIES = [{ name: "Bench Press", sets: [{ weight: 80, reps: 6 }, { weight: 80, reps: 5 }] }];

async function outboxKinds(db: Db, userId: number): Promise<string[]> {
  const r = await db.prepare("SELECT kind FROM v2_notifications WHERE accountId = ? ORDER BY id").bind(userId).all<{ kind: string }>();
  return (r.results ?? []).map((x) => x.kind);
}

test("only the client's own trainer gets in: 401 signed out, 403 not a trainer, 404 not their client", async () => {
  const db = await setup();
  const routes: Array<[string, string, unknown?]> = [
    ["GET", `/api/v2/trainer/log?clientId=${CLIENT}`],
    ["POST", "/api/v2/trainer/log", { clientId: CLIENT, entries: ENTRIES, baseSavedAt: null }],
    ["POST", "/api/v2/trainer/voice", { clientId: CLIENT, text: "Bench 80x6" }],
  ];
  for (const [method, path, body] of routes) {
    assert.equal((await call(db, null, method, path, body)).status, 401, `${method} ${path} signed out`);
    assert.equal((await call(db, SOLO, method, path, body)).status, 403, `${method} ${path} solo`);
    assert.equal((await call(db, CLIENT, method, path, body)).status, 403, `${method} ${path} the client themselves`);
    assert.equal((await call(db, OTHER_TRAINER, method, path, body)).status, 404, `${method} ${path} another trainer`);
  }
  const notMine = await call(db, TRAINER, "GET", `/api/v2/trainer/log?clientId=${OTHERS_CLIENT}`);
  assert.equal(notMine.status, 404, "another trainer's client");
  const solo = await call(db, TRAINER, "GET", `/api/v2/trainer/log?clientId=${SOLO}`);
  assert.equal(solo.status, 404, "an unrelated solo user");
  assert.equal((await getWorkoutLog(db, CLIENT, today())), null, "nothing was written by the refused calls");
});

test("GET: the client's plan day to prefill, never the client's own unsaved draft", async () => {
  const db = await setup();
  await putWorkoutDraft(db, CLIENT, today(), JSON.stringify({ secret: "half-done" }));
  const r = await call(db, TRAINER, "GET", `/api/v2/trainer/log?clientId=${CLIENT}`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.exercises?.map((e) => e.name), ["Bench Press", "Barbell Squat"]);
  assert.equal(r.data.draft, undefined, "the draft is the client's");
  assert.deepEqual(r.data.client, { id: CLIENT, name: "Cli", today: today() });
  assert.equal(r.data.savedAt, undefined, "nothing logged yet");
});

test("POST: the workout counts as the client's, is marked as the trainer's, and only the client is told", async () => {
  const db = await setup();
  // An earlier, lighter bench by the client, so 80 kg is a new record.
  assert.equal((await call(db, CLIENT, "POST", "/api/v2/workout/save", { date: daysAgo(3), entries: [{ name: "Bench Press", sets: [{ weight: 70, reps: 6 }] }] })).status, 200);
  await putWorkoutDraft(db, CLIENT, today(), "{}");
  const r = await call(db, TRAINER, "POST", "/api/v2/trainer/log", { clientId: CLIENT, entries: ENTRIES, baseSavedAt: null });
  assert.equal(r.status, 200, JSON.stringify(r.error));
  assert.deepEqual(r.data.prExercises, ["Bench Press"], "heavier than the client's best");
  assert.equal(r.data.totalWorkouts, 2);
  assert.ok(typeof r.data.savedAt === "string");

  const log = await getWorkoutLog(db, CLIENT, today());
  assert.equal(log?.loggedBy, TRAINER);
  assert.deepEqual(log?.exercises[0].setsDone.map((s) => [s.weight, s.reps]), [[80, 6], [80, 5]]);
  const rec = await db.prepare("SELECT COUNT(*) AS n FROM v2_strength_records WHERE accountId = ?").bind(CLIENT).first<{ n: number }>();
  assert.equal(rec?.n, 1, "the record is the client's, one per exercise");
  assert.equal(typeof (r.data as { level?: unknown }).level, "number", "the level is the client's (XP is computed from their workouts)");
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM v2_workout_drafts WHERE accountId = ?").bind(CLIENT).first<{ n: number }>())?.n, 1, "the client's draft is left alone");

  assert.deepEqual(await outboxKinds(db, CLIENT), ["trainer_logged_workout"]);
  assert.deepEqual(await outboxKinds(db, TRAINER), [], "no 'your client trained' message about the trainer's own log");
  const text = await db.prepare("SELECT payload FROM v2_notifications WHERE accountId = ?").bind(CLIENT).first<{ payload: string }>();
  assert.match(text?.payload ?? "", /Coach Ann/);
  assert.match(text?.payload ?? "", /New record: Bench Press/);
  const audit = await db.prepare("SELECT actorId, targetId, kind FROM v2_audit_events WHERE kind = 'log_workout'").first<{ actorId: number; targetId: number }>();
  assert.deepEqual([audit?.actorId, audit?.targetId], [TRAINER, CLIENT]);

  const hist = await call(db, CLIENT, "GET", "/api/v2/workout/today");
  assert.equal(hist.data.savedByTrainer, true, "the client sees who logged it");
});

test("same day: a stale form is refused, a current one replaces the day, and the client's re-save clears the mark", async () => {
  const db = await setup();
  const own = await call(db, CLIENT, "POST", "/api/v2/workout/save", { entries: [{ name: "Barbell Squat", sets: [{ weight: 100, reps: 5 }] }] });
  assert.equal(own.status, 200);
  const blind = await call(db, TRAINER, "POST", "/api/v2/trainer/log", { clientId: CLIENT, entries: ENTRIES, baseSavedAt: null });
  assert.equal(blind.status, 409, "the trainer's form did not include the client's squat");
  assert.equal(blind.error?.code, "conflict");
  assert.equal((await getWorkoutLog(db, CLIENT, today()))?.exercises[0].name, "Barbell Squat", "nothing was lost");

  const day = await call(db, TRAINER, "GET", `/api/v2/trainer/log?clientId=${CLIENT}`);
  assert.equal(day.data.saved?.[0]?.name, "Barbell Squat", "the form starts from what the client logged");
  const ok = await call(db, TRAINER, "POST", "/api/v2/trainer/log", {
    clientId: CLIENT, baseSavedAt: day.data.savedAt,
    entries: [{ name: "Barbell Squat", sets: [{ weight: 100, reps: 5 }] }, ...ENTRIES],
  });
  assert.equal(ok.status, 200);
  const log = await getWorkoutLog(db, CLIENT, today());
  assert.deepEqual(log?.exercises.map((e) => e.name), ["Barbell Squat", "Bench Press"]);
  assert.equal(log?.loggedBy, TRAINER);

  const again = await call(db, CLIENT, "POST", "/api/v2/workout/save", { entries: [{ name: "Barbell Squat", sets: [{ weight: 105, reps: 5 }] }] });
  assert.equal(again.status, 200);
  assert.equal((await getWorkoutLog(db, CLIENT, today()))?.loggedBy, undefined, "the last writer owns the day");
});

test("dates follow the client's calendar: today back to 14 days, nothing in the future", async () => {
  const db = await setup();
  const at = (date: string) => call(db, TRAINER, "POST", "/api/v2/trainer/log", { clientId: CLIENT, date, entries: ENTRIES, baseSavedAt: null });
  assert.equal((await at(daysAgo(14))).status, 200, "14 days back");
  const old = await at(daysAgo(15));
  assert.equal(old.status, 400);
  assert.equal(old.error?.message, "too old");
  assert.equal((await at(daysAgo(-1))).error?.message, "future date");
  assert.equal((await at("2026-02-30")).error?.message, "bad date");
  // A past day: the client is told (the text names the day), and the trainer still is not.
  assert.deepEqual(await outboxKinds(db, TRAINER), []);

  // Kiritimati is a day ahead of Pago Pago, always: the client's "today" is the trainer's tomorrow.
  const east = await setup({ clientTz: "Pacific/Kiritimati" });
  const eastToday = today("Pacific/Kiritimati");
  const ahead = await call(east, TRAINER, "POST", "/api/v2/trainer/log", { clientId: CLIENT, date: eastToday, entries: ENTRIES, baseSavedAt: null });
  assert.equal(ahead.status, 200, "the client's today is allowed");
  const west = await setup({ clientTz: "Pacific/Pago_Pago" });
  const tooSoon = await call(west, TRAINER, "POST", "/api/v2/trainer/log", { clientId: CLIENT, date: eastToday, entries: ENTRIES, baseSavedAt: null });
  assert.equal(tooSoon.error?.message, "future date", "a day that has not started for the client");
});

test("POST validation: empty, oversized and malformed entries are refused", async () => {
  const db = await setup();
  const post = (entries: unknown) => call(db, TRAINER, "POST", "/api/v2/trainer/log", { clientId: CLIENT, entries, baseSavedAt: null });
  assert.equal((await post([])).status, 400);
  assert.equal((await post(Array.from({ length: 31 }, (_, i) => ({ name: `E${i}`, sets: [{ weight: 1, reps: 1 }] })))).status, 400);
  assert.equal((await post([{ name: "Bench", sets: [{ weight: -5, reps: 5 }] }])).status, 400);
  assert.equal((await post([{ name: "Bench", sets: [{ weight: 50, reps: 0 }] }])).status, 400, "only untouched rows: nothing to save");
  assert.equal(await getWorkoutLog(db, CLIENT, today()), null);
});

test("a retried save with the same Idempotency-Key logs, notifies and audits once", async () => {
  const db = await setup();
  const body = { clientId: CLIENT, entries: ENTRIES, baseSavedAt: null };
  const a = await call(db, TRAINER, "POST", "/api/v2/trainer/log", body, { key: "trainer-log-retry-0001" });
  const b = await call(db, TRAINER, "POST", "/api/v2/trainer/log", body, { key: "trainer-log-retry-0001" });
  assert.equal(a.status, 200);
  assert.equal(b.status, 200, "the replay gets the first answer, not a stale-form refusal");
  assert.deepEqual(await outboxKinds(db, CLIENT), ["trainer_logged_workout"]);
  const audits = await db.prepare("SELECT COUNT(*) AS n FROM v2_audit_events WHERE kind = 'log_workout'").first<{ n: number }>();
  assert.equal(audits?.n, 1);
});

test("voice: plain set dictation is proposed without the AI, named after the client's plan", async () => {
  const db = await setup();
  const noAi: Run = async () => { throw new Error("the AI must not be called"); };
  const r = await call(db, TRAINER, "POST", "/api/v2/trainer/voice", { clientId: CLIENT, text: "жим лежачи 80 на 6, 80 на 5; присід 100 кг на 5" }, { run: noAi });
  assert.equal(r.status, 200, JSON.stringify(r.error));
  assert.equal(r.data.kind, "workout");
  assert.equal(await getWorkoutLog(db, CLIENT, today()), null, "a proposal writes nothing");
  assert.equal(r.data.entries?.length, 2);
  assert.deepEqual(r.data.entries?.[0]?.sets, [{ weight: 80, reps: 6 }, { weight: 80, reps: 5 }]);
  assert.deepEqual(r.data.entries?.[1]?.sets, [{ weight: 100, reps: 5 }]);
});

test("voice: a plan change goes to the AI and comes back as checked, ordered actions with the plan version", async () => {
  const db = await setup();
  const answer = {
    kind: "plan", reply: "Heavier bench on Monday and squat removed.",
    actions: [
      { label: "Remove squat", kind: "delete", weekday: 1, index: 1 },
      { label: "Bench 65", kind: "weight", weekday: 1, index: 0, value: "65" },
      { label: "Wrong index", kind: "weight", weekday: 1, index: 9, value: "70" },
    ],
  };
  const run: Run = async () => ({ response: JSON.stringify(answer) });
  const r = await call(db, TRAINER, "POST", "/api/v2/trainer/voice", { clientId: CLIENT, text: "у понеділок жим 65 і прибери присідання" }, { run });
  assert.equal(r.status, 200, JSON.stringify(r.error));
  assert.equal(r.data.kind, "plan");
  assert.equal(r.data.version, "2026-05-01T00:00:00.000Z");
  assert.deepEqual(r.data.actions?.map((a) => a.kind), ["weight", "delete"], "index-keeping edits first; an index past the day is dropped");
  assert.deepEqual(r.data.actions?.map((a) => a.target), ["Bench Press", "Barbell Squat"], "each carries the exercise it expects");
});

test("voice: an AI that never answers sensibly is a 502, an empty or huge text a 400, and an unclear one a question", async () => {
  const db = await setup();
  const junk: Run = async () => ({ response: "not json" });
  assert.equal((await call(db, TRAINER, "POST", "/api/v2/trainer/voice", { clientId: CLIENT, text: "зроби щось з планом" }, { run: junk })).status, 502);
  assert.equal((await call(db, TRAINER, "POST", "/api/v2/trainer/voice", { clientId: CLIENT, text: "  " })).status, 400);
  assert.equal((await call(db, TRAINER, "POST", "/api/v2/trainer/voice", { clientId: CLIENT, text: "x".repeat(1001) })).status, 400);
  const unclear: Run = async () => ({ response: JSON.stringify({ kind: "none", reply: "Which exercise should change?" }) });
  const q = await call(db, TRAINER, "POST", "/api/v2/trainer/voice", { clientId: CLIENT, text: "зроби легше" }, { run: unclear });
  assert.equal(q.data.kind, "none");
  assert.equal(q.data.reply, "Which exercise should change?");
});
