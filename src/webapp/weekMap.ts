// GET /weekmap.png?s=<m|f>&z=<zones>&sig=<hmac> -- the weekly digest's body map picture.
// Telegram fetches this URL itself when the digest is sent with sendPhoto, so the drawing runs in
// its own request (its own CPU budget) and a failure only costs the picture: the scheduler then
// sends the digest as text. The link carries everything to draw (sex + one zone per muscle), so
// no database read; the HMAC (keyed on the bot token, like videoLink.ts) keeps it to links the bot
// minted. The image is deterministic, so it's cached as immutable.
import type { Env } from "../types";
import { TRACKED_MUSCLES } from "../domain/muscleLoad";
import { zonesToColors } from "../domain/weeklyReport";
import { renderBodyMapPng } from "../render/bodyMapPng";

const ZONES = new RegExp(`^[nboa]{${TRACKED_MUSCLES.length}}$`);

async function sign(sex: string, zones: string, botToken: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(botToken), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`weekmap:${sex}:${zones}`));
  return [...new Uint8Array(mac)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function weekMapUrl(baseUrl: string | undefined, sex: "male" | "female" | undefined, zones: string, botToken: string): Promise<string | null> {
  if (!baseUrl || !ZONES.test(zones)) return null;
  const s = sex === "female" ? "f" : "m";
  return `${baseUrl.replace(/\/$/, "")}/weekmap.png?s=${s}&z=${zones}&sig=${await sign(s, zones, botToken)}`;
}

export async function serveWeekMap(url: URL, env: Env): Promise<Response> {
  const s = url.searchParams.get("s") === "f" ? "f" : "m";
  const zones = url.searchParams.get("z") ?? "";
  const sig = url.searchParams.get("sig") ?? "";
  if (!ZONES.test(zones) || sig !== (await sign(s, zones, env.TELEGRAM_BOT_TOKEN))) return new Response("not found", { status: 404 });
  const png = await renderBodyMapPng({ colors: zonesToColors(zones), sex: s === "f" ? "female" : "male" });
  return new Response(png, { headers: { "content-type": "image/png", "cache-control": "public, max-age=31536000, immutable" } });
}
