// Trainers & clients section. Part of the trainer feature slice (roadmap item 1); bot.ts's
// barrel seam still applies: `export * from "./features/trainer/trainer"`.

import { GrammyError, InlineKeyboard } from "grammy";
import { logInfo } from "../../log";
import type { BankPlan, Lang, UserDoc, Weekday } from "../../types";
import { eventCountsByUser, getOwnerChatId, recordAudit, setUserFlag } from "../../adapters/d1/v2Admin";
import { countCompletedWorkouts, listStrength, workoutLogsSince } from "../../adapters/d1/v2Workouts";
import { assignDraftPlan, deleteDraftPlan, getActivePlan, getDraftPlan, planStatusByUser, saveDraftPlan } from "../../adapters/d1/v2Plans";
import { approveTrainer, countClientsOf, deleteTrainerTemplate, getClientCard, getClientForTrainer, getClientNote, getRequest, getTrainer, getTrainerByCode, getTrainerTemplate, linkClient, listClientNoteHistory, listClients, listMessages, listQuestionsForTrainer, listTrainerTemplates, pendingRequestsForTrainer, rejectTrainer, createProspect, deleteProspect, getProspect, listProspects, saveTrainerTemplate, setClientCard, setClientNote, setRequestStatus, unlinkClient, updateTrainer } from "../../adapters/d1/v2Trainer";
import { bodyLogsByUser, listActiveInjuries } from "../../adapters/d1/v2Tracking";
import { nutritionLogsSince } from "../../adapters/d1/v2Nutrition";
import { getUser, getUsersByIds, updateUser } from "../../adapters/d1/v2Users";
import { isoDateMinus } from "../gamification/boards";
import { botDeepLink } from "../../bot/links";
import { interviewProgress } from "../../bot/owner";
import { adaptPlan } from "../../domain/planAdapt";
import { anthroLines, birthdayInfo, parseBirthdayInput, trainerCanSee } from "../../domain/clientCard";
import { computeCyclePhase } from "../../domain/cycle";
import { complianceScore, formatRecordBest, getPlanDay, localParts } from "../../domain/progression";
import { escapeHtml, t } from "../../locales/i18n";
import { renderPlan, renderSchedule, renderStrength, renderToday, upcomingSessions, weekdayName } from "../../render";
import { type MyContext, type TKey, HTML, clearEditOwner, reply, setEditOwner, setMode } from "../../adapters/telegram/context";
import { buildPlanDoc, buildWeekCard, deferAi, localCutoff, localizePlanNames, healPlanNamesForDisplay, mainMenu, menuBtn, obProgress, renderBodyDynamics, renderObStep, roleMenu, sendFirstObStep, sendObStepTo, trainerHubMenu, videosForDays } from "../../bot";
import { trainerCardText, trainerStyleBlock, startTrainerWizard } from "./trainerWizard";
import { showClientLogDays } from "./trainerComms";
export * from "./trainerComms";
export * from "./programSharing";
export * from "./trainerWizard";


// ================ trainers & clients ================


// Trainer menu = the compact trainer hub (own training / clients / profile).
export function trainerMenu(lang: Lang): InlineKeyboard {
  return trainerHubMenu(lang);
}

// Trainer-only extra actions (text routing); common actions come from menuActionFor.
export function trainerMenuActionFor(lang: Lang, text: string): ((c: MyContext) => Promise<void>) | undefined {
  const map: Record<string, (c: MyContext) => Promise<void>> = {
    [t(lang, "menu_clients")]: cmdClients,
    [t(lang, "menu_requests")]: cmdRequests,
    [t(lang, "menu_trainer")]: cmdTrainer,
  };
  return map[text];
}

export function shortCode(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

// --- find a trainer (client side) ---
// A public browsable directory doesn't earn its moderation cost at one trainer — clients find
// a trainer through a personal invite link (tr_<code>) or by typing that code here directly.

export async function openFindTrainer(ctx: MyContext) {
  const lang = ctx.user.lang;
  const kb = new InlineKeyboard().text(t(lang, "find_code"), "find:code");
  await reply(ctx, t(lang, "find_intro"), kb);
}

// Auto-pair via the trainer's own invite link.
// Tell the trainer a client just paired with them, with a one-tap link to the client card.
// When the client already has training history, surface it (the card has full analytics).
export async function notifyTrainerOfClient(ctx: MyContext, trainer: UserDoc, client: UserDoc, withHistory: boolean) {
  const who = escapeHtml(client.profile.name ?? `id ${client._id}`);
  const kb = new InlineKeyboard().text(t(trainer.lang, "cc_open_card"), `cl:${client._id}:card`);
  let body: string;
  if (withHistory) {
    const workouts = await countCompletedWorkouts(ctx.db, client._id).catch(() => 0);
    body = t(trainer.lang, "trainer_client_joined_history", { name: who, workouts });
  } else {
    body = t(trainer.lang, "trainer_client_joined", { name: who });
  }
  await ctx.api.sendMessage(trainer.chatId, body, { ...HTML, reply_markup: kb }).catch(() => {});
}

// One-time consent prompt sent to the CLIENT right after linking to a trainer: opt in to
// sharing body data / health details on the client card (both stay hidden until enabled).
export function sharePromptKb(lang: Lang): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(lang, "share_body_btn"), "share:tog:body")
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
    await reply(ctx, t(lang, "client_transferred", { name: escapeHtml(trainerName) }), menuBtn(lang));
    if (trainer) await notifyTrainerOfClient(ctx, trainer, ctx.user, true);
    await reply(ctx, t(lang, "share_prompt_new"), sharePromptKb(lang));
    return;
  }
  // Brand-new user → run the athlete intake first (we are in the client's context).
  await reply(ctx, t(lang, "client_paired", { name: escapeHtml(trainerName) }));
  if (trainer) await notifyTrainerOfClient(ctx, trainer, ctx.user, false);
  await reply(ctx, t(lang, "share_prompt_new"), sharePromptKb(lang));
  ctx.user.session = { mode: "onboarding", step: 0 };
  await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
  await renderObStep(ctx, 0);
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
    await ctx.api
      .sendMessage(trainer.chatId, t(trainer.lang, "trainer_approved", { link: escapeHtml(link) }), { ...HTML, reply_markup: trainerMenu(trainer.lang) })
      .catch(() => {});
  }
}

