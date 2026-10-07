// Trainer <-> client chat in the Mini App. Both sides read the same v2_messages thread; opening it
// marks the peer's messages read. A new message pings the recipient in Telegram with a button
// back into the thread -- once per burst: while earlier messages from the same sender are still
// unread (sent in the last CHAT_PUSH_QUIET_MIN minutes), the next ones don't ping again.
//
// The trainer can ask the AI for a draft reply in their own voice (POST /api/chat/draft); it only
// fills the trainer's input box, nothing is sent until the trainer sends it.
import { aiText } from "../ai/index";
import { getUser } from "../adapters/d1/v2Users";
import { getClientForTrainer, getTrainer, insertMessage, listMessages, markThreadRead, unreadBySender, unreadFromSince } from "../adapters/d1/v2Trainer";
import { appMarkup } from "../notify/appKeyboard";
import { cleanAi, escapeHtml, t } from "../locales/i18n";
import { logInfo } from "../log";
import { miniAppUser } from "./auth";
import { readJsonBody } from "./validate";
import { runIdempotent } from "../adapters/d1/v2Idempotency";
import type { Env, UserDoc } from "../types";

export const MAX_CHAT_TEXT = 2000;
export const CHAT_PUSH_QUIET_MIN = 15;

/** The other side of the viewer's thread: a client's own trainer, or one of the trainer's clients. */
export async function chatPeer(env: Env, user: UserDoc, withId?: number): Promise<UserDoc | null> {
  if (withId && withId !== user.trainerId) return getClientForTrainer(env.DB, user._id, withId).catch(() => null);
  if (user.role === "client" && user.trainerId) return getUser(env.DB, user.trainerId).catch(() => null);
  return null;
}

async function push(env: Env, from: UserDoc, to: UserDoc, text: string): Promise<void> {
  const name = escapeHtml(from.profile.name ?? `id ${from._id}`);
  const toTrainer = from.trainerId === to._id;
  const markup = toTrainer
    ? appMarkup(env, t(to.lang, "nb_reply"), "role", { client: from._id })
    : appMarkup(env, t(to.lang, "nb_reply"), "coach");
  const preview = escapeHtml(text.length > 300 ? `${text.slice(0, 300)}…` : text);
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: to.chatId, text: t(to.lang, "chat_push", { name, text: preview }), parse_mode: "HTML", ...(markup ? { reply_markup: markup } : {}) }),
  }).catch(() => null);
}

export async function handleChatApi(req: Request, url: URL, env: Env): Promise<Response> {
  const user = await miniAppUser(req, url, env);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  if (url.pathname === "/api/chat/unread") {
    return Response.json({ bySender: await unreadBySender(env.DB, user._id).catch(() => ({})) }, { headers: { "cache-control": "no-store" } });
  }

  if (url.pathname === "/api/chat" && req.method === "GET") {
    const peer = await chatPeer(env, user, Number(url.searchParams.get("with")) || undefined);
    if (!peer) return Response.json({ error: "not found" }, { status: 404 });
    const messages = await listMessages(env.DB, user._id, peer._id, 100);
    await markThreadRead(env.DB, user._id, peer._id).catch(() => {});
    return Response.json({
      peer: { id: peer._id, name: peer.profile.name ?? "", isTrainer: user.trainerId === peer._id },
      messages: messages.map((m) => ({ id: m.id, fromMe: m.fromId === user._id, text: m.text, createdAt: m.createdAt, read: m.fromId === user._id ? !!m.readAt : true })),
    }, { headers: { "cache-control": "no-store" } });
  }

  if (req.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body as Record<string, unknown>;
  const peer = await chatPeer(env, user, Number(body.with) || undefined);
  if (!peer) return Response.json({ error: "not found" }, { status: 404 });

  if (url.pathname === "/api/chat") {
    const text = typeof body.text === "string" ? body.text.trim().slice(0, MAX_CHAT_TEXT) : "";
    if (!text) return Response.json({ error: "bad request" }, { status: 400 });
    const res = await runIdempotent(env.DB, user._id, req.headers.get("idempotency-key"), async () => {
      const quietSince = new Date(Date.now() - CHAT_PUSH_QUIET_MIN * 60_000).toISOString();
      const alreadyPinged = (await unreadFromSince(env.DB, peer._id, user._id, quietSince).catch(() => 0)) > 0;
      const id = await insertMessage(env.DB, user._id, peer._id, text);
      if (!alreadyPinged) await push(env, user, peer, text);
      logInfo("chat_message_sent", { fromTrainer: peer.trainerId === user._id, pinged: !alreadyPinged });
      return { status: 200, body: { ok: true, id } };
    });
    return Response.json(res.body, { status: res.status });
  }

  // AI draft of the trainer's reply to the client's latest messages, in the trainer's own style.
  if (url.pathname === "/api/chat/draft") {
    if (peer.trainerId !== user._id) return Response.json({ error: "forbidden" }, { status: 403 });
    const thread = (await listMessages(env.DB, user._id, peer._id, 12)).map((m) => `${m.fromId === user._id ? "Trainer" : "Client"}: ${m.text}`).join("\n");
    if (!thread) return Response.json({ draft: "" });
    const trainer = await getTrainer(env.DB, user._id).catch(() => null);
    const style = trainer ? `Match this trainer's own stated style: ${[trainer.specialization, trainer.approach, trainer.bio].filter(Boolean).join(" | ")}. ` : "";
    const draft = cleanAi(await aiText(env, {
      system:
        "You are drafting the next chat message a human fitness trainer sends to their own client. Write as the TRAINER, " +
        `ready to send unedited, answering the client's latest messages. ${style}` +
        "Never give a medical diagnosis -- for pain, injury or medical concerns, suggest seeing a professional. " +
        `Answer in ${user.lang === "uk" ? "Ukrainian" : "English"}. Plain text, no markdown, at most 8 short lines.`,
      user: thread,
      temperature: 0.7,
      kind: "coach",
      db: env.DB,
      userId: user._id,
    }).catch(() => "")).slice(0, 1500);
    return Response.json({ draft });
  }

  return Response.json({ error: "not found" }, { status: 404 });
}
