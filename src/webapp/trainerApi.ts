// Trainer Mini App APIs:
//   /api/trainer/client/:id/(card|note|flag)  — per-client ops on the client card
//   /api/trainer/questions (GET)              — the trainer's Q&A inbox
//   /api/trainer/question/:id/answer (POST)   — answer a client question
// Same initData auth as the dashboard, plus a trainer-role gate; per-client ops also run the
// ownership check (getClientForTrainer — missing and not-yours both 404).
import {
  recordAudit,
  setUserFlag,
} from "../adapters/d1/v2Admin";
import { assignDraftPlan, getActivePlan, saveDraftPlan } from "../adapters/d1/v2Plans";
import {
  deleteTrainerTemplate,
  getClientCard,
  getClientForTrainer,
  getQuestion,
  getTrainerTemplate,
  insertMessage,
  listClients,
  listQuestionsForTrainer,
  listTrainerTemplates,
  saveTrainerTemplate,
  setClientCard,
  setClientNote,
  setQuestionStatus,
} from "../adapters/d1/v2Trainer";
import { getUser, updateUser } from "../adapters/d1/v2Users";
import { runIdempotent } from "../adapters/d1/v2Idempotency";
import { logInfo } from "../log";
import { adaptPlan } from "../domain/planAdapt";
import { escapeHtml, t } from "../locales/i18n";
import { obKeyboard, obProgress, obSteps } from "../bot";
import { miniAppUser } from "./auth";
import { buildClientCardPayload } from "./clientCard";
import { readJsonBody } from "./validate";
import type { BankPlan, Env, UserDoc } from "../types";
import { apiFailure } from "./apiError";

