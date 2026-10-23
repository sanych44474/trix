// Trainers & clients section. Part of the trainer feature slice (roadmap item 1); bot.ts's
// barrel seam still applies: `export * from "./features/trainer/trainer"`.

import { InlineKeyboard } from "grammy";
import { logInfo } from "../../log";
import type { Lang, UserDoc } from "../../types";
import { eventCountsByUser } from "../../adapters/d1/v2Analytics";
import { getOwnerChatId } from "../../adapters/d1/v2Admin";
import { countCompletedWorkouts } from "../../adapters/d1/v2Workouts";
import { planStatusByUser } from "../../adapters/d1/v2Plans";
import { approveTrainer, countClientsOf, getRequest, getTrainer, getTrainerByCode, linkClient, listClients, pendingRequestsForTrainer, rejectTrainer, createProspect, deleteProspect, getProspect, listProspects, setRequestStatus, unlinkClient, updateTrainer } from "../../adapters/d1/v2Trainer";
import { getUser, getUsersByIds, updateUser } from "../../adapters/d1/v2Users";
import { isoDateMinus } from "../gamification/boards";
import { botDeepLink } from "../../notify/links";
import { interviewProgress } from "../owner/ownerRows";
import { localParts } from "../../domain/localTime";
import { escapeHtml, t } from "../../locales/i18n";
import { type MyContext, HTML, reply, setMode } from "../../adapters/telegram/context";
import { menuBtn, roleMenu } from "../../adapters/telegram/keyboards";
import { renderObQuestion } from "../onboarding/sendStep";
import { nudgeOnboarding } from "../onboarding/nudge";
import { notifySafely } from "../../notify";
import { onboardingUrlFromEnv, sendOnboardingPrompt } from "../../notify/onboardingApp";
import { trainerCardText, startTrainerWizard } from "./trainerWizard";
import { requireTrainer, shortCode, trainerMenu } from "./trainerCommon";

// ================ trainers & clients ================

// Trainer-only extra actions (text routing); common actions come from menuActionFor.
export function trainerMenuActionFor(lang: Lang, text: string): ((c: MyContext) => Promise<void>) | undefined {
  const map: Record<string, (c: MyContext) => Promise<void>> = {
    [t(lang, "menu_clients")]: cmdClients,
    [t(lang, "menu_requests")]: cmdRequests,
    [t(lang, "menu_trainer")]: cmdTrainer,
  };
  return map[text];
}

export async function openFindTrainer(ctx: MyContext) {
  const lang = ctx.user.lang;
  const kb = new InlineKeyboard().text(t(lang, "find_code"), "find:code");
  await reply(ctx, t(lang, "find_intro"), kb);
}

// Auto-pair via the trainer's own invite link.
// Tell the trainer a client just paired with them, with a one-tap link to the client card.
// When the client already has training history, surface it (the card has full analytics).
export async function notifyTrainerOfClient(ctx: MyContext, trainer: UserDoc, client: UserDoc, withHistory: boolean) {
  const who = client.profile.name ?? `id ${client._id}`;
  const kb = new InlineKeyboard().text(t(trainer.lang, "cc_open_card"), `cl:${client._id}:card`);
  let body: string;
  if (withHistory) {
    const workouts = await countCompletedWorkouts(ctx.db, client._id).catch(() => 0);
    body = t(trainer.lang, "trainer_client_joined_history", { name: who, workouts });
  } else {
    body = t(trainer.lang, "trainer_client_joined", { name: who });
  }
  await notifySafely(ctx.env, { api: ctx.api }, { userId: trainer._id, chatId: trainer.chatId }, {
    kind: "trainer_client_joined",
    key: `client_joined:${trainer._id}:${client._id}`,
    text: body,
    extra: { ...HTML, reply_markup: kb },
  });
}

// One-time consent prompt sent to the CLIENT right after linking to a trainer: opt in to
// sharing body data / health details on the client card (both stay hidden until enabled).
export function sharePromptKb(lang: Lang): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(lang, "share_body_btn"), "share:tog:body")
    .row()
    .text(t(lang, "share_health_btn"), "share:tog:health")
    .row()
    .text(t(lang, "share_skip_btn"), "share:skip");
}

