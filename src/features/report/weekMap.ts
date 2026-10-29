// GET /weekmap.png?s=<m|f>&z=<zones>&sig=<hmac> -- the weekly digest's body map picture.
// Telegram fetches this URL itself when the digest is sent with sendPhoto, so the drawing runs in
// its own request (its own CPU budget) and a failure only costs the picture: the scheduler then
// sends the digest as text. The link carries everything to draw (sex + one zone per muscle), so
// no database read; the HMAC (keyed on a bot-token-derived key, like videoLink.ts) keeps it to links
// the bot minted. The image is deterministic, so it's cached as immutable.
import type { Env } from "../../types";
import { TRACKED_MUSCLES } from "../../domain/muscleLoad";
import { zonesToColors } from "../../domain/weeklyReport";
import { renderBodyMapPng } from "../../render/bodyMapPng";
import { hmacSha256, macHex, toHex, verifyMac } from "../../domain/secrets";

const ZONES = new RegExp(`^[nboa]{${TRACKED_MUSCLES.length}}$`);

const payload = (sex: string, zones: string) => `weekmap:${sex}:${zones}`;

async function weekMapKey(botToken: string): Promise<string> {
  return toHex(await hmacSha256(botToken, "trix:weekmap:v1"));
}

export async function weekMapUrl(baseUrl: string | undefined, sex: "male" | "female" | undefined, zones: string, botToken: string): Promise<string | null> {
  if (!baseUrl || !ZONES.test(zones)) return null;
  const s = sex === "female" ? "f" : "m";
  return `${baseUrl.replace(/\/$/, "")}/weekmap.png?s=${s}&z=${zones}&sig=${await macHex(await weekMapKey(botToken), payload(s, zones), 8)}`;
}

export async function serveWeekMap(url: URL, env: Env): Promise<Response> {
  const s = url.searchParams.get("s") === "f" ? "f" : "m";
  const zones = url.searchParams.get("z") ?? "";
  const sig = url.searchParams.get("sig") ?? "";
  const token = env.TELEGRAM_BOT_TOKEN;
  const signed =
    (await verifyMac(await weekMapKey(token), payload(s, zones), sig, 8)) ||
    // Legacy: links sent in digests before the per-purpose key existed were MACed with the raw bot
    // token. Keep accepting them so those pictures still load. Remove once they age out.
    (await verifyMac(token, payload(s, zones), sig, 8));
  if (!ZONES.test(zones) || !signed) return new Response("not found", { status: 404 });
  const png = await renderBodyMapPng({ colors: zonesToColors(zones), sex: s === "f" ? "female" : "male" });
  return new Response(png, { headers: { "content-type": "image/png", "cache-control": "public, max-age=31536000, immutable" } });
}
