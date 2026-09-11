import { test } from "node:test";
import assert from "node:assert/strict";
import { cachePhoto, getCachedPhoto } from "../src/webapp/photoStorage";
import type { Env } from "../src/types";

function fakeEnv(bucket?: Partial<R2Bucket>): Env {
  return { R2_PHOTOS: bucket as R2Bucket | undefined } as Env;
}

test("getCachedPhoto: no R2 binding configured -> null, no throw", async () => {
  const result = await getCachedPhoto(fakeEnv(undefined), 1);
  assert.equal(result, null);
});

test("getCachedPhoto: bucket miss -> null", async () => {
  const env = fakeEnv({ get: async () => null });
  assert.equal(await getCachedPhoto(env, 1), null);
});

test("getCachedPhoto: bucket hit -> body + contentType (defaults to image/jpeg)", async () => {
  const body = new ReadableStream();
  const env = fakeEnv({ get: async () => ({ body, httpMetadata: {} }) as never });
  const result = await getCachedPhoto(env, 1);
  assert.ok(result);
  assert.equal(result!.body, body);
  assert.equal(result!.contentType, "image/jpeg");
});

test("getCachedPhoto: bucket hit with an explicit contentType -> uses it", async () => {
  const body = new ReadableStream();
  const env = fakeEnv({ get: async () => ({ body, httpMetadata: { contentType: "image/png" } }) as never });
  const result = await getCachedPhoto(env, 1);
  assert.equal(result!.contentType, "image/png");
});

test("getCachedPhoto: a bucket that throws is swallowed -> null", async () => {
  const env = fakeEnv({ get: async () => { throw new Error("r2 down"); } });
  assert.equal(await getCachedPhoto(env, 1), null);
});

test("cachePhoto: no R2 binding configured -> no-op, does not throw", async () => {
  await cachePhoto(fakeEnv(undefined), 1, new ArrayBuffer(4), "image/jpeg");
});

test("cachePhoto: puts under a stable per-photo key with the given content type", async () => {
  const calls: unknown[] = [];
  const env = fakeEnv({ put: (async (key: string, value: unknown, opts: unknown) => { calls.push([key, opts]); return {} as never; }) as never });
  await cachePhoto(env, 42, new ArrayBuffer(4), "image/png");
  assert.deepEqual(calls, [["progress-photos/42.jpg", { httpMetadata: { contentType: "image/png" } }]]);
});

test("cachePhoto: a bucket that throws is swallowed, not propagated", async () => {
  const env = fakeEnv({ put: async () => { throw new Error("r2 down"); } });
  await cachePhoto(env, 1, new ArrayBuffer(4), "image/jpeg");
});