// Shared by joinByCode (generic tr_<code> link) and joinByProspectCode (personal trp_<code>
// link) — everything after the trainer has been resolved is identical either way.
async function pairWithTrainer(ctx: MyContext, trainerId: number, trainerName: string) {
  const lang = ctx.user.lang;
  await linkClient(ctx.db, ctx.user._id, trainerId);
  logInfo("trainer_client_connected", {});
  ctx.user.role = "client";
  ctx.user.trainerId = trainerId;
  const trainer = await getUser(ctx.db, trainerId);
  // Already-onboarded athlete → transfer WITHOUT re-onboarding. linkClient keeps all their data
  // (logs, body, records, plan); the trainer sees it all on the client card for analytics.
  if (ctx.user.onboarded) {
    ctx.user.session = { mode: "idle" };
    await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
    await reply(ctx, t(lang, "client_transferred", { name: trainerName }), menuBtn(lang));
    if (trainer) await notifyTrainerOfClient(ctx, trainer, ctx.user, true);
    await reply(ctx, t(lang, "share_prompt_new"), sharePromptKb(lang));
    return;
  }
  // Brand-new user → the questionnaire first (we are in the client's context). One message, one
  // button: the Mini App asks the questions one at a time, including what the trainer may see.
  await reply(ctx, t(lang, "client_paired", { name: trainerName }));
  if (trainer) await notifyTrainerOfClient(ctx, trainer, ctx.user, false);
  ctx.user.session = { mode: "onboarding", step: 0 };
  await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
  if (await sendOnboardingPrompt(ctx)) return;
  await reply(ctx, t(lang, "share_prompt_new"), sharePromptKb(lang));
  await renderObQuestion(ctx, 0);
}

export async function joinByCode(ctx: MyContext, code: string) {
  const lang = ctx.user.lang;
  if (ctx.user.role === "trainer") {
    await reply(ctx, t(lang, "trainer_home"), trainerMenu(lang));
    return;
  }
  const tr = await getTrainerByCode(ctx.db, code.trim());
  if (!tr) {
    await reply(ctx, t(lang, "code_invalid"));
    return;
  }
  await pairWithTrainer(ctx, tr.trainerId, tr.name);
}

// --- trainer application + owner approval ---

export async function cmdBecomeTrainer(ctx: MyContext) {
  const lang = ctx.user.lang;
  if (ctx.user.role === "trainer") {
    await reply(ctx, t(lang, "trainer_already"), trainerMenu(lang));
    return;
  }
  const existing = await getTrainer(ctx.db, ctx.user._id);
  if (existing?.status === "pending") {
    await reply(ctx, t(lang, "trainer_pending"));
    return;
  }
  await startTrainerWizard(ctx);
}

// ======================= Trainer profile wizard =======================
// A step-by-step, button-guided flow that collects a rich trainer profile, previews the
// client-facing card, and persists it (pending approval for new applicants, in-place for
// already-approved trainers). The working answers live in session.trainerDraft.

export async function onTrainerApprove(ctx: MyContext, trainerId: number) {
  const ownerChatId = await getOwnerChatId(ctx.db);
  if (ownerChatId !== ctx.user.chatId) return;
  const code = shortCode();
  await approveTrainer(ctx.db, trainerId, code);
  await reply(ctx, t(ctx.user.lang, "trainer_approved_owner"));
  const trainer = await getUser(ctx.db, trainerId);
  if (trainer) {
    const link = botDeepLink(ctx.env, `tr_${code}`);
    await notifySafely(ctx.env, { api: ctx.api }, { userId: trainerId, chatId: trainer.chatId }, {
      kind: "trainer_approved",
      key: `trainer_approved:${trainerId}:${code}`,
      text: t(trainer.lang, "trainer_approved", { link }),
      extra: { ...HTML, reply_markup: trainerMenu(trainer.lang) },
    });
  }
}

