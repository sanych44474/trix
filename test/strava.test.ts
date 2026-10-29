import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { activityKind, activityToExercise, planImport, type StravaActivity } from "../src/domain/strava";
import { decryptTokens, encryptTokens, getStravaLink, importedActivityIds, signState, verifyState } from "../src/adapters/d1/v2Strava";
import { connectStrava, disconnectStrava, syncStrava, type StravaConfig } from "../src/features/strava/stravaSync";
import { getWorkoutLog, upsertWorkoutLog } from "../src/adapters/d1/v2Workouts";
import { conditioningWeek } from "../src/domain/conditioning";
import { deleteUserData } from "../src/adapters/d1/v2Account";
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

test("callback page never puts an unvalidated bot username into an attribute", async () => {
  const { handleStravaCallback } = await import("../src/webapp/stravaApi");
  const env = { STRAVA_CLIENT_ID: "1", STRAVA_CLIENT_SECRET: "s3cret", WORKER_URL: "https://w.example", BOT_USERNAME: 'x" onmouseover="alert(1)', DB: newDb() } as never;
  const res = await handleStravaCallback(new URL("https://w.example/strava/callback?state=bad&code=c"), env);
  const html = await res.text();
  assert.ok(!html.includes("onmouseover"), "a malformed username is dropped, not escaped into the href");
  const ok = await handleStravaCallback(new URL("https://w.example/strava/callback?state=bad&code=c"), { ...(env as object), BOT_USERNAME: "trix_bot" } as never);
  assert.ok((await ok.text()).includes('href="https://t.me/trix_bot"'));
});

