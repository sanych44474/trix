// Training extras in the apps: cardio templates + quick cardio log, strength standards, and the
// post-vacation comeback interview (state, answers and decision).
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser, getUser, updateUser } from "../src/adapters/d1/v2Users";
import { getWorkoutLog, upsertStrengthRecord } from "../src/adapters/d1/v2Workouts";
import { handleTrainingExtrasApi } from "../src/webapp/trainingExtrasApi";
import { handleQuickLogApi } from "../src/webapp/quickLogApi";
import { localParts } from "../src/domain/localTime";

const env = (db: ReturnType<typeof newDb>) => ({ DB: db, ALLOW_DEBUG_USER: "1", TELEGRAM_BOT_TOKEN: "t", BOT_USERNAME: "trixbot" }) as never;

function req(db: ReturnType<typeof newDb>, id: number, path: string, method = "GET", body?: unknown) {
  const url = new URL(`https://x${path}${path.includes("?") ? "&" : "?"}debugUser=${id}`);
  const init: RequestInit = body !== undefined
    ? { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } }
    : { method };
  return { request: new Request(url, init), url };
}

async function athlete(db: ReturnType<typeof newDb>, id: number, lang: "en" | "uk" = "en", profile: Record<string, unknown> = {}) {
  await getOrCreateUser(db, id, id, lang, `U${id}`);
  await updateUser(db, id, { onboarded: true, profile: { timezone: "UTC", age: 40, sex: "male", weightKg: 80, ...profile } as never });
}

test("cardio: quick types and structured templates come in the user's language with personal zones", async () => {
  const db = newDb();
  await athlete(db, 1, "uk");
  const { request, url } = req(db, 1, "/api/cardio");
  const res = await handleTrainingExtrasApi(request, url, env(db));
  assert.equal(res.status, 200);
  const data = ((await res.json()) as { quick: Array<{ key: string; name: string; label: string }>; structured: { templates: Array<{ key: string; steps: Array<{ bpm: { lo: number; hi: number } }> }> } });
  assert.equal(data.quick.length, 8);
  assert.deepEqual(data.quick.find((c) => c.key === "row"), { key: "row", name: "Веслування", label: "🚣 Веслування" });
  assert.equal(data.quick.find((c) => c.key === "other")?.name, "");
  assert.deepEqual(data.structured.templates.map((t) => t.key), ["liss", "tempo", "intervals", "vo2"]);
  // Age 40 → max HR 180; zone 2 is 60-70%.
  assert.deepEqual(data.structured.templates[0].steps[0].bpm, { lo: 108, hi: 126 });
});

test("cardio quick log: a timed or distance line is saved as the chosen type, a bare weight is refused", async () => {
  const db = newDb();
  await athlete(db, 2);
  const { request, url } = req(db, 2, "/api/log", "POST", { kind: "cardio", key: "row", text: "20 min" });
  const res = await handleQuickLogApi(request, url, env(db));
  assert.deepEqual(await res.json(), { ok: true, exercises: 1 });
  const today = localParts("UTC").date;
  const log = await getWorkoutLog(db, 2, today);
  assert.equal(log?.exercises[0].name, "Rowing");
  assert.ok((log?.exercises[0].setsDone[0].seconds ?? 0) > 0);

  const bad = req(db, 2, "/api/log", "POST", { kind: "cardio", key: "run", text: "80x5" });
  assert.deepEqual(await (await handleQuickLogApi(bad.request, bad.url, env(db))).json(), { ok: false, reason: "unreadable" });

  // "other" has no name prefix: the typed line names the exercise itself.
  const other = req(db, 2, "/api/log", "POST", { kind: "cardio", key: "other", text: "Jump rope 10 min" });
  assert.deepEqual(await (await handleQuickLogApi(other.request, other.url, env(db))).json(), { ok: true, exercises: 2 });
  assert.equal((await getWorkoutLog(db, 2, today))?.exercises[1].name, "Jump rope");
});