export async function onTrainerReject(ctx: MyContext, trainerId: number) {
  const ownerChatId = await getOwnerChatId(ctx.db);
  if (ownerChatId !== ctx.user.chatId) return;
  const application = await getTrainer(ctx.db, trainerId);
  await rejectTrainer(ctx.db, trainerId);
  await reply(ctx, t(ctx.user.lang, "trainer_rejected_owner"));
  const trainer = await getUser(ctx.db, trainerId);
  if (trainer) {
    await notifySafely(ctx.env, { api: ctx.api }, { userId: trainerId, chatId: trainer.chatId }, {
      kind: "trainer_rejected",
      key: `trainer_rejected:${trainerId}:${application?.createdAt.getTime() ?? 0}`,
      text: t(trainer.lang, "trainer_rejected"),
      extra: HTML,
    });
  }
}

// --- request accept/decline (trainer side) ---

export async function onRequestAccept(ctx: MyContext, reqId: number) {
  const lang = ctx.user.lang;
  const req = await getRequest(ctx.db, reqId);
  if (!req || req.trainerId !== ctx.user._id || req.status !== "pending") {
    await reply(ctx, t(lang, "request_gone"));
    return;
  }
  await setRequestStatus(ctx.db, reqId, "accepted");
  await linkClient(ctx.db, req.clientId, ctx.user._id);
  logInfo("trainer_client_connected", {});
  const client = await getUser(ctx.db, req.clientId);
  await reply(ctx, t(lang, "request_accepted_trainer", { name: client?.profile.name ?? `id ${req.clientId}` }));
  if (client) {
    const trainerName = ctx.user.profile.name ?? "trainer";
    if (client.onboarded) {
      // Existing athlete → transfer WITH their history (no re-onboarding). The card has analytics.
      await updateUser(ctx.db, client._id, { session: { mode: "idle" } });
      await notifySafely(ctx.env, { api: ctx.api }, { userId: client._id, chatId: client.chatId }, {
        kind: "client_transferred",
        key: `client_transferred:${reqId}`,
        text: t(client.lang, "client_transferred", { name: trainerName }),
        extra: { ...HTML, reply_markup: menuBtn(client.lang) },
      });
      await notifyTrainerOfClient(ctx, ctx.user, client, true);
    } else {
      // Brand-new user → the questionnaire goes to the client's chat (we're in the trainer's
      // context). In the Mini App it also asks what the trainer may see, so no separate prompt.
      await updateUser(ctx.db, client._id, { session: { mode: "onboarding", step: 0 } });
      const appFlow = !!onboardingUrlFromEnv(ctx.env);
      await nudgeOnboarding(ctx.env, { ...client, session: { mode: "onboarding", step: 0 } }, t(client.lang, "client_accepted", { name: trainerName }));
      if (appFlow) return;
    }
    await notifySafely(ctx.env, { api: ctx.api }, { userId: client._id, chatId: client.chatId }, {
      kind: "share_prompt",
      key: `share_prompt:${reqId}`,
      text: t(client.lang, "share_prompt_new"),
      extra: { ...HTML, reply_markup: sharePromptKb(client.lang) },
    });
  }
}

export async function onRequestDecline(ctx: MyContext, reqId: number) {
  const lang = ctx.user.lang;
  const req = await getRequest(ctx.db, reqId);
  if (!req || req.trainerId !== ctx.user._id || req.status !== "pending") {
    await reply(ctx, t(lang, "request_gone"));
    return;
  }
  await setRequestStatus(ctx.db, reqId, "declined");
  await reply(ctx, t(lang, "request_declined_trainer"));
  const client = await getUser(ctx.db, req.clientId);
  if (client) {
    const kb = new InlineKeyboard().text(t(client.lang, "menu_find_trainer"), "role:find");
    await notifySafely(ctx.env, { api: ctx.api }, { userId: client._id, chatId: client.chatId }, {
      kind: "client_declined",
      key: `request_declined:${reqId}`,
      text: t(client.lang, "client_declined"),
      extra: { ...HTML, reply_markup: kb },
    });
  }
}

export async function onRequestCancel(ctx: MyContext, reqId: number) {
  const req = await getRequest(ctx.db, reqId);
  if (req && req.clientId === ctx.user._id && req.status === "pending") {
    await setRequestStatus(ctx.db, reqId, "cancelled");
  }
  await reply(ctx, t(ctx.user.lang, "request_cancelled"), roleMenu(ctx.user.lang));
}

