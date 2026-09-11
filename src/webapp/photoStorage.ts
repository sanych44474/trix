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
import type { Env } from "../types";

function r2Key(photoId: number): string {
  return `progress-photos/${photoId}.jpg`;
}

/** Best-effort cache lookup. Never throws -- a misconfigured/unavailable bucket must fall back to
 * the Telegram proxy, not break photo viewing. */
export async function getCachedPhoto(env: Env, photoId: number): Promise<{ body: ReadableStream; contentType: string } | null> {
  if (!env.R2_PHOTOS) return null;
  try {
    const obj = await env.R2_PHOTOS.get(r2Key(photoId));
    if (!obj) return null;
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
