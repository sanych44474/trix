// Signs the /v tracking redirect (src/index.ts's handler) so a forged `uid` can't inflate a
// stranger's video_open counter. GET /v?u=<url>&uid=<id> used to trust `uid` outright -- anyone
// could hit it with any id and bump someone else's count with no authentication at all.
//
// Not a credential: an unsigned or mismatched link still redirects the viewer to the video, it
// just doesn't get counted. That means a link generated before this landed (already sent, cached
// in a rendered message, or on an old client) keeps working -- only its tracking silently stops,
// never the actual "open the video" UX this exists to make convenient.
//
// Same HMAC-SHA256 mechanism as initData.ts's Telegram signature check, keyed on the bot token
// (already the shared secret every client of this bot proves knowledge of), but this is a
// separate concern with a separate payload -- a fixed (uid, url) pair, not initData's whole field
// set -- so it gets its own small module rather than overloading that one.
async function hmacKey(botToken: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(botToken), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

function payload(uid: number, targetUrl: string): string {
  return `${uid}:${targetUrl}`;
}

// Truncated to 8 bytes (16 hex chars): this MACs one fixed (uid, url) pair for the bot's own
// redirect, not a bearer credential guarding anything sensitive -- 2^64 is far past what's worth
// spending to forge a low-value analytics counter, and the short param keeps the link tidy.
export async function signVideoOpen(uid: number, targetUrl: string, botToken: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(botToken), new TextEncoder().encode(payload(uid, targetUrl)));
  return [...new Uint8Array(sig)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyVideoOpen(uid: number, targetUrl: string, sig: string, botToken: string): Promise<boolean> {
  if (!sig) return false;
  return (await signVideoOpen(uid, targetUrl, botToken)) === sig;
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