// --- trainer dashboard ---

export async function cmdRequests(ctx: MyContext) {
  if (!(await requireTrainer(ctx))) return;
  const lang = ctx.user.lang;
  const reqs = await pendingRequestsForTrainer(ctx.db, ctx.user._id);
  if (!reqs.length) {
    await reply(ctx, t(lang, "requests_none"), menuBtn(lang));
    return;
  }
  const reqClients = await getUsersByIds(ctx.db, reqs.map((r) => r.clientId));
  for (const r of reqs) {
    const client = reqClients.get(r.clientId);
    const who = client?.profile.name ?? `id ${r.clientId}`;
    const kb = new InlineKeyboard()
      .text(t(lang, "req_accept"), `req:accept:${r.id}`)
      .text(t(lang, "req_decline"), `req:decline:${r.id}`);
    await reply(ctx, t(lang, "trainer_new_request", { name: who }) + (r.note ? `\n💬 ${escapeHtml(r.note)}` : ""), kb);
  }
}

// Client-capacity ladder the tr:limit button cycles through (null = unlimited).
export const CLIENT_LIMITS: (number | null)[] = [5, 10, 15, 20, null];

export async function cmdTrainer(ctx: MyContext) {
  if (!(await requireTrainer(ctx))) return;
  const lang = ctx.user.lang;
  const tr = await getTrainer(ctx.db, ctx.user._id);
  if (!tr) return;
  const link = (tr.inviteCode && botDeepLink(ctx.env, `tr_${tr.inviteCode}`)) || "—";
  const nClients = await countClientsOf(ctx.db, ctx.user._id);
  const limitLabel = tr.maxClients ? `${nClients}/${tr.maxClients}` : `${nClients}/∞`;
  const kb = new InlineKeyboard()
    .text(tr.accepting ? t(lang, "trainer_close") : t(lang, "trainer_open"), "tr:toggle")
    .row()
    .text(t(lang, "trainer_limit_btn", { limit: limitLabel }), "tr:limit")
    .row()
    .text(t(lang, "trainer_edit_profile"), "tr:edit")
    .row()
    .text(t(lang, "trainer_invite_prospect_btn"), "tr:prospect");
  const card = trainerCardText(lang, tr, { usernameFallback: ctx.user.username ? `@${ctx.user.username}` : undefined });
  const statusLine = tr.profileComplete ? t(lang, "trainer_status_listed") : t(lang, "trainer_status_hidden");
  const full = tr.maxClients !== undefined && nClients >= tr.maxClients;
  const prospects = await listProspects(ctx.db, ctx.user._id);
  const pendingLine = prospects.length
    ? `\n\n${t(lang, "trainer_prospects_pending", { names: prospects.map((p) => p.name).join(", ") })}`
    : "";
  const body =
    `${card}\n\n${statusLine}\n${t(lang, "trainer_invite_link", { link })}` +
    (full ? `\n${t(lang, "trainer_at_capacity")}` : "") +
    pendingLine;
  if (tr.photoFileId) await ctx.api.sendPhoto(ctx.user.chatId, tr.photoFileId).catch(() => {});
  await reply(ctx, body, kb);
}

// "➕ Personal invite" — trainer names someone who hasn't joined Telegram yet; the resulting
// deep link auto-pairs AND pre-fills the client's name when they eventually open it (Telegram
// gives no way to reach someone before they press Start, so this is the closest to "add a
// client" that's actually possible — a single-use, named invite instead of the generic shared one).
export async function startProspectInvite(ctx: MyContext) {
  if (!(await requireTrainer(ctx))) return;
  const lang = ctx.user.lang;
  ctx.user.session = { ...ctx.user.session, mode: "trainer_prospect_name" };
  await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
  await reply(ctx, t(lang, "trainer_prospect_name_prompt"));
}

