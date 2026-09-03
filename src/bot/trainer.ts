// Trainers & clients section — extracted verbatim from src/bot.ts (mechanical split).

import { InlineKeyboard } from "grammy";
import type { BankPlan, Env, Lang, PlanDoc, SetEntry, TrainerDoc, TrainerProfileInput, UserDoc, Weekday } from "../types";
import {
  addOrUpdateReview, applyTrainer, approveTrainer, assignDraftPlan, bodyLogsByUser, canReview,
  countClientsOf, countCompletedWorkouts, countSessionsDoneSince, createRequest, deleteDraftPlan,
  deleteTrainerTemplate, getActivePlan, getClientBilling, getClientCard, getClientForTrainer, getClientNote,
  getDraftPlan, getOwnerChatId, getQuestion, getRequest, getTrainer, getTrainerByCode,
  getTrainerTemplate, getUser, getUsersByIds, getWorkoutLog, insertMessage, linkClient, listActiveInjuries, listBillingForTrainer,
  listClients, listOpenTrainers, listQuestionsForTrainer, listReviews, listStrength,
  listTrainerTemplates, nutritionLogsSince, pendingRequestsForTrainer, recordAudit, rejectTrainer,
  createSharedProgram, getSharedProgram, listPublicPrograms, bumpSharedTaken,
  saveDraftPlan, saveTrainerTemplate, setActivePlan, setClientBilling, setClientCard, setClientNote, setQuestionStatus,
  setRequestStatus, setUserFlag, unlinkClient, updateTrainer, updateUser, upsertStrengthRecord,
  upsertWorkoutLog, workoutLogsSince,
} from "../db/repos";
import { isOwner } from "./owner";
import { adaptPlan } from "../domain/planAdapt";
import { anthroLines, birthdayInfo, parseBirthdayInput, trainerCanSee } from "../domain/clientCard";
import { computeCyclePhase } from "../domain/cycle";
import {
  bestSetForMetric, complianceScore, formatRecordBest, formatSetEntry, getPlanDay, localParts,
  metricOfSets, normalizeExercise, parseWorkoutText,
} from "../domain/progression";
import { escapeHtml, t } from "../locales/i18n";
import { renderPlan, renderSchedule, renderStrength, renderToday, upcomingSessions, weekdayName } from "../render";
import {
  type MyContext, type TKey, HTML, buildPlanDoc, buildWeekCard, clearEditOwner, deferAi,
  isoDateMinus, localCutoff, localizePlanNames, healPlanNamesForDisplay, mainMenu, menuBtn,
  obProgress, renderBodyDynamics, renderObStep, reply, roleMenu, sendFirstObStep, sendObStepTo,
  setEditOwner, setMode, startTrainerBooking, trainerHubMenu, videosForDays, weekdayOf,
} from "../bot";


// ================ trainers & clients ================

/**
 * Deep link into this deployment's bot (`t.me/<bot>?start=<payload>`). The username comes from
 * `BOT_USERNAME` so no deployment's identity is hardcoded; a fork that hasn't set it gets an
 * empty string back and the caller renders "—" instead of a link to someone else's bot.
 */
export function botDeepLink(env: Env, payload: string): string {
  const user = env.BOT_USERNAME?.replace(/^@/, "");
  return user ? `https://t.me/${user}?start=${payload}` : "";
}

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

export async function openFindTrainer(ctx: MyContext) {
  const lang = ctx.user.lang;
  const kb = new InlineKeyboard()
    .text(t(lang, "find_browse"), "find:browse")
    .row()
    .text(t(lang, "find_code"), "find:code");
  await reply(ctx, t(lang, "find_intro"), kb);
}

export async function showCatalog(ctx: MyContext, filter: { tag?: string; lang?: string } = {}) {
  const lang = ctx.user.lang;
  const trainers = await listOpenTrainers(ctx.db, filter);
  const kb = new InlineKeyboard();
  for (const tr of trainers) {
    const star = tr.ratingCount && tr.ratingAvg != null ? ` ⭐${tr.ratingAvg.toFixed(1)}` : "";
    const spec = tr.specialization ? ` — ${tr.specialization}` : "";
    kb.text(`${tr.name}${spec}${star}`.slice(0, 64), `cat:${tr.trainerId}`).row();
  }
  // Filter bar: match my goal · by tag · by language · show all.
  kb.text(t(lang, "catf_goal"), "catf:goal").text(t(lang, "catf_tag"), "catf:tag").row();
  kb.text(t(lang, "catf_lang"), "catf:lang").text(t(lang, "catf_all"), "find:browse");
  await reply(ctx, trainers.length ? t(lang, "catalog_header") : t(lang, "catalog_empty"), kb);
}

export async function showTagPicker(ctx: MyContext) {
  const lang = ctx.user.lang;
  const kb = new InlineKeyboard();
  TRAINER_TAGS.forEach((code, idx) => {
    kb.text(t(lang, TAG_LABEL[code]), `catft:${code}`);
    if ((idx + 1) % 2 === 0) kb.row();
  });
  kb.row().text(t(lang, "back"), "find:browse");
  await reply(ctx, t(lang, "catf_pick_tag"), kb);
}

export async function showLangPicker(ctx: MyContext) {
  const lang = ctx.user.lang;
  const kb = new InlineKeyboard();
  TR_LANG_CODES.forEach((code) => kb.text(t(lang, TR_LANG_LABEL[code]), `catfl:${code}`));
  kb.row().text(t(lang, "back"), "find:browse");
  await reply(ctx, t(lang, "catf_pick_lang"), kb);
}

export async function showTrainerProfile(ctx: MyContext, trainerId: number) {
  const lang = ctx.user.lang;
  const tr = await getTrainer(ctx.db, trainerId);
  if (!tr || tr.status !== "approved") {
    await reply(ctx, t(lang, "catalog_empty"));
    return;
  }
  const trUser = await getUser(ctx.db, trainerId);
  const reviews = await listReviews(ctx.db, trainerId, 3);
  let body = trainerCardText(lang, tr, { usernameFallback: trUser?.username ? `@${trUser.username}` : undefined });
  if (reviews.length) {
    const lines = reviews.map((r) => `${"⭐".repeat(r.rating)}${r.text ? ` ${escapeHtml(r.text)}` : ""}`);
    body += `\n\n💬 <b>${t(lang, "tr_reviews_title")}</b>\n${lines.join("\n")}`;
  }
  const kb = new InlineKeyboard().text(t(lang, "trainer_request_btn"), `catreq:${trainerId}`);
  if (tr.priceOffline != null) kb.row().text(t(lang, "book_offline_btn"), `book:${trainerId}`);
  if (await canReview(ctx.db, trainerId, ctx.user._id)) kb.row().text(t(lang, "review_btn"), `rev:start:${trainerId}`);
  kb.row().text(t(lang, "back"), "find:browse");
  // Photo first (no caption — keeps the rich card free of Telegram's 1024-char caption limit).
  if (tr.photoFileId) await ctx.api.sendPhoto(ctx.user.chatId, tr.photoFileId).catch(() => {});
  await reply(ctx, body, kb);
}

// Offline booking: ping the trainer with the prospect's contact, and give the user the trainer's.
// Client requests a trainer → ask for an optional note (handled in client_note mode).
export async function requestTrainerStart(ctx: MyContext, trainerId: number) {
  const lang = ctx.user.lang;
  await updateUser(ctx.db, ctx.user._id, { session: { mode: "client_note", targetId: trainerId } });
  await reply(ctx, t(lang, "request_note_prompt"));
}

