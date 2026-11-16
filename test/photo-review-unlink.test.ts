// A trainer's photo request (session.photoReviewFor) must not outlive the trainer-client
// relationship: after the client leaves (or is moved to another trainer, or the trainer is
// deleted), their next progress photo stays with them. Also gated on the client's "body" sharing,
// the same consent that gates the trainer viewing progress photos on the client card.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser, getUser, updateUser } from "../src/adapters/d1/v2Users";
import { linkClient } from "../src/adapters/d1/v2Trainer";
import { deleteUserData } from "../src/adapters/d1/v2Account";
import { handlePhotoApi } from "../src/webapp/miscApi";
import { handleTrainerApi } from "../src/webapp/trainerApi";
import { handleSettingsApi } from "../src/webapp/settingsApi";
import type { Env, UserDoc } from "../src/types";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const TRAINER = 10;
const CLIENT = 20;

function fakeBucket() {
  const objects = new Map<string, ArrayBuffer>();
  return {
    put: async (key: string, bytes: ArrayBuffer) => { objects.set(key, bytes); },
    get: async () => null,
    delete: async (keys: string | string[]) => { for (const k of [keys].flat()) objects.delete(k); },
    list: async () => ({ objects: [], truncated: false }),
  };
}

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
const envOf = (db: ReturnType<typeof newDb>) => ({ DB: db, ALLOW_DEBUG_USER: "1", TELEGRAM_BOT_TOKEN: "t", R2_PHOTOS: fakeBucket() }) as unknown as Env;

function jsonReq(path: string, body: unknown) {
  const full = `https://x${path}`;
  return { req: new Request(full, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), url: new URL(full) };
}

// Every Telegram call goes through fetch; record the chat_id and method of each sendPhoto.
function captureTelegram() {
  const real = globalThis.fetch;
  const photos: number[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input instanceof Request ? input.url : input);
    if (u.endsWith("/sendPhoto")) {
      const body = init?.body;
      const chat = body instanceof FormData ? body.get("chat_id") : JSON.parse(String(body)).chat_id;
      photos.push(Number(chat));
    }
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
  }) as typeof fetch;
  return { photos, restore: () => { globalThis.fetch = real; } };
}

async function setup(db: ReturnType<typeof newDb>, shareBody = true) {
  await getOrCreateUser(db, TRAINER, TRAINER, "en", "Coach");
  await updateUser(db, TRAINER, { role: "trainer" });
  await getOrCreateUser(db, CLIENT, CLIENT, "en", "Cli");
  await updateUser(db, CLIENT, { role: "client", trainerId: TRAINER, profile: { name: "Cli", shareWithTrainer: { body: shareBody } } });
}

async function requestPhoto(env: Env) {
  const { req, url } = jsonReq(`/api/trainer/client/${CLIENT}/photo-request?debugUser=${TRAINER}`, {});
  const res = await handleTrainerApi(req, url, env);
  assert.equal(res.status, 200);
}

async function leaveTrainer(env: Env) {
  const { req, url } = jsonReq(`/api/settings?debugUser=${CLIENT}`, { action: "leaveTrainer" });
  const res = await handleSettingsApi(req, url, env);
  assert.equal(res.status, 200);
}

async function upload(env: Env) {
  const form = new FormData();
  form.append("photo", new Blob([JPEG]), "p.jpg");
  const p = `/api/v2/photo?debugUser=${CLIENT}`;
  const res = await handlePhotoApi(new Request(`https://x${p}`, { method: "POST", body: form }), new URL(`https://x${p}`), env, ctx);
  assert.equal(res.status, 200);
  return (await res.json()) as { ok: boolean; sentToTrainer?: boolean };
}

const reviewFor = async (db: ReturnType<typeof newDb>) => ((await getUser(db, CLIENT)) as UserDoc).session.photoReviewFor;

test("normal case: the requested photo goes to the trainer exactly once and the request is cleared", async () => {
  const db = newDb();
  const env = envOf(db);
  await setup(db);
  const tg = captureTelegram();
  try {
    await requestPhoto(env);
    assert.equal(await reviewFor(db), TRAINER);
    const first = await upload(env);
    assert.equal(first.sentToTrainer, true);
    assert.equal(await reviewFor(db), undefined);
    const second = await upload(env);
    assert.equal(second.sentToTrainer, undefined);
  } finally {
    tg.restore();
  }
  assert.deepEqual(tg.photos, [TRAINER], "one photo to the trainer, none after the request was used");
});

test("after the client leaves the trainer, their next photo is not sent to the former trainer", async () => {
  const db = newDb();
  const env = envOf(db);
  await setup(db);
  const tg = captureTelegram();
  try {
    await requestPhoto(env);
    await leaveTrainer(env);
    // Simulate a request left behind by any path that ended the relationship without clearing it.
    await updateUser(db, CLIENT, { session: { mode: "idle", photoReviewFor: TRAINER } });
    const res = await upload(env);
    assert.equal(res.sentToTrainer, undefined);
  } finally {
    tg.restore();
  }
  assert.deepEqual(tg.photos, [], "nothing goes to the former trainer");
  assert.equal(await reviewFor(db), undefined, "the stale request is cleared");
});

test("leaving the trainer clears a pending photo request", async () => {
  const db = newDb();
  const env = envOf(db);
  await setup(db);
  const tg = captureTelegram();
  try {
    await requestPhoto(env);
    await leaveTrainer(env);
  } finally {
    tg.restore();
  }
  const u = (await getUser(db, CLIENT)) as UserDoc;
  assert.equal(u.trainerId, undefined);
  assert.equal(u.session.photoReviewFor, undefined);
});

test("moving to another trainer clears the old trainer's request; deleting the trainer clears it too", async () => {
  const db = newDb();
  const env = envOf(db);
  await setup(db);
  await getOrCreateUser(db, 11, 11, "en", "Other");
  await updateUser(db, 11, { role: "trainer" });
  const tg = captureTelegram();
  try {
    await requestPhoto(env);
    await linkClient(db, CLIENT, 11);
    assert.equal(await reviewFor(db), undefined, "switching trainers drops the old request");

    await linkClient(db, CLIENT, TRAINER);
    await requestPhoto(env);
    await deleteUserData(env, TRAINER);
    assert.equal(await reviewFor(db), undefined, "deleting the trainer drops the request");
  } finally {
    tg.restore();
  }
});

test("with body sharing off, the requested photo is not forwarded and the request is cleared", async () => {
  const db = newDb();
  const env = envOf(db);
  await setup(db, false);
  const tg = captureTelegram();
  try {
    await requestPhoto(env);
    const res = await upload(env);
    assert.equal(res.sentToTrainer, undefined);
  } finally {
    tg.restore();
  }
  assert.deepEqual(tg.photos, []);
  assert.equal(await reviewFor(db), undefined);
});
