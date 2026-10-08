// Owner console in the Mini App: the /ownerreport sections rendered in-app (they're already
// Telegram-HTML — <b>/<i>/<pre> render natively in the webview), plus one-tap ops actions.
// Auth: initData user must BE the owner (chatId match); everyone else gets an opaque 404.
import { broadcastRelease, pendingReleaseRecipients } from "../bot/releaseBroadcast";
import { latestRelease } from "../releaseNotes";
import { getOwnerChatId, recordAudit } from "../adapters/d1/v2Admin";
import { listFeedback, updateFeedback } from "../adapters/d1/v2Feedback";
import { recordInbox } from "../adapters/d1/v2Inbox";
import { FEEDBACK_CATEGORIES, FEEDBACK_STATUSES, type FeedbackCategory, type FeedbackStatus } from "../domain/feedbackTriage";
import { readJsonBody } from "./validate";
import { getUser, listInactive, listOnboardedUsers, updateUser } from "../adapters/d1/v2Users";
import { appMarkup } from "../notify/appKeyboard";
import { deleteUserData } from "../adapters/d1/v2Account";
import { orAI, orEngagement, orErrors, orOnboarding, orOverview, orRetention, orTrainers, orUsers, ownerUsersData } from "../bot/ownerReport";
import { switchMode } from "../domain/session";
import { escapeHtml, t } from "../locales/i18n";
import { ImageBudgetError, generateImage } from "../ai/image";
import { miniAppUser } from "./auth";
import { nudgeOnboarding } from "./onboardingNudge";
import type { Env } from "../types";