export async function handleClientNote(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const trainerId = ctx.user.session.targetId;
  if (!trainerId) {
    await setMode(ctx, "idle");
    return;
  }
  const trainer = await getUser(ctx.db, trainerId);
  if (!trainer) {
    await setMode(ctx, "idle");
    await reply(ctx, t(lang, "error_generic"));
    return;
  }
  const note = text.trim() === "-" ? undefined : text.trim();
  const reqId = await createRequest(ctx.db, ctx.user._id, trainerId, note);
  await setMode(ctx, "idle");
  // Capacity check: a full roster keeps the request pending as a WAITLIST — the client is
  // told honestly, and the trainer sees the waitlist tag on the notification.
  const [tr, nClients] = await Promise.all([
    getTrainer(ctx.db, trainerId).catch(() => null),
    countClientsOf(ctx.db, trainerId).catch(() => 0),
  ]);
  const atCapacity = !!tr?.maxClients && nClients >= tr.maxClients;
  const trainerName = escapeHtml(trainer.profile.name ?? "trainer");
  await reply(ctx, t(lang, atCapacity ? "request_sent_waitlist" : "request_sent", { name: trainerName }));
  const who = escapeHtml(ctx.user.profile.name ?? `id ${ctx.user._id}`);
  const kb = new InlineKeyboard()
    .text(t(trainer.lang, "req_accept"), `req:accept:${reqId}`)
    .text(t(trainer.lang, "req_decline"), `req:decline:${reqId}`);
  const body =
    t(trainer.lang, "trainer_new_request", { name: who }) +
    (atCapacity ? `\n${t(trainer.lang, "trainer_request_waitlist")}` : "") +
    (note ? `\n\n💬 ${escapeHtml(note)}` : "");
  await ctx.api.sendMessage(trainer.chatId, body, { ...HTML, reply_markup: kb }).catch(() => {});
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
  await linkClient(ctx.db, ctx.user._id, tr.trainerId);
  ctx.user.role = "client";
  ctx.user.trainerId = tr.trainerId;
  const trainer = await getUser(ctx.db, tr.trainerId);
  // Already-onboarded athlete → transfer WITHOUT re-onboarding. linkClient keeps all their data
  // (logs, body, records, plan); the trainer sees it all on the client card for analytics.
  if (ctx.user.onboarded) {
    ctx.user.session = { mode: "idle" };
    await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
    await reply(ctx, t(lang, "client_transferred", { name: escapeHtml(tr.name) }), menuBtn(lang));
    if (trainer) await notifyTrainerOfClient(ctx, trainer, ctx.user, true);
    await reply(ctx, t(lang, "share_prompt_new"), sharePromptKb(lang));
    return;
  }
  // Brand-new user → run the athlete intake first (we are in the client's context).
  await reply(ctx, t(lang, "client_paired", { name: escapeHtml(tr.name) }));
  if (trainer) await notifyTrainerOfClient(ctx, trainer, ctx.user, false);
  await reply(ctx, t(lang, "share_prompt_new"), sharePromptKb(lang));
  ctx.user.session = { mode: "onboarding", step: 0 };
  await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
  await renderObStep(ctx, 0);
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

export const TRAINER_TAGS = [
  "strength", "fatloss", "muscle", "recomp", "powerlifting", "bodybuilding",
  "rehab", "mobility", "womens", "nutrition", "conditioning", "beginners",
] as const;
export const TAG_LABEL: Record<string, TKey> = {
  strength: "tag_strength", fatloss: "tag_fatloss", muscle: "tag_muscle", recomp: "tag_recomp",
  powerlifting: "tag_powerlifting", bodybuilding: "tag_bodybuilding", rehab: "tag_rehab",
  mobility: "tag_mobility", womens: "tag_womens", nutrition: "tag_nutrition",
  conditioning: "tag_conditioning", beginners: "tag_beginners",
};
export const TR_LANG_CODES = ["uk", "en", "ru"] as const;
export const TR_LANG_LABEL: Record<string, TKey> = { uk: "trlang_uk", en: "trlang_en", ru: "trlang_ru" };
export const TR_CURRENCIES = ["UAH", "USD", "EUR"] as const;
export const CURRENCY_SYMBOL: Record<string, string> = { UAH: "₴", USD: "$", EUR: "€" };

export const TW_FIELD_LABEL: Record<string, TKey> = {
  name: "twf_name", specialization: "twf_specialization", tags: "twf_tags",
  experienceYears: "twf_experience", certifications: "twf_certifications", approach: "twf_approach",
  languages: "twf_languages", currency: "twf_currency", priceOnline: "twf_price_online",
  priceOffline: "twf_price_offline", city: "twf_city", contact: "twf_contact",
  bio: "twf_bio", photoFileId: "twf_photo",
};

interface TwStep {
  field: keyof TrainerProfileInput | "preview";
  q: TKey;
  kind: "text" | "number" | "tags" | "languages" | "currency" | "photo" | "preview";
  skip?: boolean;
  max?: number;
  maxLen?: number;
}

export function trainerSteps(): TwStep[] {
  return [
    { field: "name", q: "tw_q_name", kind: "text", maxLen: 80 },
    { field: "specialization", q: "tw_q_specialization", kind: "text", maxLen: 200 },
    { field: "tags", q: "tw_q_tags", kind: "tags" },
    { field: "experienceYears", q: "tw_q_experience", kind: "number", max: 70 },
    { field: "certifications", q: "tw_q_certifications", kind: "text", skip: true, maxLen: 300 },
    { field: "approach", q: "tw_q_approach", kind: "text", skip: true, maxLen: 500 },
    { field: "languages", q: "tw_q_languages", kind: "languages" },
    { field: "currency", q: "tw_q_currency", kind: "currency" },
    { field: "priceOnline", q: "tw_q_price_online", kind: "number", skip: true, max: 1_000_000 },
    { field: "priceOffline", q: "tw_q_price_offline", kind: "number", skip: true, max: 1_000_000 },
    { field: "city", q: "tw_q_city", kind: "text", skip: true, maxLen: 80 },
    { field: "contact", q: "tw_q_contact", kind: "text", skip: true, maxLen: 80 },
    { field: "bio", q: "tw_q_bio", kind: "text", maxLen: 600 },
    { field: "photoFileId", q: "tw_q_photo", kind: "photo", skip: true },
    { field: "preview", q: "tw_preview_title", kind: "preview" },
  ];
}

type TrainerCardData = {
  name: string;
  specialization?: string;
  tags?: string[];
  certifications?: string;
  experienceYears?: number;
  approach?: string;
  priceOnline?: number;
  priceOffline?: number;
  currency?: string;
  city?: string;
  contact?: string;
  languages?: string[];
  bio?: string;
  ratingAvg?: number;
  ratingCount?: number;
};

// Render the client-facing trainer card (only non-empty lines). Used by the directory,
// the wizard preview, the trainer home, and the owner approval message.
export function trainerCardText(lang: Lang, tr: TrainerCardData, opts: { usernameFallback?: string } = {}): string {
  const lines: string[] = [];
  const rating =
    tr.ratingCount && tr.ratingAvg != null
      ? `  ⭐ ${tr.ratingAvg.toFixed(1)} · ${t(lang, "tr_reviews_n", { n: tr.ratingCount })}`
      : "";
  lines.push(`🧑‍🏫 <b>${escapeHtml(tr.name)}</b>${rating}`);
  if (tr.specialization) lines.push(`🎯 ${escapeHtml(tr.specialization)}`);
  if (tr.tags?.length) lines.push(`🏷 ${tr.tags.map((c) => t(lang, TAG_LABEL[c] ?? (`tag_${c}` as TKey))).join(", ")}`);
  if (tr.experienceYears != null) lines.push(`📅 ${t(lang, "tr_years", { n: tr.experienceYears })}`);
  if (tr.languages?.length) lines.push(`🗣 ${tr.languages.map((c) => t(lang, TR_LANG_LABEL[c] ?? (c as TKey))).join(", ")}`);
  if (tr.certifications) lines.push(`🎓 ${escapeHtml(tr.certifications)}`);
  if (tr.approach) lines.push(`🧭 ${escapeHtml(tr.approach)}`);
  const cur = tr.currency ? CURRENCY_SYMBOL[tr.currency] ?? tr.currency : "";
  const prices: string[] = [];
  if (tr.priceOnline != null) prices.push(`${t(lang, "tr_price_online")}: ${tr.priceOnline} ${cur}`.trim());
  if (tr.priceOffline != null) prices.push(`${t(lang, "tr_price_offline")}: ${tr.priceOffline} ${cur}`.trim());
  if (prices.length) lines.push(`💵 ${prices.join("   ")}`);
  if (tr.priceOffline != null && tr.city) lines.push(`📍 ${escapeHtml(tr.city)}`);
  const contact = tr.contact || opts.usernameFallback;
  if (contact) lines.push(`📨 ${t(lang, "tr_booking")}: ${escapeHtml(contact)}`);
  if (tr.bio) lines.push(`\n${escapeHtml(tr.bio)}`);
  return lines.join("\n");
}

export function draftToTrainerLike(d: TrainerProfileInput): TrainerCardData {
  return {
    name: d.name ?? "—",
    specialization: d.specialization,
    tags: d.tags,
    certifications: d.certifications,
    experienceYears: d.experienceYears,
    approach: d.approach,
    priceOnline: d.priceOnline,
    priceOffline: d.priceOffline,
    currency: d.currency,
    city: d.city,
    contact: d.contact,
    languages: d.languages,
    bio: d.bio,
  };
}

// A trainer is listed in the directory only once the core fields are filled.
export function isDraftComplete(d: TrainerProfileInput): boolean {
  return !!(
    d.name && (d.specialization || (d.tags && d.tags.length)) &&
    d.experienceYears != null && d.bio && d.photoFileId &&
    (d.priceOnline != null || d.priceOffline != null)
  );
}

export function missingFieldsLabel(lang: Lang, d: TrainerProfileInput): string {
  const miss: string[] = [];
  if (!d.specialization && !(d.tags && d.tags.length)) miss.push(t(lang, "twf_specialization"));
  if (d.experienceYears == null) miss.push(t(lang, "twf_experience"));
  if (!d.bio) miss.push(t(lang, "twf_bio"));
  if (!d.photoFileId) miss.push(t(lang, "twf_photo"));
  if (d.priceOnline == null && d.priceOffline == null) miss.push(t(lang, "twf_price"));
  return miss.join(", ");
}

// English style block injected into the plan prompt so a client's AI draft matches their
// human trainer's stated specialization/approach. Returns undefined when there's no signal.
export function trainerStyleBlock(tr: TrainerDoc): string | undefined {
  const parts: string[] = [`This client trains under human coach "${tr.name}".`];
  if (tr.specialization) parts.push(`Specialization: ${tr.specialization}.`);
  if (tr.tags?.length) parts.push(`Focus areas: ${tr.tags.join(", ")}.`);
  if (tr.experienceYears != null) parts.push(`Coaching experience: ${tr.experienceYears} years.`);
  if (tr.certifications) parts.push(`Certifications: ${tr.certifications}.`);
  if (tr.approach) parts.push(`Coaching approach / methodology: ${tr.approach}.`);
  return parts.length > 1 ? parts.join(" ") : undefined;
}

// Map the client's free-text goal to a directory tag for one-tap "find a trainer for my goal".
export function goalToTag(goal?: string): string | undefined {
  const g = (goal ?? "").toLowerCase();
  if (/recomp|реком/.test(g)) return "recomp";
  if (/fat|loss|похуд|схуд|жир/.test(g)) return "fatloss";
  if (/muscle|gain|mass|м.?яз|набір|набор/.test(g)) return "muscle";
  if (/strength|сил/.test(g)) return "strength";
  return undefined;
}

export async function startTrainerWizard(ctx: MyContext) {
  const draft: TrainerProfileInput = { name: ctx.user.profile.name };
  ctx.user.session = { mode: "trainer_setup", step: 0, trainerDraft: draft, editField: undefined };
  await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
  await renderTwStep(ctx, 0);
}

// Approved/pending trainer editing their existing profile: seed the draft and jump to preview.
export async function openTrainerEdit(ctx: MyContext) {
  const tr = await getTrainer(ctx.db, ctx.user._id);
  if (!tr) {
    await startTrainerWizard(ctx);
    return;
  }
  const draft: TrainerProfileInput = {
    name: tr.name, bio: tr.bio, specialization: tr.specialization, tags: tr.tags,
    certifications: tr.certifications, experienceYears: tr.experienceYears, approach: tr.approach,
    priceOnline: tr.priceOnline, priceOffline: tr.priceOffline, currency: tr.currency,
    city: tr.city, contact: tr.contact, languages: tr.languages, photoFileId: tr.photoFileId,
  };
  ctx.user.session = { mode: "trainer_setup", step: trainerSteps().length - 1, trainerDraft: draft, editField: undefined };
  await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
  await renderTwPreview(ctx);
}

export function twKeyboard(lang: Lang, step: TwStep, draft: TrainerProfileInput): InlineKeyboard | undefined {
  const kb = new InlineKeyboard();
  if (step.kind === "tags") {
    const sel = new Set(draft.tags ?? []);
    TRAINER_TAGS.forEach((code, idx) => {
      kb.text(`${sel.has(code) ? "✅ " : ""}${t(lang, TAG_LABEL[code])}`, `tw:tag:${code}`);
      if ((idx + 1) % 2 === 0) kb.row();
    });
    kb.row().text(t(lang, "tw_done"), "tw:next");
  } else if (step.kind === "languages") {
    const sel = new Set(draft.languages ?? []);
    TR_LANG_CODES.forEach((code) => kb.text(`${sel.has(code) ? "✅ " : ""}${t(lang, TR_LANG_LABEL[code])}`, `tw:lang:${code}`));
    kb.row().text(t(lang, "tw_done"), "tw:next");
  } else if (step.kind === "currency") {
    TR_CURRENCIES.forEach((c) => kb.text(`${CURRENCY_SYMBOL[c]} ${c}`, `tw:cur:${c}`));
  } else if (step.kind === "photo") {
    kb.text(t(lang, "tw_photo_upload"), "tw:photo:upload").row();
    kb.text(t(lang, "tw_photo_telegram"), "tw:photo:tg").row();
    kb.text(t(lang, "tw_skip"), "tw:skip");
  } else {
    if (step.field === "contact") kb.text(t(lang, "tw_contact_tg"), "tw:contact:tg").row();
    if (step.skip) kb.text(t(lang, "tw_skip"), "tw:skip");
  }
  return kb.inline_keyboard.length ? kb : undefined;
}

export async function renderTwStep(ctx: MyContext, i: number) {
  const lang = ctx.user.lang;
  const steps = trainerSteps();
  const step = steps[i];
  if (!step || step.kind === "preview") {
    await renderTwPreview(ctx);
    return;
  }
  const draft = ctx.user.session.trainerDraft ?? {};
  const total = steps.length - 1; // exclude the preview step from the counter
  const progress = ctx.user.session.editField ? "" : `(${i + 1}/${total}) `;
  await reply(ctx, `${progress}${t(lang, step.q)}`, twKeyboard(lang, step, draft));
}

export async function renderTwPreview(ctx: MyContext) {
  const lang = ctx.user.lang;
  const draft = ctx.user.session.trainerDraft ?? {};
  const card = trainerCardText(lang, draftToTrainerLike(draft));
  let body = `${t(lang, "tw_preview_title")}\n\n${card}`;
  const missing = missingFieldsLabel(lang, draft);
  if (missing) body += `\n\n⚠️ ${t(lang, "tw_incomplete_warn", { fields: missing })}`;
  const kb = new InlineKeyboard()
    .text(t(lang, "tw_submit"), "tw:submit")
    .row()
    .text(t(lang, "tw_edit_field"), "tw:editfield");
  if (draft.photoFileId) await ctx.api.sendPhoto(ctx.user.chatId, draft.photoFileId).catch(() => {});
  await reply(ctx, body, kb);
}

export async function twFieldMenu(ctx: MyContext) {
  const lang = ctx.user.lang;
  const kb = new InlineKeyboard();
  const fields = trainerSteps().filter((s) => s.kind !== "preview");
  fields.forEach((s, idx) => {
    kb.text(t(lang, TW_FIELD_LABEL[s.field as string]), `twf:${s.field}`);
    if ((idx + 1) % 2 === 0) kb.row();
  });
  kb.row().text(t(lang, "back"), "tw:preview");
  await reply(ctx, t(lang, "tw_edit_which"), kb);
}

export async function twEditField(ctx: MyContext, field: string) {
  if (ctx.user.session.mode !== "trainer_setup") return;
  const steps = trainerSteps();
  const idx = steps.findIndex((s) => s.field === field && s.kind !== "preview");
  if (idx < 0) {
    await renderTwPreview(ctx);
    return;
  }
  ctx.user.session = { ...ctx.user.session, step: idx, editField: field };
  await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
  await renderTwStep(ctx, idx);
}

// Advance one step — or, when editing a single field, return straight to the preview.
export async function twAdvance(ctx: MyContext) {
  if (ctx.user.session.editField) {
    ctx.user.session = { ...ctx.user.session, editField: undefined };
    await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
    await renderTwPreview(ctx);
    return;
  }
  const next = (ctx.user.session.step ?? 0) + 1;
  ctx.user.session = { ...ctx.user.session, step: next };
  await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
  await renderTwStep(ctx, next);
}

export async function twSetValue(ctx: MyContext, patch: Partial<TrainerProfileInput>) {
  ctx.user.session = {
    ...ctx.user.session,
    trainerDraft: { ...(ctx.user.session.trainerDraft ?? {}), ...patch },
  };
  await twAdvance(ctx);
}

export async function fetchTelegramPhotoFileId(ctx: MyContext): Promise<string | undefined> {
  try {
    const res = await ctx.api.getUserProfilePhotos(ctx.user._id, { limit: 1 });
    const first = res.photos?.[0];
    if (!first || !first.length) return undefined;
    return first[first.length - 1].file_id; // largest available size
  } catch {
    return undefined;
  }
}

// All tw:* callback taps during the trainer wizard.
export async function trainerWizardButton(ctx: MyContext, data: string) {
  const lang = ctx.user.lang;
  if (ctx.user.session.mode !== "trainer_setup") return;
  const step = trainerSteps()[ctx.user.session.step ?? 0];
  if (data === "tw:next" || data === "tw:skip") { await twAdvance(ctx); return; }
  if (data === "tw:preview") { await renderTwPreview(ctx); return; }
  if (data === "tw:editfield") { await twFieldMenu(ctx); return; }
  if (data === "tw:submit") { await finishTrainerWizard(ctx); return; }
  if (data === "tw:photo:upload") { await reply(ctx, t(lang, "tw_photo_send_now")); return; }
  if (data === "tw:photo:tg") {
    const fileId = await fetchTelegramPhotoFileId(ctx);
    if (!fileId) { await reply(ctx, t(lang, "tw_no_tg_photo")); return; }
    await twSetValue(ctx, { photoFileId: fileId });
    return;
  }
  if (data === "tw:contact:tg") {
    const uname = ctx.user.username ? `@${ctx.user.username}` : undefined;
    if (!uname) { await reply(ctx, t(lang, "tw_no_username")); return; }
    await twSetValue(ctx, { contact: uname });
    return;
  }
  if (data.startsWith("tw:cur:")) {
    await twSetValue(ctx, { currency: data.slice("tw:cur:".length) as TrainerProfileInput["currency"] });
    return;
  }
  if (data.startsWith("tw:tag:") || data.startsWith("tw:lang:")) {
    const isTag = data.startsWith("tw:tag:");
    const code = data.slice(isTag ? "tw:tag:".length : "tw:lang:".length);
    const key = isTag ? "tags" : "languages";
    const cur = new Set((ctx.user.session.trainerDraft?.[key] as string[] | undefined) ?? []);
    cur.has(code) ? cur.delete(code) : cur.add(code);
    ctx.user.session = {
      ...ctx.user.session,
      trainerDraft: { ...(ctx.user.session.trainerDraft ?? {}), [key]: [...cur] },
    };
    await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
    if (step) {
      await ctx.editMessageReplyMarkup({ reply_markup: twKeyboard(lang, step, ctx.user.session.trainerDraft ?? {}) }).catch(() => {});
    }
    return;
  }
}

// Typed answers (text/number steps) during the trainer wizard.
export async function handleTwText(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const step = trainerSteps()[ctx.user.session.step ?? 0];
  if (!step) {
    await renderTwPreview(ctx);
    return;
  }
  const val = text.trim();
  if (step.kind === "number") {
    const n = parseInt(val.replace(/[^\d]/g, ""), 10);
    if (!Number.isFinite(n) || n < 0 || (step.max != null && n > step.max)) {
      await reply(ctx, t(lang, "tw_invalid_number"));
      return;
    }
    await twSetValue(ctx, { [step.field]: n } as Partial<TrainerProfileInput>);
    return;
  }
  if (step.kind === "text") {
    if (!val) {
      await reply(ctx, t(lang, step.q));
      return;
    }
    await twSetValue(ctx, { [step.field]: val.slice(0, step.maxLen ?? 200) } as Partial<TrainerProfileInput>);
    return;
  }
  // Button-only step but the user typed — re-render its buttons.
  await renderTwStep(ctx, ctx.user.session.step ?? 0);
}

export async function finishTrainerWizard(ctx: MyContext) {
  const lang = ctx.user.lang;
  const draft = ctx.user.session.trainerDraft ?? {};
  const complete = isDraftComplete(draft);
  const input: TrainerProfileInput = { ...draft, profileComplete: complete };
  const existing = await getTrainer(ctx.db, ctx.user._id);
  const approved = ctx.user.role === "trainer" || existing?.status === "approved";
  ctx.user.session = { mode: "idle" };
  if (approved) {
    // Never hide an already-listed trainer because of a partial edit; completing only helps.
    input.profileComplete = complete || (existing?.profileComplete ?? false);
    await updateTrainer(ctx.db, ctx.user._id, { ...input });
    await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
    await reply(ctx, t(lang, input.profileComplete ? "trainer_profile_saved" : "tw_saved_incomplete"), trainerMenu(lang));
    return;
  }
  // New applicant → save pending and notify the owner with the full card.
  await applyTrainer(ctx.db, ctx.user._id, input);
  await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
  await reply(ctx, t(lang, complete ? "trainer_applied" : "tw_applied_incomplete"));
  const ownerChatId = await getOwnerChatId(ctx.db);
  if (ownerChatId) {
    const kb = new InlineKeyboard()
      .text("✅ Approve", `trainer:approve:${ctx.user._id}`)
      .text("❌ Reject", `trainer:reject:${ctx.user._id}`);
    if (draft.photoFileId) await ctx.api.sendPhoto(ownerChatId, draft.photoFileId).catch(() => {});
    await ctx.api
      .sendMessage(ownerChatId, `🧑‍🏫 <b>Trainer application</b>\n\n${trainerCardText(lang, draftToTrainerLike(draft))}`, { ...HTML, reply_markup: kb })
      .catch(() => {});
  }
}

// ======================= Trainer reviews (client side) =======================

export async function startReview(ctx: MyContext, trainerId: number) {
  const lang = ctx.user.lang;
  if (!(await canReview(ctx.db, trainerId, ctx.user._id))) {
    await reply(ctx, t(lang, "review_not_allowed"));
    return;
  }
  const kb = new InlineKeyboard();
  for (let n = 1; n <= 5; n++) kb.text("⭐".repeat(n), `rev:rate:${trainerId}:${n}`);
  await reply(ctx, t(lang, "review_rate_prompt"), kb);
}

export async function onReviewRate(ctx: MyContext, trainerId: number, rating: number) {
  ctx.user.session = { mode: "review_text", targetId: trainerId, reviewRating: rating };
  await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
  await reply(ctx, t(ctx.user.lang, "review_comment_prompt"));
}

export async function handleReviewText(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const trainerId = ctx.user.session.targetId;
  const rating = ctx.user.session.reviewRating ?? 5;
  if (!trainerId) {
    await setMode(ctx, "idle");
    return;
  }
  const comment = text.trim() === "-" ? undefined : text.trim().slice(0, 400);
  await addOrUpdateReview(ctx.db, trainerId, ctx.user._id, rating, comment);
  await setMode(ctx, "idle");
  await reply(ctx, t(lang, "review_thanks"));
  const trainer = await getUser(ctx.db, trainerId);
  if (trainer) {
    await ctx.api.sendMessage(trainer.chatId, t(trainer.lang, "review_received", { n: rating }), HTML).catch(() => {});
  }
}

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
    const kb = new InlineKeyboard().text(t(client.lang, "find_browse"), "find:browse");
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
    .text(t(lang, "trainer_edit_profile"), "tr:edit");
  const card = trainerCardText(lang, tr, { usernameFallback: ctx.user.username ? `@${ctx.user.username}` : undefined });
  const statusLine = tr.profileComplete ? t(lang, "trainer_status_listed") : t(lang, "trainer_status_hidden");
  const full = tr.maxClients !== undefined && nClients >= tr.maxClients;
  const body =
    `${card}\n\n${statusLine}\n${t(lang, "trainer_invite_link", { link })}` +
    (full ? `\n${t(lang, "trainer_at_capacity")}` : "");
  if (tr.photoFileId) await ctx.api.sendPhoto(ctx.user.chatId, tr.photoFileId).catch(() => {});
  await reply(ctx, body, kb);
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

// Can this actor share programs broadly? Owner always; a trainer only if the owner granted the
// instructor capability. Gate for the whole share flow.
export async function canShareProgram(ctx: MyContext): Promise<boolean> {
  if (await isOwner(ctx)) return true;
  if (ctx.user.role !== "trainer") return false;
  const tr = await getTrainer(ctx.db, ctx.user._id).catch(() => null);
  return !!tr?.isInstructor;
}

// 📤 Share a program — pick one of the instructor's saved templates, then choose how to
// distribute it (selected clients / a link / the public library).
export async function cmdShareProgram(ctx: MyContext) {
  const lang = ctx.user.lang;
  if (!(await canShareProgram(ctx))) { await reply(ctx, t(lang, "share_not_allowed"), menuBtn(lang)); return; }
  const templates = await listTrainerTemplates(ctx.db, ctx.user._id);
  if (!templates.length) { await reply(ctx, t(lang, "share_no_templates"), menuBtn(lang)); return; }
  const kb = new InlineKeyboard();
  for (const tp of templates) kb.text(`📋 ${tp.name}`.slice(0, 60), `shr:t:${tp.id}`).row();
  kb.text(t(lang, "tr_back_hub"), "menu:open");
  await reply(ctx, t(lang, "share_pick_program"), kb);
}

// Distribution menu for a chosen template: clients / link / library.
export async function shareTemplateMenu(ctx: MyContext, templateId: number) {
  const lang = ctx.user.lang;
  if (!(await canShareProgram(ctx))) { await reply(ctx, t(lang, "share_not_allowed")); return; }
  const tpl = await getTrainerTemplate(ctx.db, ctx.user._id, templateId);
  if (!tpl) { await reply(ctx, t(lang, "error_generic")); return; }
  const kb = new InlineKeyboard()
    .text(t(lang, "share_to_clients"), `shr:sel:${templateId}`)
    .row()
    .text(t(lang, "share_by_link"), `shr:link:${templateId}`)
    .text(t(lang, "share_to_library"), `shr:pub:${templateId}`)
    .row()
    .text(t(lang, "tr_back_hub"), "menu:share");
  await reply(ctx, t(lang, "share_how", { name: escapeHtml(tpl.name) }), kb);
}

// --- Mode 1: assign to SELECTED clients (multi-select) ---
function shareSelectKb(lang: Lang, clients: UserDoc[], sel: Set<number>): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const c of clients) {
    kb.text(`${sel.has(c._id) ? "✅" : "☐"} ${c.profile.name ?? `id ${c._id}`}`.slice(0, 60), `shrc:${c._id}`).row();
  }
  return kb
    .text(t(lang, sel.size === clients.length ? "share_clear_all" : "share_select_all"), "shr:all")
    .row()
    .text(t(lang, "share_assign_n", { n: sel.size }), "shr:go")
    .text(t(lang, "share_cancel_btn"), "menu:share");
}

