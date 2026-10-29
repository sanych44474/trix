// The /api/v2 seam: authenticate once per request, typed failures, one routing table, and t() vars
// escaped exactly once. Real handlers over the in-memory DB; ?debugUser is the dev bypass.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser, updateUser } from "../src/adapters/d1/v2Users";
import { miniAppIdentity, shareIdentity } from "../src/webapp/auth";
import { codeFor, handleV2Api } from "../src/webapp/v2Api";
import { handleSettingsApi } from "../src/webapp/settingsApi";
import { legacyRouteFor, v2RouteFor } from "../src/webapp/routes";
import { retryableFor } from "../src/contracts/v2";
import type { Env } from "../src/types";

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

const ENV = (db: ReturnType<typeof newDb>) => ({ DB: db, ALLOW_DEBUG_USER: "1", TELEGRAM_BOT_TOKEN: "123:TEST" }) as unknown as Env;

test("miniAppIdentity: one resolution per Request object, shared with a derived Request", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "uk", "Ann");
  const url = new URL("https://x/api/settings?debugUser=1");
  const req = new Request(url, { method: "POST" });

  const first = await miniAppIdentity(req, url, ENV(db));
  const again = await miniAppIdentity(req, url, ENV(db));
  assert.ok(first);
  assert.equal(again, first, "a second ask for the same Request must reuse the resolved identity");

  const derived = new Request(req, { headers: new Headers({ "x-derived": "1" }) });
  shareIdentity(req, derived);
  assert.equal(await miniAppIdentity(derived, url, ENV(db)), first, "the derived Request inherits the identity");

  const separate = new Request(url, { method: "POST" });
  const other = await miniAppIdentity(separate, url, ENV(db));
  assert.ok(other);
  assert.notEqual(other, first, "an unrelated Request resolves on its own");
});

test("miniAppIdentity: a rejected session is cached as null, not re-resolved", async () => {
  const db = newDb();
  const url = new URL("https://x/api/settings");
  const req = new Request(url, { method: "POST" });
  assert.equal(await miniAppIdentity(req, url, ENV(db)), null);
  assert.equal(await miniAppIdentity(req, url, ENV(db)), null);
});

test("v2 mutating call: a typed validation failure reaches the envelope with code and retryable", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "uk", "Ann");
  const url = new URL("https://x/api/v2/settings?debugUser=1");
  const req = new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "remToggle", key: "not-a-real-key" }),
  });
  const res = await handleV2Api(req, url, ENV(db), ctx);
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: { code: string; retryable: boolean; message: string } };
  assert.equal(body.error.code, "validation_error");
  assert.equal(body.error.retryable, false);
  assert.equal(body.error.message, "bad request");
});

test("v2 unauthenticated read: unauthorized, retryable once a session exists", async () => {
  const db = newDb();
  const url = new URL("https://x/api/v2/plan");
  const res = await handleV2Api(new Request(url), url, ENV(db), ctx);
  assert.equal(res.status, 401);
  const body = (await res.json()) as { error: { code: string; retryable: boolean } };
  assert.equal(body.error.code, "unauthorized");
  assert.equal(body.error.retryable, true);
});

test("codeFor: an explicit code wins; the status guess is only the fallback", () => {
  assert.equal(codeFor(400, "something free-text", "not_found"), "not_found");
  assert.equal(codeFor(409, "stale"), "conflict");
  assert.equal(codeFor(500, "error"), "dependency_unavailable");
  assert.equal(codeFor(400, "bad request", "not-a-code"), "validation_error");
});

test("retryableFor: throttling, outages and a missing session retry, request errors do not", () => {
  for (const code of ["rate_limited", "dependency_unavailable", "unauthorized"] as const) assert.equal(retryableFor(code), true, code);
  for (const code of ["validation_error", "forbidden", "not_found", "conflict"] as const) {
    assert.equal(retryableFor(code), false, code);
  }
});

test("one routing table: v2 and legacy readers agree on the same entries", () => {
  // Whole segments only on the v2 side.
  assert.equal(v2RouteFor("/api/v2/workoutX"), null);
  assert.equal(v2RouteFor("/api/v2/trainer/invite")?.legacyPath, "/api/trainer/invite");
  // The more specific entry wins over the trainer prefix on both readers.
  assert.equal(v2RouteFor("/api/v2/trainer/profile")?.route.path, "/api/trainer/profile");
  assert.equal(legacyRouteFor("/api/trainer/profile")?.path, "/api/trainer/profile");
  // Legacy dispatch keeps its match modes: exact paths do not catch subpaths, prefixes do.
  assert.equal(legacyRouteFor("/api/records/extra"), null);
  assert.equal(legacyRouteFor("/api/trainer/invite")?.path, "/api/trainer", "falls through to the trainer prefix, as before");
  assert.equal(legacyRouteFor("/api/workout/today")?.path, "/api/workout");
  // v2-only routes are not on the unversioned surface.
  assert.equal(legacyRouteFor("/api/squads"), null);
});

test("t() vars are escaped once: a name with an ampersand reaches Telegram as &amp; (not &amp;amp;)", async () => {
  const db = newDb();
  const trainer = (await getOrCreateUser(db, 2, 2, "en", "Coach")) as unknown as { _id: number };
  await getOrCreateUser(db, 1, 1, "en", "A&B");
  await updateUser(db, 1, { role: "client", trainerId: trainer._id } as never);

  const sent: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    sent.push(String(init?.body ?? ""));
    return Response.json({ ok: true, result: {} });
  }) as typeof fetch;
  try {
    const url = new URL("https://x/api/settings?debugUser=1");
    const req = new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "leaveTrainer" }) });
    await handleSettingsApi(req, url, ENV(db));
  } finally {
    globalThis.fetch = realFetch;
  }
  const toTrainer = sent.filter((b) => b.includes("A&amp;B") || b.includes("A&amp;amp;B") || b.includes("A&B"));
  assert.ok(toTrainer.length >= 1, "the trainer was notified");
  for (const body of toTrainer) {
    assert.ok(!body.includes("&amp;amp;"), "no double escaping");
    assert.ok(body.includes("A&amp;B"), "the name appears escaped once");
  }
});
