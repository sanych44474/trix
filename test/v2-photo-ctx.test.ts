// GET /api/v2/photo on a Telegram-stored photo must hand the R2 cache write to the request's
// ExecutionContext, so the write survives the response (ctx.waitUntil), not a no-op stand-in.
import assert from "node:assert/strict";
import test from "node:test";
import { handleV2Api } from "../src/webapp/v2Api";
import { getOrCreateUser } from "../src/adapters/d1/v2Users";
import { addProgressPhoto } from "../src/adapters/d1/v2Tracking";
import { newDb } from "./harness";
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
    delete: async () => {},
    list: async () => ({ objects: [], truncated: false }),
  };
}

test("GET /api/v2/photo hands the R2 cache write to the request's ctx.waitUntil", async () => {
  const db = newDb();
  await getOrCreateUser(db, 41, 41, "en", "Photo");
  await addProgressPhoto(db, 41, "tg-file-41");
  const photoId = db.dump<{ id: number }>("SELECT id FROM v2_progress_photos WHERE accountId = 41")[0].id;
  const bucket = fakeBucket();
  const env = { DB: db, ALLOW_DEBUG_USER: "1", TELEGRAM_BOT_TOKEN: "test", R2_PHOTOS: bucket } as unknown as Env;

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/getFile")) return Response.json({ ok: true, result: { file_id: "tg-file-41", file_path: "photos/41.jpg" } });
    if (url.includes("/file/bot")) return new Response(JPEG, { headers: { "content-type": "image/jpeg" } });
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;

  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(p); }, passThroughOnException: () => {} } as unknown as ExecutionContext;
  try {
    const p = `/api/v2/photo?id=${photoId}&debugUser=41`;
    const res = await handleV2Api(new Request(`https://example.test${p}`), new URL(`https://example.test${p}`), env, ctx);
    assert.equal(res.status, 200);
    assert.deepEqual(new Uint8Array(await res.arrayBuffer()), JPEG);
    assert.equal(pending.length, 1, "the cache write was handed to ctx.waitUntil");
    await Promise.all(pending);
    assert.equal(bucket.objects.size, 1, "the photo was cached in R2 once the background work finished");
  } finally {
    globalThis.fetch = realFetch;
  }
});