export async function startShareSelect(ctx: MyContext, templateId: number) {
  const lang = ctx.user.lang;
  if (!(await canShareProgram(ctx))) { await reply(ctx, t(lang, "share_not_allowed")); return; }
  const clients = await listClients(ctx.db, ctx.user._id);
  if (!clients.length) { await reply(ctx, t(lang, "share_no_clients"), menuBtn(lang)); return; }
  const session = { ...ctx.user.session, shareTemplate: templateId, shareClients: [] as number[] };
  await updateUser(ctx.db, ctx.user._id, { session });
  ctx.user.session = session;
  await reply(ctx, t(lang, "share_pick_clients"), shareSelectKb(lang, clients, new Set()));
}

async function reRenderShareSelect(ctx: MyContext) {
  const clients = await listClients(ctx.db, ctx.user._id);
  const sel = new Set(ctx.user.session.shareClients ?? []);
  await ctx.editMessageReplyMarkup({ reply_markup: shareSelectKb(ctx.user.lang, clients, sel) }).catch(() => {});
}

export async function toggleShareClient(ctx: MyContext, clientId: number) {
  const sel = new Set(ctx.user.session.shareClients ?? []);
  sel.has(clientId) ? sel.delete(clientId) : sel.add(clientId);
  const session = { ...ctx.user.session, shareClients: [...sel] };
  await updateUser(ctx.db, ctx.user._id, { session });
  ctx.user.session = session;
  await reRenderShareSelect(ctx);
}

