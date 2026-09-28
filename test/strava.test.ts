import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { activityKind, activityToExercise, planImport, type StravaActivity } from "../src/domain/strava";
import { decryptTokens, encryptTokens, getStravaLink, signState, verifyState } from "../src/adapters/d1/v2Strava";
import { connectStrava, disconnectStrava, syncStrava, type StravaConfig } from "../src/features/strava/stravaSync";
import { getWorkoutLog, upsertWorkoutLog } from "../src/adapters/d1/v2Workouts";
import { conditioningWeek } from "../src/domain/conditioning";
import type { Weekday } from "../src/types";

const cfg: StravaConfig = { clientId: "1", clientSecret: "s3cret", redirectUri: "https://w.example/strava/callback" };
const run = (id: number, date: string, extra: Partial<StravaActivity> = {}): StravaActivity => ({ id, sport_type: "Run", start_date_local: `${date}T07:30:00Z`, moving_time: 1800, distance: 5000, ...extra });

function seedAccount(db: ReturnType<typeof newDb>, id: number): void {
  const now = new Date().toISOString();
  db.prepare("INSERT INTO v2_accounts (id, legacyUserId, chatId, role, status, createdAt, updatedAt) VALUES (?, ?, ?, 'solo', 'active', ?, ?)").bind(id, id, id, now, now).run();
}

test("activity mapping: kinds, skips, and names that count as conditioning", () => {
  assert.equal(activityKind({ sport_type: "GravelRide" }), "bike");
  assert.equal(activityKind({ sport_type: "WeightTraining" }), null, "strength is logged in trix itself");
  assert.equal(activityKind({ type: "Swim" }), "swim");
  const ex = activityToExercise(run(1, "2026-09-25"), "uk");
  assert.deepEqual(ex, { name: "Біг", skipped: false, setsDone: [{ reps: 0, weight: 0, seconds: 1800, meters: 5000 }] });
  assert.equal(activityToExercise(run(2, "2026-09-25", { moving_time: 20, distance: 30 }), "en"), null, "an accidental start/stop");
  for (const sport of ["Run", "Ride", "Swim", "Walk", "Hike", "Rowing"]) {
    const e = activityToExercise(run(3, "2026-09-25", { sport_type: sport }), "en")!;
    const week = conditioningWeek([{ userId: 1, date: "2026-09-25", weekday: 4, completed: true, exercises: [e], createdAt: new Date() }], "2026-09-19");
    assert.equal(week.minutes, 30, `${sport} (${e.name}) counts toward conditioning load`);
  }
});

test("planImport groups by local date and drops what was already imported", () => {
  const plan = planImport([run(1, "2026-09-24"), run(2, "2026-09-25"), run(3, "2026-09-25", { sport_type: "Ride" }), run(4, "2026-09-25", { sport_type: "Yoga" })], new Set([1]), "en");
  assert.deepEqual([...plan.keys()], ["2026-09-25"]);
  assert.deepEqual(plan.get("2026-09-25")!.map((i) => [i.activityId, i.exercise.name]), [[2, "Running"], [3, "Cycling"]]);
});

test("OAuth state: bound to the account, expires, and can't be forged", async () => {
  const now = Date.parse("2026-09-28T10:00:00Z");
  const state = await signState(42, "s3cret", now);
  assert.equal(await verifyState(state, "s3cret", now + 60_000), 42);
  assert.equal(await verifyState(state, "s3cret", now + 16 * 60_000), null, "expired");
  assert.equal(await verifyState(state.replace(/^42\./, "43."), "s3cret", now), null, "another account");
  assert.equal(await verifyState(state, "other-secret", now), null, "different key");
  assert.equal(await verifyState("garbage", "s3cret", now), null);
});

test("tokens are encrypted at rest and unreadable with another key", async () => {
  const tokens = { access: "a", refresh: "r", expiresAt: 1 };
  const stored = await encryptTokens(tokens, "s3cret");
  assert.ok(!stored.includes('"access"'));
  assert.deepEqual(await decryptTokens(stored, "s3cret"), tokens);
  assert.equal(await decryptTokens(stored, "rotated"), null);
});

function fakeStrava(activities: StravaActivity[]) {
  const calls: string[] = [];
  let tokenN = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url.replace(/\?.*/, "")}`);
    if (url.endsWith("/oauth/token")) {
      tokenN += 1;
      return Response.json({ access_token: `acc${tokenN}`, refresh_token: `ref${tokenN}`, expires_at: Math.floor(Date.now() / 1000) + 6 * 3600, athlete: { id: 777 } });
    }
    if (url.includes("/athlete/activities")) {
      const page = Number(new URL(url).searchParams.get("page"));
      return Response.json(page === 1 ? activities : []);
    }
    if (url.endsWith("/oauth/deauthorize")) return Response.json({});
    return new Response("nope", { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

test("connect -> sync -> re-sync -> disconnect against a fake Strava", async () => {
  const db = newDb();
  seedAccount(db, 501);
  // A strength session already logged for the 25th must survive the import untouched.
  await upsertWorkoutLog(db, 501, "2026-09-25", 4 as Weekday, [{ name: "Bench Press", skipped: false, setsDone: [{ reps: 8, weight: 60 }] }], true, "bench");
  const strava = fakeStrava([run(1, "2026-09-25"), run(2, "2026-09-26", { sport_type: "Ride", distance: 20000, moving_time: 3600 }), run(3, "2026-09-26", { sport_type: "WeightTraining" })]);

  await assert.rejects(connectStrava(db, cfg, 501, "code", "read", strava.fetchImpl), /strava_scope/);
  await connectStrava(db, cfg, 501, "code", "read,activity:read", strava.fetchImpl);
  assert.equal((await getStravaLink(db, 501, cfg.clientSecret))?.athleteId, 777);

  const now = Date.parse("2026-09-28T10:00:00Z");
  const first = await syncStrava(db, cfg, 501, "en", strava.fetchImpl, now);
  assert.deepEqual(first, { imported: 2, days: 2 });
  const day25 = await getWorkoutLog(db, 501, "2026-09-25");
  assert.deepEqual(day25?.exercises.map((e) => e.name), ["Bench Press", "Running"]);
  assert.equal(day25?.notes, "bench", "existing log kept");
  assert.equal((await getWorkoutLog(db, 501, "2026-09-26"))?.completed, true);

  const second = await syncStrava(db, cfg, 501, "en", strava.fetchImpl, now);
  assert.deepEqual(second, { imported: 0, days: 0 }, "nothing imported twice");
  assert.equal((await getWorkoutLog(db, 501, "2026-09-25"))?.exercises.length, 2);

  await disconnectStrava(db, cfg, 501, strava.fetchImpl);
  assert.equal(await getStravaLink(db, 501, cfg.clientSecret), null);
  assert.ok(strava.calls.includes("POST https://www.strava.com/oauth/deauthorize"));
});

test("an expired access token is refreshed before syncing", async () => {
  const db = newDb();
  seedAccount(db, 502);
  const strava = fakeStrava([]);
  await connectStrava(db, cfg, 502, "code", "activity:read", strava.fetchImpl);
  const later = Date.now() + 7 * 3600_000; // past the 6 h expiry the fake hands out
  await syncStrava(db, cfg, 502, "en", strava.fetchImpl, later);
  assert.equal(strava.calls.filter((c) => c.endsWith("/oauth/token")).length, 2, "code exchange + one refresh");
  assert.equal((await getStravaLink(db, 502, cfg.clientSecret))?.tokens.access, "acc2");
});
