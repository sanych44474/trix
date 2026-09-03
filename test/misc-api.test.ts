import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser, updateUser, addProgressPhoto, recentErrors } from "../src/db/repos";
import { handleChallengesApi, handleInjuriesApi, handleClientErrorApi, handlePhotoApi, handleBoardsApi } from "../src/webapp/miscApi";
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

// ---------------- challenges ----------------

test("handleChallengesApi: unauthorized without a resolvable user", async () => {
  const db = newDb();
  const res = await call(handleChallengesApi, db, null, "GET", "/api/challenges");
  assert.equal(res.status, 401);
});

test("handleChallengesApi: GET with nothing joined lists every template as available", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const res = await call(handleChallengesApi, db, 1, "GET", "/api/challenges");
  const body = (await res.json()) as { active: unknown[]; available: { code: string }[]; won: number };
  assert.equal(res.status, 200);
  assert.deepEqual(body.active, []);
  assert.equal(body.won, 0);
  assert.ok(body.available.length > 0);
});

test("handleChallengesApi: joining moves a template from available to active, join is idempotent", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const before = (await (await call(handleChallengesApi, db, 1, "GET", "/api/challenges")).json()) as { available: { code: string }[] };
  const code = before.available[0].code;

  const join1 = await call(handleChallengesApi, db, 1, "POST", "/api/challenges", { code });
  assert.equal(join1.status, 200);
  const after = (await (await call(handleChallengesApi, db, 1, "GET", "/api/challenges")).json()) as { active: { code: string }[] };
  assert.equal(after.active.length, 1);
  assert.equal(after.active[0].code, code);

  // Joining again must not insert a second row (no unique-constraint crash, no duplicate).
  const join2 = await call(handleChallengesApi, db, 1, "POST", "/api/challenges", { code });
  assert.equal(join2.status, 200);
  const stillOne = (await (await call(handleChallengesApi, db, 1, "GET", "/api/challenges")).json()) as { active: unknown[] };
  assert.equal(stillOne.active.length, 1);
});

test("handleChallengesApi: rejects an unknown challenge code", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const res = await call(handleChallengesApi, db, 1, "POST", "/api/challenges", { code: "not-a-real-code" });
  assert.equal(res.status, 400);
});

// ---------------- injuries ----------------

test("handleInjuriesApi: GET lists the static area/severity option sets even with no injuries", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const res = await call(handleInjuriesApi, db, 1, "GET", "/api/injuries");
  const body = (await res.json()) as { injuries: unknown[]; areas: unknown[]; severities: unknown[] };
  assert.deepEqual(body.injuries, []);
  assert.ok(body.areas.length > 0);
  assert.equal(body.severities.length, 2);
});

test("handleInjuriesApi: reporting a valid injury makes it show up on GET", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const res = await call(handleInjuriesApi, db, 1, "POST", "/api/injuries", { area: "knee", severity: "mild" });
  assert.equal(res.status, 200);
  const list = (await (await call(handleInjuriesApi, db, 1, "GET", "/api/injuries")).json()) as { injuries: { since: string }[] };
  assert.equal(list.injuries.length, 1);
});

test("handleInjuriesApi: rejects an unknown area or severity", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  assert.equal((await call(handleInjuriesApi, db, 1, "POST", "/api/injuries", { area: "not-a-joint", severity: "mild" })).status, 400);
  assert.equal((await call(handleInjuriesApi, db, 1, "POST", "/api/injuries", { area: "knee", severity: "extreme" })).status, 400);
});

// ---------------- client-side error reporting ----------------

test("handleClientErrorApi: persists a client error into error_logs", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const res = await call(handleClientErrorApi, db, 1, "POST", "/api/client-error", { message: "TypeError: x is undefined", source: "app.html", line: 42 });
  assert.equal(res.status, 200);
  const rows = await recentErrors(db, new Date(Date.now() - 60_000).toISOString(), 10);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "webapp");
  assert.ok(rows[0].message?.includes("TypeError"));
});

test("handleClientErrorApi: rejects an empty message and a GET", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  assert.equal((await call(handleClientErrorApi, db, 1, "POST", "/api/client-error", { message: "" })).status, 400);
  assert.equal((await call(handleClientErrorApi, db, 1, "GET", "/api/client-error")).status, 405);
});

// ---------------- progress-photo proxy ----------------

test("handlePhotoApi: 400 on a bad id, 404 on a missing photo, 404 for someone else's photo", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  await getOrCreateUser(db, 2, 2, "en", "Bo");
  assert.equal((await call(handlePhotoApi, db, 1, "GET", "/api/photo?id=abc")).status, 400);
  assert.equal((await call(handlePhotoApi, db, 1, "GET", "/api/photo?id=999")).status, 404);

  await addProgressPhoto(db, 2, "file123");
  const rows = db.dump<{ id: number }>("SELECT id FROM progress_photos WHERE userId = 2");
  const res = await call(handlePhotoApi, db, 1, "GET", `/api/photo?id=${rows[0].id}`);
  assert.equal(res.status, 404); // owned by user 2, requester is user 1 (not their trainer)
});

test("handlePhotoApi: unauthorized without a resolvable user", async () => {
  const db = newDb();
  const res = await call(handlePhotoApi, db, null, "GET", "/api/photo?id=1");
  assert.equal(res.status, 401);
});

// ---------------- boards ----------------

test("handleBoardsApi: not opted in returns optedIn:false without computing anything", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const res = await call(handleBoardsApi, db, 1, "GET", "/api/boards");
  assert.deepEqual(await res.json(), { optedIn: false });
});

test("handleBoardsApi: opted in with no friends returns a friends block with count 0", async () => {
  const db = newDb();
  const me = (await getOrCreateUser(db, 1, 1, "en", "Ann")) as unknown as UserDoc;
  await updateUser(db, 1, { competeOptIn: true, alias: "Ann" });
  void me;
  const res = await call(handleBoardsApi, db, 1, "GET", "/api/boards");
  const body = (await res.json()) as { optedIn: boolean; friends: { count: number } };
  assert.equal(res.status, 200);
  assert.equal(body.optedIn, true);
  assert.equal(body.friends.count, 0);
});