const ROUTE = /^\/api\/trainer\/client\/(\d+)\/(card|note|flag|photo-request|interview-nudge)$/;
const ANSWER_ROUTE = /^\/api\/trainer\/question\/(\d+)\/answer$/;
const MAX_TEXT = 2000;

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
    const parsedTpl = await readJsonBody(req);
    if (!parsedTpl.ok) return parsedTpl.response;
    const b = parsedTpl.body as Record<string, unknown>;
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
    if (b.action === "create") {
      // "Save this client's current active plan as a reusable template" — the minimal
      // creation flow: no plan-authoring UI, just snapshot an existing plan for later reuse.
      const name = textField(b.name);
      if (!name) return Response.json({ error: "bad request" }, { status: 400 });
      const fromClientId = Number(b.fromClientId);
      if (!Number.isFinite(fromClientId)) return Response.json({ error: "bad request" }, { status: 400 });
      const client = await getClientForTrainer(env.DB, user._id, fromClientId);
      if (!client) return Response.json({ error: "not found" }, { status: 404 });
      const plan = await getActivePlan(env.DB, fromClientId);
      if (!plan) return Response.json({ error: "not found" }, { status: 404 });
      const bankPlan: BankPlan = {
        split: plan.split,
        nutrition: plan.nutrition,
        supplements: plan.supplements,
        methodology: plan.methodology,
        ...(plan.restDayNutrition ? { restDayNutrition: plan.restDayNutrition } : {}),
        ...(plan.movementAudit ? { movementAudit: plan.movementAudit } : {}),
        ...(plan.stepsTarget !== undefined ? { stepsTarget: plan.stepsTarget } : {}),
      };
      const newId = await saveTrainerTemplate(env.DB, user._id, name, bankPlan);
      await recordAudit(env.DB, user._id, "template_create", fromClientId, name).catch(() => {});
      return Response.json({ ok: true, id: newId });
    }
    return Response.json({ error: "bad request" }, { status: 400 });
  }

  // Broadcast a message to all of the trainer's clients (composed + confirmed in the app).
  if (req.method === "POST" && url.pathname === "/api/trainer/broadcast") {
    const parsedBc = await readJsonBody(req);
    if (!parsedBc.ok) return parsedBc.response;
    const b = parsedBc.body as Record<string, unknown>;
    const text = textField(b.text);
    if (!text) return Response.json({ error: "bad request" }, { status: 400 });
    // A lost-response retry must not message every client a second time.
    const bc = await runIdempotent(env.DB, user._id, req.headers.get("idempotency-key"), async () => {
      const clients = await listClients(env.DB, user._id).catch(() => [] as UserDoc[]);
      const who = escapeHtml(user.profile.name ?? "trainer");
      let sent = 0;
      for (const c of clients) {
        await tgSend(env, c.chatId, t(c.lang, "tr_broadcast_from", { name: who }) + "\n\n" + escapeHtml(text.slice(0, 1500)));
        sent++;
      }
      await recordAudit(env.DB, user._id, "broadcast", undefined, `${sent}/${clients.length}`).catch(() => {});
      return { status: 200, body: { ok: true, sent } };
    });
    return Response.json(bc.body, { status: bc.status });
  }

  // Answer a client question — deliver to the client (chat push + stored message), mark answered.
  const am = ANSWER_ROUTE.exec(url.pathname);
  if (am) {
    if (req.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });
    const qid = Number(am[1]);
    const q = await getQuestion(env.DB, qid);
    if (!q || q.trainerId !== user._id) return Response.json({ error: "not found" }, { status: 404 });
    const parsedAns = await readJsonBody(req);
    if (!parsedAns.ok) return parsedAns.response;
    const body = parsedAns.body as Record<string, unknown>;
    const text = textField(body.text);
    if (!text) return Response.json({ error: "bad request" }, { status: 400 });
    // The question's own status doesn't gate a re-answer (a trainer might legitimately amend),
    // so a lost-response retry must not double-message the client -- idempotency key only.
    const ans = await runIdempotent(env.DB, user._id, req.headers.get("idempotency-key"), async () => {
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
      logInfo("trainer_question_answered", {});
      return { status: 200, body: { ok: true } };
    });
    return Response.json(ans.body, { status: ans.status });
  }

  const m = ROUTE.exec(url.pathname);
  if (!m) return Response.json({ error: "not found" }, { status: 404 });
  const clientId = Number(m[1]);
  const action = m[2] as "card" | "note" | "flag" | "photo-request" | "interview-nudge";
  const client = await getClientForTrainer(env.DB, user._id, clientId);
  if (!client) return Response.json({ error: "not found" }, { status: 404 });

  if (req.method === "GET" && action === "card") {
    const payload = await buildClientCardPayload(env.DB, user, client);
    return Response.json(payload, { headers: { "cache-control": "no-store" } });
  }
  if (req.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });

  const parsedCard = await readJsonBody(req);
  if (!parsedCard.ok) return parsedCard.response;
  const body = parsedCard.body as Record<string, unknown>;

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
    if (action === "flag") {
      // Mirrors the bot's toggle: setUserFlag + audit trail.
      if (typeof body.flagged !== "boolean") return Response.json({ error: "bad request" }, { status: 400 });
      await setUserFlag(env.DB, clientId, body.flagged);
      await recordAudit(env.DB, user._id, body.flagged ? "flag_client" : "unflag_client", clientId);
      return Response.json({ flagged: body.flagged });
    }
    if (action === "photo-request") {
      // Mirrors the bot's cl:*:photo action (features/trainer/trainer.ts) exactly: park the
      // client's session so their next photo upload routes to this trainer, then push the same
      // prompt (with the same skip button) the bot sends. No new repo function, no audit trail —
      // the bot action doesn't record one either.
      await updateUser(env.DB, clientId, { session: { ...client.session, photoReviewFor: user._id } });
      const trName = escapeHtml(user.profile.name ?? "trainer");
      const kb = { inline_keyboard: [[{ text: t(client.lang, "photo_req_skip_btn"), callback_data: "photo:skip" }]] };
      await tgSend(env, client.chatId, t(client.lang, "photo_req_from", { name: trName }), kb);
      return Response.json({ ok: true });
    }
    // action === "interview-nudge" — mirrors the bot's cl:*:intvping action: resume the AI
    // interview transcript if one is in progress, else resume/restart the button wizard at the
    // first unanswered step. A no-op (ok:true, alreadyOnboarded:true) once the client is done —
    // the bot's own action just shows the summary at that point, nothing to nudge.
    if (client.onboarded) return Response.json({ ok: true, alreadyOnboarded: true });
    const prefix = t(client.lang, "cc_intv_remind_text");
    const transcript = client.session.transcript;
    if (client.session.mode === "onboarding" && transcript?.length) {
      const lastQ = [...transcript].reverse().find((entry) => entry.role === "assistant");
      await tgSend(env, client.chatId, `${prefix}\n\n${escapeHtml(lastQ?.text ?? "")}`.trim());
    } else {
      const step = client.session.mode === "onboarding" && typeof client.session.step === "number" ? client.session.step : obProgress(client.profile).next;
      await updateUser(env.DB, clientId, { session: { mode: "onboarding", step } });
      const steps = obSteps(client.lang);
      const idx = Math.max(0, Math.min(step, steps.length - 1));
      const stepDef = steps[idx];
      const text = `${prefix}\n\n(${idx + 1}/${steps.length}) ${t(client.lang, stepDef.q)}`;
      await tgSend(env, client.chatId, text, obKeyboard(client.lang, stepDef, client.profile.trainingWeekdays ?? [], idx > 0));
    }
    return Response.json({ ok: true });
  } catch (err) {
    return apiFailure(env, "api_trainer", err, { userId: user._id, action });
  }
}