export async function toggleShareAll(ctx: MyContext) {
  const clients = await listClients(ctx.db, ctx.user._id);
  const all = (ctx.user.session.shareClients ?? []).length === clients.length;
  const session = { ...ctx.user.session, shareClients: all ? [] : clients.map((c) => c._id) };
  await updateUser(ctx.db, ctx.user._id, { session });
  ctx.user.session = session;
  await reRenderShareSelect(ctx);
}

// Assign the stashed template to the SELECTED clients — adapted per client, activated, notified.
export async function shareAssignToClients(ctx: MyContext) {
  const lang = ctx.user.lang;
  if (!(await canShareProgram(ctx))) { await reply(ctx, t(lang, "share_not_allowed")); return; }
  const templateId = ctx.user.session.shareTemplate;
  const ids = new Set(ctx.user.session.shareClients ?? []);
  if (!templateId || !ids.size) { await reply(ctx, t(lang, "share_pick_none"), menuBtn(lang)); return; }
  const tpl = await getTrainerTemplate(ctx.db, ctx.user._id, templateId);
  if (!tpl) { await reply(ctx, t(lang, "error_generic")); return; }
  const clients = (await listClients(ctx.db, ctx.user._id)).filter((c) => ids.has(c._id));
  await reply(ctx, t(lang, "share_running", { n: clients.length }));
  let ok = 0;
  for (const c of clients) {
    try {
      const records = await listStrength(ctx.db, c._id, 8).catch(() => []);
      const prs = records.length ? records.map((r) => `${r.exercise}: ${formatRecordBest(r)}`).join("\n") : undefined;
      const draft = adaptPlan(tpl.plan, c.profile, c._id, { prs, authoredBy: ctx.user._id });
      await localizePlanNames(ctx, draft, c.lang);
      await setActivePlan(ctx.db, draft);
      await updateUser(ctx.db, c._id, { nutrition: draft.nutrition });
      await ctx.api.sendMessage(c.chatId, t(c.lang, "share_client_got", { name: escapeHtml(tpl.name) }), { ...HTML, reply_markup: mainMenu(c.lang) }).catch(() => {});
      ok++;
    } catch (err) {
      console.error("shareAssignToClients", c._id, err);
    }
  }
  const cleared = { ...ctx.user.session };
  delete cleared.shareTemplate;
  delete cleared.shareClients;
  await updateUser(ctx.db, ctx.user._id, { session: cleared });
  ctx.user.session = cleared;
  await recordAudit(ctx.db, ctx.user._id, "share_program", undefined, `${tpl.name} → ${ok}/${clients.length}`).catch(() => {});
  await reply(ctx, t(lang, "share_done", { name: tpl.name, ok, total: clients.length }), menuBtn(lang));
}

