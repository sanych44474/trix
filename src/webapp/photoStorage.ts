// R2-backed cache for progress photos, in front of the Telegram-file-proxy path that's the only
// storage today (fileId in D1, bytes fetched from Telegram on every view). Two real problems that
// solves: every photo view costs two Telegram API round-trips, and a Telegram file_id is not a
// permanent handle -- it can go stale, at which point the photo is gone with no way to recover it.
//
// Deliberately a lazy read-through CACHE, not a migration: no schema change, no bulk backfill
// script, no behavior change until a bucket actually exists. `env.R2_PHOTOS` only exists once
// wrangler.toml declares the binding AND the bucket is created (both live/billable actions --
// not done by this code). Until then every call here is a no-op and every read falls straight
// through to Telegram, exactly like before this module existed.
import { logInfo } from "../log";
import type { Env } from "../types";

const KEY_PREFIX = "progress-photos/";

function r2Key(photoId: number): string {
  return `${KEY_PREFIX}${photoId}.jpg`;
}

/** Best-effort cache lookup. Never throws -- a misconfigured/unavailable bucket must fall back to
 * the Telegram proxy, not break photo viewing. */
export async function getCachedPhoto(env: Env, photoId: number): Promise<{ body: ReadableStream; contentType: string } | null> {
  if (!env.R2_PHOTOS) return null; // not configured -- not a "miss," nothing to log yet
  try {
    const obj = await env.R2_PHOTOS.get(r2Key(photoId));
    if (!obj) {
      logInfo("r2_cache_miss", {});
      return null;
    }
    logInfo("r2_cache_hit", {});
    return { body: obj.body, contentType: obj.httpMetadata?.contentType || "image/jpeg" };
  } catch {
    return null;
  }
}

/** Best-effort cache fill after a Telegram-proxy fetch, so the NEXT view of the same photo skips
 * Telegram entirely. Called via ctx.waitUntil -- must never throw into the caller's response
 * path, and must never be awaited on the response's critical path. */
export async function cachePhoto(env: Env, photoId: number, bytes: ArrayBuffer, contentType: string): Promise<void> {
  if (!env.R2_PHOTOS) return;
  await env.R2_PHOTOS.put(r2Key(photoId), bytes, { httpMetadata: { contentType } }).catch(() => {});
}

// R2's free tier is 10 GB-month of Standard storage (Cloudflare's own pricing page) -- this cache
// has no reason to ever get close to that for a handful of users, but nothing stops it from
// trying if the bucket just keeps filling. Act at 80% rather than wait for an overage bill.
const BUCKET_LIMIT_BYTES = 10 * 1024 * 1024 * 1024;
const BUDGET_THRESHOLD = 0.8;
// Evict down to a lower target, not right back up to the threshold -- otherwise the very next
// weekly check re-triggers eviction for one more object, over and over.
const EVICT_TARGET = 0.65;

export interface StorageBudgetResult {
  checked: boolean;
  totalBytes: number;
  evictedCount: number;
  evictedBytes: number;
}

/** Weekly safety valve (wired into scheduler.ts's existing weekly maintenance pass): if the cache
 * is approaching the R2 free tier's 10GB ceiling, evict the oldest-cached entries until back
 * under a lower target. This is a CACHE -- an evicted entry just means the next view re-fetches
 * from Telegram (the existing fallback), not data loss, UNLESS that specific photo's Telegram
 * file_id has since gone stale. That's an accepted, low-probability tradeoff (oldest-cached is
 * also the objects least likely to still be viewed) against the alternative of silently growing
 * past a free-tier budget with no cap at all. */
export async function enforceStorageBudget(env: Env): Promise<StorageBudgetResult> {
  if (!env.R2_PHOTOS) return { checked: false, totalBytes: 0, evictedCount: 0, evictedBytes: 0 };
  const bucket = env.R2_PHOTOS;

  const objects: { key: string; size: number; uploaded: Date }[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: KEY_PREFIX, cursor, limit: 1000 });
    for (const o of page.objects) objects.push({ key: o.key, size: o.size, uploaded: o.uploaded });
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  const totalBytes = objects.reduce((sum, o) => sum + o.size, 0);
  if (totalBytes < BUCKET_LIMIT_BYTES * BUDGET_THRESHOLD) {
    return { checked: true, totalBytes, evictedCount: 0, evictedBytes: 0 };
  }

  // Oldest-cached-first: there's no view-count tracking, so upload time is the best available
  // proxy for "safe to drop first" (also correlates with "cached longest ago," i.e. most likely
  // to already be re-fetchable or simply forgotten).
  objects.sort((a, b) => a.uploaded.getTime() - b.uploaded.getTime());
  const target = BUCKET_LIMIT_BYTES * EVICT_TARGET;
  let remaining = totalBytes;
  const toDelete: string[] = [];
  for (const o of objects) {
    if (remaining <= target) break;
    toDelete.push(o.key);
    remaining -= o.size;
  }
  for (let i = 0; i < toDelete.length; i += 1000) {
    await bucket.delete(toDelete.slice(i, i + 1000)); // delete() caps at 1000 keys per call
  }
  return { checked: true, totalBytes, evictedCount: toDelete.length, evictedBytes: totalBytes - remaining };
}