export async function handleProspectName(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const name = text.trim().slice(0, 60);
  // Stay in this mode on a too-short name so the next message retries here instead of falling
  // through to idle-mode handling (e.g. the AI coach chat) — only leave the mode on success.
  if (name.length < 2) { await reply(ctx, t(lang, "trainer_prospect_name_prompt")); return; }
  await setMode(ctx, "idle");
  const code = shortCode();
  await createProspect(ctx.db, code, ctx.user._id, name);
  const link = botDeepLink(ctx.env, `trp_${code}`);
  await reply(ctx, t(lang, "trainer_prospect_link", { name, link }), menuBtn(lang));
}

// /start trp_<code> — the personal-invite counterpart to joinByCode's tr_<code>. Same pairing
// (and the same already-onboarded-vs-fresh branches), plus: the trainer's own name for this
// person wins over whatever Telegram happens to show, and the prospect record is consumed.
export async function joinByProspectCode(ctx: MyContext, code: string) {
  const lang = ctx.user.lang;
  if (ctx.user.role === "trainer") { await reply(ctx, t(lang, "trainer_home"), trainerMenu(lang)); return; }
  const prospect = await getProspect(ctx.db, code.trim());
  if (!prospect) { await reply(ctx, t(lang, "code_invalid")); return; }
  const tr = await getTrainer(ctx.db, prospect.trainerId);
  if (!tr) { await reply(ctx, t(lang, "code_invalid")); return; }
  // Single-use claim, done BEFORE any pairing side effect: DELETE is one atomic statement, so
  // under a race (a duplicate Telegram webhook delivery, or two people opening the same link)
  // only one caller's delete actually removes the row — the other sees `claimed=false` and
  // bails here instead of pairing off a prospect record that just got consumed elsewhere.
  const claimed = await deleteProspect(ctx.db, prospect.code);
  if (!claimed) { await reply(ctx, t(lang, "code_invalid")); return; }
  ctx.user.profile = { ...ctx.user.profile, name: prospect.name };
  await updateUser(ctx.db, ctx.user._id, { profile: ctx.user.profile });
  await pairWithTrainer(ctx, prospect.trainerId, tr.name);
}

// Cycle the capacity: 5 → 10 → 15 → 20 → ∞ → 5 …
export async function onTrainerLimitCycle(ctx: MyContext) {
  if (!(await requireTrainer(ctx))) return;
  const tr = await getTrainer(ctx.db, ctx.user._id);
  if (!tr) return;
  const cur = CLIENT_LIMITS.indexOf(tr.maxClients ?? null);
  const next = CLIENT_LIMITS[(cur + 1) % CLIENT_LIMITS.length];
  await updateTrainer(ctx.db, ctx.user._id, { maxClients: next });
  await cmdTrainer(ctx);
  // Raising (or removing) the cap can free spots — surface the waitlist right away.
  ctx.waitUntil(notifyWaitlistSlot(ctx, ctx.user._id));
}

export async function cmdClients(ctx: MyContext) {
  if (!(await requireTrainer(ctx))) return;
  const lang = ctx.user.lang;
  const clients = await listClients(ctx.db, ctx.user._id);
  if (!clients.length) {
    await reply(ctx, t(lang, "clients_none"), menuBtn(lang));
    return;
  }
  // Attention first: flagged clients, then pending-onboarding — listClients has no ORDER BY, so
  // without this a trainer with many clients has to scan the whole roster to find who needs them.
  const sorted = [...clients].sort((a, b) => Number(b.flagged) - Number(a.flagged) || Number(!a.onboarded) - Number(!b.onboarded));
  const kb = new InlineKeyboard();
  for (const c of sorted) {
    const flag = (c.flagged ? " 🚩" : "") + (c.onboarded ? "" : " ⏳");
    kb.text(`${c.profile.name ?? `id ${c._id}`}${flag}`.slice(0, 60), `cl:${c._id}:card`).row();
  }
  await reply(ctx, t(lang, "clients_header"), kb);
}

