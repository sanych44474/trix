// Former chat-only tools now in the Mini App: CSV history import, plan rebuild, owner announce.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser, getUser, updateUser } from "../src/adapters/d1/v2Users";
import { getWorkoutLog } from "../src/adapters/d1/v2Workouts";
import { setOwnerChatId } from "../src/adapters/d1/v2Admin";
import { replanRunning } from "../src/bot/plan";
import { handleMediaApi } from "../src/webapp/mediaApi";
import { handlePlanApi } from "../src/webapp/planApi";
import { handleOwnerApi } from "../src/webapp/ownerApi";
import type { UserDoc } from "../src/types";

const env = (db: ReturnType<typeof newDb>) => ({ DB: db, ALLOW_DEBUG_USER: "1", TELEGRAM_BOT_TOKEN: "t", WORKER_URL: "https://trix.example" }) as never;
const withDebug = (path: string, id: number) => `${path}${path.includes("?") ? "&" : "?"}debugUser=${id}`;

async function withTelegram<T>(run: (sent: Array<{ chat_id: number; text: string }>) => Promise<T>): Promise<T> {
  const sent: Array<{ chat_id: number; text: string }> = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: { body?: string }) => {
    if (String(url).includes("api.telegram.org") && init?.body) sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof fetch;
  try { return await run(sent); } finally { globalThis.fetch = realFetch; }
}

const STRONG = [
  "Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE",
  '2026-08-30 18:51:52,"Evening Workout",1h 12m,"Bench Press (Barbell)",1,80.0,5,0,0,,,7',
  '2026-09-01 07:15:00,"Morning Workout",45m,"Back Squat (Barbell)",1,100,5,0,0,,,',
].join("\r\n");

async function importCsv(db: ReturnType<typeof newDb>, id: number, content: string) {
  const form = new FormData();
  form.append("file", new Blob([content], { type: "text/csv" }), "strong.csv");
  const p = withDebug("/api/media/import-csv", id);
  const res = await handleMediaApi(new Request(`https://x${p}`, { method: "POST", body: form }), new URL(`https://x${p}`), env(db));
  return (await res.json()) as { ok: boolean; imported?: number; skipped?: number; reason?: string };
}

test("CSV import in the app: new dates are written, a second import skips them", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  const first = await importCsv(db, 1, STRONG);
  assert.deepEqual([first.ok, first.imported, first.skipped], [true, 2, 0]);
  assert.ok(await getWorkoutLog(db, 1, "2026-08-30"));
  const again = await importCsv(db, 1, STRONG);
  assert.deepEqual([again.imported, again.skipped], [0, 2]);
});

test("CSV import in the app: a file that is not a workout export says so", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Ann");
  assert.deepEqual(await importCsv(db, 1, "name,age\nAnn,30"), { ok: false, reason: "wrong_format" });
});

async function plan(db: ReturnType<typeof newDb>, id: number, method: string) {
  const p = withDebug("/api/plan/replan", id);
  return handlePlanApi(new Request(`https://x${p}`, { method }), new URL(`https://x${p}`), env(db), { waitUntil: () => {} } as never);
}

test("plan rebuild: a trainer's client cannot rebuild; a running rebuild is not started twice", async () => {
  const db = newDb();
  await getOrCreateUser(db, 10, 10, "en", "Max");
  await updateUser(db, 10, { role: "trainer" });
  await getOrCreateUser(db, 20, 20, "en", "Client");
  await updateUser(db, 20, { role: "client", trainerId: 10, onboarded: true });
  assert.equal((await plan(db, 20, "POST")).status, 403);

  await getOrCreateUser(db, 30, 30, "en", "Solo");
  await updateUser(db, 30, { onboarded: true });
  const res = await plan(db, 30, "POST");
  assert.equal(res.status, 200);
  const u = (await getUser(db, 30)) as UserDoc;
  assert.ok(u.session.replanAt, "the rebuild is marked as running");
  assert.equal(replanRunning(u), true);
  assert.deepEqual(await (await plan(db, 30, "GET")).json(), { pending: true, failed: false });
  assert.deepEqual(await (await plan(db, 30, "POST")).json(), { ok: true, pending: true });
});

test("plan rebuild: a stale running mark expires", () => {
  const u = { session: { replanAt: new Date(Date.now() - 10 * 60_000).toISOString() } } as UserDoc;
  assert.equal(replanRunning(u), false);
});

test("owner announce: batches of 25 by account id, continuing from `after`", async () => {
  const db = newDb();
  await getOrCreateUser(db, 5, 5, "en", "Owner");
  await setOwnerChatId(db, 5);
  for (let i = 100; i < 130; i++) {
    await getOrCreateUser(db, i, i, "en", `U${i}`);
    await updateUser(db, i, { onboarded: true });
  }
  const call = (body: unknown) => {
    const p = withDebug("/api/owner/announce", 5);
    return handleOwnerApi(new Request(`https://x${p}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), new URL(`https://x${p}`), env(db));
  };
  await withTelegram(async (sent) => {
    const first = (await (await call({ text: "Hello" })).json()) as { sent: number; remaining: number; next: number | null };
    assert.equal(first.sent, 25);
    assert.equal(first.remaining, 5);
    assert.equal(first.next, 124);
    const second = (await (await call({ text: "Hello", after: first.next })).json()) as { sent: number; remaining: number; next: number | null };
    assert.equal(second.sent, 5);
    assert.equal(second.next, null);
    assert.equal(new Set(sent.map((m) => m.chat_id)).size, 30, "nobody gets it twice");
    assert.match(sent[0].text, /Hello/);
  });
  const p = withDebug("/api/owner/announce", 100);
  const notOwner = await handleOwnerApi(new Request(`https://x${p}`, { method: "POST", body: JSON.stringify({ text: "x" }) }), new URL(`https://x${p}`), env(db));
  assert.equal(notOwner.status, 404);
});
