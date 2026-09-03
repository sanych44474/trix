// Trainer Mini App APIs:
//   /api/trainer/client/:id/(card|note|flag|billing)  — per-client ops on the client card
//   /api/trainer/questions (GET)                       — the trainer's Q&A inbox
//   /api/trainer/question/:id/answer (POST)            — answer a client question
// Same initData auth as the dashboard, plus a trainer-role gate; per-client ops also run the
// ownership check (getClientForTrainer — missing and not-yours both 404).
import {
  assignDraftPlan,
  createSession,
  deleteTrainerTemplate,
  getClientBilling,
  getClientCard,
  getClientForTrainer,
  getQuestion,
  getTrainerTemplate,
  getUser,
  insertMessage,
  listClients,
  listQuestionsForTrainer,
  listTrainerTemplates,
  recordAudit,
  saveDraftPlan,
  setClientBilling,
  setClientCard,
  setClientNote,
  setQuestionStatus,
  setUserFlag,
} from "../db/repos";
import { adaptPlan } from "../domain/planAdapt";
import { localParts } from "../domain/progression";
import { sessionTimeFor } from "../domain/sessionTz";
import { escapeHtml, t } from "../locales/i18n";
import { miniAppUser } from "./auth";
import { buildClientCardPayload } from "./clientCard";
import type { Env, UserDoc } from "../types";

const ROUTE = /^\/api\/trainer\/client\/(\d+)\/(card|note|flag|billing|session)$/;
const ANSWER_ROUTE = /^\/api\/trainer\/question\/(\d+)\/answer$/;
const MAX_TEXT = 2000;
const BOOK_HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];

async function tgSend(env: Env, chatId: number, text: string, replyMarkup?: unknown): Promise<void> {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }),
  }).catch(() => {});
}

/** "" clears (→ null); otherwise a trimmed string capped by validation. undefined = invalid. */
function textField(v: unknown): string | null | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (s.length > MAX_TEXT) return undefined;
  return s === "" ? null : s;
}