// --- Mode 2: share by link. --- Mode 3: publish to the public library. ---
async function publishShared(ctx: MyContext, templateId: number, isPublic: boolean) {
  const lang = ctx.user.lang;
  if (!(await canShareProgram(ctx))) { await reply(ctx, t(lang, "share_not_allowed")); return; }
  const tpl = await getTrainerTemplate(ctx.db, ctx.user._id, templateId);
  if (!tpl) { await reply(ctx, t(lang, "error_generic")); return; }
  const code = shortCode();
  await createSharedProgram(ctx.db, code, ctx.user._id, tpl.name, tpl.plan, isPublic);
  if (isPublic) {
    await reply(ctx, t(lang, "share_published", { name: escapeHtml(tpl.name) }), menuBtn(lang));
  } else {
    const link = botDeepLink(ctx.env, `prog_${code}`);
    await reply(ctx, t(lang, "share_link_ready", { name: escapeHtml(tpl.name), link }), menuBtn(lang));
  }
}
export const shareLink = (ctx: MyContext, tid: number) => publishShared(ctx, tid, false);
export const sharePublish = (ctx: MyContext, tid: number) => publishShared(ctx, tid, true);

// --- Recipient (ANY user): preview a shared program and take it as their active plan. ---
export async function showSharedProgram(ctx: MyContext, code: string) {
  const lang = ctx.user.lang;
  const sp = await getSharedProgram(ctx.db, code);
  if (!sp) { await reply(ctx, t(lang, "share_gone"), menuBtn(lang)); return; }
  const kb = new InlineKeyboard().text(t(lang, "share_take"), `prog:take:${code}`).row().text(t(lang, "menu_open"), "menu:open");
  await reply(ctx, t(lang, "share_preview", { name: escapeHtml(sp.name), days: sp.plan.split.length }), kb);
}

