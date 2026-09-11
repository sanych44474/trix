import { test } from "node:test";
import assert from "node:assert/strict";
import { cachePhoto, enforceStorageBudget, getCachedPhoto } from "../src/webapp/photoStorage";
import type { Env } from "../src/types";

function fakeEnv(bucket?: Partial<R2Bucket>): Env {
  return { R2_PHOTOS: bucket as R2Bucket | undefined } as Env;
}

const GB = 1024 * 1024 * 1024;

// One-page listing helper for enforceStorageBudget tests: objects sorted oldest-first by index.
function objectsOfSize(sizes: number[]) {
  return sizes.map((size, i) => ({ key: `progress-photos/${i}.jpg`, size, uploaded: new Date(2020, 0, i + 1) }));
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

test("enforceStorageBudget: no R2 binding configured -> checked:false, no-op", async () => {
  const result = await enforceStorageBudget(fakeEnv(undefined));
  assert.deepEqual(result, { checked: false, totalBytes: 0, evictedCount: 0, evictedBytes: 0 });
});

test("enforceStorageBudget: well under 80% of 10GB -> no eviction", async () => {
  const objects = objectsOfSize([1 * GB, 2 * GB]); // 3GB total, well under the 8GB (80%) trigger
  const deleteCalls: unknown[] = [];
  const env = fakeEnv({
    list: async () => ({ objects, truncated: false }) as never,
    delete: (async (keys: unknown) => { deleteCalls.push(keys); }) as never,
  });
  const result = await enforceStorageBudget(env);
  assert.deepEqual(result, { checked: true, totalBytes: 3 * GB, evictedCount: 0, evictedBytes: 0 });
  assert.equal(deleteCalls.length, 0);
});

test("enforceStorageBudget: at/over 80% -> evicts oldest-first down to the 65% target", async () => {
  // 9 x 1GB = 9GB total (over the 8GB/80% trigger). Target is 6.5GB (65%), so evicting the
  // 3 oldest (indices 0,1,2 -- oldest by `uploaded`) brings it to 6GB, under target.
  const objects = objectsOfSize(Array(9).fill(1 * GB));
  const deleteCalls: string[][] = [];
  const env = fakeEnv({
    list: async () => ({ objects, truncated: false }) as never,
    delete: (async (keys: string[]) => { deleteCalls.push(keys); }) as never,
  });
  const result = await enforceStorageBudget(env);
  assert.equal(result.checked, true);
  assert.equal(result.totalBytes, 9 * GB);
  assert.equal(result.evictedCount, 3);
  assert.equal(result.evictedBytes, 3 * GB);
  assert.equal(deleteCalls.length, 1);
  assert.deepEqual(deleteCalls[0], ["progress-photos/0.jpg", "progress-photos/1.jpg", "progress-photos/2.jpg"]);
});

test("enforceStorageBudget: paginates through a truncated listing before deciding", async () => {
  const page1 = objectsOfSize(Array(5).fill(1 * GB)).slice(0, 5); // indices 0-4
  const page2 = [{ key: "progress-photos/5.jpg", size: 4 * GB, uploaded: new Date(2020, 0, 6) }]; // index 5
  let calls = 0;
  const env = fakeEnv({
    list: (async (opts: { cursor?: string }) => {
      calls++;
      if (!opts?.cursor) return { objects: page1, truncated: true, cursor: "next" } as never;
      return { objects: page2, truncated: false } as never;
    }) as never,
    delete: async () => {},
  });
  const result = await enforceStorageBudget(env);
  assert.equal(calls, 2);
  assert.equal(result.totalBytes, 9 * GB); // both pages summed
});
