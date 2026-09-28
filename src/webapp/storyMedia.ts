// Short-lived public images for Telegram's shareToStory. The Mini App draws a card (week summary,
// a new record) on a canvas; Telegram's story editor only accepts a public HTTPS URL, and a
// Telegram file URL would expose the bot token -- so the PNG goes to R2 under an unguessable key
// and is served without auth from /story/<key>.png, then deleted after STORY_TTL_MS.
//
// Public by design: the user is about to post this exact image to their own story. The key is a
// random UUID (122 bits), keys are never listed publicly, and the object is gone within two
// days, so the images are also out of scope for /deleteme (see purgeExpiredStories).
import type { Env } from "../types";

const PREFIX = "stories/";
export const STORY_TTL_MS = 2 * 86_400_000;
export const STORY_MAX_BYTES = 3 * 1024 * 1024;
const KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Stores a PNG/JPEG and returns the public path (without origin), or null when unavailable. */
export async function putStoryImage(env: Env, accountId: number, bytes: ArrayBuffer, contentType: string): Promise<string | null> {
  if (!env.R2_PHOTOS) return null;
  if (bytes.byteLength === 0 || bytes.byteLength > STORY_MAX_BYTES) return null;
  if (contentType !== "image/png" && contentType !== "image/jpeg") return null;
  const id = crypto.randomUUID();
  await env.R2_PHOTOS.put(`${PREFIX}${id}`, bytes, {
    httpMetadata: { contentType, cacheControl: "public, max-age=86400" },
    customMetadata: { accountId: String(accountId) },
  });
  return `/story/${id}.${contentType === "image/png" ? "png" : "jpg"}`;
}

/** GET /story/<uuid>.(png|jpg) -- null for anything that isn't a live story image. */
export async function serveStoryImage(env: Env, pathname: string): Promise<Response | null> {
  const m = /^\/story\/([0-9a-f-]{36})\.(png|jpg)$/.exec(pathname);
  if (!m || !KEY_RE.test(m[1]) || !env.R2_PHOTOS) return null;
  const obj = await env.R2_PHOTOS.get(`${PREFIX}${m[1]}`).catch(() => null);
  if (!obj || Date.now() - obj.uploaded.getTime() > STORY_TTL_MS) return null;
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType ?? "image/png",
      "cache-control": "public, max-age=86400",
      "x-content-type-options": "nosniff",
    },
  });
}

/** Deletes story images older than the TTL. Run from the daily cron. */
export async function purgeExpiredStories(env: Env, now = Date.now()): Promise<number> {
  if (!env.R2_PHOTOS) return 0;
  const expired: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.R2_PHOTOS.list({ prefix: PREFIX, cursor, limit: 1000 });
    for (const o of page.objects) if (now - o.uploaded.getTime() > STORY_TTL_MS) expired.push(o.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  for (let i = 0; i < expired.length; i += 1000) await env.R2_PHOTOS.delete(expired.slice(i, i + 1000));
  return expired.length;
}
