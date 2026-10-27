// Trainer Mini App APIs:
//   /api/trainer/client/:id/(card|note|flag)  — per-client ops on the client card
//   /api/trainer/questions (GET)              — the trainer's Q&A inbox
//   /api/trainer/question/:id/answer (POST)   — answer a client question
// Same initData auth as the dashboard, plus a trainer-role gate; per-client ops also run the
// ownership check (getClientForTrainer — missing and not-yours both 404).
import { notifySafely, pingOther } from "../notify";
import { appMarkup } from "../notify/appKeyboard";
import { rawTelegramApi } from "../adapters/telegram/rawApi";
import { HTML } from "../adapters/telegram/context";
import {
  recordAudit,
  setUserFlag,
} from "../adapters/d1/v2Admin";
import { assignDraftPlan, deleteDraftPlan, getActivePlan, saveDraftPlan } from "../adapters/d1/v2Plans";
import { postponeAutoActivation } from "../staleDrafts";
import { deleteTrainerTemplate, getTrainerTemplate, listTrainerTemplates, saveTrainerTemplate } from "../adapters/d1/v2TrainerPrograms";
import { getClientCard, getClientForTrainer, listClients, setClientCard, setClientNote } from "../adapters/d1/v2Trainer";
import { getQuestion, insertMessage, listQuestionsForTrainer, setQuestionStatus } from "../adapters/d1/v2TrainerMessages";
import { getUser, updateUser } from "../adapters/d1/v2Users";
import { runIdempotent } from "../adapters/d1/v2Idempotency";
import { activateClientPlan, canShareProgramFor, planToBank, publishProgram, recentPrs } from "../features/trainer/programSharing";
import { localizePlanNames, type LocalizedName } from "../features/exercise/catalog";
import { trainerReportData } from "../features/trainer/trainer";
import { botDeepLink } from "../notify/links";
import { logInfo } from "../log";
import { adaptPlan } from "../domain/planAdapt";
import { escapeHtml, t } from "../locales/i18n";
import { nudgeOnboarding } from "../features/onboarding/nudge";
import { miniAppUser } from "./auth";
import { buildClientCardPayload } from "./clientCard";
import { readJsonBody } from "./validate";
import type { BankPlan, Env, UserDoc } from "../types";
import { apiFailure } from "./apiError";
import { typedFailure } from "./failure";

const ROUTE = /^\/api\/trainer\/client\/(\d+)\/(card|note|flag|photo-request|interview-nudge|draft)$/;
const ANSWER_ROUTE = /^\/api\/trainer\/question\/(\d+)\/answer$/;
const MAX_TEXT = 2000;

/** "" clears (→ null); otherwise a trimmed string capped by validation. undefined = invalid. */
function textField(v: unknown): string | null | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (s.length > MAX_TEXT) return undefined;
  return s === "" ? null : s;
}