export async function onTrainerReject(ctx: MyContext, trainerId: number) {
  const ownerChatId = await getOwnerChatId(ctx.db);
  if (ownerChatId !== ctx.user.chatId) return;
  await rejectTrainer(ctx.db, trainerId);
  await reply(ctx, t(ctx.user.lang, "trainer_rejected_owner"));
  const trainer = await getUser(ctx.db, trainerId);
  if (trainer) await ctx.api.sendMessage(trainer.chatId, t(trainer.lang, "trainer_rejected"), HTML).catch(() => {});
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
  await reply(ctx, t(lang, "request_accepted_trainer", { name: escapeHtml(client?.profile.name ?? `id ${req.clientId}`) }));
  if (client) {
    const trainerName = escapeHtml(ctx.user.profile.name ?? "trainer");
    if (client.onboarded) {
      // Existing athlete → transfer WITH their history (no re-onboarding). The card has analytics.
      await updateUser(ctx.db, client._id, { session: { mode: "idle" } });
      await ctx.api
        .sendMessage(client.chatId, t(client.lang, "client_transferred", { name: trainerName }), { ...HTML, reply_markup: menuBtn(client.lang) })
        .catch(() => {});
      await notifyTrainerOfClient(ctx, ctx.user, client, true);
    } else {
      // Brand-new user → push the athlete intake to the client's chat (we're in the trainer's context).
      await updateUser(ctx.db, client._id, { session: { mode: "onboarding", step: 0 } });
      await sendFirstObStep(ctx, client.chatId, client.lang, t(client.lang, "client_accepted", { name: trainerName }));
    }
    await ctx.api
      .sendMessage(client.chatId, t(client.lang, "share_prompt_new"), { ...HTML, reply_markup: sharePromptKb(client.lang) })
      .catch(() => {});
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
    await ctx.api.sendMessage(client.chatId, t(client.lang, "client_declined"), { ...HTML, reply_markup: kb }).catch(() => {});
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

export async function requireTrainer(ctx: MyContext): Promise<boolean> {
  if (ctx.user.role !== "trainer") {
    await reply(ctx, t(ctx.user.lang, "not_a_trainer"));
    return false;
  }
  return true;
}

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
    const who = escapeHtml(client?.profile.name ?? `id ${r.clientId}`);
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
    ? `\n\n${t(lang, "trainer_prospects_pending", { names: prospects.map((p) => escapeHtml(p.name)).join(", ") })}`
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
  await reply(ctx, t(lang, "trainer_prospect_link", { name: escapeHtml(name), link: escapeHtml(link) }), menuBtn(lang));
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

// Stored onboarding answers are English enum-ish strings; map the known ones back to the
// localized onboarding button labels, fall back to the (escaped) raw text for free-form answers.
const INTV_VALUE_KEYS: Record<string, string> = {
  "fat loss": "ob_goal_fatloss", "muscle gain": "ob_goal_muscle", recomposition: "ob_goal_recomp",
  strength: "ob_goal_strength", endurance: "ob_goal_endurance",
  beginner: "ob_level_beginner", intermediate: "ob_level_intermediate", advanced: "ob_level_advanced",
  "full gym": "ob_eq_gym", "home basics (dumbbells, bands)": "ob_eq_home",
  "dumbbells only": "ob_eq_dumbbells", "bodyweight only": "ob_eq_bodyweight",
  sedentary: "ob_life_sedentary", moderate: "ob_life_moderate", active: "ob_life_active",
  morning: "ob_sleep_morning", evening: "ob_sleep_evening",
  none: "ob_diet_none", vegetarian: "ob_diet_vegetarian", vegan: "ob_diet_vegan",
};

function intvLabel(lang: Lang, v?: string): string | undefined {
  if (!v) return undefined;
  const key = INTV_VALUE_KEYS[v.toLowerCase().trim()];
  return key ? t(lang, key as TKey) : escapeHtml(v);
}

// Consent-gated anthropometry block for card views ("" = shared but nothing filled in yet).
function anthroBlock(lang: Lang, client: UserDoc, cname: string): string {
  if (!trainerCanSee(client.profile, "body")) return t(lang, "cc_share_locked", { name: cname });
  const lines = anthroLines(client.profile, {
    height: t(lang, "cc_anthro_height"), weight: t(lang, "cc_anthro_weight"),
    age: t(lang, "cc_anthro_age"), sex: t(lang, "cc_anthro_sex"),
    goalWeight: t(lang, "cc_anthro_goalweight"), waist: t(lang, "cc_anthro_waist"),
    chest: t(lang, "cc_anthro_chest"), hips: t(lang, "cc_anthro_hips"),
    arm: t(lang, "cc_anthro_arm"), thigh: t(lang, "cc_anthro_thigh"),
    male: t(lang, "cc_sex_male"), female: t(lang, "cc_sex_female"),
  });
  return lines.length ? `${t(lang, "cc_anthro_hdr")}\n${lines.join("\n")}` : "";
}

// AI-draft a plan for a client from an arbitrary profile snapshot. Shared by the card's
// "Draft" action (client's own profile) and the mini-interview (ephemeral trainer answers).
async function runTrainerDraft(ctx: MyContext, client: UserDoc, profile: UserDoc["profile"]) {
  const lang = ctx.user.lang;
  const clientId = client._id;
  await reply(ctx, t(lang, "draft_generating"));
  await ctx.replyWithChatAction("typing").catch(() => {});
  // Deferred past the webhook response: the full build (catalog + plan AI chain + translate)
  // can outlive the webhook window — run inline it silently died and no draft ever landed.
  deferAi(ctx, "draft", async () => {
    const records = await listStrength(ctx.db, clientId, 8);
    const prs = records.length ? records.map((r) => `${r.exercise}: ${formatRecordBest(r)}`).join("\n") : undefined;
    // Bias the draft toward THIS trainer's stated specialization/approach.
    const trainerDoc = await getTrainer(ctx.db, ctx.user._id).catch(() => null);
    const trainerStyle = trainerDoc ? trainerStyleBlock(trainerDoc) : undefined;
    // Generate the client's draft in the CLIENT's language, not the trainer's.
    const plan = await buildPlanDoc(ctx, client.lang, profile, clientId, { prs, authoredBy: ctx.user._id, trainerStyle });
    await saveDraftPlan(ctx.db, plan);
    await reply(ctx, t(lang, "draft_ready"));
    await reply(ctx, renderPlan(lang, plan), clientCardKb(lang, clientId));
  });
}

// ============ Trainer mini-interview: a 6-question stand-in for the client's intake ============
// The trainer answers FOR the client; the answers live only in the callback data and are merged
// into an EPHEMERAL profile for one draft generation. The client's own profile/session/onboarded
// flags are never touched, so their full interview still runs from where they left off.
const MI_STEPS: { q: TKey; options: { key?: TKey; label?: string; code: string }[] }[] = [
  { q: "ob_q_sex", options: [{ key: "ob_sex_male", code: "m" }, { key: "ob_sex_female", code: "f" }] },
  { q: "ob_q_age", options: [{ key: "mi_age_1", code: "22" }, { key: "mi_age_2", code: "30" }, { key: "mi_age_3", code: "40" }, { key: "mi_age_4", code: "52" }] },
  { q: "ob_q_goal", options: [{ key: "ob_goal_fatloss", code: "fl" }, { key: "ob_goal_muscle", code: "mg" }, { key: "ob_goal_recomp", code: "rc" }, { key: "ob_goal_strength", code: "st" }, { key: "ob_goal_endurance", code: "en" }] },
  { q: "ob_q_level", options: [{ key: "ob_level_beginner", code: "b" }, { key: "ob_level_intermediate", code: "i" }, { key: "ob_level_advanced", code: "a" }] },
  { q: "mi_q_days", options: [{ label: "2", code: "2" }, { label: "3", code: "3" }, { label: "4", code: "4" }, { label: "5", code: "5" }] },
  { q: "ob_q_equipment", options: [{ key: "ob_eq_gym", code: "g" }, { key: "ob_eq_home", code: "h" }, { key: "ob_eq_dumbbells", code: "d" }, { key: "ob_eq_bodyweight", code: "bw" }] },
];

const MI_GOALS: Record<string, string> = { fl: "fat loss", mg: "muscle gain", rc: "recomposition", st: "strength", en: "endurance" };
const MI_LEVELS: Record<string, UserDoc["profile"]["level"]> = { b: "beginner", i: "intermediate", a: "advanced" };
const MI_EQ: Record<string, string> = { g: "full gym", h: "home basics (dumbbells, bands)", d: "dumbbells only", bw: "bodyweight only" };
const MI_WEEKDAYS: Record<string, Weekday[]> = { "2": [1, 4], "3": [1, 3, 5], "4": [1, 2, 4, 5], "5": [1, 2, 3, 4, 5] };

function miProfilePatch(codes: string[]): Partial<UserDoc["profile"]> {
  const [sex, age, goal, level, days, eq] = codes;
  const out: Partial<UserDoc["profile"]> = {};
  if (sex === "m" || sex === "f") out.sex = sex === "f" ? "female" : "male";
  if (age && Number(age) > 0) out.age = Number(age);
  if (goal && MI_GOALS[goal]) out.goal = MI_GOALS[goal];
  if (level && MI_LEVELS[level]) out.level = MI_LEVELS[level];
  if (days && MI_WEEKDAYS[days]) {
    out.daysPerWeek = Number(days);
    out.trainingWeekdays = MI_WEEKDAYS[days];
  }
  if (eq && MI_EQ[eq]) out.equipment = MI_EQ[eq];
  return out;
}

// Callback flow: "mi:<clientId>" starts it, "mi:<clientId>:<c1.c2...>" carries answers so far.
export async function onMiniInterview(ctx: MyContext, payload: string) {
  const lang = ctx.user.lang;
  const [idStr, codesStr] = payload.split(":");
  const clientId = Number(idStr);
  const client = await getClientForTrainer(ctx.db, ctx.user._id, clientId);
  if (!client) {
    await reply(ctx, t(lang, "error_generic"));
    return;
  }
  const codes = codesStr ? codesStr.split(".") : [];
  if (codes.length >= MI_STEPS.length) {
    // Done — merge over whatever the client already answered (their answers stay authoritative
    // in the DB; the trainer's take precedence only inside this one-off generation snapshot).
    const profile = { ...client.profile, ...miProfilePatch(codes) };
    await runTrainerDraft(ctx, client, profile);
    return;
  }
  const step = MI_STEPS[codes.length];
  const kb = new InlineKeyboard();
  step.options.forEach((o, i) => {
    kb.text(o.key ? t(lang, o.key) : (o.label ?? o.code), `mi:${clientId}:${[...codes, o.code].join(".")}`);
    if (i % 2 === 1) kb.row();
  });
  kb.row().text(t(lang, "cc_open_card"), `cl:${clientId}:card`);
  const cname = escapeHtml(client.profile.name ?? `id ${clientId}`);
  const title = codes.length === 0 ? `${t(lang, "mi_title", { name: cname })}\n\n` : "";
  await reply(ctx, `${title}(${codes.length + 1}/${MI_STEPS.length}) ${t(lang, step.q)}`, kb);
}

export function clientCardKb(lang: Lang, id: number): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(lang, "cc_plan"), `cl:${id}:plan`)
    .text(t(lang, "cc_schedule"), `cl:${id}:sched`)
    .row()
    .text(t(lang, "cc_progress"), `cl:${id}:prog`)
    .text(t(lang, "cc_body"), `cl:${id}:body`)
    .row()
    .text(t(lang, "cc_draft"), `cl:${id}:draft`)
    .text(t(lang, "cc_assign"), `cl:${id}:assign`)
    .row()
    .text(t(lang, "cc_edit"), `cl:${id}:edit`)
    .text(t(lang, "cc_message"), `cl:${id}:msg`)
    .row()
    .text(t(lang, "cc_thread"), `cl:${id}:thread`)
    .row()
    .text(t(lang, "cc_note"), `cl:${id}:note`)
    .text(t(lang, "cc_flag"), `cl:${id}:flag`)
    .row()
    .text(t(lang, "cc_templates"), `cl:${id}:tpl`)
    .text(t(lang, "cc_logs"), `cl:${id}:logs`)
    .row()
    .text(t(lang, "cc_photo"), `cl:${id}:photo`)
    .text(t(lang, "cc_week"), `cl:${id}:week`)
    .row()
    .text(t(lang, "cc_health"), `cl:${id}:health`)
    .text(t(lang, "cc_personal"), `cl:${id}:pers`)
    .text(t(lang, "cc_interview"), `cl:${id}:intv`);
}

