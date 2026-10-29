// Strava connection endpoints for the Mini App, plus the public OAuth callback page.
//   GET    /api/strava          -- { available, connected, lastSyncAt, lastError }
//   POST   /api/strava/connect  -- { url } to open in the browser (Strava's authorize page)
//   POST   /api/strava/sync     -- { imported, days }
//   DELETE /api/strava          -- revoke + forget
//   GET    /strava/callback     -- Strava redirects here; not a Mini App call (no initData)
// Everything is hidden (available: false) until STRAVA_CLIENT_ID/SECRET are configured.
import { sendBestEffort } from "../adapters/telegram/rawApi";
import { miniAppUser } from "./auth";
import { getStravaLink, signState, verifyState } from "../adapters/d1/v2Strava";
import { authorizeUrl, connectStrava, disconnectStrava, stravaConfig, syncStrava, type StravaConfig } from "../features/strava/stravaSync";
import { getUser } from "../adapters/d1/v2Users";
import { escapeHtml, t } from "../locales/i18n";
import type { Env, Lang, UserDoc } from "../types";
import { typedFailure } from "./failure";
import { readMultipartBody } from "./validate";

export async function handleStravaApi(req: Request, url: URL, env: Env): Promise<Response> {
  const user = await miniAppUser(req, url, env);
  if (!user) return typedFailure(401, "unauthorized", "unauthorized");
  const cfg = stravaConfig(env, url.origin);
  const noStore = { headers: { "cache-control": "no-store" } };
  if (req.method === "GET" && url.pathname === "/api/strava") {
    if (!cfg) return Response.json({ available: false, connected: false }, noStore);
    const link = await getStravaLink(env.DB, user._id, cfg.clientSecret);
    return Response.json({ available: true, connected: !!link, lastSyncAt: link?.lastSyncAt ?? null, lastError: link?.lastError ?? null }, noStore);
  }
  if (!cfg) return typedFailure(404, "not_found", "not found");
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
  return typedFailure(404, "not_found", "not found");
}

function page(title: string, body: string, botUsername?: string, form = ""): Response {
  // Only a well-formed Telegram username reaches the href: escapeHtml doesn't escape quotes, so
  // an attribute must never receive anything outside [A-Za-z0-9_].
  const back = botUsername && /^[A-Za-z0-9_]{3,64}$/.test(botUsername) ? `<p><a href="https://t.me/${encodeURIComponent(botUsername)}">Telegram →</a></p>` : "";
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0d11;color:#eef1f6;font:17px/1.5 system-ui,sans-serif}main{max-width:26rem;padding:2rem}h1{font-size:1.5rem}a{color:#fc4c02}small{color:#8f99aa}button{margin-top:.5rem;padding:.6rem 1.2rem;border:0;border-radius:.5rem;background:#fc4c02;color:#fff;font:inherit;cursor:pointer}</style></head>
<body><main><h1>${escapeHtml(title)}</h1><p>${body}</p>${form}${back}<small>Powered by Strava</small></main></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

// The confirm form posts these back. Each is checked against a strict pattern before it goes into
// an attribute, because escapeHtml doesn't escape quotes.
const STATE_RE = /^\d+\.\d+\.[0-9a-f]{32}$/;
const CODE_RE = /^[A-Za-z0-9]{1,128}$/;
const SCOPE_RE = /^[a-z_:,]{0,200}$/;
const MAX_FORM_BYTES = 4096;

/** Verifies the redirect's fields: the signed state's account, then the code and scope formats. */
async function readCallback(params: URLSearchParams, cfg: StravaConfig, env: Env) {
  const state = params.get("state") ?? "";
  const code = params.get("code") ?? "";
  const scope = params.get("scope") ?? "";
  const accountId = STATE_RE.test(state) ? await verifyState(state, cfg.clientSecret) : null;
  const user = accountId ? await getUser(env.DB, accountId).catch(() => null) : null;
  const ok = !!user && CODE_RE.test(code) && SCOPE_RE.test(scope) && !params.get("error");
  return { user, ok, state, code, scope };
}

function failedPage(lang: Lang, env: Env): Response {
  return page(t(lang, "strava_connect_failed_title"), escapeHtml(t(lang, "strava_connect_failed_body")), env.BOT_USERNAME);
}

/** Links the account, runs a first sync, and tells the user in the bot too. */
async function connectAndSync(env: Env, cfg: StravaConfig, user: UserDoc, code: string, scope: string): Promise<Response> {
  const lang = user.lang;
  try {
    await connectStrava(env.DB, cfg, user._id, code, scope);
  } catch (err) {
    const scopeMissing = err instanceof Error && err.message === "strava_scope";
    return page(t(lang, "strava_connect_failed_title"), escapeHtml(t(lang, scopeMissing ? "strava_scope_missing" : "strava_connect_failed_body")), env.BOT_USERNAME);
  }
  const result = await syncStrava(env.DB, cfg, user._id, user.lang).catch(() => null);
  const message = result ? t(lang, "strava_connected_synced", { n: result.imported }) : t(lang, "strava_connected");
  await sendBestEffort(env, user.chatId, message);
  return page(t(lang, "strava_connected_title"), message, env.BOT_USERNAME);
}

/** GET /strava/callback -- Strava's redirect. Links nothing: it asks the user to confirm first. A link
 *  the attacker started would otherwise connect the victim's Strava to the attacker's account. */
export async function handleStravaCallback(url: URL, env: Env): Promise<Response> {
  const cfg = stravaConfig(env, url.origin);
  if (!cfg) return new Response("Not found", { status: 404 });
  const cb = await readCallback(url.searchParams, cfg, env);
  if (!cb.user || !cb.ok) return failedPage(cb.user?.lang ?? "en", env);
  const lang = cb.user.lang;
  const name = cb.user.profile?.name || t(lang, "strava_confirm_fallback_name");
  const form = `<form method="post" action="/strava/callback"><input type="hidden" name="code" value="${cb.code}"><input type="hidden" name="state" value="${cb.state}"><input type="hidden" name="scope" value="${cb.scope}"><button type="submit">${escapeHtml(t(lang, "strava_confirm_button"))}</button></form>`;
  return page(t(lang, "strava_confirm_title"), t(lang, "strava_confirm_body", { name }), undefined, form);
}

/** POST /strava/callback -- the confirm page's form. Connects the account, as the GET used to. */
export async function handleStravaConnectPost(req: Request, url: URL, env: Env): Promise<Response> {
  const cfg = stravaConfig(env, url.origin);
  if (!cfg) return new Response("Not found", { status: 404 });
  // Public route: the body is counted as it is read, so a chunked request cannot make it buffer more.
  const parsed = await readMultipartBody(req, MAX_FORM_BYTES);
  if (!parsed.ok) return parsed.response;
  const params = new URLSearchParams();
  for (const key of ["code", "state", "scope", "error"]) {
    const value = parsed.form?.get(key);
    if (typeof value === "string") params.set(key, value);
  }
  const cb = await readCallback(params, cfg, env);
  if (!cb.user || !cb.ok) return failedPage(cb.user?.lang ?? "en", env);
  return connectAndSync(env, cfg, cb.user, cb.code, cb.scope);
}
