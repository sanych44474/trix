// The trainer profile wizard: steps, the profile card, draft checks, the field editor and owner
// approval of the application. Split out of trainer.ts; trainer.ts re-exports everything here.
import { InlineKeyboard } from "grammy";
import type { Lang, TrainerDoc, TrainerProfileInput } from "../../types";
import { getOwnerChatId } from "../../adapters/d1/v2Admin";
import { applyTrainer, getTrainer, updateTrainer } from "../../adapters/d1/v2Trainer";
import { updateUser } from "../../adapters/d1/v2Users";
import { escapeHtml, t } from "../../locales/i18n";
import { type MyContext, type TKey, HTML, reply } from "../../adapters/telegram/context";
import { trainerMenu } from "./trainerCommon";

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

export interface TwStep {
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

export type TrainerCardData = {
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
};

// Render the client-facing trainer card (only non-empty lines). Used by the wizard preview,
// the trainer home, and the owner approval message.
export function trainerCardText(lang: Lang, tr: TrainerCardData, opts: { usernameFallback?: string } = {}): string {
  const lines: string[] = [];
  lines.push(`🧑‍🏫 <b>${escapeHtml(tr.name)}</b>`);
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