const FB_ASK_COOLDOWN_DAYS = 14;
const RELEASE_BATCH = 25;
const USER_ACTION_ROUTE = /^\/api\/owner\/user\/(\d+)\/(block|unblock|delete|nudge)$/;

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
    else if (section === "retention") html = await orRetention(env.DB);
    else html = await orOverview(env.DB);
    return Response.json({ html }, { headers: { "cache-control": "no-store" } });
  }

  // Release notes to every chat, in batches small enough for one Worker request's subrequest
  // budget; each tap continues where the last stopped (bot/releaseBroadcast.ts marks deliveries).
  if (req.method === "GET" && path === "/api/owner/release") {
    return Response.json({ version: latestRelease().version, pending: await pendingReleaseRecipients(env) }, { headers: { "cache-control": "no-store" } });
  }
  if (req.method === "POST" && path === "/api/owner/release/send") {
    return Response.json(await broadcastRelease(env, user._id, RELEASE_BATCH));
  }

  // Announcement to every onboarded user (not banned, not blocked the bot), the in-app /announce.
  // Batches of RELEASE_BATCH by ascending account id: `after` is the last id the previous batch
  // reached, so each tap continues where the last stopped and nobody gets it twice.
  if (req.method === "POST" && path === "/api/owner/announce") {
    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;
    const b = parsed.body as Record<string, unknown>;
    const text = typeof b.text === "string" ? b.text.trim().slice(0, 3000) : "";
    const after = Math.max(0, Math.round(Number(b.after) || 0));
    if (!text) return Response.json({ error: "bad request" }, { status: 400 });
    const all = (await listOnboardedUsers(env.DB)).filter((u) => !u.blocked && !u.botBlocked).sort((a, b) => a._id - b._id);
    const batch = all.filter((u) => u._id > after).slice(0, RELEASE_BATCH);
    let sent = 0;
    let failed = 0;
    for (const u of batch) {
      const markup = appMarkup(env, t(u.lang, "launch_open_btn"), "today");
      const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: u.chatId, text: `📢 ${escapeHtml(text)}`, parse_mode: "HTML", ...(markup ? { reply_markup: markup } : {}) }),
      }).catch(() => null);
      if (res?.ok) sent++; else failed++;
    }
    const last = batch.at(-1)?._id ?? after;
    const remaining = all.filter((u) => u._id > last).length;
    await recordAudit(env.DB, user._id, "broadcast", undefined, `${sent}/${batch.length} (left ${remaining}): ${text.slice(0, 80)}`).catch(() => {});
    return Response.json({ sent, failed, total: all.length, remaining, next: remaining > 0 ? last : null });
  }

  // Promo / story picture: FLUX on Workers AI (within the daily neuron budget), delivered to the
  // owner's own chat so it can be forwarded or saved from Telegram.
  if (req.method === "POST" && path === "/api/owner/image") {
    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;
    const prompt = typeof (parsed.body as { prompt?: unknown }).prompt === "string" ? (parsed.body as { prompt: string }).prompt.trim().slice(0, 1000) : "";
    if (prompt.length < 3) return Response.json({ error: "bad request" }, { status: 400 });
    let jpeg: Uint8Array;
    try {
      jpeg = await generateImage(env, env.DB, prompt);
    } catch (err) {
      if (err instanceof ImageBudgetError) return Response.json({ error: "rate_limited" }, { status: 429 });
      throw err;
    }
    const form = new FormData();
    form.append("chat_id", String(ownerChatId));
    form.append("caption", `🎨 ${prompt.slice(0, 1000)}`);
    form.append("photo", new Blob([jpeg], { type: "image/jpeg" }), "promo.jpg");
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`, { method: "POST", body: form }).catch(() => null);
    await recordAudit(env.DB, user._id, "promo_image", undefined, prompt.slice(0, 80)).catch(() => {});
    return Response.json({ ok: !!res?.ok });
  }

  // Feedback triage: the inbox as a list with a category and a status instead of a Telegram scroll.
  if (req.method === "GET" && path === "/api/owner/feedback") {
    const q = url.searchParams.get("status") ?? "new";
    const status = q === "all" || (FEEDBACK_STATUSES as readonly string[]).includes(q) ? (q as FeedbackStatus | "all") : "new";
    return Response.json(await listFeedback(env.DB, status), { headers: { "cache-control": "no-store" } });
  }
  const fbMatch = /^\/api\/owner\/feedback\/(\d+)$/.exec(path);
  if (req.method === "POST" && fbMatch) {
    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;
    const b = parsed.body as Record<string, unknown>;
    const status = (FEEDBACK_STATUSES as readonly string[]).includes(String(b.status)) ? (b.status as FeedbackStatus) : undefined;
    const category = (FEEDBACK_CATEGORIES as readonly string[]).includes(String(b.category)) ? (b.category as FeedbackCategory) : undefined;
    if (!status && !category) return Response.json({ error: "bad request" }, { status: 400 });
    const before = await updateFeedback(env.DB, Number(fbMatch[1]), { status, category });
    if (!before) return Response.json({ error: "not found" }, { status: 404 });
    // "Your idea is live": only on the transition to done, only when asked, never twice.
    let notified = false;
    if (status === "done" && before.status !== "done" && b.notify === true) {
      const author = await getUser(env.DB, before.userId).catch(() => null);
      if (author && !author.blocked && !author.botBlocked) {
        const preview = before.text.replace(/^\[AI coach\]\s*/, "").split("\n")[0]!.slice(0, 140);
        const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: author.chatId, text: t(author.lang, "feedback_done_user", { text: escapeHtml(preview) }), parse_mode: "HTML" }),
        }).catch(() => null);
        notified = !!res?.ok;
        await recordInbox(env.DB, author._id, "feedback_done", { preview }).catch(() => {});
      }
    }
    return Response.json({ ok: true, notified });
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

  // Moderation: block/unblock/delete ANY user. Mirrors bot/owner.ts's ownerUserAction "block" /
  // "unblock" / "delok" branches exactly (same updateUser/deleteUserData calls, no new repo
  // function, no audit trail — the bot's own branches don't record one either). The bot's
  // two-tap delete confirm (ou:*:del shows a confirm/cancel keyboard, only ou:*:delok deletes) is
  // the app's safety bar for this — the Mini App mirrors it as a two-tap UI gate client-side
  // (see OwnerWorkspace's pendingDelete state) rather than a second server round trip.
  const um = USER_ACTION_ROUTE.exec(path);
  if (um) {
    if (req.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });
    const targetId = Number(um[1]);
    const action = um[2] as "block" | "unblock" | "delete" | "nudge";
    // The owner can't block/delete their own account through this console — self-lockout has no
    // recovery path in the Mini App (unlike the bot, which has no such guard but also isn't the
    // only door: /admin re-claims ownership by chat). Not present in the bot's own flow, but a
    // sane safety net for an irreversible action exposed as a one-tap button in a UI.
    if (targetId === user._id) return Response.json({ error: "bad request" }, { status: 400 });
    const target = await getUser(env.DB, targetId).catch(() => null);
    if (!target) return Response.json({ error: "not found" }, { status: 404 });
    if (action === "delete") {
      await deleteUserData(env, targetId);
      return Response.json({ ok: true });
    }
    // Push someone stuck in onboarding back to the first unanswered question (same message the
    // trainer's client card sends, worded as coming from trix rather than a trainer).
    if (action === "nudge") {
      const r = await nudgeOnboarding(env, target, "owner_intv_remind_text");
      if (r.alreadyOnboarded) return Response.json({ error: "already onboarded" }, { status: 409 });
      return Response.json({ ok: true, sent: r.sent });
    }
    const blocked = action === "block";
    await updateUser(env.DB, targetId, blocked ? { blocked: true } : { blocked: false, botBlocked: false });
    return Response.json({ ok: true, blocked });
  }

  return Response.json({ error: "not found" }, { status: 404 });
}