// Trainer/owner edit keyboard for one day of a managed user's plan (no log buttons).
// `prefix` is the card namespace: "cl" (trainer→client) or "ou" (owner→any user).
export function editDayKb(lang: Lang, prefix: string, id: number, weekday: number): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(lang, "swap_btn"), `swap:${weekday}`)
    .text(t(lang, "workout_add_btn"), `workout:add:${weekday}`)
    .row()
    .text(t(lang, "workout_delete_btn"), `workout:delete:${weekday}`)
    .text(t(lang, "reorder_btn"), `ord:open:${weekday}`)
    .row()
    .text(t(lang, "plan_diff_edit_weight"), `wt:open:${weekday}`)
    .text(t(lang, "plan_diff_edit_sets"), `st:open:${weekday}`)
    .row()
    .text(t(lang, "warmup_edit_btn"), `wu:open:${weekday}`)
    .text(t(lang, "video_btn"), `vid:pick:${weekday}`)
    .row()
    .text(t(lang, "edit_pick_day"), `${prefix}:${id}:edit`)
    .text(t(lang, "edit_done"), `${prefix}:${id}:editdone`);
}

// Enter "edit this user's plan" mode → show a day picker. Shared by trainer & owner.
export async function showPlanEditPicker(ctx: MyContext, targetId: number, prefix: string, headerName: string) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, targetId);
  if (!plan || !plan.split.length) {
    // The editor works on the ACTIVE plan only -- but cc_plan (viewing) already falls back to a
    // draft, so a client sitting on an unassigned draft (or an active plan orphaned by a leave/
    // rejoin, see unlinkClient in v2Trainer.ts) could be viewed but never edited. Offer to assign
    // the draft right here instead of a dead-end "no plan" message.
    const draft = await getDraftPlan(ctx.db, targetId);
    if (draft && draft.split.length) {
      const kb = new InlineKeyboard().text(t(lang, "cc_assign"), `${prefix}:${targetId}:assign`);
      await reply(ctx, t(lang, "client_draft_only_trainer", { name: headerName }), kb);
      return;
    }
    await reply(ctx, t(lang, "client_no_plan_trainer"));
    return;
  }
  // Store the prefix too — the day manager (pday:*) builds its links from the session context.
  await setEditOwner(ctx, targetId, prefix === "ou" ? "ou" : "cl");
  const kb = new InlineKeyboard();
  for (const d of [...plan.split].sort((a, b) => a.weekday - b.weekday)) {
    kb.text(`${weekdayName(lang, d.weekday)} — ${d.muscleGroup}`.slice(0, 60), `${prefix}:${targetId}:eday:${d.weekday}`).row();
  }
  kb.text(t(lang, "pday_manage_btn"), "pday:open").text(t(lang, "edit_done"), `${prefix}:${targetId}:editdone`);
  await reply(ctx, t(lang, "edit_pick_day_header", { name: headerName }), kb);
}

