import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { isSupportAmount, parseSupportPayload, recordSupportPayment, supportPayload, supportTotals } from "../src/adapters/d1/v2Support";
import { purgeExpiredStories, putStoryImage, serveStoryImage, STORY_TTL_MS } from "../src/webapp/storyMedia";
import type { Env } from "../src/types";

function seedAccount(db: ReturnType<typeof newDb>, id: number): void {
  const now = new Date().toISOString();
  db.prepare("INSERT INTO v2_accounts (id, legacyUserId, chatId, role, status, createdAt, updatedAt) VALUES (?, ?, ?, 'solo', 'active', ?, ?)").bind(id, id, id, now, now).run();
}

test("support payloads: only the offered amounts round-trip", () => {
  assert.equal(parseSupportPayload(supportPayload(100)), 100);
  assert.equal(parseSupportPayload("support:99"), null);
  assert.equal(parseSupportPayload("support:100x"), null);
  assert.equal(parseSupportPayload("other:100"), null);
  assert.equal(isSupportAmount(250), true);
});

test("support payments: a redelivered charge is recorded once", async () => {
  const db = newDb();
  seedAccount(db, 401);
  assert.equal(await recordSupportPayment(db, 401, 100, "charge-1"), true);
  assert.equal(await recordSupportPayment(db, 401, 100, "charge-1"), false);
  assert.equal(await recordSupportPayment(db, 401, 50, "charge-2"), true);
  assert.deepEqual(await supportTotals(db), { payments: 2, stars: 150, supporters: 1 });
});

// A minimal in-memory stand-in for the R2 bucket surface storyMedia.ts uses.
function fakeBucket() {
  const objects = new Map<string, { bytes: ArrayBuffer; uploaded: Date; contentType?: string }>();
  return {
    objects,
    async put(key: string, bytes: ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }) { objects.set(key, { bytes, uploaded: new Date(), contentType: opts?.httpMetadata?.contentType }); },
    async get(key: string) {
      const o = objects.get(key);
      return o ? { body: new Blob([o.bytes]).stream(), uploaded: o.uploaded, httpMetadata: { contentType: o.contentType } } : null;
    },
    async list({ prefix }: { prefix: string }) {
      return { objects: [...objects].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, uploaded: o.uploaded })), truncated: false };
    },
    async delete(keys: string[]) { for (const k of keys) objects.delete(k); },
  };
}

test("story images: stored under an unguessable key, served publicly, then expire", async () => {
  const bucket = fakeBucket();
  const env = { R2_PHOTOS: bucket } as unknown as Env;
  const png = new Uint8Array([137, 80, 78, 71]).buffer;
  const path = await putStoryImage(env, 7, png, "image/png");
  assert.match(path ?? "", /^\/story\/[0-9a-f-]{36}\.png$/);
  const res = await serveStoryImage(env, path!);
  assert.equal(res?.headers.get("content-type"), "image/png");
  assert.equal(await serveStoryImage(env, "/story/../stories/x.png"), null);
  assert.equal(await serveStoryImage(env, "/story/not-a-uuid.png"), null);
  assert.equal(await putStoryImage(env, 7, png, "text/html"), null, "only images");
  assert.equal(await putStoryImage(env, 7, new ArrayBuffer(4 * 1024 * 1024), "image/png"), null, "size cap");
  // Age the object past the TTL: no longer served, and the sweep removes it.
  for (const o of bucket.objects.values()) o.uploaded = new Date(Date.now() - STORY_TTL_MS - 1000);
  assert.equal(await serveStoryImage(env, path!), null);
  assert.equal(await purgeExpiredStories(env), 1);
  assert.equal(bucket.objects.size, 0);
});

test("story images: no bucket configured means no story, not a crash", async () => {
  assert.equal(await putStoryImage({} as Env, 1, new ArrayBuffer(4), "image/png"), null);
  assert.equal(await serveStoryImage({} as Env, "/story/00000000-0000-0000-0000-000000000000.png"), null);
});
