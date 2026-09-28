// Strava connection endpoints for the Mini App, plus the public OAuth callback page.
//   GET    /api/strava          -- { available, connected, lastSyncAt, lastError }
//   POST   /api/strava/connect  -- { url } to open in the browser (Strava's authorize page)
//   POST   /api/strava/sync     -- { imported, days }
//   DELETE /api/strava          -- revoke + forget
//   GET    /strava/callback     -- Strava redirects here; not a Mini App call (no initData)
// Everything is hidden (available: false) until STRAVA_CLIENT_ID/SECRET are configured.
import { miniAppUser } from "./auth";
import { getStravaLink, signState, verifyState } from "../adapters/d1/v2Strava";
import { authorizeUrl, connectStrava, disconnectStrava, syncStrava, type StravaConfig } from "../features/strava/stravaSync";
import { getUser } from "../adapters/d1/v2Users";
import { escapeHtml, t } from "../locales/i18n";
import type { Env } from "../types";

export function stravaConfig(env: Env, origin: string): StravaConfig | null {
  if (!env.STRAVA_CLIENT_ID || !env.STRAVA_CLIENT_SECRET) return null;
  const base = (env.WORKER_URL || origin).replace(/\/$/, "");
  return { clientId: env.STRAVA_CLIENT_ID, clientSecret: env.STRAVA_CLIENT_SECRET, redirectUri: `${base}/strava/callback` };
}

export async function handleStravaApi(req: Request, url: URL, env: Env): Promise<Response> {
  const user = await miniAppUser(req, url, env);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const cfg = stravaConfig(env, url.origin);
  const noStore = { headers: { "cache-control": "no-store" } };
  if (req.method === "GET" && url.pathname === "/api/strava") {
    if (!cfg) return Response.json({ available: false, connected: false }, noStore);
    const link = await getStravaLink(env.DB, user._id, cfg.clientSecret);
    return Response.json({ available: true, connected: !!link, lastSyncAt: link?.lastSyncAt ?? null, lastError: link?.lastError ?? null }, noStore);
  }
  if (!cfg) return Response.json({ error: "not found" }, { status: 404 });
  if (req.method === "POST" && url.pathname === "/api/strava/connect") {
    return Response.json({ url: authorizeUrl(cfg, await signState(user._id, cfg.clientSecret)) });
  }
  if (req.method === "POST" && url.pathname === "/api/strava/sync") {
    try {
      return Response.json(await syncStrava(env.DB, cfg, user._id, user.lang));
    } catch (err) {
      const code = err instanceof Error ? err.message : "strava_error";
      return Response.json({ error: code === "strava_not_linked" ? "not found" : "unavailable" }, { status: code === "strava_not_linked" ? 404 : 503 });
    }
  }
  if (req.method === "DELETE" && url.pathname === "/api/strava") {
    await disconnectStrava(env.DB, cfg, user._id);
    return Response.json({ ok: true });
  }
  return Response.json({ error: "not found" }, { status: 404 });
}

function page(title: string, body: string, botUsername?: string): Response {
  const back = botUsername ? `<p><a href="https://t.me/${escapeHtml(botUsername)}">Telegram →</a></p>` : "";
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0d11;color:#eef1f6;font:17px/1.5 system-ui,sans-serif}main{max-width:26rem;padding:2rem}h1{font-size:1.5rem}a{color:#fc4c02}small{color:#8f99aa}</style></head>
<body><main><h1>${escapeHtml(title)}</h1><p>${body}</p>${back}<small>Powered by Strava</small></main></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

/** GET /strava/callback -- finishes OAuth, runs a first sync, and tells the user in the bot too. */
export async function handleStravaCallback(url: URL, env: Env): Promise<Response> {
  const cfg = stravaConfig(env, url.origin);
  if (!cfg) return new Response("Not found", { status: 404 });
  const accountId = await verifyState(url.searchParams.get("state") ?? "", cfg.clientSecret);
  const user = accountId ? await getUser(env.DB, accountId).catch(() => null) : null;
  const lang = user?.lang ?? "en";
  const code = url.searchParams.get("code");
  if (!user || !code || url.searchParams.get("error")) {
    return page(t(lang, "strava_connect_failed_title"), escapeHtml(t(lang, "strava_connect_failed_body")), env.BOT_USERNAME);
  }
  try {
    await connectStrava(env.DB, cfg, user._id, code, url.searchParams.get("scope") ?? "");
  } catch (err) {
    const scope = err instanceof Error && err.message === "strava_scope";
    return page(t(lang, "strava_connect_failed_title"), escapeHtml(t(lang, scope ? "strava_scope_missing" : "strava_connect_failed_body")), env.BOT_USERNAME);
  }
  const result = await syncStrava(env.DB, cfg, user._id, user.lang).catch(() => null);
  const message = result ? t(lang, "strava_connected_synced", { n: result.imported }) : t(lang, "strava_connected");
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: user.chatId, text: message, parse_mode: "HTML" }),
  }).catch(() => null);
  return page(t(lang, "strava_connected_title"), message, env.BOT_USERNAME);
}