// Show one day of a managed user's plan with edit buttons. Shared by trainer & owner.
export async function showPlanEditDay(ctx: MyContext, targetId: number, prefix: string, wd: Weekday) {
  const lang = ctx.user.lang;
  await setEditOwner(ctx, targetId, prefix === "ou" ? "ou" : "cl");
  const target = await getUser(ctx.db, targetId).catch(() => null);
  let plan = await getActivePlan(ctx.db, targetId);
  if (!plan) {
    // Same fallback as showPlanEditPicker: reachable directly via a stale eday button (e.g. from
    // an old chat message) even when the picker itself was never re-opened.
    const draft = await getDraftPlan(ctx.db, targetId);
    if (draft && draft.split.length) {
      const kb = new InlineKeyboard().text(t(lang, "cc_assign"), `${prefix}:${targetId}:assign`);
      await reply(ctx, t(lang, "client_draft_only_trainer", { name: target?.profile.name ?? `id ${targetId}` }), kb);
      return;
    }
    await reply(ctx, t(lang, "client_no_plan_trainer"));
    return;
  }
  // Self-heal English names on view (a pre-localization template/shared assign), in the CLIENT's
  // language, and persist — so the client also sees the corrected plan, not just this editor.
  plan = await healPlanNamesForDisplay(ctx, plan, target?.lang ?? lang);
  const day = getPlanDay(plan, wd);
  if (!day) { await reply(ctx, t(lang, "error_generic")); return; }
  // Editing a plan is NOT logging — suppress the "record workout" CTA and prefix the day with
  // whose plan this is, so a trainer with their own program never confuses it with a client's.
  const header = t(lang, "edit_day_banner", { name: escapeHtml(target?.profile.name ?? `id ${targetId}`) });
  await reply(
    ctx,
    `${header}\n\n${renderToday(lang, day, weekdayName(lang, wd), undefined, await videosForDays(ctx, [day]), { noCta: true })}`,
    editDayKb(lang, prefix, targetId, wd),
  );
}

// ❓ Q&A archive — the trainer's recent client questions with status at a glance.
export async function cmdTrainerQuestions(ctx: MyContext) {
  if (!(await requireTrainer(ctx))) return;
  const lang = ctx.user.lang;
  const qs = await listQuestionsForTrainer(ctx.db, ctx.user._id, 15);
  if (!qs.length) {
    await reply(ctx, t(lang, "qa_none"), menuBtn(lang));
    return;
  }
  const clients = await listClients(ctx.db, ctx.user._id);
  const names = new Map(clients.map((c) => [c._id, c.profile.name ?? `id ${c._id}`]));
  const icon = (s: string) => (s === "answered" ? "✅" : s === "dismissed" ? "✖️" : "⏳");
  const lines = [t(lang, "qa_header")];
  for (const q of qs) {
    const when = q.createdAt.toISOString().slice(5, 10);
    lines.push(
      `${icon(q.status)} ${when} <b>${escapeHtml(names.get(q.clientId) ?? `id ${q.clientId}`)}</b>: ${escapeHtml(q.text.slice(0, 150))}`,
    );
  }
  const kb = new InlineKeyboard().text(t(lang, "tr_back_hub"), "menu:open");
  await reply(ctx, lines.join("\n"), kb);
}

/** clientCardAction "card". */
async function showClientCard(ctx: MyContext, client: UserDoc, clientId: number, cname: string, lang: Lang) {
  await clearEditOwner(ctx);
  // 7-day compliance: % of scheduled workouts done + % of days food was logged.
  const cutoff = localCutoff(client.profile.timezone, 7);
  const [wl, nl] = await Promise.all([
    workoutLogsSince(ctx.db, clientId, cutoff),
    nutritionLogsSince(ctx.db, clientId, cutoff),
  ]);
  const comp = complianceScore({
    completedWorkouts: wl.filter((l) => l.completed).length,
    scheduledWorkouts: (client.profile.trainingWeekdays ?? []).length,
    nutritionDays: nl.length,
    windowDays: 7,
  });
  const note = await getClientNote(ctx.db, ctx.user._id, clientId);
  // Cycle phase — shown to the trainer when the client is female (helps them adjust the
  // session on the fly without having to ask). Menstrual data is medical, so it also
  // requires the client's explicit health-sharing consent.
  let cycleLine = "";
  if (client.profile.sex === "female" && trainerCanSee(client.profile, "health")) {
    const clientDate = localParts(client.profile.timezone ?? "UTC").date;
    const cycleInfo = computeCyclePhase(client.profile, clientDate);
    if (cycleInfo) {
      const phaseLabel = t(lang, `cycle_phase_${cycleInfo.phase}` as Parameters<typeof t>[1]);
      cycleLine = "\n" + t(lang, "cc_cycle_phase", { phase: phaseLabel, day: cycleInfo.day, len: cycleInfo.cycleLength });
    } else {
      cycleLine = "\n" + t(lang, "cc_cycle_no_data");
    }
  }
  const card =
    t(lang, "client_card", { name: cname, status: client.onboarded ? "✅" : "⏳" }) +
    "\n" +
    t(lang, "cc_compliance_line", { workoutPct: comp.workoutPct, nutritionPct: comp.nutritionPct }) +
    cycleLine +
    (note ? `\n\n📝 <i>${escapeHtml(note)}</i>` : "");
  await reply(ctx, card, clientCardKb(lang, clientId));
}