// The redirect only asks for confirmation; the link is made by the POST from that page. A login-CSRF
// attacker can send a victim the attacker's own authorize link, so the GET must never connect.
test("GET callback shows a confirm page and links nothing until the form is posted", async () => {
  const { handleStravaCallback, handleStravaConnectPost } = await import("../src/webapp/stravaApi");
  const db = newDb();
  seedAccount(db, 504);
  db.prepare("INSERT INTO v2_profiles (accountId, lang, profile, updatedAt) VALUES (?, 'en', ?, ?)").bind(504, JSON.stringify({ name: "Anna <i>" }), new Date().toISOString()).run();
  const env = { STRAVA_CLIENT_ID: "1", STRAVA_CLIENT_SECRET: cfg.clientSecret, WORKER_URL: "https://w.example", TELEGRAM_BOT_TOKEN: "test", DB: db } as never;
  const state = await signState(504, cfg.clientSecret);
  const strava = fakeStrava([run(1, "2026-09-25")]);
  const realFetch = globalThis.fetch;
  globalThis.fetch = strava.fetchImpl;
  try {
    const get = await handleStravaCallback(new URL(`https://w.example/strava/callback?state=${state}&code=abc123&scope=read,activity:read`), env);
    const html = await get.text();
    assert.ok(html.includes("Anna &lt;i&gt;"), "names the account, escaped");
    assert.ok(html.includes(`<form method="post" action="/strava/callback">`));
    for (const field of ["code", "state", "scope"]) assert.ok(html.includes(`name="${field}"`), `hidden ${field}`);
    assert.deepEqual(strava.calls, [], "no token exchange on GET");
    assert.equal(await getStravaLink(db, 504, cfg.clientSecret), null, "nothing linked on GET");

    const form = new URLSearchParams({ code: "abc123", state, scope: "read,activity:read" }).toString();
    const post = new Request("https://w.example/strava/callback", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "content-length": String(form.length) }, body: form });
    const done = await handleStravaConnectPost(post, new URL(post.url), env);
    assert.ok((await done.text()).includes("Strava connected"), "POST shows the success page");
    assert.equal((await getStravaLink(db, 504, cfg.clientSecret))?.athleteId, 777, "POST connects");
    assert.ok(strava.calls.includes("POST https://www.strava.com/oauth/token"));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("POST callback rejects a tampered state, a malformed code and an oversized body", async () => {
  const { handleStravaCallback, handleStravaConnectPost } = await import("../src/webapp/stravaApi");
  const db = newDb();
  seedAccount(db, 505);
  const env = { STRAVA_CLIENT_ID: "1", STRAVA_CLIENT_SECRET: cfg.clientSecret, WORKER_URL: "https://w.example", TELEGRAM_BOT_TOKEN: "test", DB: db } as never;
  const state = await signState(505, cfg.clientSecret);
  const strava = fakeStrava([]);
  const realFetch = globalThis.fetch;
  globalThis.fetch = strava.fetchImpl;
  const post = (fields: Record<string, string>, length?: string) => {
    const form = new URLSearchParams(fields).toString();
    return new Request("https://w.example/strava/callback", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "content-length": length ?? String(form.length) }, body: form });
  };
  try {
    const tampered = state.slice(0, -1) + (state.endsWith("0") ? "1" : "0");
    const r1 = await handleStravaConnectPost(post({ code: "abc123", state: tampered, scope: "read,activity:read" }), new URL("https://w.example/strava/callback"), env);
    assert.ok(!(await r1.text()).includes("<form"), "tampered state fails");
    const r2 = await handleStravaConnectPost(post({ code: `abc"onmouseover="x`, state, scope: "read,activity:read" }), new URL("https://w.example/strava/callback"), env);
    assert.ok(!(await r2.text()).includes("onmouseover"), "malformed code fails");
    const g = await handleStravaCallback(new URL(`https://w.example/strava/callback?state=${state}&code=bad"x&scope=read,activity:read`), env);
    assert.ok(!(await g.text()).includes("<form"), "malformed code gets no confirm form");
    const r3 = await handleStravaConnectPost(post({ code: "abc123", state, scope: "read,activity:read" }, "5000"), new URL("https://w.example/strava/callback"), env);
    assert.ok(!(await r3.text()).includes("Strava connected"), "oversized body is rejected before parsing");
    // No Content-Length (chunked): the route is public, so the body is counted as it is read and
    // reading stops at the cap instead of buffering whatever the sender streams.
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled += 1;
        if (pulled > 1000) c.close();
        else c.enqueue(new Uint8Array(1024).fill(97));
      },
    });
    const chunked = new Request("https://w.example/strava/callback", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: endless, duplex: "half" } as RequestInit);
    const r4 = await handleStravaConnectPost(chunked, new URL("https://w.example/strava/callback"), env);
    assert.equal(r4.status, 413, "a streamed body over the cap is a 413");
    assert.ok(pulled < 20, `reading stopped near the 4 KB cap (pulled ${pulled} KB)`);
    assert.deepEqual(strava.calls, [], "no token exchange on any failure");
    assert.equal(await getStravaLink(db, 505, cfg.clientSecret), null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("importedActivityIds: a 300-activity first sync stays under D1's 100-parameter limit", async () => {
  const db = newDb();
  seedAccount(db, 1);
  const ids = Array.from({ length: 300 }, (_, i) => i + 1);
  const seen = await importedActivityIds(db as never, 1, ids);
  assert.equal(seen.size, 0);
});

test("account erasure revokes the Strava grant before it forgets the tokens", async () => {
  const db = newDb();
  seedAccount(db, 503);
  const strava = fakeStrava([]);
  await connectStrava(db, cfg, 503, "code", "activity:read", strava.fetchImpl);
  const realFetch = globalThis.fetch;
  globalThis.fetch = strava.fetchImpl as typeof fetch;
  try {
    await deleteUserData({ DB: db, STRAVA_CLIENT_SECRET: cfg.clientSecret } as never, 503);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.ok(strava.calls.includes("POST https://www.strava.com/oauth/deauthorize"));
  assert.equal(await getStravaLink(db, 503, cfg.clientSecret), null);
});