export async function handleTrainerApi(req: Request, url: URL, env: Env): Promise<Response> {
  const user = await miniAppUser(req, url, env);
  if (!user) return typedFailure(401, "unauthorized", "unauthorized");
  if (user.role !== "trainer") return typedFailure(403, "forbidden", "forbidden");

  // Q&A inbox — list the trainer's client questions (pending first).
  if (req.method === "GET" && url.pathname === "/api/trainer/questions") {
    const qs = await listQuestionsForTrainer(env.DB, user._id, 30).catch(() => []);
    const clientIds = [...new Set(qs.map((q) => q.clientId))];
    const clients = await Promise.all(clientIds.map((id) => getUser(env.DB, id).catch(() => null)));
    const names = new Map(clientIds.map((id, i) => [id, clients[i]?.profile.name ?? `id ${id}`]));
    const out = qs.map((q) => ({ id: q.id, clientId: q.clientId, client: names.get(q.clientId), text: q.text, draft: q.aiDraft ?? "", status: q.status }));
    return Response.json({ questions: out }, { headers: { "cache-control": "no-store" } });
  }

  // Program templates — list / delete / assign (activate for a client).
  if (url.pathname === "/api/trainer/templates") {
    if (req.method === "GET") {
      const tpls = await listTrainerTemplates(env.DB, user._id, 30).catch(() => []);
      return Response.json({ templates: tpls.map((tp) => ({ id: tp.id, name: tp.name })) }, { headers: { "cache-control": "no-store" } });
    }
    if (req.method !== "POST") return typedFailure(405, "validation_error", "method not allowed");
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
      if (!client) return typedFailure(404, "not_found", "not found");
      const tpl = await getTrainerTemplate(env.DB, user._id, id);
      if (!tpl) return typedFailure(404, "not_found", "not found");
      const draft = adaptPlan(tpl.plan, client.profile, client._id, { authoredBy: user._id });
      await saveDraftPlan(env.DB, draft);
      await assignDraftPlan(env.DB, client._id);
      await recordAudit(env.DB, user._id, "template_assign", client._id, tpl.name).catch(() => {});
      await pingOther(env, client.chatId, t(client.lang, "client_plan_assigned"), appMarkup(env, t(client.lang, "nb_open_today"), "today"));
      return Response.json({ ok: true });
    }
    if (b.action === "create") {
      // "Save this client's current active plan as a reusable template" — the minimal
      // creation flow: no plan-authoring UI, just snapshot an existing plan for later reuse.
      const name = textField(b.name);
      if (!name) return typedFailure(400, "validation_error", "bad request");
      const fromClientId = Number(b.fromClientId);
      if (!Number.isFinite(fromClientId)) return typedFailure(400, "validation_error", "bad request");
      const client = await getClientForTrainer(env.DB, user._id, fromClientId);
      if (!client) return typedFailure(404, "not_found", "not found");
      const plan = await getActivePlan(env.DB, fromClientId);
      if (!plan) return typedFailure(404, "not_found", "not found");
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
    return typedFailure(400, "validation_error", "bad request");
  }

  // Broadcast a message to all of the trainer's clients (composed + confirmed in the app).
  if (req.method === "POST" && url.pathname === "/api/trainer/broadcast") {
    const parsedBc = await readJsonBody(req);
    if (!parsedBc.ok) return parsedBc.response;
    const b = parsedBc.body as Record<string, unknown>;
    const text = textField(b.text);
    if (!text) return typedFailure(400, "validation_error", "bad request");
    // A lost-response retry must not message every client a second time.
    const bc = await runIdempotent(env.DB, user._id, req.headers.get("idempotency-key"), async () => {
      const clients = await listClients(env.DB, user._id).catch(() => [] as UserDoc[]);
      const who = user.profile.name ?? "trainer";
      // Same event and outbox path as the bot's broadcast: one id shared by every recipient's row.
      const broadcastId = crypto.randomUUID();
      let sent = 0;
      for (const c of clients) {
        const result = await notifySafely(env, { api: rawTelegramApi(env) }, { userId: c._id, chatId: c.chatId }, {
          kind: "trainer_broadcast",
          key: `trainer_broadcast:${broadcastId}`,
          text: t(c.lang, "tr_broadcast_from", { name: who }) + "\n\n" + escapeHtml(text.slice(0, 1500)),
          extra: { ...HTML, reply_markup: appMarkup(env, t(c.lang, "nb_reply"), "coach") },
        });
        if (result === "sent") sent++;
      }
      await recordAudit(env.DB, user._id, "broadcast", undefined, `${sent}/${clients.length}`).catch(() => {});
      return { status: 200, body: { ok: true, sent } };
    });
    return Response.json(bc.body, { status: bc.status });
  }

  // Weekly client report: the bot's /trreport table as structured rows (same ranking, same data).
  if (req.method === "GET" && url.pathname === "/api/trainer/report") {
    const report = await trainerReportData(env.DB, user);
    const rows = report.ranked.map(({ u, ev, ps, prog }) => ({
      id: u._id,
      name: u.profile.name ?? null,
      username: u.username ?? null,
      onboarded: u.onboarded,
      interview: prog,
      plan: { active: !!ps?.active, draft: !!ps?.draft },
      events: ev,
      lastSeen: u.lastSeenAt ? u.lastSeenAt.toISOString() : null,
      botBlocked: !!u.botBlocked,
    }));
    return Response.json({ clientCount: report.clients.length, active7: report.active7, activePct: report.activePct, rows }, { headers: { "cache-control": "no-store" } });
  }

  // Program sharing (the bot's share flow, features/trainer/programSharing.ts): publish a saved
  // template to the library or as a link, publish my own active plan, assign a template to clients.
  if (req.method === "POST" && url.pathname === "/api/trainer/share/template") {
    if (!(await canShareProgramFor(env.DB, user))) return typedFailure(403, "forbidden", "forbidden");
    const parsedShare = await readJsonBody(req);
    if (!parsedShare.ok) return parsedShare.response;
    const b = parsedShare.body as Record<string, unknown>;
    if (b.mode !== "library" && b.mode !== "link") return typedFailure(400, "validation_error", "bad request");
    const tpl = await getTrainerTemplate(env.DB, user._id, Number(b.templateId));
    if (!tpl) return typedFailure(404, "not_found", "not found");
    const isPublic = b.mode === "library";
    const pub = await runIdempotent(env.DB, user._id, req.headers.get("idempotency-key"), async () => {
      const code = await publishProgram(env.DB, user._id, tpl.name, tpl.plan, isPublic);
      return { status: 200, body: { ok: true, code, name: tpl.name, ...(isPublic ? {} : { link: botDeepLink(env, `prog_${code}`) }) } };
    });
    return Response.json(pub.body, { status: pub.status });
  }

  if (req.method === "POST" && url.pathname === "/api/trainer/share/plan") {
    if (!(await canShareProgramFor(env.DB, user))) return typedFailure(403, "forbidden", "forbidden");
    const parsedMine = await readJsonBody(req);
    if (!parsedMine.ok) return parsedMine.response;
    const rawName = (parsedMine.body as Record<string, unknown>).name;
    const name = typeof rawName === "string" ? rawName.trim().slice(0, 48) : "";
    if (!name) return typedFailure(400, "validation_error", "bad request");
    const plan = await getActivePlan(env.DB, user._id);
    if (!plan || !plan.split.length) return typedFailure(404, "not_found", "not found");
    const pubMine = await runIdempotent(env.DB, user._id, req.headers.get("idempotency-key"), async () => {
      const code = await publishProgram(env.DB, user._id, name, planToBank(plan), true);
      await recordAudit(env.DB, user._id, "share_myplan", undefined, name).catch(() => {});
      return { status: 200, body: { ok: true, code, name } };
    });
    return Response.json(pubMine.body, { status: pubMine.status });
  }

  if (req.method === "POST" && url.pathname === "/api/trainer/share/assign") {
    if (!(await canShareProgramFor(env.DB, user))) return typedFailure(403, "forbidden", "forbidden");
    const parsedAssign = await readJsonBody(req);
    if (!parsedAssign.ok) return parsedAssign.response;
    const b = parsedAssign.body as Record<string, unknown>;
    const ids = Array.isArray(b.clientIds) ? b.clientIds.map(Number) : [];
    if (!ids.length || !ids.every((n) => Number.isInteger(n) && n > 0)) return typedFailure(400, "validation_error", "bad request");
    const tpl = await getTrainerTemplate(env.DB, user._id, Number(b.templateId));
    if (!tpl) return typedFailure(404, "not_found", "not found");
    // Only the trainer's own active clients, as the bot's selection does.
    const clients = (await listClients(env.DB, user._id)).filter((c) => ids.includes(c._id));
    if (!clients.length) return typedFailure(400, "validation_error", "bad request");
    const assign = await runIdempotent(env.DB, user._id, req.headers.get("idempotency-key"), async () => {
      let ok = 0;
      // Same as the bot's shareAssignToClients: exercise names in the client's language, one
      // localization per exercise across clients. Best effort: a failure keeps the English names.
      const names = new Map<string, LocalizedName>();
      for (const c of clients) {
        try {
          const prs = await recentPrs(env.DB, c._id);
          const draft = adaptPlan(tpl.plan, c.profile, c._id, { prs, authoredBy: user._id });
          await localizePlanNames({ db: env.DB, env, user }, draft, c.lang, names).catch(() => false);
          await activateClientPlan(env.DB, c._id, draft);
          await pingOther(env, c.chatId, t(c.lang, "share_client_got", { name: tpl.name }), appMarkup(env, t(c.lang, "nb_open_today"), "today"));
          ok++;
        } catch (err) {
          console.error("trainer share assign", c._id, err);
        }
      }
      await recordAudit(env.DB, user._id, "share_program", undefined, `${tpl.name} → ${ok}/${clients.length}`).catch(() => {});
      return { status: 200, body: { ok: true, assigned: ok, total: clients.length } };
    });
    return Response.json(assign.body, { status: assign.status });
  }

  // Answer a client question — deliver to the client (chat push + stored message), mark answered.
  const am = ANSWER_ROUTE.exec(url.pathname);
  if (am) {
    if (req.method !== "POST") return typedFailure(405, "validation_error", "method not allowed");
    const qid = Number(am[1]);
    const q = await getQuestion(env.DB, qid);
    if (!q || q.trainerId !== user._id) return typedFailure(404, "not_found", "not found");
    const parsedAns = await readJsonBody(req);
    if (!parsedAns.ok) return parsedAns.response;
    const body = parsedAns.body as Record<string, unknown>;
    const text = textField(body.text);
    if (!text) return typedFailure(400, "validation_error", "bad request");
    // The question's own status doesn't gate a re-answer (a trainer might legitimately amend),
    // so a lost-response retry must not double-message the client -- idempotency key only.
    const ans = await runIdempotent(env.DB, user._id, req.headers.get("idempotency-key"), async () => {
      const client = await getUser(env.DB, q.clientId).catch(() => null);
      if (client) {
        await insertMessage(env.DB, user._id, q.clientId, text).catch(() => {});
        // Keyed per call, not per question: a trainer may amend an answer, and runIdempotent already covers a retry.
        await notifySafely(env, { api: rawTelegramApi(env) }, { userId: client._id, chatId: client.chatId }, {
          kind: "trainer_answer",
          key: `trainer_answer:${qid}:${crypto.randomUUID()}`,
          text: t(client.lang, "answer_from_trainer", { text }),
          extra: { ...HTML, reply_markup: appMarkup(env, t(client.lang, "nb_reply"), "coach") },
        });
      }
      await setQuestionStatus(env.DB, qid, "answered");
      logInfo("trainer_question_answered", {});
      return { status: 200, body: { ok: true } };
    });
    return Response.json(ans.body, { status: ans.status });
  }

  const m = ROUTE.exec(url.pathname);
  if (!m) return typedFailure(404, "not_found", "not found");
  const clientId = Number(m[1]);
  const action = m[2] as "card" | "note" | "flag" | "photo-request" | "interview-nudge" | "draft";
  const client = await getClientForTrainer(env.DB, user._id, clientId);
  if (!client) return typedFailure(404, "not_found", "not found");

  if (req.method === "GET" && action === "card") {
    const payload = await buildClientCardPayload(env.DB, user, client);
    return Response.json(payload, { headers: { "cache-control": "no-store" } });
  }
  if (req.method !== "POST") return typedFailure(405, "validation_error", "method not allowed");

  const parsedCard = await readJsonBody(req);
  if (!parsedCard.ok) return parsedCard.response;
  const body = parsedCard.body as Record<string, unknown>;

  try {
    if (action === "card") {
      const patch: { healthNotes?: string | null; personalNotes?: string | null; birthday?: string | null } = {};
      for (const key of ["healthNotes", "personalNotes"] as const) {
        if (body[key] === undefined) continue;
        const v = textField(body[key]);
        if (v === undefined) return typedFailure(400, "validation_error", "bad request");
        patch[key] = v;
      }
      if (body.birthday !== undefined) {
        const v = textField(body.birthday);
        if (v === undefined) return typedFailure(400, "validation_error", "bad request");
        // Canonical stored forms only: YYYY-MM-DD or MM-DD (year unknown); "" cleared to null above.
        if (v !== null && !/^\d{4}-\d{2}-\d{2}$/.test(v) && !/^\d{2}-\d{2}$/.test(v)) {
          return typedFailure(400, "validation_error", "bad request");
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
    if (action === "draft") {
      // The trainer's call on a waiting draft (onboarding draft or weekly progression proposal).
      if (body.decision !== "assign" && body.decision !== "discard" && body.decision !== "postpone") return typedFailure(400, "validation_error", "bad request");
      if (body.decision === "postpone") {
        // The one "wait 3 more days" on a first-plan draft (staleDrafts.ts).
        const result = await postponeAutoActivation(env.DB, clientId);
        if (result === "no_draft") return typedFailure(404, "not_found", "not found");
        if (result === "already_used") return typedFailure(409, "conflict", "already postponed");
        await recordAudit(env.DB, user._id, "postpone_draft", clientId).catch(() => {});
        return Response.json({ ok: true });
      }
      if (body.decision === "discard") {
        if (!(await deleteDraftPlan(env.DB, clientId))) return typedFailure(404, "not_found", "not found");
        await recordAudit(env.DB, user._id, "discard_draft", clientId).catch(() => {});
        return Response.json({ ok: true });
      }
      if (!(await assignDraftPlan(env.DB, clientId))) return typedFailure(404, "not_found", "not found");
      await recordAudit(env.DB, user._id, "assign_plan", clientId).catch(() => {});
      await pingOther(env, client.chatId, t(client.lang, "client_plan_assigned"), appMarkup(env, t(client.lang, "nb_open_today"), "today"));
      return Response.json({ ok: true });
    }
    if (action === "note") {
      const note = textField(body.note);
      if (note === undefined) return typedFailure(400, "validation_error", "bad request");
      await setClientNote(env.DB, user._id, clientId, note ?? "");
      return Response.json({ note });
    }
    if (action === "flag") {
      // Mirrors the bot's toggle: setUserFlag + audit trail.
      if (typeof body.flagged !== "boolean") return typedFailure(400, "validation_error", "bad request");
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
      const trName = user.profile.name ?? "trainer";
      // The photo is added in the app (Progress → photos); the upload goes on to the trainer.
      const appKb = appMarkup(env, t(client.lang, "nb_add_photo"), "progress");
      const kb = appKb ?? { inline_keyboard: [[{ text: t(client.lang, "photo_req_skip_btn"), callback_data: "photo:skip" }]] };
      await pingOther(env, client.chatId, t(client.lang, appKb ? "photo_req_from_app" : "photo_req_from", { name: trName }), kb);
      return Response.json({ ok: true });
    }
    // action === "interview-nudge" — mirrors the bot's cl:*:intvping action: resume the AI
    // interview transcript if one is in progress, else resume/restart the button wizard at the
    // first unanswered step. A no-op (ok:true, alreadyOnboarded:true) once the client is done —
    // the bot's own action just shows the summary at that point, nothing to nudge.
    const nudged = await nudgeOnboarding(env, client, t(client.lang, "cc_intv_remind_text"));
    if (nudged.alreadyOnboarded) return Response.json({ ok: true, alreadyOnboarded: true });
    return Response.json({ ok: true });
  } catch (err) {
    return apiFailure(env, "api_trainer", err, { userId: user._id, action });
  }
}