/** clientCardAction "thread". */
async function showClientThread(ctx: MyContext, clientId: number, cname: string, lang: Lang) {
  // Messages were previously write-only (sent once as a Telegram push, never readable again).
  const msgs = await listMessages(ctx.db, ctx.user._id, clientId, 20);
  const kb = new InlineKeyboard()
    .text(t(lang, "cc_message"), `cl:${clientId}:msg`)
    .text(t(lang, "cc_open_card"), `cl:${clientId}:card`);
  if (!msgs.length) {
    await reply(ctx, t(lang, "cc_thread_empty", { name: cname }), kb);
  } else {
    const lines = msgs.map((m) => `${m.createdAt.slice(0, 16).replace("T", " ")} ${m.fromId === ctx.user._id ? "→" : "←"} ${escapeHtml(m.text)}`);
    await reply(ctx, `${t(lang, "cc_thread_title", { name: cname })}\n\n${lines.join("\n")}`, kb);
  }
}

/** clientCardAction "note". */
async function showClientNote(ctx: MyContext, clientId: number, cname: string, lang: Lang) {
  const note = await getClientNote(ctx.db, ctx.user._id, clientId);
  const history = await listClientNoteHistory(ctx.db, ctx.user._id, clientId, "note");
  let body = note ? `📝 ${cname}\n\n${escapeHtml(note)}` : t(lang, "cc_note_empty", { name: cname });
  if (history.length) {
    body += `\n\n<i>${t(lang, "cc_note_history_hdr")}</i>\n` +
      history.slice(0, 5).map((h) => `• ${h.savedAt.slice(0, 10)}: ${escapeHtml(h.value)}`).join("\n");
  }
  const kb = new InlineKeyboard()
    .text(t(lang, "cc_note_edit"), `cl:${clientId}:noteedit`)
    .text(t(lang, "cc_open_card"), `cl:${clientId}:card`);
  await reply(ctx, body, kb);
}

/** clientCardAction "health". */
async function showClientHealth(ctx: MyContext, client: UserDoc, clientId: number, cname: string, lang: Lang) {
  // Trainer-authored health notes first; the client's self-reported limitations/injuries
  // only when the client shares health data.
  const card = await getClientCard(ctx.db, ctx.user._id, clientId);
  const lines = [t(lang, "cc_health_title", { name: cname })];
  lines.push(card?.healthNotes ? escapeHtml(card.healthNotes) : t(lang, "cc_health_none"));
  if (trainerCanSee(client.profile, "health")) {
    if (client.profile.limitations) {
      lines.push("", t(lang, "cc_client_limitations", { text: client.profile.limitations }));
    }
    const injuries = await listActiveInjuries(ctx.db, clientId);
    if (injuries.length) {
      lines.push("", t(lang, "cc_injuries_hdr"));
      for (const inj of injuries) {
        const area = t(lang, `inj_area_${inj.area}` as TKey);
        const sev = t(lang, `inj_sev_${inj.severity}` as TKey);
        const last = inj.checkinsHistory[inj.checkinsHistory.length - 1];
        const pain = last ? ` · ${last.score}/10 (${last.date})` : "";
        lines.push(`• ${area} — ${sev} · ${inj.reportedAt.slice(0, 10)}${pain}`);
      }
    }
  } else {
    lines.push("", t(lang, "cc_share_locked", { name: cname }));
  }
  const healthHistory = await listClientNoteHistory(ctx.db, ctx.user._id, clientId, "healthNotes");
  if (healthHistory.length) {
    lines.push("", `<i>${t(lang, "cc_health_history_hdr")}</i>`);
    for (const h of healthHistory.slice(0, 5)) lines.push(`• ${h.savedAt.slice(0, 10)}: ${escapeHtml(h.value)}`);
  }
  const kb = new InlineKeyboard()
    .text(t(lang, "cc_health_edit"), `cl:${clientId}:healthedit`)
    .text(t(lang, "cc_open_card"), `cl:${clientId}:card`);
  await reply(ctx, lines.join("\n"), kb);
}

/** clientCardAction "pers". */
async function showClientPersonal(ctx: MyContext, clientId: number, cname: string, lang: Lang) {
  const card = await getClientCard(ctx.db, ctx.user._id, clientId);
  const lines = [t(lang, "cc_personal_title", { name: cname })];
  if (card?.birthday) {
    const info = birthdayInfo(card.birthday, new Date().toISOString().slice(0, 10));
    let bday = t(lang, "cc_bday_line", { date: info.display, age: info.age !== undefined ? ` (${info.age})` : "" });
    if (info.daysUntil <= 7) bday += t(lang, "cc_bday_soon", { days: info.daysUntil });
    lines.push(bday);
  }
  lines.push(card?.personalNotes ? escapeHtml(card.personalNotes) : t(lang, "cc_personal_none"));
  const kb = new InlineKeyboard()
    .text(t(lang, "cc_personal_edit"), `cl:${clientId}:persedit`)
    .text(t(lang, "cc_bday_btn"), `cl:${clientId}:bday`)
    .row()
    .text(t(lang, "cc_open_card"), `cl:${clientId}:card`);
  await reply(ctx, lines.join("\n"), kb);
}

/** clientCardAction "intv". */
async function showClientIntake(ctx: MyContext, client: UserDoc, clientId: number, cname: string, lang: Lang) {
  // Interview summary: onboarding answers straight from the client's profile (no backfill
  // needed — both the button wizard and the AI interview write there), consent-gated where
  // the data is body/health sensitive.
  const p = obProgress(client.profile);
  const lines = [t(lang, "cc_intv_title", { name: cname })];
  lines.push(client.onboarded ? t(lang, "cc_intv_done") : t(lang, "cc_intv_progress", { n: p.answered, total: p.total }));
  lines.push("");
  const before = lines.length;
  const add = (key: TKey, v?: string) => { if (v) lines.push(`${t(lang, key)}: ${v}`); };
  add("cc_intv_goal", intvLabel(lang, client.profile.goal));
  add("cc_intv_level", intvLabel(lang, client.profile.level));
  add("cc_intv_history", client.profile.trainingHistory ? escapeHtml(client.profile.trainingHistory) : undefined);
  const days = client.profile.trainingWeekdays ?? [];
  if (days.length) lines.push(`${t(lang, "cc_intv_days")}: ${days.map((w) => weekdayName(lang, w)).join(", ")}`);
  add("cc_intv_equipment", intvLabel(lang, client.profile.equipment));
  add("cc_intv_lifestyle", intvLabel(lang, client.profile.lifestyle));
  add("cc_intv_sleep", intvLabel(lang, client.profile.sleepSchedule));
  add("cc_intv_diet", intvLabel(lang, client.profile.dietPrefs));
  add("cc_intv_allergies", client.profile.allergies ? escapeHtml(client.profile.allergies) : undefined);
  add("cc_intv_food_likes", client.profile.foodLikes ? escapeHtml(client.profile.foodLikes) : undefined);
  add("cc_intv_food_dislikes", client.profile.foodDislikes ? escapeHtml(client.profile.foodDislikes) : undefined);
  add("cc_intv_fav_ex", client.profile.favoriteExercises ? escapeHtml(client.profile.favoriteExercises) : undefined);
  add("cc_intv_dis_ex", client.profile.dislikedExercises ? escapeHtml(client.profile.dislikedExercises) : undefined);
  if (lines.length === before) lines.push(t(lang, "cc_intv_empty"));
  const anthro = anthroBlock(lang, client, cname);
  if (anthro) lines.push("", anthro);
  if (trainerCanSee(client.profile, "health") && client.profile.limitations) {
    lines.push("", t(lang, "cc_client_limitations", { text: client.profile.limitations }));
  }
  const kb = new InlineKeyboard();
  if (!client.onboarded) {
    kb.text(t(lang, "cc_intv_remind_btn"), `cl:${clientId}:intvping`)
      .text(t(lang, "cc_mini_btn"), `mi:${clientId}`)
      .row();
  }
  kb.text(t(lang, "cc_open_card"), `cl:${clientId}:card`);
  await reply(ctx, lines.join("\n"), kb);
}