export async function cmdLeaveTrainer(ctx: MyContext) {
  const lang = ctx.user.lang;
  if (ctx.user.role !== "client") {
    await reply(ctx, t(lang, "not_a_client"));
    return;
  }
  const formerTrainerId = ctx.user.trainerId;
  await unlinkClient(ctx.db, ctx.user._id);
  ctx.user.role = "solo";
  ctx.user.trainerId = undefined;
  await reply(ctx, t(lang, "left_trainer"), roleMenu(lang));
  // A roster spot just freed up — remind the trainer about their waitlist (if any).
  if (formerTrainerId) ctx.waitUntil(notifyWaitlistSlot(ctx, formerTrainerId));
}

export interface WaitlistNudge {
  userId: number;
  chatId: number;
  lang: Lang;
  text: string;
  /** One nudge per freed-up roster size: the same slot state is not announced twice. */
  key: string;
}

/** When a trainer's roster spot frees (client left / limit raised): the nudge toward their
 * waitlist if they're now under capacity and have pending requests, or null if there's nothing
 * to send. Ctx-free and DB-only so both the chat leave-trainer flow and the Mini App's leave-
 * trainer action can trigger the identical notification instead of one of them silently
 * skipping it. */
export async function resolveWaitlistNudge(db: D1Database, trainerId: number): Promise<WaitlistNudge | null> {
  const [tr, trainerUser, n, pending] = await Promise.all([
    getTrainer(db, trainerId),
    getUser(db, trainerId),
    countClientsOf(db, trainerId),
    pendingRequestsForTrainer(db, trainerId),
  ]);
  if (!tr || !trainerUser || !pending.length) return null;
  if (tr.maxClients !== undefined && n >= tr.maxClients) return null; // still full
  return {
    userId: trainerId,
    chatId: trainerUser.chatId,
    lang: trainerUser.lang,
    text: t(trainerUser.lang, "waitlist_slot_free", { n: pending.length }),
    key: `waitlist_slot:${trainerId}:${n}`,
  };
}

// Best-effort, deduped by key (fires only on the freeing event itself).
async function notifyWaitlistSlot(ctx: MyContext, trainerId: number) {
  try {
    const nudge = await resolveWaitlistNudge(ctx.db, trainerId);
    if (!nudge) return;
    const kb = new InlineKeyboard().text(t(nudge.lang, "menu_requests"), "menu:requests");
    await notifySafely(ctx.env, { api: ctx.api }, { userId: nudge.userId, chatId: nudge.chatId }, {
      kind: "waitlist_slot",
      key: nudge.key,
      text: nudge.text,
      extra: { ...HTML, reply_markup: kb },
    });
  } catch {
    /* best-effort */
  }
}

// On-demand trainer report — the owner's /users table scoped to this trainer's clients
// (same columns minus trainer/ban), plus one-tap "finish the interview" nudges below.
export interface TrainerReportRow {
  u: UserDoc;
  ev: { workouts: number; checkins: number; nutrition: number; steps: number };
  ps?: { active: boolean; draft: boolean };
  prog: { filled: number; total: number };
}

export interface TrainerReport {
  /** Clients in listClients order (the bot's "finish the interview" buttons follow it). */
  clients: UserDoc[];
  /** Most-active first, the same ranking as the owner table. */
  ranked: TrainerReportRow[];
  active7: number;
  activePct: number;
}

// The weekly report data, shared by the bot's /trreport text table and the app's Report tab.
// Retention snapshot: active in the last 7 days / total clients, in the trainer's timezone.
export async function trainerReportData(db: D1Database, trainer: UserDoc): Promise<TrainerReport> {
  const clients = await listClients(db, trainer._id);
  const [eventCounts, planStatus] = await Promise.all([
    eventCountsByUser(db).catch(() => new Map<number, { workouts: number; checkins: number; nutrition: number; steps: number }>()),
    planStatusByUser(db).catch(() => new Map<number, { active: boolean; draft: boolean }>()),
  ]);
  const todayStr = localParts(trainer.profile.timezone).date;
  const active7 = clients.filter((c) => c.lastSeenAt && c.lastSeenAt.toISOString().slice(0, 10) >= isoDateMinus(todayStr, 7)).length;
  const activePct = clients.length ? Math.round((active7 / clients.length) * 100) : 0;
  const zero = { workouts: 0, checkins: 0, nutrition: 0, steps: 0 };
  const ranked: TrainerReportRow[] = [...clients]
    .map((u) => ({ u, ev: eventCounts.get(u._id) ?? zero, ps: planStatus.get(u._id), prog: interviewProgress(u.profile) }))
    .sort((a, b) => {
      const sum = (e: typeof zero) => e.workouts + e.checkins + e.nutrition + e.steps;
      return sum(b.ev) - sum(a.ev);
    });
  return { clients, ranked, active7, activePct };
}

