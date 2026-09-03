// Owner console in the Mini App: the /ownerreport sections rendered in-app (they're already
// Telegram-HTML — <b>/<i>/<pre> render natively in the webview), plus one-tap ops actions.
// Auth: initData user must BE the owner (chatId match); everyone else gets an opaque 404.
import { getOwnerChatId, listInactive, updateUser } from "../db/repos";
import { orAI, orEngagement, orErrors, orOnboarding, orOverview, orTrainers, orUsers, ownerUsersData } from "../bot/owner";
import { switchMode } from "../domain/session";
import { t } from "../locales/i18n";
import { miniAppUser } from "./auth";
import type { Env } from "../types";

const FB_ASK_COOLDOWN_DAYS = 14;

export async function handleOwnerApi(req: Request, url: URL, env: Env): Promise<Response> {
  const user = await miniAppUser(req, url, env);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const ownerChatId = await getOwnerChatId(env.DB).catch(() => undefined);
  if (!ownerChatId || ownerChatId !== user.chatId) return Response.json({ error: "not found" }, { status: 404 });
  const path = url.pathname;

  // Structured user rows for the in-app sortable/groupable table (richer than the text report).
  if (req.method === "GET" && path === "/api/owner/users") {
    return Response.json(await ownerUsersData(env.DB), { headers: { "cache-control": "no-store" } });
  }

  if (req.method === "GET" && path === "/api/owner/report") {
    const section = url.searchParams.get("section") ?? "overview";
    let html: string;
    if (section === "ai") html = await orAI(env.DB, env);
    else if (section === "trainers") html = await orTrainers(env.DB);
    else if (section === "onboarding") html = await orOnboarding(env.DB);
    else if (section === "errors") html = await orErrors(env.DB);
    else if (section === "events") html = await orEngagement(env.DB);
    else if (section === "users") html = await orUsers(env.DB);
    else html = await orOverview(env.DB);
    return Response.json({ html }, { headers: { "cache-control": "no-store" } });
  }

  // Feedback ask to users quiet for 7+ days: pushes a "what's missing?" question and parks
  // their session in inact_feedback so their next typed reply lands in the feedback inbox.
  // Per-user cooldown via reminders.sent.fb_ask so repeat taps don't spam the same people.
  if (req.method === "POST" && path === "/api/owner/ask-inactive") {
    const nowIso = new Date().toISOString();
    const today = nowIso.slice(0, 10);
    const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const floor = new Date(Date.now() - FB_ASK_COOLDOWN_DAYS * 86_400_000).toISOString().slice(0, 10);
    const targets = (await listInactive(env.DB, cutoff, nowIso, 200)).filter((u) => {
      if (u._id === user._id || u.botBlocked || u.blocked) return false;
      const asked = u.reminders?.sent?.fb_ask;
      return !asked || asked < floor;
    });
    let sent = 0;
    for (const u of targets) {
      const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: u.chatId, text: t(u.lang, "inact_fb_ask"), parse_mode: "HTML" }),
      }).catch(() => null);
      if (res?.ok) {
        sent++;
        await updateUser(env.DB, u._id, {
          session: switchMode(u.session, "inact_feedback"),
          reminders: { ...u.reminders, sent: { ...u.reminders?.sent, fb_ask: today } },
        }).catch(() => {});
      }
    }
    return Response.json({ sent, total: targets.length });
  }

  return Response.json({ error: "not found" }, { status: 404 });
}
