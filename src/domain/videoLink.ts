// Signs the /v tracking redirect (src/index.ts's handler) so a forged `uid` can't inflate a
// stranger's video_open counter. GET /v?u=<url>&uid=<id> used to trust `uid` outright -- anyone
// could hit it with any id and bump someone else's count with no authentication at all.
//
// Not a credential: an unsigned or mismatched link still redirects the viewer to the video, it
// just doesn't get counted. That means a link generated before this landed (already sent, cached
// in a rendered message, or on an old client) keeps working -- only its tracking silently stops,
// never the actual "open the video" UX this exists to make convenient.
//
// Same HMAC-SHA256 mechanism as initData.ts's Telegram signature check, but this is a separate
// concern with a separate payload -- a fixed (uid, url) pair, not initData's whole field set -- so
// it gets its own small module rather than overloading that one.
//
// The MAC key is derived from the bot token with a purpose label, so this signature cannot be
// replayed against any other link the bot mints (the weekly body map uses its own label).
import { hmacSha256, macHex, toHex, verifyMac } from "./secrets";

function payload(uid: number, targetUrl: string): string {
  return `${uid}:${targetUrl}`;
}

async function videoOpenKey(botToken: string): Promise<string> {
  return toHex(await hmacSha256(botToken, "trix:video-open:v1"));
}

// Truncated to 8 bytes (16 hex chars): this MACs one fixed (uid, url) pair for the bot's own
// redirect, not a bearer credential guarding anything sensitive -- 2^64 is far past what's worth
// spending to forge a low-value analytics counter, and the short param keeps the link tidy.
export async function signVideoOpen(uid: number, targetUrl: string, botToken: string): Promise<string> {
  return macHex(await videoOpenKey(botToken), payload(uid, targetUrl), 8);
}

export async function verifyVideoOpen(uid: number, targetUrl: string, sig: string, botToken: string): Promise<boolean> {
  if (await verifyMac(await videoOpenKey(botToken), payload(uid, targetUrl), sig, 8)) return true;
  // Legacy: links minted before the per-purpose key existed were MACed with the raw bot token and
  // are already in Telegram chats. Keep accepting them so those still count. Remove once they age out.
  return verifyMac(botToken, payload(uid, targetUrl), sig, 8);
}

/** Builds the full /v redirect link, signature included -- the ONE place every caller constructs
 * this URL, so the format can't drift between them and a new call site can't ship unsigned by
 * forgetting the step. Returns targetUrl unchanged when no baseUrl (WORKER_URL/APP_URL) is
 * configured, same as every existing call site already did for "not deployed yet." */
export async function buildVideoOpenLink(baseUrl: string | undefined, targetUrl: string, uid: number, botToken: string): Promise<string> {
  if (!baseUrl) return targetUrl;
  const sig = await signVideoOpen(uid, targetUrl, botToken);
  return `${baseUrl}/v?u=${encodeURIComponent(targetUrl)}&uid=${uid}&sig=${sig}`;
}
