import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser, updateUser, applyTrainer, approveTrainer, getUser, listStrength, getTrainer } from "../src/db/repos";
import { handleExtrasApi } from "../src/webapp/extrasApi";
import type { UserDoc } from "../src/types";

function req(method: string, path: string, body?: unknown) {
  return new Request(`https://x${path}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}),
  });
}
function u(path: string) {
  return new URL(`https://x${path}`);
}
async function asUser(db: ReturnType<typeof newDb>, id: number, method: string, path: string, body?: unknown) {
  return handleExtrasApi(req(method, `${path}${path.includes("?") ? "&" : "?"}debugUser=${id}`, body), u(`${path}${path.includes("?") ? "&" : "?"}debugUser=${id}`), { DB: db, TELEGRAM_BOT_TOKEN: "t" } as never);
}

test("handleExtrasApi: unauthorized without a resolvable user", async () => {
  const db = newDb();
  const res = await handleExtrasApi(req("GET", "/api/records"), u("/api/records"), { DB: db } as never);
  assert.equal(res.status, 401);
});

test("/api/records: returns strength history and full badge catalog", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const res = await asUser(db, 1, "GET", "/api/records");
  const body = (await res.json()) as { records: unknown[]; badges: { earned: boolean }[] };
  assert.equal(res.status, 200);
  assert.deepEqual(body.records, []);
  assert.ok(body.badges.length > 0);
  assert.ok(body.badges.every((b) => b.earned === false));
});

test("/api/plates: rejects out-of-range weight, computes plates in range", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const bad = await asUser(db, 1, "GET", "/api/plates?kg=0");
  assert.equal(bad.status, 400);
  const tooHeavy = await asUser(db, 1, "GET", "/api/plates?kg=9999");
  assert.equal(tooHeavy.status, 400);
  const ok = await asUser(db, 1, "GET", "/api/plates?kg=100");
  assert.equal(ok.status, 200);
  const body = (await ok.json()) as { plan: { loaded: number } | null };
  assert.ok(body.plan);
});

test("/api/requests: GET forbidden for a non-trainer", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const res = await asUser(db, 1, "GET", "/api/requests");
  assert.equal(res.status, 403);
});

test("/api/requests: accepting links the client to the trainer and starts onboarding", async () => {
  const db = newDb();
  const trainer = (await getOrCreateUser(db, 10, 10, "en", "Coach")) as unknown as UserDoc;
  await updateUser(db, 10, { role: "trainer" });
  const client = (await getOrCreateUser(db, 20, 20, "en", "Cli")) as unknown as UserDoc;
  void trainer; void client;

  // Client requests the trainer.
  const reqRes = await asUser(db, 20, "POST", "/api/trainers", { trainerId: 10 });
  assert.equal(reqRes.status, 404); // trainer not yet approved

  await applyTrainer(db, 10, { name: "Coach" });
  await approveTrainer(db, 10, "INV1");
  const ok = await asUser(db, 20, "POST", "/api/trainers", { trainerId: 10 });
  assert.equal(ok.status, 200);

  const list = await asUser(db, 10, "GET", "/api/requests");
  const { requests } = (await list.json()) as { requests: { id: number; clientId: number }[] };
  assert.equal(requests.length, 1);
  assert.equal(requests[0].clientId, 20);

  const accept = await asUser(db, 10, "POST", "/api/requests", { id: requests[0].id, action: "accept" });
  assert.equal(accept.status, 200);

  const reloaded = await getUser(db, 20);
  assert.equal(reloaded?.role, "client");
  assert.equal(reloaded?.trainerId, 10);
  assert.equal(reloaded?.session.mode, "onboarding");
});

test("/api/requests: declining leaves the client unlinked", async () => {
  const db = newDb();
  await getOrCreateUser(db, 10, 10, "en", "Coach");
  await updateUser(db, 10, { role: "trainer" });
  await applyTrainer(db, 10, { name: "Coach" });
  await approveTrainer(db, 10, "INV2");
  await getOrCreateUser(db, 21, 21, "en", "Other");
  await asUser(db, 21, "POST", "/api/trainers", { trainerId: 10 });

  const list = await asUser(db, 10, "GET", "/api/requests");
  const { requests } = (await list.json()) as { requests: { id: number }[] };
  const res = await asUser(db, 10, "POST", "/api/requests", { id: requests[0].id, action: "decline" });
  assert.equal(res.status, 200);
  const reloaded = await getUser(db, 21);
  assert.equal(reloaded?.role, "solo");
  assert.equal(reloaded?.trainerId, undefined);
});

test("/api/library: taking a shared program activates it and marks onboarded", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  await db.raw.exec(
    `INSERT INTO shared_programs (code, ownerId, name, plan, isPublic, takenCount, createdAt)
     VALUES ('PLN1', 99, 'Push Pull Legs', '${JSON.stringify({
       split: [{ weekday: 1, muscleGroup: "Push", exercises: [] }],
       nutrition: { calories: 2000, protein: 150, fats: 60, carbs: 200 },
       supplements: [], methodology: "",
     }).replace(/'/g, "''")}', 1, 0, '${new Date().toISOString()}')`,
  );
  const res = await asUser(db, 1, "POST", "/api/library", { code: "PLN1" });
  assert.equal(res.status, 200);
  const reloaded = await getUser(db, 1);
  assert.equal(reloaded?.onboarded, true);

  const missing = await asUser(db, 1, "POST", "/api/library", { code: "NOPE" });
  assert.equal(missing.status, 404);
});

test("/api/trainer/profile: a solo user applying starts a pending application", async () => {
  const db = newDb();
  await getOrCreateUser(db, 5, 5, "en", "Applicant");
  const res = await asUser(db, 5, "POST", "/api/trainer/profile", { name: "New Coach", bio: "Hi" });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; pending: boolean };
  assert.equal(body.pending, true);
  const tr = await getTrainer(db, 5);
  assert.equal(tr?.status, "pending");
  assert.equal(tr?.name, "New Coach");
});

test("/api/trainer/profile: rejects an application with no name", async () => {
  const db = newDb();
  await getOrCreateUser(db, 6, 6, "en", "NoName");
  const res = await asUser(db, 6, "POST", "/api/trainer/profile", { bio: "just a bio" });
  assert.equal(res.status, 400);
});

test("/api/trainer/finance: forbidden for a non-trainer, empty summary for a trainer with no clients", async () => {
  const db = newDb();
  await getOrCreateUser(db, 7, 7, "en", "Solo");
  assert.equal((await asUser(db, 7, "GET", "/api/trainer/finance")).status, 403);

  await getOrCreateUser(db, 8, 8, "en", "Coach2");
  await updateUser(db, 8, { role: "trainer" });
  const res = await asUser(db, 8, "GET", "/api/trainer/finance");
  const body = (await res.json()) as { clients: number; paying: unknown[] };
  assert.equal(res.status, 200);
  assert.equal(body.clients, 0);
  assert.deepEqual(body.paying, []);
});

test("/api/weekcard and /api/whatsnew respond ok for any authenticated user", async () => {
  const db = newDb();
  await getOrCreateUser(db, 9, 9, "en", "Ann");
  assert.equal((await asUser(db, 9, "GET", "/api/weekcard")).status, 200);
  assert.equal((await asUser(db, 9, "GET", "/api/whatsnew")).status, 200);
});