export async function takeSharedProgram(ctx: MyContext, code: string) {
  const lang = ctx.user.lang;
  if (ctx.user.role === "client") { await reply(ctx, t(lang, "share_take_client"), menuBtn(lang)); return; } // trainer owns a client's plan
  const sp = await getSharedProgram(ctx.db, code);
  if (!sp) { await reply(ctx, t(lang, "share_gone"), menuBtn(lang)); return; }
  const records = await listStrength(ctx.db, ctx.user._id, 8).catch(() => []);
  const prs = records.length ? records.map((r) => `${r.exercise}: ${formatRecordBest(r)}`).join("\n") : undefined;
  const plan = adaptPlan(sp.plan, ctx.user.profile, ctx.user._id, { prs });
  await localizePlanNames(ctx, plan, ctx.user.lang);
  await setActivePlan(ctx.db, plan);
  await updateUser(ctx.db, ctx.user._id, { onboarded: true, nutrition: plan.nutrition });
  ctx.user.onboarded = true;
  await bumpSharedTaken(ctx.db, code).catch(() => {});
  await reply(ctx, t(lang, "share_taken", { name: escapeHtml(sp.name) }), new InlineKeyboard().text(t(lang, "menu_plan"), "menu:plan").row().text(t(lang, "menu_open"), "menu:open"));
}

// --- Public library: browse and take. ---
export async function cmdLibrary(ctx: MyContext) {
  const lang = ctx.user.lang;
  const progs = await listPublicPrograms(ctx.db, 20);
  const kb = new InlineKeyboard();
  for (const p of progs) kb.text(`📋 ${p.name} · ${p.takenCount}👤`.slice(0, 60), `prog:view:${p.code}`).row();
  // Any athlete (solo/trainer) can contribute their own active plan as a reusable template.
  if (ctx.user.role !== "client") kb.text(t(lang, "share_my_plan_btn"), "prog:mine").row();
  kb.text(t(lang, "menu_open"), "menu:open");
  await reply(ctx, t(lang, progs.length ? "library_title" : "library_empty"), kb);
}

// --- Any user: publish their OWN active plan to the public library as a reusable template. ---
function planToBank(plan: PlanDoc): BankPlan {
  return {
    split: plan.split,
    nutrition: plan.nutrition,
    ...(plan.restDayNutrition ? { restDayNutrition: plan.restDayNutrition } : {}),
    supplements: plan.supplements ?? [],
    methodology: plan.methodology ?? "",
    ...(plan.movementAudit ? { movementAudit: plan.movementAudit } : {}),
    ...(typeof plan.stepsTarget === "number" ? { stepsTarget: plan.stepsTarget } : {}),
  };
}

export async function startShareMyPlan(ctx: MyContext) {
  const lang = ctx.user.lang;
  await ctx.answerCallbackQuery().catch(() => {});
  // A client's plan is authored/owned by their trainer — not theirs to publish.
  if (ctx.user.role === "client") { await reply(ctx, t(lang, "share_take_client"), menuBtn(lang)); return; }
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  if (!plan || !plan.split.length) { await reply(ctx, t(lang, "share_myplan_noplan"), menuBtn(lang)); return; }
  await setMode(ctx, "share_myplan_name");
  await reply(ctx, t(lang, "share_myplan_name_prompt"));
}

export async function handleShareMyPlanName(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const name = text.trim().slice(0, 48);
  if (!name) { await reply(ctx, t(lang, "share_myplan_name_prompt")); return; } // stay in mode
  await setMode(ctx, "idle");
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  if (!plan || !plan.split.length) { await reply(ctx, t(lang, "share_myplan_noplan"), menuBtn(lang)); return; }
  const code = shortCode();
  await createSharedProgram(ctx.db, code, ctx.user._id, name, planToBank(plan), true);
  await recordAudit(ctx.db, ctx.user._id, "share_myplan", undefined, name).catch(() => {});
  await reply(ctx, t(lang, "share_published", { name: escapeHtml(name) }), menuBtn(lang));
}