test("standards: without a bodyweight the screen asks for one, with it each big lift gets a level", async () => {
  const db = newDb();
  await athlete(db, 3, "en", { weightKg: 0 });
  const none = req(db, 3, "/api/standards");
  assert.deepEqual(await (await handleTrainingExtrasApi(none.request, none.url, env(db))).json(), { needsWeight: true, bodyweight: null, sex: "male", lifts: [] });

  await updateUser(db, 3, { profile: { ...(await getUser(db, 3))!.profile, weightKg: 80 } });
  await upsertStrengthRecord(db, 3, "Bench Press", { metric: "reps", weight: 100, reps: 5 }, "2026-10-01");
  const res = req(db, 3, "/api/standards");
  const body = (await (await handleTrainingExtrasApi(res.request, res.url, env(db))).json()) as { needsWeight: boolean; bodyweight: number; lifts: Array<{ exercise: string; level: string; e1rm: number; levelLabel: string }> };
  assert.equal(body.needsWeight, false);
  assert.equal(body.bodyweight, 80);
  assert.equal(body.lifts.length, 1);
  assert.equal(body.lifts[0].exercise, "Bench Press");
  assert.equal(body.lifts[0].e1rm, 117);
  assert.equal(body.lifts[0].level, "intermediate");
  assert.equal(body.lifts[0].levelLabel, "Intermediate");
});

test("comeback: pending only while the bot would be asking; answers and a decision end it", async () => {
  const db = newDb();
  await athlete(db, 4);
  const get = () => req(db, 4, "/api/comeback");
  const state = (await (await handleTrainingExtrasApi(get().request, get().url, env(db))).json()) as { pending: boolean; steps: Array<{ key: string }> };
  assert.equal(state.pending, false);
  assert.deepEqual(state.steps.map((s) => s.key), ["feel", "goals", "weight", "changed", "decision"]);

  // Not pending → a POST is a conflict, nothing changes.
  const early = req(db, 4, "/api/comeback", "POST", { answers: {}, decision: "keep" });
  assert.equal((await handleTrainingExtrasApi(early.request, early.url, env(db))).status, 409);

  // The scheduler's vacation-end opener puts the user in comeback mode.
  await updateUser(db, 4, { session: { mode: "comeback", comeback: { step: 0, answers: {} } } });
  const open = get();
  assert.equal(((await (await handleTrainingExtrasApi(open.request, open.url, env(db))).json()) as { pending: boolean }).pending, true);

  const partial = req(db, 4, "/api/comeback", "POST", { answers: { feel: "good", goals: "same" }, decision: "keep" });
  assert.equal((await handleTrainingExtrasApi(partial.request, partial.url, env(db))).status, 400);

  const answers = { feel: "Feeling good, a bit rusty", goals: "same", weight: "up", changed: "no" };
  const bogus = req(db, 4, "/api/comeback", "POST", { answers: { ...answers, weight: "heavier" }, decision: "keep" });
  assert.equal((await handleTrainingExtrasApi(bogus.request, bogus.url, env(db))).status, 400);

  const keep = req(db, 4, "/api/comeback", "POST", { answers, decision: "keep" });
  const kept = await handleTrainingExtrasApi(keep.request, keep.url, env(db));
  assert.deepEqual(await kept.json(), { ok: true, decision: "keep", planPending: false });
  assert.equal((await getUser(db, 4))!.session.mode, "idle");
  assert.equal(((await (await handleTrainingExtrasApi(get().request, get().url, env(db))).json()) as { pending: boolean }).pending, false);
});

test("comeback: adjust hands the next message to the adaptive check-in, as the bot does", async () => {
  const db = newDb();
  await athlete(db, 5);
  await updateUser(db, 5, { session: { mode: "comeback", comeback: { step: 0, answers: {} } } });
  const answers = { feel: "ok", goals: "changed", weight: "same", changed: "yes" };
  const r = req(db, 5, "/api/comeback", "POST", { answers, decision: "adjust" });
  assert.deepEqual(await (await handleTrainingExtrasApi(r.request, r.url, env(db))).json(), { ok: true, decision: "adjust", planPending: false });
  assert.equal((await getUser(db, 5))!.session.mode, "checkin_adaptive");
});
