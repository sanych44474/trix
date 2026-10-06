// Sharing programs: a trainer assigning a template to selected clients, share links, the public
// library, taking a shared program, and anyone publishing their own plan. Split out of trainer.ts;
// trainer.ts re-exports everything here.
import { InlineKeyboard } from "grammy";
import { logInfo } from "../../log";
import type { BankPlan, Lang, PlanDoc, UserDoc } from "../../types";
import { recordAudit } from "../../adapters/d1/v2Admin";
import { listStrength } from "../../adapters/d1/v2Workouts";
import { getActivePlan, setActivePlan } from "../../adapters/d1/v2Plans";
import { getTrainer, getTrainerTemplate, listClients, listTrainerTemplates, createSharedProgram, getSharedProgram, listPublicPrograms, bumpSharedTaken } from "../../adapters/d1/v2Trainer";
import { stampOnboardedAt, updateUser } from "../../adapters/d1/v2Users";
import { botDeepLink } from "../../bot/links";
import { isOwner } from "../../bot/ownerAccess";
import { adaptPlan } from "../../domain/planAdapt";
import { formatRecordBest } from "../../domain/setFormat";
import { escapeHtml, t } from "../../locales/i18n";
import { type MyContext, HTML, reply, setMode } from "../../adapters/telegram/context";
import { localizePlanNames } from "../../bot/exerciseCatalog";
import { mainMenu, menuBtn } from "../../bot/keyboards";
import { shortCode } from "./trainerCommon";

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
export function shareSelectKb(lang: Lang, clients: UserDoc[], sel: Set<number>): InlineKeyboard {
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

export async function reRenderShareSelect(ctx: MyContext) {
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
  const assigned: UserDoc[] = [];
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
      assigned.push(c);
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
  // The template was auto-adapted the same way for everyone — a specific client's plan (an
  // injury, a piece of missing equipment) still needs a look. One tap into their existing plan
  // editor instead of separately navigating to /clients for each one.
  if (assigned.length) {
    const kb = new InlineKeyboard();
    for (const c of assigned) kb.text(`✏️ ${c.profile.name ?? `id ${c._id}`}`.slice(0, 60), `cl:${c._id}:edit`).row();
    await reply(ctx, t(lang, "share_adjust_hint"), kb);
  }
}

// --- Mode 2: share by link. --- Mode 3: publish to the public library. ---
export async function publishShared(ctx: MyContext, templateId: number, isPublic: boolean) {
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
  if (!ctx.user.onboarded) {
    logInfo("onboarding_completed", { role: ctx.user.role });
    logInfo("first_plan_ready", { source: "template" }); // a taken shared program, not AI/bank
    await stampOnboardedAt(ctx.db, ctx.user._id).catch(() => {});
  }
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
export function planToBank(plan: PlanDoc): BankPlan {
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