/** clientCardAction "intvping". */
async function pingClientIntake(ctx: MyContext, client: UserDoc, clientId: number, cname: string, lang: Lang) {
  // Nudge the client to finish the interview: resume the exact question they stopped at.
  if (client.onboarded) { await clientCardAction(ctx, clientId, "intv"); return; }
  const prefix = t(client.lang, "cc_intv_remind_text");
  const transcript = client.session.transcript;
  if (client.session.mode === "onboarding" && transcript?.length) {
    // AI-interview user — re-send the last unanswered question (same as the cron nudge).
    const lastQ = [...transcript].reverse().find((m) => m.role === "assistant");
    await ctx.api
      .sendMessage(client.chatId, `${prefix}\n\n${escapeHtml(lastQ?.text ?? "")}`.trim(), HTML)
      .catch(() => {});
  } else {
    // Button-wizard user (or an abandoned session) — resume at the first unanswered step.
    const step = client.session.mode === "onboarding" && typeof client.session.step === "number"
      ? client.session.step
      : obProgress(client.profile).next;
    await updateUser(ctx.db, clientId, { session: { mode: "onboarding", step } });
    await sendObStepTo(ctx, client, step, prefix);
  }
  await reply(ctx, t(lang, "cc_intv_reminded", { name: cname }));
}

/** clientCardAction "tpl". */
async function showTemplateMenu(ctx: MyContext, clientId: number, cname: string, lang: Lang) {
  // Reusable program templates: assign one to this client, or save their plan as a new one.
  const tpls = await listTrainerTemplates(ctx.db, ctx.user._id);
  const kb = new InlineKeyboard();
  for (const tp of tpls) {
    kb.text(`📋 ${tp.name}`.slice(0, 48), `cl:${clientId}:tplas:${tp.id}`).text("🗑", `tpldel:${tp.id}`).row();
  }
  kb.text(t(lang, "tpl_save_btn"), `cl:${clientId}:tplsave`).row();
  kb.text(t(lang, "cc_open_card"), `cl:${clientId}:card`);
  await reply(ctx, t(lang, tpls.length ? "tpl_pick" : "tpl_none", { name: cname }), kb);
}

