// The Telegram adapter's core context + plumbing: MyContext, reply/sendLong, session-mode and
// plan-edit-target helpers, HTML formatting, and the locale-key type. Every bot/*.ts file needs
// a subset of this — before this module existed, they all imported it from bot.ts itself, which
// is what produced router.ts's 100+ backward imports from bot.ts (bot.ts is supposed to be the
// composition root, not something everything else depends on). This file has NO dependency on
// bot.ts or any bot/*.ts feature module — only grammY, types, db/repos, domain/session, locales,
// and bot/keyboards (itself already a leaf module) — so it can sit underneath everything.
//
// Extraction note (roadmap item 1, first slice): this is deliberately the highest-leverage
// subset — the handful of symbols nearly every file imported — not a full feature-folder reorg.
// menuActionFor and reRenderEditDay stayed in bot.ts: both route to command handlers
// (cmdToday/cmdPlan/... and showPlanEditDay) that live at the feature layer, so moving them here
// would just re-create the same cycle one level down.
import { InlineKeyboard, Keyboard, type Context } from "grammy";
import type { Env, Lang, UserDoc } from "../../types";
import { getActivePlan, getUser, updateUser } from "../../db/repos";
import { switchMode } from "../../domain/session";
import { t } from "../../locales/i18n";
import { menuBtn } from "../../bot/keyboards";

export type MyContext = Context & {
  env: Env;
  db: D1Database;
  user: UserDoc;
  // Defer heavy background work past the webhook response (Cloudflare ExecutionContext.waitUntil).
  // Falls back to fire-and-forget if no ExecutionContext was provided (e.g. tests).
  waitUntil: (p: Promise<unknown>) => void;
};

export const HTML = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };

export type TKey = Parameters<typeof t>[1]; // keyof the locale dictionary

// Telegram caps messages at 4096 chars; split on newlines if needed.
// When a reply carries no inline keyboard we send ReplyKeyboardRemove so the
// legacy persistent bottom keyboard is cleared (the menu is the inline button now).
export async function sendLong(ctx: MyContext, text: string, kb?: InlineKeyboard | Keyboard) {
  const LIMIT = 3800;
  const tail = kb ? { reply_markup: kb } : { reply_markup: { remove_keyboard: true } as const };
  if (text.length <= LIMIT) {
    await ctx.reply(text, { ...HTML, ...tail });
    return;
  }
  const chunks: string[] = [];
  let buf = "";
  for (const block of text.split("\n")) {
    if ((buf + "\n" + block).length > LIMIT) {
      chunks.push(buf);
      buf = block;
    } else {
      buf = buf ? buf + "\n" + block : block;
    }
  }
  if (buf) chunks.push(buf);
  for (let i = 0; i < chunks.length; i++) {
    const last = i === chunks.length - 1;
    await ctx.reply(chunks[i], { ...HTML, ...(last ? tail : {}) });
  }
}

export async function reply(ctx: MyContext, text: string, kb?: InlineKeyboard | Keyboard) {
  await sendLong(ctx, text, kb);
}

export async function setMode(ctx: MyContext, mode: UserDoc["session"]["mode"]) {
  // switchMode carries the context fields (editPlanOwner/editPlanPrefix/photoReviewFor) and
  // drops all transient flow state — see domain/session.ts for why this lives in one place.
  const session = switchMode(ctx.user.session, mode);
  await updateUser(ctx.db, ctx.user._id, { session });
  ctx.user.session = session;
}

// Whose plan the current plan-EDIT operation targets: a managed client (trainer/owner) or self.
export function planOwnerId(ctx: MyContext): number {
  return ctx.user.session.editPlanOwner ?? ctx.user._id;
}

// Fetch the active plan for the current edit target (managed client or self); if there is none,
// send the standard "no plan" reply and return undefined — the caller should then `return`.
export async function getActivePlanOrReply(
  ctx: MyContext,
  ownerId = planOwnerId(ctx),
): Promise<Awaited<ReturnType<typeof getActivePlan>>> {
  const plan = await getActivePlan(ctx.db, ownerId);
  if (!plan) await reply(ctx, t(ctx.user.lang, "no_plan"), menuBtn(ctx.user.lang));
  return plan;
}

// The LANGUAGE of the plan owner — so a trainer/owner editing a client's plan persists the
// client's exercise names in the CLIENT's language, not the editor's.
export async function planOwnerLang(ctx: MyContext): Promise<Lang> {
  const owner = ctx.user.session.editPlanOwner;
  if (owner === undefined || owner === ctx.user._id) return ctx.user.lang;
  const u = await getUser(ctx.db, owner);
  return u?.lang ?? ctx.user.lang;
}

// Begin editing another user's plan (trainer→client / owner→anyone). Sets the edit context.
// `prefix` records which card owns the edit ("cl"/"ou") so post-action re-renders can rebuild
// the edit-day keyboard instead of the self logging view.
export async function setEditOwner(ctx: MyContext, ownerId: number | undefined, prefix?: "cl" | "ou") {
  const session = { ...ctx.user.session, editPlanOwner: ownerId, editPlanPrefix: prefix };
  if (ownerId === undefined) { delete session.editPlanOwner; delete session.editPlanPrefix; }
  await updateUser(ctx.db, ctx.user._id, { session });
  ctx.user.session = session;
}

// True when the current edit targets someone else's plan (trainer→client / owner→user), so
// the shared edit handlers must render the edit-day view, never the self "log workout" view.
export function isEditingOther(ctx: MyContext): boolean {
  return ctx.user.session.editPlanOwner !== undefined && ctx.user.session.editPlanOwner !== ctx.user._id;
}

// Clear any "editing someone else's plan" context (called when the user navigates to their
// own home / today / menu so self-edits never leak onto a managed client).
export async function clearEditOwner(ctx: MyContext) {
  if (ctx.user.session.editPlanOwner === undefined) return;
  await setEditOwner(ctx, undefined);
}
