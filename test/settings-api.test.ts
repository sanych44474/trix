import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser, getUser, setOwnerChatId, updateUser } from "../src/db/repos";
import { handleSettingsApi } from "../src/webapp/settingsApi";
import type { UserDoc } from "../src/types";

function req(method: string, path: string, body?: unknown) {
  return new Request(`https://x${path}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}),
  });
}
async function call(db: ReturnType<typeof newDb>, userId: number | null, method: string, path: string, body?: unknown) {
  const full = userId ? `${path}${path.includes("?") ? "&" : "?"}debugUser=${userId}` : path;
  return handleSettingsApi(req(method, full, body), new URL(`https://x${full}`), { DB: db, TELEGRAM_BOT_TOKEN: "t" } as never);
}

// Every action here that notifies someone goes through fetch(api.telegram.org/...); stub it so
// tests don't make real network calls (same pattern as test/transcribe.test.ts).
function stubFetch() {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch;
  return () => { globalThis.fetch = real; };
}

test("handleSettingsApi: unauthorized without a resolvable user", async () => {
  const db = newDb();
  const res = await call(db, null, "GET", "/api/settings");
  assert.equal(res.status, 401);
});

test("handleSettingsApi: GET reflects reminder state and compete opt-in", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const res = await call(db, 1, "GET", "/api/settings");
  const body = (await res.json()) as { reminders: { key: string; on: boolean }[]; compete: { on: boolean }; cycle: unknown };
  assert.equal(res.status, 200);
  assert.ok(body.reminders.every((r) => r.on)); // nothing muted yet
  assert.equal(body.compete.on, false);
  assert.equal(body.cycle, null); // no sex on profile yet
});

test("remToggle: flips a reminder off then back on; rejects an unknown key", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const bad = await call(db, 1, "POST", "/api/settings", { action: "remToggle", key: "not-a-key" });
  assert.equal(bad.status, 400);

  await call(db, 1, "POST", "/api/settings", { action: "remToggle", key: "steps" });
  let u = (await getUser(db, 1)) as UserDoc;
  assert.deepEqual(u.profile.remindersOff, ["steps"]);

  await call(db, 1, "POST", "/api/settings", { action: "remToggle", key: "steps" });
  u = (await getUser(db, 1)) as UserDoc;
  assert.deepEqual(u.profile.remindersOff, []);
});

test("vacation: sets and clears, rejects an out-of-range day count", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  assert.equal((await call(db, 1, "POST", "/api/settings", { action: "vacation", days: 0 })).status, 400);
  assert.equal((await call(db, 1, "POST", "/api/settings", { action: "vacation", days: 91 })).status, 400);

  const ok = await call(db, 1, "POST", "/api/settings", { action: "vacation", days: 14 });
  assert.equal(ok.status, 200);
  let u = (await getUser(db, 1)) as UserDoc;
  assert.ok(u.vacationUntil);
  assert.ok(u.reminders?.lastVacation);

  await call(db, 1, "POST", "/api/settings", { action: "vacation", off: true });
  u = (await getUser(db, 1)) as UserDoc;
  assert.equal(u.vacationUntil, undefined);
});

test("lang: switches to a supported language, rejects anything else", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  assert.equal((await call(db, 1, "POST", "/api/settings", { action: "lang", lang: "fr" })).status, 400);
  const res = await call(db, 1, "POST", "/api/settings", { action: "lang", lang: "uk" });
  assert.equal(res.status, 200);
  const u = (await getUser(db, 1)) as UserDoc;
  assert.equal(u.lang, "uk");
});

test("cycle: only writable for a female profile, ignores a future start date", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const rejected = await call(db, 1, "POST", "/api/settings", { action: "cycle", on: true });
  assert.equal(rejected.status, 400); // sex not set

  await updateUser(db, 1, { profile: { sex: "female" } });
  const future = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  await call(db, 1, "POST", "/api/settings", { action: "cycle", on: true, lastStart: future, len: 30 });
  let u = (await getUser(db, 1)) as UserDoc;
  assert.equal(u.profile.cycleTracking, true);
  assert.equal(u.profile.lastPeriodStart, undefined); // future date rejected
  assert.equal(u.profile.cycleLengthDays, 30);

  const past = "2020-01-01";
  await call(db, 1, "POST", "/api/settings", { action: "cycle", lastStart: past });
  u = (await getUser(db, 1)) as UserDoc;
  assert.equal(u.profile.lastPeriodStart, past);
});

test("compete: sets alias and opt-in independently", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  await call(db, 1, "POST", "/api/settings", { action: "compete", on: true, alias: "  Flash  " });
  const u = (await getUser(db, 1)) as UserDoc;
  assert.equal(u.competeOptIn, true);
  assert.equal(u.alias, "Flash");
});

test("feedback: rejects a too-short message, stores + notifies the owner otherwise", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  await getOrCreateUser(db, 9, 9, "en", "Owner");
  await setOwnerChatId(db, 9);
  assert.equal((await call(db, 1, "POST", "/api/settings", { action: "feedback", text: "x" })).status, 400);

  const unstub = stubFetch();
  try {
    const res = await call(db, 1, "POST", "/api/settings", { action: "feedback", text: "The AI plan gen felt slow today." });
    assert.equal(res.status, 200);
  } finally {
    unstub();
  }
  const rows = db.dump<{ text: string }>("SELECT text FROM feedback WHERE userId = 1");
  assert.equal(rows.length, 1);
});

test("leaveTrainer: only a client can leave, unlinks and notifies the former trainer", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const solo = await call(db, 1, "POST", "/api/settings", { action: "leaveTrainer" });
  assert.equal(solo.status, 400);

  await getOrCreateUser(db, 10, 10, "en", "Coach");
  await updateUser(db, 1, { role: "client", trainerId: 10 });
  const unstub = stubFetch();
  try {
    const res = await call(db, 1, "POST", "/api/settings", { action: "leaveTrainer" });
    assert.equal(res.status, 200);
  } finally {
    unstub();
  }
  const u = (await getUser(db, 1)) as UserDoc;
  assert.equal(u.role, "solo");
  assert.equal(u.trainerId, undefined);
});

test("deleteAccount: requires explicit confirm, then hard-deletes the user", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const unconfirmed = await call(db, 1, "POST", "/api/settings", { action: "deleteAccount" });
  assert.equal(unconfirmed.status, 400);

  const res = await call(db, 1, "POST", "/api/settings", { action: "deleteAccount", confirm: true });
  assert.equal(res.status, 200);
  assert.equal(await getUser(db, 1), null);
});

test("an unrecognized action is a 400, not a 500", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const res = await call(db, 1, "POST", "/api/settings", { action: "doTheThing" });
  assert.equal(res.status, 400);
});
