// Progress photos for accounts without a Telegram chat (email / Google sign-in): stored in R2 as the
// primary copy and served from there; rejected cleanly when nothing can hold them; erased with the
// account.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser, updateUser } from "../src/adapters/d1/v2Users";
import { deleteUserData } from "../src/adapters/d1/v2Account";
import { handlePhotoApi } from "../src/webapp/miscApi";
import { hasTelegramChat, sniffImage } from "../src/domain/delivery";
import type { Env } from "../src/types";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

function fakeBucket() {
  const objects = new Map<string, { bytes: ArrayBuffer; contentType: string }>();
  return {
    objects,
    put: async (key: string, bytes: ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }) => { objects.set(key, { bytes, contentType: opts?.httpMetadata?.contentType ?? "" }); },
    get: async (key: string) => {
      const o = objects.get(key);
      return o ? { body: new Response(o.bytes).body, httpMetadata: { contentType: o.contentType } } : null;
    },
    delete: async (keys: string | string[]) => { for (const k of [keys].flat()) objects.delete(k); },
    list: async () => ({ objects: [], truncated: false }),
  };
}

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
function upload(env: Env, userId: number, bytes: Uint8Array) {
  const form = new FormData();
  form.append("photo", new Blob([bytes]), "p.jpg");
  const p = `/api/v2/photo?debugUser=${userId}`;
  return handlePhotoApi(new Request(`https://x${p}`, { method: "POST", body: form }), new URL(`https://x${p}`), env, ctx);
}
const view = (env: Env, userId: number, id: number) => {
  const p = `/api/v2/photo?id=${id}&debugUser=${userId}`;
  return handlePhotoApi(new Request(`https://x${p}`), new URL(`https://x${p}`), env, ctx);
};

test("sniffImage / hasTelegramChat", () => {
  assert.equal(sniffImage(JPEG), "image/jpeg");
  assert.equal(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(sniffImage(new TextEncoder().encode("RIFF____WEBPVP8 ")), "image/webp");
  assert.equal(sniffImage(new TextEncoder().encode("<svg onload=alert(1)>")), null);
  assert.equal(hasTelegramChat({ chatId: 42 }), true);
  assert.equal(hasTelegramChat({ chatId: -4_000_000_000_000_123, botBlocked: true }), false, "email/Google account");
  assert.equal(hasTelegramChat({ chatId: 42, botBlocked: true }), false, "blocked the bot");
});

test("an account without Telegram uploads to R2, views it, and the photo is erased with the account", async () => {
  const db = newDb();
  const bucket = fakeBucket();
  const env = { DB: db, ALLOW_DEBUG_USER: "1", TELEGRAM_BOT_TOKEN: "t", R2_PHOTOS: bucket } as unknown as Env;
  await getOrCreateUser(db, 31, 31, "en", "EmailOnly");
  await updateUser(db, 31, { botBlocked: true });

  const res = await upload(env, 31, JPEG);
  assert.equal(res.status, 200);
  const row = db.dump<{ id: number; objectKey: string | null; legacyFileId: string | null }>("SELECT id, objectKey, legacyFileId FROM v2_progress_photos WHERE accountId = 31")[0];
  assert.match(row.objectKey ?? "", /^photos\/31\//);
  assert.equal(row.legacyFileId, null, "no Telegram involved");

  const got = await view(env, 31, row.id);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get("content-type"), "image/jpeg");
  assert.deepEqual(new Uint8Array(await got.arrayBuffer()), JPEG);

  await deleteUserData(env, 31);
  assert.equal(bucket.objects.size, 0, "the stored original is erased, not just the row");
});

test("upload rejects non-images, and says so when there is nowhere to store the photo", async () => {
  const db = newDb();
  await getOrCreateUser(db, 32, 32, "en", "NoStore");
  await updateUser(db, 32, { botBlocked: true });
  const withBucket = { DB: db, ALLOW_DEBUG_USER: "1", TELEGRAM_BOT_TOKEN: "t", R2_PHOTOS: fakeBucket() } as unknown as Env;
  assert.equal((await upload(withBucket, 32, new TextEncoder().encode("<svg/>"))).status, 415);
  const noBucket = { DB: db, ALLOW_DEBUG_USER: "1", TELEGRAM_BOT_TOKEN: "t" } as unknown as Env;
  assert.equal((await upload(noBucket, 32, JPEG)).status, 503);
});