export async function cmdClients(ctx: MyContext) {
  if (!(await requireTrainer(ctx))) return;
  const lang = ctx.user.lang;
  const clients = await listClients(ctx.db, ctx.user._id);
  if (!clients.length) {
    await reply(ctx, t(lang, "clients_none"), menuBtn(lang));
    return;
  }
  const kb = new InlineKeyboard();
  for (const c of clients) {
    const flag = c.onboarded ? "" : " ⏳";
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
    .text(t(lang, "cc_note"), `cl:${id}:note`)
    .text(t(lang, "cc_flag"), `cl:${id}:flag`)
    .row()
    .text(t(lang, "cc_book"), `cl:${id}:book`)
    .text(t(lang, "cc_logs"), `cl:${id}:logs`)
    .row()
    .text(t(lang, "cc_templates"), `cl:${id}:tpl`)
    .text(t(lang, "cc_billing"), `cl:${id}:bill`)
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
  // Self-heal English names on view (a pre-localization template/shared assign), in the CLIENT's
  // language, and persist — so the client also sees the corrected plan, not just this editor.
  if (plan) plan = await healPlanNamesForDisplay(ctx, plan, target?.lang ?? lang);
  const day = plan ? getPlanDay(plan, wd) : undefined;
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

// 💰 Trainer finance summary — pure bookkeeping over client_billing + done sessions.
export async function cmdTrainerFinance(ctx: MyContext) {
  if (!(await requireTrainer(ctx))) return;
  const lang = ctx.user.lang;
  const today = localParts(ctx.user.profile.timezone).date;
  const monthStart = `${today.slice(0, 8)}01`;
  const [billing, doneMonth, clients] = await Promise.all([
    listBillingForTrainer(ctx.db, ctx.user._id).catch(() => []),
    countSessionsDoneSince(ctx.db, ctx.user._id, monthStart).catch(() => 0),
    listClients(ctx.db, ctx.user._id),
  ]);
  const names = new Map(clients.map((c) => [c._id, c.profile.name ?? `id ${c._id}`]));
  const in7 = isoDateMinus(today, -7);
  const paying = billing.filter((b) => (b.paidUntil !== null && b.paidUntil >= today) || (b.sessionsLeft ?? 0) > 0);
  const expiring = billing.filter(
    (b) => (b.paidUntil !== null && b.paidUntil >= today && b.paidUntil <= in7) || b.sessionsLeft === 1,
  );
  const expired = billing.filter((b) => (b.paidUntil !== null && b.paidUntil < today) || b.sessionsLeft === 0);
  const who = (b: { clientId: number }) => `• ${names.get(b.clientId) ?? `id ${b.clientId}`}`;
  const lines = [
    t(lang, "fin_header"),
    t(lang, "fin_summary", { paying: paying.length, total: clients.length, done: doneMonth }),
  ];
  if (expiring.length) lines.push("", t(lang, "fin_expiring"), ...expiring.map(who));
  if (expired.length) lines.push("", t(lang, "fin_expired"), ...expired.map(who));
  if (!billing.length) lines.push("", t(lang, "fin_none"));
  const kb = new InlineKeyboard().text(t(lang, "menu_clients"), "menu:clients").row().text(t(lang, "tr_back_hub"), "menu:open");
  await reply(ctx, lines.join("\n"), kb);
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

export async function clientCardAction(ctx: MyContext, clientId: number, action: string, arg?: string) {
  const lang = ctx.user.lang;
  const client = await getClientForTrainer(ctx.db, ctx.user._id, clientId);
  if (!client) {
    await reply(ctx, t(lang, "client_not_found"));
    return;
  }
  const cname = escapeHtml(client.profile.name ?? `id ${clientId}`);
  if (action === "card") {
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
  } else if (action === "note") {
    const note = await getClientNote(ctx.db, ctx.user._id, clientId);
    const kb = new InlineKeyboard()
      .text(t(lang, "cc_note_edit"), `cl:${clientId}:noteedit`)
      .text(t(lang, "cc_open_card"), `cl:${clientId}:card`);
    await reply(ctx, note ? `📝 ${cname}\n\n${escapeHtml(note)}` : t(lang, "cc_note_empty", { name: cname }), kb);
  } else if (action === "noteedit") {
    await updateUser(ctx.db, ctx.user._id, { session: { mode: "trainer_note", targetId: clientId } });
    await reply(ctx, t(lang, "cc_note_prompt", { name: cname }));
  } else if (action === "health") {
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
    const kb = new InlineKeyboard()
      .text(t(lang, "cc_health_edit"), `cl:${clientId}:healthedit`)
      .text(t(lang, "cc_open_card"), `cl:${clientId}:card`);
    await reply(ctx, lines.join("\n"), kb);
  } else if (action === "healthedit") {
    await updateUser(ctx.db, ctx.user._id, { session: { mode: "trainer_health", targetId: clientId } });
    await reply(ctx, t(lang, "cc_health_prompt"));
  } else if (action === "pers") {
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
  } else if (action === "persedit") {
    await updateUser(ctx.db, ctx.user._id, { session: { mode: "trainer_personal", targetId: clientId } });
    await reply(ctx, t(lang, "cc_personal_prompt"));
  } else if (action === "bday") {
    await updateUser(ctx.db, ctx.user._id, { session: { mode: "trainer_bday", targetId: clientId } });
    await reply(ctx, t(lang, "cc_bday_prompt"));
  } else if (action === "intv") {
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
  } else if (action === "intvping") {
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
  } else if (action === "book") {
    await startTrainerBooking(ctx, clientId);
  } else if (action === "logs") {
    await showClientLogDays(ctx, clientId);
  } else if (action === "tpl") {
    // Reusable program templates: assign one to this client, or save their plan as a new one.
    const tpls = await listTrainerTemplates(ctx.db, ctx.user._id);
    const kb = new InlineKeyboard();
    for (const tp of tpls) {
      kb.text(`📋 ${tp.name}`.slice(0, 48), `cl:${clientId}:tplas:${tp.id}`).text("🗑", `tpldel:${tp.id}`).row();
    }
    kb.text(t(lang, "tpl_save_btn"), `cl:${clientId}:tplsave`).row();
    kb.text(t(lang, "cc_open_card"), `cl:${clientId}:card`);
    await reply(ctx, t(lang, tpls.length ? "tpl_pick" : "tpl_none", { name: cname }), kb);
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
  } else if (action === "bill") {
    const b = await getClientBilling(ctx.db, ctx.user._id, clientId);
    const body = t(lang, "bill_card", {
      name: cname,
      paid: b?.paidUntil ?? "—",
      sessions: b?.sessionsLeft === null || b?.sessionsLeft === undefined ? "—" : String(b.sessionsLeft),
    });
    const kb = new InlineKeyboard()
      .text(t(lang, "bill_set_paid"), `cl:${clientId}:billpaid`)
      .text(t(lang, "bill_set_sessions"), `cl:${clientId}:billsess`)
      .row()
      .text(t(lang, "cc_open_card"), `cl:${clientId}:card`);
    await reply(ctx, body, kb);
  } else if (action === "billpaid") {
    ctx.user.session = { ...ctx.user.session, mode: "billing_paid", targetId: clientId };
    await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
    await reply(ctx, t(lang, "bill_paid_prompt"));
  } else if (action === "billsess") {
    ctx.user.session = { ...ctx.user.session, mode: "billing_sessions", targetId: clientId };
    await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
    await reply(ctx, t(lang, "bill_sessions_prompt"));
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

// Trainer typed a "paid until" value: YYYY-MM-DD, "+N" days from today, or "-" to stop tracking.
export async function handleBillingPaid(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const clientId = ctx.user.session.targetId;
  const tt = text.trim();
  let paidUntil: string | null | undefined;
  if (tt === "-") paidUntil = null;
  else if (/^\+\d{1,3}$/.test(tt)) paidUntil = new Date(Date.now() + Number(tt.slice(1)) * 86_400_000).toISOString().slice(0, 10);
  else if (/^\d{4}-\d{2}-\d{2}$/.test(tt)) paidUntil = tt;
  if (paidUntil === undefined) { await reply(ctx, t(lang, "bill_paid_invalid")); return; } // stay in mode
  await setMode(ctx, "idle");
  if (!clientId) return;
  await setClientBilling(ctx.db, ctx.user._id, clientId, { paidUntil });
  await reply(ctx, t(lang, "bill_saved"));
  await clientCardAction(ctx, clientId, "bill");
}

// Trainer typed a prepaid-session count ("-" to stop tracking).
export async function handleBillingSessions(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const clientId = ctx.user.session.targetId;
  const tt = text.trim();
  let sessionsLeft: number | null | undefined;
  if (tt === "-") sessionsLeft = null;
  else if (/^\d{1,3}$/.test(tt)) sessionsLeft = Number(tt);
  if (sessionsLeft === undefined) { await reply(ctx, t(lang, "bill_sessions_invalid")); return; } // stay in mode
  await setMode(ctx, "idle");
  if (!clientId) return;
  await setClientBilling(ctx.db, ctx.user._id, clientId, { sessionsLeft });
  await reply(ctx, t(lang, "bill_saved"));
  await clientCardAction(ctx, clientId, "bill");
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

export async function showClientLogDays(ctx: MyContext, clientId: number) {
  const lang = ctx.user.lang;
  const client = await getClientForTrainer(ctx.db, ctx.user._id, clientId);
  if (!client) { await reply(ctx, t(lang, "client_not_found")); return; }
  const logs = await workoutLogsSince(ctx.db, clientId, localCutoff(client.profile.timezone, 60));
  const recent = [...logs].reverse().slice(0, 10);
  if (!recent.length) { await reply(ctx, t(lang, "clog_none"), clientCardKb(lang, clientId)); return; }
  const kb = new InlineKeyboard();
  for (const w of recent) {
    const n = w.exercises.filter((e) => !e.skipped).length;
    kb.text(`${w.completed ? "✅" : "✖️"} ${w.date} · ${t(lang, "clog_n_ex", { n })}`.slice(0, 60), `clog:${clientId}:${w.date}`).row();
  }
  kb.text(t(lang, "cc_open_card"), `cl:${clientId}:card`);
  await reply(ctx, t(lang, "clog_pick"), kb);
}

export async function showClientLogDay(ctx: MyContext, clientId: number, date: string) {
  const lang = ctx.user.lang;
  const client = await getClientForTrainer(ctx.db, ctx.user._id, clientId);
  if (!client) { await reply(ctx, t(lang, "client_not_found")); return; }
  const log = await getWorkoutLog(ctx.db, clientId, date);
  const cname = escapeHtml(client.profile.name ?? `id ${clientId}`);
  const done = (log?.exercises ?? []).filter((e) => !e.skipped);
  let body = t(lang, "clog_day_title", { name: cname, date });
  body += done.length
    ? "\n" + done.map((e) => `• ${escapeHtml(e.name)}: ${e.setsDone.map(formatSetEntry).join(", ") || "—"}`).join("\n")
    : "\n" + t(lang, "clog_day_empty");
  // Show what the plan had for that weekday, so the trainer sees what's missing.
  const plan = await getActivePlan(ctx.db, clientId);
  const planDay = plan ? getPlanDay(plan, weekdayOf(date)) : undefined;
  if (planDay) body += "\n\n" + t(lang, "clog_planned", { n: planDay.exercises.length, list: planDay.exercises.map((e) => e.name).join(", ") });
  const kb = new InlineKeyboard()
    .text(t(lang, "clog_rewrite_btn"), `clogedit:${clientId}:${date}`)
    .row()
    .text(t(lang, "back"), `cl:${clientId}:logs`);
  await reply(ctx, body, kb);
}

export async function startClientLogEdit(ctx: MyContext, clientId: number, date: string) {
  const lang = ctx.user.lang;
  const client = await getClientForTrainer(ctx.db, ctx.user._id, clientId);
  if (!client) { await reply(ctx, t(lang, "client_not_found")); return; }
  ctx.user.session = { mode: "edit_client_log", targetId: clientId, awaitText: date };
  await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
  await reply(ctx, t(lang, "clog_rewrite_prompt", { date }));
}

export async function handleClientLogEdit(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const clientId = ctx.user.session.targetId;
  const date = ctx.user.session.awaitText;
  if (!clientId || !date) { await setMode(ctx, "idle"); return; }
  const client = await getClientForTrainer(ctx.db, ctx.user._id, clientId);
  if (!client) { await setMode(ctx, "idle"); await reply(ctx, t(lang, "client_not_found")); return; }
  const sets = parseWorkoutText(text);
  if (!sets.length) { await reply(ctx, t(lang, "log_unreadable")); return; } // stay in mode, re-prompt
  await setMode(ctx, "idle");
  const wd = weekdayOf(date);
  const plan = await getActivePlan(ctx.db, clientId);
  const existing = await listStrength(ctx.db, clientId);
  const candidates = [
    ...(plan?.split.flatMap((d) => d.exercises.map((e) => e.name)) ?? []),
    ...(plan?.split.flatMap((d) => d.exercises.map((e) => e.canonicalName).filter((n): n is string => !!n)) ?? []),
    ...existing.map((r) => r.exercise),
  ];
  const byExercise = new Map<string, SetEntry[]>();
  const rpeByExercise = new Map<string, number>();
  for (const s of sets) {
    const name = normalizeExercise(s.exercise, candidates);
    const arr = byExercise.get(name) ?? [];
    arr.push({
      reps: s.reps, weight: s.weight,
      ...(typeof s.seconds === "number" ? { seconds: s.seconds } : {}),
      ...(typeof s.meters === "number" ? { meters: s.meters } : {}),
      ...(typeof s.rpe === "number" ? { rpe: s.rpe } : {}),
    });
    byExercise.set(name, arr);
    if (typeof s.rpe === "number") rpeByExercise.set(name, Math.max(rpeByExercise.get(name) ?? 0, s.rpe));
  }
  const exercises = [...byExercise.entries()].map(([name, setsDone]) => ({ name, setsDone, skipped: false, ...(rpeByExercise.has(name) ? { rpe: rpeByExercise.get(name)! } : {}) }));
  await upsertWorkoutLog(ctx.db, clientId, date, wd, exercises, true, text);
  // Keep the client's strength records in sync with the corrected log.
  for (const [name, setsDone] of byExercise) {
    const metric = metricOfSets(setsDone);
    const best = bestSetForMetric(setsDone, metric);
    if (best) await upsertStrengthRecord(ctx.db, clientId, name, { metric, weight: best.weight, reps: best.reps, seconds: best.seconds, meters: best.meters }, date, rpeByExercise.get(name)).catch(() => {});
  }
  await recordAudit(ctx.db, ctx.user._id, "edit_client_log", clientId, date).catch(() => {});
  await reply(ctx, t(lang, "clog_saved", { n: exercises.length }));
  await showClientLogDay(ctx, clientId, date);
}

export async function handleTrainerMessage(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const clientId = ctx.user.session.targetId;
  await setMode(ctx, "idle");
  if (!clientId) return;
  const client = await getClientForTrainer(ctx.db, ctx.user._id, clientId);
  if (!client) { await reply(ctx, t(lang, "client_not_found")); return; }
  await insertMessage(ctx.db, ctx.user._id, clientId, text);
  // Give the client a one-tap reply back to this trainer (threaded messaging).
  const replyKb = new InlineKeyboard().text(t(client.lang, "msg_reply_btn"), `msg:reply:${ctx.user._id}`);
  await ctx.api.sendMessage(client.chatId, t(client.lang, "msg_from_trainer", { text: escapeHtml(text) }), { ...HTML, reply_markup: replyKb }).catch(() => {});
  await reply(ctx, t(lang, "msg_sent"), menuBtn(lang));
}

// Client tapped "Reply" on a trainer message → deliver it back to the trainer with a reply
// button of their own, closing the async messaging loop with notifications both ways.
export async function handleClientReply(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const trainerId = ctx.user.session.targetId;
  await setMode(ctx, "idle");
  if (!trainerId) return;
  const trainer = await getUser(ctx.db, trainerId);
  if (!trainer) { await reply(ctx, t(lang, "error_generic")); return; }
  await insertMessage(ctx.db, ctx.user._id, trainerId, text);
  const who = escapeHtml(ctx.user.profile.name ?? `id ${ctx.user._id}`);
  const kb = new InlineKeyboard().text(t(trainer.lang, "msg_reply_btn"), `cl:${ctx.user._id}:msg`);
  await ctx.api
    .sendMessage(trainer.chatId, t(trainer.lang, "msg_from_client", { name: who, text: escapeHtml(text) }), { ...HTML, reply_markup: kb })
    .catch(() => {});
  await reply(ctx, t(lang, "msg_sent"), menuBtn(lang));
}

// --- client question: trainer's reply actions ---

export async function onQuestionSend(ctx: MyContext, qid: number) {
  const lang = ctx.user.lang;
  const q = await getQuestion(ctx.db, qid);
  if (!q || q.trainerId !== ctx.user._id || q.status !== "pending") { await reply(ctx, t(lang, "request_gone")); return; }
  if (!q.aiDraft) { await reply(ctx, t(lang, "q_no_draft")); return; }
  await deliverTrainerAnswer(ctx, q.clientId, q.aiDraft);
  await setQuestionStatus(ctx.db, qid, "answered");
  await reply(ctx, t(lang, "q_done"));
}

export async function onQuestionOwn(ctx: MyContext, qid: number) {
  const lang = ctx.user.lang;
  const q = await getQuestion(ctx.db, qid);
  if (!q || q.trainerId !== ctx.user._id || q.status !== "pending") { await reply(ctx, t(lang, "request_gone")); return; }
  await updateUser(ctx.db, ctx.user._id, { session: { mode: "answer_q", targetId: qid } });
  await reply(ctx, t(lang, "q_write_prompt"));
}

export async function onQuestionSkip(ctx: MyContext, qid: number) {
  await setQuestionStatus(ctx.db, qid, "dismissed");
  await reply(ctx, t(ctx.user.lang, "q_dismissed"));
}

export async function handleAnswerQuestion(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const qid = ctx.user.session.targetId;
  await setMode(ctx, "idle");
  if (!qid) return;
  const q = await getQuestion(ctx.db, qid);
  if (!q || q.trainerId !== ctx.user._id) { await reply(ctx, t(lang, "request_gone")); return; }
  await deliverTrainerAnswer(ctx, q.clientId, text);
  await setQuestionStatus(ctx.db, qid, "answered");
  await reply(ctx, t(lang, "q_done"), menuBtn(lang));
}

export async function deliverTrainerAnswer(ctx: MyContext, clientId: number, text: string) {
  const client = await getUser(ctx.db, clientId);
  if (!client) return;
  await insertMessage(ctx.db, ctx.user._id, clientId, text);
  await ctx.api.sendMessage(client.chatId, t(client.lang, "answer_from_trainer", { text: escapeHtml(text) }), HTML).catch(() => {});
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

// When a spot frees (client left / limit raised): if the trainer is now under capacity and
// has pending requests, nudge them toward the waitlist. Best-effort, deduped by nature
// (fires only on the freeing event itself).
async function notifyWaitlistSlot(ctx: MyContext, trainerId: number) {
  try {
    const [tr, trainerUser, n, pending] = await Promise.all([
      getTrainer(ctx.db, trainerId),
      getUser(ctx.db, trainerId),
      countClientsOf(ctx.db, trainerId),
      pendingRequestsForTrainer(ctx.db, trainerId),
    ]);
    if (!tr || !trainerUser || !pending.length) return;
    if (tr.maxClients !== undefined && n >= tr.maxClients) return; // still full
    const kb = new InlineKeyboard().text(t(trainerUser.lang, "menu_requests"), "menu:requests");
    await ctx.api
      .sendMessage(trainerUser.chatId, t(trainerUser.lang, "waitlist_slot_free", { n: pending.length }), { ...HTML, reply_markup: kb })
      .catch(() => {});
  } catch {
    /* best-effort */
  }
}