export async function handleTrainerApi(req: Request, url: URL, env: Env): Promise<Response> {
  const user = await miniAppUser(req, url, env);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "trainer") return Response.json({ error: "forbidden" }, { status: 403 });

  // Q&A inbox — list the trainer's client questions (pending first).
  if (req.method === "GET" && url.pathname === "/api/trainer/questions") {
    const qs = await listQuestionsForTrainer(env.DB, user._id, 30).catch(() => []);
    const names = new Map<number, string>();
    const out = [];
    for (const q of qs) {
      if (!names.has(q.clientId)) {
        const c = await getUser(env.DB, q.clientId).catch(() => null);
        names.set(q.clientId, c?.profile.name ?? `id ${q.clientId}`);
      }
      out.push({ id: q.id, clientId: q.clientId, client: names.get(q.clientId), text: q.text, draft: q.aiDraft ?? "", status: q.status });
    }
    return Response.json({ questions: out }, { headers: { "cache-control": "no-store" } });
  }

  // Program templates — list / delete / assign (activate for a client).
  if (url.pathname === "/api/trainer/templates") {
    if (req.method === "GET") {
      const tpls = await listTrainerTemplates(env.DB, user._id, 30).catch(() => []);
      return Response.json({ templates: tpls.map((tp) => ({ id: tp.id, name: tp.name })) }, { headers: { "cache-control": "no-store" } });
    }
    if (req.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });
    let b: Record<string, unknown>;
    try { b = (await req.json()) as Record<string, unknown>; } catch { return Response.json({ error: "bad request" }, { status: 400 }); }
    const id = Number(b.id);
    if (b.action === "delete") {
      const ok = await deleteTrainerTemplate(env.DB, user._id, id);
      return Response.json({ ok });
    }
    if (b.action === "assign") {
      const client = await getClientForTrainer(env.DB, user._id, Number(b.clientId));
      if (!client) return Response.json({ error: "not found" }, { status: 404 });
      const tpl = await getTrainerTemplate(env.DB, user._id, id);
      if (!tpl) return Response.json({ error: "not found" }, { status: 404 });
      const draft = adaptPlan(tpl.plan, client.profile, client._id, { authoredBy: user._id });
      await saveDraftPlan(env.DB, draft);
      await assignDraftPlan(env.DB, client._id);
      await recordAudit(env.DB, user._id, "template_assign", client._id, tpl.name).catch(() => {});
      await tgSend(env, client.chatId, t(client.lang, "client_plan_assigned"));
      return Response.json({ ok: true });
    }
    return Response.json({ error: "bad request" }, { status: 400 });
  }

  // Broadcast a message to all of the trainer's clients (composed + confirmed in the app).
  if (req.method === "POST" && url.pathname === "/api/trainer/broadcast") {
    let b: Record<string, unknown>;
    try { b = (await req.json()) as Record<string, unknown>; } catch { return Response.json({ error: "bad request" }, { status: 400 }); }
    const text = textField(b.text);
    if (!text) return Response.json({ error: "bad request" }, { status: 400 });
    const clients = await listClients(env.DB, user._id).catch(() => [] as UserDoc[]);
    const who = escapeHtml(user.profile.name ?? "trainer");
    let sent = 0;
    for (const c of clients) {
      await tgSend(env, c.chatId, t(c.lang, "tr_broadcast_from", { name: who }) + "\n\n" + escapeHtml(text.slice(0, 1500)));
      sent++;
    }
    await recordAudit(env.DB, user._id, "broadcast", undefined, `${sent}/${clients.length}`).catch(() => {});
    return Response.json({ ok: true, sent });
  }

  // Answer a client question — deliver to the client (chat push + stored message), mark answered.
  const am = ANSWER_ROUTE.exec(url.pathname);
  if (am) {
    if (req.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });
    const qid = Number(am[1]);
    const q = await getQuestion(env.DB, qid);
    if (!q || q.trainerId !== user._id) return Response.json({ error: "not found" }, { status: 404 });
    let body: Record<string, unknown>;
    try { body = (await req.json()) as Record<string, unknown>; } catch { return Response.json({ error: "bad request" }, { status: 400 }); }
    const text = textField(body.text);
    if (!text) return Response.json({ error: "bad request" }, { status: 400 });
    const client = await getUser(env.DB, q.clientId).catch(() => null);
    if (client) {
      await insertMessage(env.DB, user._id, q.clientId, text).catch(() => {});
      await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: client.chatId, text: t(client.lang, "answer_from_trainer", { text: escapeHtml(text) }), parse_mode: "HTML" }),
      }).catch(() => {});
    }
    await setQuestionStatus(env.DB, qid, "answered");
    return Response.json({ ok: true });
  }

  const m = ROUTE.exec(url.pathname);
  if (!m) return Response.json({ error: "not found" }, { status: 404 });
  const clientId = Number(m[1]);
  const action = m[2] as "card" | "note" | "flag" | "billing" | "session";
  const client = await getClientForTrainer(env.DB, user._id, clientId);
  if (!client) return Response.json({ error: "not found" }, { status: 404 });

  if (req.method === "GET" && action === "card") {
    const payload = await buildClientCardPayload(env.DB, user, client);
    return Response.json(payload, { headers: { "cache-control": "no-store" } });
  }
  if (req.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "bad request" }, { status: 400 });
  }

  try {
    if (action === "card") {
      const patch: { healthNotes?: string | null; personalNotes?: string | null; birthday?: string | null } = {};
      for (const key of ["healthNotes", "personalNotes"] as const) {
        if (body[key] === undefined) continue;
        const v = textField(body[key]);
        if (v === undefined) return Response.json({ error: "bad request" }, { status: 400 });
        patch[key] = v;
      }
      if (body.birthday !== undefined) {
        const v = textField(body.birthday);
        if (v === undefined) return Response.json({ error: "bad request" }, { status: 400 });
        // Canonical stored forms only: YYYY-MM-DD or MM-DD (year unknown); "" cleared to null above.
        if (v !== null && !/^\d{4}-\d{2}-\d{2}$/.test(v) && !/^\d{2}-\d{2}$/.test(v)) {
          return Response.json({ error: "bad request" }, { status: 400 });
        }
        patch.birthday = v;
      }
      await setClientCard(env.DB, user._id, clientId, patch);
      const card = await getClientCard(env.DB, user._id, clientId);
      return Response.json({
        card: card
          ? { healthNotes: card.healthNotes, personalNotes: card.personalNotes, birthday: card.birthday }
          : null,
      });
    }
    if (action === "note") {
      const note = textField(body.note);
      if (note === undefined) return Response.json({ error: "bad request" }, { status: 400 });
      await setClientNote(env.DB, user._id, clientId, note ?? "");
      return Response.json({ note });
    }
    if (action === "billing") {
      const patch: { paidUntil?: string | null; sessionsLeft?: number | null } = {};
      if (body.paidUntil !== undefined) {
        const v = body.paidUntil;
        if (v === null || v === "") patch.paidUntil = null;
        else if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) patch.paidUntil = v;
        else return Response.json({ error: "bad request" }, { status: 400 });
      }
      if (body.sessionsLeft !== undefined) {
        const v = body.sessionsLeft;
        if (v === null || v === "") patch.sessionsLeft = null;
        else if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 999) patch.sessionsLeft = v;
        else return Response.json({ error: "bad request" }, { status: 400 });
      }
      await setClientBilling(env.DB, user._id, clientId, patch);
      const b = await getClientBilling(env.DB, user._id, clientId);
      return Response.json({ billing: { paidUntil: b?.paidUntil ?? null, sessionsLeft: b?.sessionsLeft ?? null } });
    }
    if (action === "session") {
      // Propose a session (two-party): booked in the TRAINER's tz; the client gets a chat push
      // with confirm/decline buttons (the existing sess:ok / sess:no bot callbacks).
      const date = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : null;
      const hour = Number(body.hour);
      const today = localParts(user.profile.timezone).date;
      if (!date || date < today || !BOOK_HOURS.includes(hour)) return Response.json({ error: "bad request" }, { status: 400 });
      const tz = user.profile.timezone;
      const id = await createSession(env.DB, { trainerId: user._id, clientId, date, hour, proposedBy: "trainer", tz });
      const forClient = sessionTimeFor(date, hour, tz, client.profile.timezone);
      const kb = { inline_keyboard: [[{ text: t(client.lang, "sess_confirm_btn"), callback_data: `sess:ok:${id}` }, { text: t(client.lang, "sess_decline_btn"), callback_data: `sess:no:${id}` }]] };
      await tgSend(env, client.chatId, t(client.lang, "sess_proposed_trainer", { name: escapeHtml(user.profile.name ?? "trainer"), date: forClient.date, hour: forClient.hour }), kb);
      return Response.json({ ok: true, date, hour });
    }
    // action === "flag" — mirrors the bot's toggle: setUserFlag + audit trail.
    if (typeof body.flagged !== "boolean") return Response.json({ error: "bad request" }, { status: 400 });
    await setUserFlag(env.DB, clientId, body.flagged);
    await recordAudit(env.DB, user._id, body.flagged ? "flag_client" : "unflag_client", clientId);
    return Response.json({ flagged: body.flagged });
  } catch (err) {
    console.error("api/trainer error", user._id, action, err);
    return Response.json({ error: "error" }, { status: 500 });
  }
}