export async function clientCardAction(ctx: MyContext, clientId: number, action: string, arg?: string) {
  const lang = ctx.user.lang;
  const client = await getClientForTrainer(ctx.db, ctx.user._id, clientId);
  if (!client) {
    await reply(ctx, t(lang, "client_not_found"));
    return;
  }
  const cname = escapeHtml(client.profile.name ?? `id ${clientId}`);
  if (action === "card") {
    await showClientCard(ctx, client, clientId, cname, lang);
  } else if (action === "edit") {
    await showPlanEditPicker(ctx, clientId, "cl", cname);
  } else if (action === "eday") {
    await showPlanEditDay(ctx, clientId, "cl", Number(arg) as Weekday);
  } else if (action === "editdone") {
    await clearEditOwner(ctx);
    await reply(ctx, t(lang, "client_card", { name: cname, status: client.onboarded ? "✅" : "⏳" }), clientCardKb(lang, clientId));
  } else if (action === "plan") {
    const plan = (await getActivePlan(ctx.db, clientId)) ?? (await getDraftPlan(ctx.db, clientId));
    if (!plan) { await reply(ctx, t(lang, "client_no_plan_trainer")); return; }
    await reply(ctx, renderPlan(lang, plan, await videosForDays(ctx, plan.split)));
  } else if (action === "sched") {
    const plan = await getActivePlan(ctx.db, clientId);
    if (!plan) { await reply(ctx, t(lang, "client_no_plan_trainer")); return; }
    const logs = (await workoutLogsSince(ctx.db, clientId, localCutoff(client.profile.timezone, 14))).map((l) => ({ date: l.date, completed: l.completed }));
    await reply(ctx, renderSchedule(lang, upcomingSessions(lang, plan, client.profile.timezone, logs, 8)));
  } else if (action === "prog") {
    const records = await listStrength(ctx.db, clientId);
    await reply(ctx, renderStrength(lang, records));
  } else if (action === "body") {
    const body = await bodyLogsByUser(ctx.db, clientId);
    // Static anthropometry (profile data) is client-owned — gated by the body-sharing consent.
    // The measurement dynamics below come from logs and stay trainer-visible as before.
    const block = anthroBlock(lang, client, cname);
    const anthro = block ? `${block}\n\n` : "";
    await reply(ctx, `📐 ${cname}\n${anthro}${renderBodyDynamics(lang, body)}`);
  } else if (action === "draft") {
    await runTrainerDraft(ctx, client, client.profile);
  } else if (action === "assign") {
    const ok = await assignDraftPlan(ctx.db, clientId);
    if (!ok) { await reply(ctx, t(lang, "no_draft")); return; }
    await recordAudit(ctx.db, ctx.user._id, "assign_plan", clientId);
    await reply(ctx, t(lang, "plan_assigned", { name: cname }));
    await ctx.api.sendMessage(client.chatId, t(client.lang, "client_plan_assigned"), { ...HTML, reply_markup: mainMenu(client.lang) }).catch(() => {});
  } else if (action === "flag") {
    const next = !client.flagged;
    await setUserFlag(ctx.db, clientId, next);
    await recordAudit(ctx.db, ctx.user._id, next ? "flag_client" : "unflag_client", clientId);
    await reply(ctx, t(lang, next ? "client_flagged" : "client_unflagged", { name: cname }), clientCardKb(lang, clientId));
  } else if (action === "discard") {
    const ok = await deleteDraftPlan(ctx.db, clientId);
    await reply(ctx, t(lang, ok ? "draft_discarded" : "no_draft"), clientCardKb(lang, clientId));
  } else if (action === "msg") {
    await updateUser(ctx.db, ctx.user._id, { session: { mode: "msg_client", targetId: clientId } });
    await reply(ctx, t(lang, "msg_prompt", { name: cname }));
  } else if (action === "thread") {
    await showClientThread(ctx, clientId, cname, lang);
  } else if (action === "note") {
    await showClientNote(ctx, clientId, cname, lang);
  } else if (action === "noteedit") {
    await updateUser(ctx.db, ctx.user._id, { session: { mode: "trainer_note", targetId: clientId } });
    await reply(ctx, t(lang, "cc_note_prompt", { name: cname }));
  } else if (action === "health") {
    await showClientHealth(ctx, client, clientId, cname, lang);
  } else if (action === "healthedit") {
    await updateUser(ctx.db, ctx.user._id, { session: { mode: "trainer_health", targetId: clientId } });
    await reply(ctx, t(lang, "cc_health_prompt"));
  } else if (action === "pers") {
    await showClientPersonal(ctx, clientId, cname, lang);
  } else if (action === "persedit") {
    await updateUser(ctx.db, ctx.user._id, { session: { mode: "trainer_personal", targetId: clientId } });
    await reply(ctx, t(lang, "cc_personal_prompt"));
  } else if (action === "bday") {
    await updateUser(ctx.db, ctx.user._id, { session: { mode: "trainer_bday", targetId: clientId } });
    await reply(ctx, t(lang, "cc_bday_prompt"));
  } else if (action === "intv") {
    await showClientIntake(ctx, client, clientId, cname, lang);
  } else if (action === "intvping") {
    await pingClientIntake(ctx, client, clientId, cname, lang);
  } else if (action === "logs") {
    await showClientLogDays(ctx, clientId);
  } else if (action === "tpl") {
    await showTemplateMenu(ctx, clientId, cname, lang);
  } else if (action === "tplsave") {
    const plan = (await getActivePlan(ctx.db, clientId)) ?? (await getDraftPlan(ctx.db, clientId));
    if (!plan || !plan.split.length) { await reply(ctx, t(lang, "client_no_plan_trainer")); return; }
    ctx.user.session = { ...ctx.user.session, mode: "tpl_name", targetId: clientId };
    await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
    await reply(ctx, t(lang, "tpl_name_prompt"));
  } else if (action === "tplas") {
    const tpl = await getTrainerTemplate(ctx.db, ctx.user._id, Number(arg));
    if (!tpl) { await reply(ctx, t(lang, "error_generic")); return; }
    // Personalize the template for THIS client (weekday remap, weight scaling to bodyweight/PRs)
    // and stage it as a draft — same review/assign path as an AI draft.
    const records = await listStrength(ctx.db, clientId, 8);
    const prs = records.length ? records.map((r) => `${r.exercise}: ${formatRecordBest(r)}`).join("\n") : undefined;
    const draft = adaptPlan(tpl.plan, client.profile, clientId, { prs, authoredBy: ctx.user._id });
    await localizePlanNames(ctx, draft, client.lang);
    await saveDraftPlan(ctx.db, draft);
    await recordAudit(ctx.db, ctx.user._id, "template_draft", clientId, tpl.name).catch(() => {});
    await reply(ctx, t(lang, "tpl_draft_ready", { tpl: tpl.name, name: cname }));
    await reply(ctx, renderPlan(lang, draft), clientCardKb(lang, clientId));
  } else if (action === "week") {
    // Forwardable weekly report card for THIS client — same card the solo user gets.
    const card = await buildWeekCard(ctx.db, clientId, client.profile.timezone, client.profile.name ?? `id ${clientId}`, lang, client.reminders?.lastVacation);
    if (!card) {
      await reply(ctx, t(lang, "wcard_client_empty", { name: cname }), clientCardKb(lang, clientId));
      return;
    }
    await reply(ctx, `${card}\n\n${t(lang, "wcard_client_hint")}`, clientCardKb(lang, clientId));
  } else if (action === "photo") {
    // Ask the client for a progress photo; their next photo routes to this trainer.
    await updateUser(ctx.db, clientId, { session: { ...client.session, photoReviewFor: ctx.user._id } });
    const kb = new InlineKeyboard().text(t(client.lang, "photo_req_skip_btn"), "photo:skip");
    const trName = escapeHtml(ctx.user.profile.name ?? "trainer");
    const ok = await ctx.api
      .sendMessage(client.chatId, t(client.lang, "photo_req_from", { name: trName }), { ...HTML, reply_markup: kb })
      .then(() => true)
      .catch(() => false);
    await reply(ctx, t(lang, ok ? "photo_req_sent" : "error_generic", { name: cname }), clientCardKb(lang, clientId));
  }
}

// Trainer typed a template name → snapshot the client's plan under it.
export async function handleTemplateName(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const clientId = ctx.user.session.targetId;
  await setMode(ctx, "idle");
  if (!clientId) return;
  const plan = (await getActivePlan(ctx.db, clientId)) ?? (await getDraftPlan(ctx.db, clientId));
  if (!plan || !plan.split.length) { await reply(ctx, t(lang, "client_no_plan_trainer")); return; }
  const name = text.trim().slice(0, 48);
  if (!name) { await reply(ctx, t(lang, "error_generic")); return; }
  const bank: BankPlan = {
    split: plan.split,
    nutrition: plan.nutrition,
    ...(plan.restDayNutrition ? { restDayNutrition: plan.restDayNutrition } : {}),
    supplements: plan.supplements ?? [],
    methodology: plan.methodology ?? "",
    ...(typeof plan.stepsTarget === "number" ? { stepsTarget: plan.stepsTarget } : {}),
  };
  await saveTrainerTemplate(ctx.db, ctx.user._id, name, bank);
  await reply(ctx, t(lang, "tpl_saved", { name }), menuBtn(lang));
}

export async function onTemplateDelete(ctx: MyContext, tplId: number) {
  const ok = await deleteTrainerTemplate(ctx.db, ctx.user._id, tplId);
  await reply(ctx, t(ctx.user.lang, ok ? "tpl_deleted" : "error_generic"), menuBtn(ctx.user.lang));
}

// Trainer typed a private note about a client → save it (or "-" to clear) and reopen the card.
export async function handleTrainerNote(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const clientId = ctx.user.session.targetId;
  await setMode(ctx, "idle");
  if (!clientId) return;
  const client = await getClientForTrainer(ctx.db, ctx.user._id, clientId);
  if (!client) { await reply(ctx, t(lang, "client_not_found")); return; }
  const note = text.trim() === "-" ? "" : text.trim().slice(0, 1000);
  await setClientNote(ctx.db, ctx.user._id, clientId, note);
  await reply(ctx, t(lang, note ? "cc_note_saved" : "cc_note_cleared"));
  await clientCardAction(ctx, clientId, "card");
}