export async function cmdTrainerReport(ctx: MyContext) {
  const lang = ctx.user.lang;
  if (ctx.user.role !== "trainer") return;
  const report = await trainerReportData(ctx.db, ctx.user);
  const { clients, ranked, active7, activePct } = report;
  if (!clients.length) {
    await reply(ctx, t(lang, "tr_report_noclients"), menuBtn(lang));
    return;
  }
  const biz = [
    `💰 <b>${t(lang, "tr_biz")}</b>`,
    `• ${t(lang, "tr_biz_clients")}: <b>${clients.length}</b> · ${t(lang, "tr_biz_active")}: <b>${active7}</b> (${activePct}%)`,
    "",
  ].join("\n");
  const header = ["name", "nick", "stat", "pln", "drf", "W", "C", "N", "S", "last", "blk"];
  const cells = [
    header,
    ...ranked.map(({ u, ev, ps, prog }) => [
      (u.profile.name || `id ${u._id}`).slice(0, 16),
      u.username ? `@${u.username}` : "-",
      u.onboarded ? "ok" : `${prog.filled}/${prog.total}`,
      ps?.active ? "y" : "-",
      ps?.draft ? "y" : "-",
      String(ev.workouts), String(ev.checkins), String(ev.nutrition), String(ev.steps),
      u.lastSeenAt ? u.lastSeenAt.toISOString().slice(5, 10) : "—",
      u.botBlocked ? "x" : "-",
    ]),
  ];
  const widths = header.map((_, i) => Math.max(...cells.map((r) => r[i].length)));
  const rightAlign = new Set([5, 6, 7, 8]); // numeric columns W/C/N/S
  const tbl = cells.map((r) =>
    r.map((cell, i) => (rightAlign.has(i) ? cell.padStart(widths[i]) : cell.padEnd(widths[i]))).join(" "),
  );
  const kb = new InlineKeyboard();
  for (const c of clients) {
    if (!c.onboarded) kb.text(`🔔 ${(c.profile.name ?? String(c._id)).slice(0, 24)}`, `cl:${c._id}:intvping`).row();
  }
  kb.text(t(lang, "menu_open"), "menu:open");
  await reply(ctx, `${biz}${t(lang, "tr_report_legend")}\n<pre>${escapeHtml(tbl.join("\n"))}</pre>`, kb);
}

export async function cmdTrainerBroadcast(ctx: MyContext) {
  if (!(await requireTrainer(ctx))) return;
  const n = await countClientsOf(ctx.db, ctx.user._id);
  if (!n) { await reply(ctx, t(ctx.user.lang, "tr_broadcast_noclients"), trainerMenu(ctx.user.lang)); return; }
  await setMode(ctx, "trainer_broadcast");
  await reply(ctx, t(ctx.user.lang, "tr_broadcast_prompt", { n }));
}

export async function handleTrainerBroadcast(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  await setMode(ctx, "idle");
  const clients = await listClients(ctx.db, ctx.user._id);
  const who = ctx.user.profile.name ?? "trainer";
  // One broadcast = one event: every recipient's outbox row shares this id.
  const broadcastId = crypto.randomUUID();
  let sent = 0;
  for (const c of clients) {
    const result = await notifySafely(ctx.env, { api: ctx.api }, { userId: c._id, chatId: c.chatId }, {
      kind: "trainer_broadcast",
      key: `trainer_broadcast:${broadcastId}`,
      text: t(c.lang, "tr_broadcast_from", { name: who }) + `\n\n${escapeHtml(text.slice(0, 1500))}`,
      extra: HTML,
    });
    if (result === "sent" || result === "retrying") sent++;
  }
  await reply(ctx, t(lang, "tr_broadcast_sent", { n: sent }), trainerMenu(lang));
}