// Trainer typed health notes for a client → save to the client card ("-" clears) and reopen.
export async function handleTrainerHealth(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const clientId = ctx.user.session.targetId;
  await setMode(ctx, "idle");
  if (!clientId) return;
  const client = await getClientForTrainer(ctx.db, ctx.user._id, clientId);
  if (!client) { await reply(ctx, t(lang, "client_not_found")); return; }
  const notes = text.trim() === "-" ? null : text.trim().slice(0, 1000);
  await setClientCard(ctx.db, ctx.user._id, clientId, { healthNotes: notes });
  await reply(ctx, t(lang, "cc_health_saved"));
  await clientCardAction(ctx, clientId, "health");
}

// Trainer typed personal notes for a client → save to the client card ("-" clears) and reopen.
export async function handleTrainerPersonal(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const clientId = ctx.user.session.targetId;
  await setMode(ctx, "idle");
  if (!clientId) return;
  const client = await getClientForTrainer(ctx.db, ctx.user._id, clientId);
  if (!client) { await reply(ctx, t(lang, "client_not_found")); return; }
  const notes = text.trim() === "-" ? null : text.trim().slice(0, 1000);
  await setClientCard(ctx.db, ctx.user._id, clientId, { personalNotes: notes });
  await reply(ctx, t(lang, "cc_personal_saved"));
  await clientCardAction(ctx, clientId, "pers");
}

// Trainer typed the client's birthday (DD.MM.YYYY / DD.MM, "-" clears) → save and reopen.
export async function handleTrainerBirthday(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const clientId = ctx.user.session.targetId;
  const tt = text.trim();
  const birthday = tt === "-" ? null : parseBirthdayInput(tt, new Date().toISOString().slice(0, 10));
  if (birthday === null && tt !== "-") { await reply(ctx, t(lang, "cc_bday_invalid")); return; } // stay in mode
  await setMode(ctx, "idle");
  if (!clientId) return;
  const client = await getClientForTrainer(ctx.db, ctx.user._id, clientId);
  if (!client) { await reply(ctx, t(lang, "client_not_found")); return; }
  await setClientCard(ctx.db, ctx.user._id, clientId, { birthday });
  await reply(ctx, t(lang, "cc_bday_saved"));
  await clientCardAction(ctx, clientId, "pers");
}

// --- trainer: view & correct a client's logged (completed) workouts ---

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
  chatId: number;
  lang: Lang;
  text: string;
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
  return { chatId: trainerUser.chatId, lang: trainerUser.lang, text: t(trainerUser.lang, "waitlist_slot_free", { n: pending.length }) };
}

// Best-effort, deduped by nature (fires only on the freeing event itself).
async function notifyWaitlistSlot(ctx: MyContext, trainerId: number) {
  try {
    const nudge = await resolveWaitlistNudge(ctx.db, trainerId);
    if (!nudge) return;
    const kb = new InlineKeyboard().text(t(nudge.lang, "menu_requests"), "menu:requests");
    await ctx.api.sendMessage(nudge.chatId, nudge.text, { ...HTML, reply_markup: kb }).catch(() => {});
  } catch {
    /* best-effort */
  }
}

// On-demand trainer report — the owner's /users table scoped to this trainer's clients
// (same columns minus trainer/ban), plus one-tap "finish the interview" nudges below.
export async function cmdTrainerReport(ctx: MyContext) {
  const lang = ctx.user.lang;
  if (ctx.user.role !== "trainer") return;
  const clients = await listClients(ctx.db, ctx.user._id);
  if (!clients.length) {
    await reply(ctx, t(lang, "tr_report_noclients"), menuBtn(lang));
    return;
  }
  const [eventCounts, planStatus] = await Promise.all([
    eventCountsByUser(ctx.db).catch(() => new Map<number, { workouts: number; checkins: number; nutrition: number; steps: number }>()),
    planStatusByUser(ctx.db).catch(() => new Map<number, { active: boolean; draft: boolean }>()),
  ]);
  // Retention snapshot: active in the last 7 days / total clients.
  const todayStr = localParts(ctx.user.profile.timezone).date;
  const active7 = clients.filter((c) => c.lastSeenAt && c.lastSeenAt.toISOString().slice(0, 10) >= isoDateMinus(todayStr, 7)).length;
  const retentionPct = clients.length ? Math.round((active7 / clients.length) * 100) : 0;
  const biz = [
    `💰 <b>${t(lang, "tr_biz")}</b>`,
    `• ${t(lang, "tr_biz_clients")}: <b>${clients.length}</b> · ${t(lang, "tr_biz_active")}: <b>${active7}</b> (${retentionPct}%)`,
    "",
  ].join("\n");
  const zero = { workouts: 0, checkins: 0, nutrition: 0, steps: 0 };
  // Most-active first, same ranking as the owner table.
  const ranked = [...clients]
    .map((u) => ({ u, ev: eventCounts.get(u._id) ?? zero }))
    .sort((a, b) => {
      const sum = (e: typeof zero) => e.workouts + e.checkins + e.nutrition + e.steps;
      return sum(b.ev) - sum(a.ev);
    });
  const header = ["name", "nick", "stat", "pln", "drf", "W", "C", "N", "S", "last", "blk"];
  const cells = [
    header,
    ...ranked.map(({ u, ev }) => {
      const prog = interviewProgress(u.profile);
      const ps = planStatus.get(u._id);
      return [
        (u.profile.name || `id ${u._id}`).slice(0, 16),
        u.username ? `@${u.username}` : "-",
        u.onboarded ? "ok" : `${prog.filled}/${prog.total}`,
        ps?.active ? "y" : "-",
        ps?.draft ? "y" : "-",
        String(ev.workouts), String(ev.checkins), String(ev.nutrition), String(ev.steps),
        u.lastSeenAt ? u.lastSeenAt.toISOString().slice(5, 10) : "—",
        u.botBlocked ? "x" : "-",
      ];
    }),
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
  const who = escapeHtml(ctx.user.profile.name ?? "trainer");
  let sent = 0;
  for (const c of clients) {
    try {
      await ctx.api.sendMessage(c.chatId, t(c.lang, "tr_broadcast_from", { name: who }) + `\n\n${escapeHtml(text.slice(0, 1500))}`, HTML);
      sent++;
    } catch (err) {
      if (err instanceof GrammyError && err.error_code === 403) await updateUser(ctx.db, c._id, { botBlocked: true }).catch(() => {});
      else console.error("trainer broadcast", c._id, err);
    }
  }
  await reply(ctx, t(lang, "tr_broadcast_sent", { n: sent }), trainerMenu(lang));
}
