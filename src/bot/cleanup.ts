// Owner-confirmed inactive-user cleanup (NEVER automatic — only on the owner's explicit tap)
// and the "still here?" inactivity ask/reply flow that feeds it. Extracted from bot.ts
// (god-file split; same barrel seam via bot.ts's `export * from "./bot/cleanup"`).
import { GrammyError, InlineKeyboard } from "grammy";
import type { UserDoc } from "../types";
import {
  clearInactiveAsk, deleteUserData, getOwnerChatId, getUser, insertFeedback, listClients, listInactive,
  recordAudit, unlinkClient, updateUser,
} from "../db/repos";
import { localParts } from "../domain/progression";
import { escapeHtml, t } from "../locales/i18n";
import { isOwner } from "./owner";
import { type MyContext, HTML, menuBtn, reply, setMode } from "../bot";

export const INACTIVE_DAYS = 7;

export async function cmdCleanup(ctx: MyContext) {
  const lang = ctx.user.lang;
  if (!(await isOwner(ctx))) { await reply(ctx, t(lang, "admin_only")); return; }
  const nowIso = new Date().toISOString();
  const cutoff = new Date(Date.now() - INACTIVE_DAYS * 86_400_000).toISOString();
  const ownerId = ctx.user._id;
  const candidates = (await listInactive(ctx.db, cutoff, nowIso)).filter((u) => u._id !== ownerId);
  if (!candidates.length) { await reply(ctx, t(lang, "cleanup_none"), menuBtn(lang)); return; }
  const kb = new InlineKeyboard();
  for (const u of candidates.slice(0, 25)) {
    const idle = Math.floor((Date.now() - (u.lastSeenAt ?? u.createdAt).getTime()) / 86_400_000);
    const name = u.profile.name ?? `id ${u._id}`;
    // Response badge: 🔴 wants out · ⏳ asked, silent · 💤 inactive, not asked.
    const badge = u.inactiveReply === "leaving" ? "🔴" : u.inactiveAskedAt ? "⏳" : "💤";
    kb.text(`🗑 ${badge} ${name} · ${idle}d`.slice(0, 60), `clean:del:${u._id}`).row();
  }
  const notAsked = candidates.filter((u) => !u.inactiveAskedAt).length;
  if (notAsked > 0) kb.text(t(lang, "cleanup_ask_btn", { n: notAsked }), "clean:ask").row();
  kb.text(t(lang, "cleanup_all_btn"), "clean:all");
  await reply(ctx, t(lang, "cleanup_title", { n: candidates.length, days: INACTIVE_DAYS }), kb);
}

// Owner-triggered: send the "still here?" ask to inactive candidates who haven't been asked yet
// (ask once). Replies feed the badges above. Never auto — only on the owner's tap/command.
export async function cmdAskInactive(ctx: MyContext) {
  const lang = ctx.user.lang;
  if (!(await isOwner(ctx))) { await reply(ctx, t(lang, "admin_only")); return; }
  const nowIso = new Date().toISOString();
  const cutoff = new Date(Date.now() - INACTIVE_DAYS * 86_400_000).toISOString();
  const targets = (await listInactive(ctx.db, cutoff, nowIso, 200))
    .filter((u) => u._id !== ctx.user._id && !u.inactiveAskedAt && !u.botBlocked);
  let sent = 0;
  for (const u of targets) {
    const kb = new InlineKeyboard()
      .text(t(u.lang, "inact_stay_btn"), "inact:stay")
      .text(t(u.lang, "inact_leave_btn"), "inact:leave");
    try {
      await ctx.api.sendMessage(u.chatId, t(u.lang, "inact_ask"), { ...HTML, reply_markup: kb });
      await updateUser(ctx.db, u._id, { inactiveAskedAt: new Date() });
      sent++;
    } catch (err) {
      if (err instanceof GrammyError && err.error_code === 403) {
        await updateUser(ctx.db, u._id, { botBlocked: true }).catch(() => {});
      } else {
        console.error("inactive ask send", u._id, err);
      }
    }
  }
  await reply(ctx, t(lang, "inact_sent", { n: sent }), menuBtn(lang));
}

// User reply to the inactivity ask → record stay/leave, then ask for feedback (forwarded to owner).
export async function onInactiveReply(ctx: MyContext, decision: "stay" | "leave") {
  const lang = ctx.user.lang;
  if (decision === "stay") {
    await clearInactiveAsk(ctx.db, ctx.user._id); // lastSeenAt already bumped by ingress → active again
  } else {
    await updateUser(ctx.db, ctx.user._id, { inactiveReply: "leaving" });
  }
  ctx.user.session = { mode: "inact_feedback", awaitText: decision };
  await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
  const ack = decision === "stay" ? t(lang, "inact_stay_ack") : t(lang, "inact_leave_ack");
  const kb = new InlineKeyboard().text(t(lang, "inact_fb_skip"), "inact:fbskip");
  await reply(ctx, `${ack}\n\n${t(lang, "inact_fb_q")}`, kb);
}

export async function handleInactiveFeedback(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const decision = ctx.user.session.awaitText ?? "";
  const fb = text.trim().slice(0, 600);
  await insertFeedback(ctx.db, {
    userId: ctx.user._id,
    username: ctx.user.username,
    text: fb,
    date: localParts(ctx.user.profile.timezone).date,
  }).catch(() => {});
  await forwardInactiveFeedbackToOwner(ctx, decision, fb);
  await setMode(ctx, "idle");
  await reply(ctx, t(lang, "inact_fb_thanks"), menuBtn(lang));
}

export async function forwardInactiveFeedbackToOwner(ctx: MyContext, decision: string, fb: string) {
  const ownerChatId = await getOwnerChatId(ctx.db);
  if (!ownerChatId) return;
  const who = escapeHtml(ctx.user.profile.name ?? `id ${ctx.user._id}`) + (ctx.user.username ? ` (@${ctx.user.username})` : "");
  const tag = decision === "leave" ? "🔴 leaving" : "🟢 staying";
  await ctx.api
    .sendMessage(ownerChatId, `💬 <b>Inactive-user feedback</b> · ${tag}\n${who}: ${escapeHtml(fb)}`, HTML)
    .catch(() => {});
}

// Re-verify a candidate is still deletable at the moment of the owner's tap (defense in depth).
// Only the owner is excluded; trainers, clients and on-vacation users are all deletable.
export function cleanupEligible(u: UserDoc | null, ownerId: number): boolean {
  if (!u) return false;
  if (u._id === ownerId) return false; // owner is the only exception
  if (u.inactiveReply === "leaving") return true; // explicitly asked to be removed
  const cutoff = Date.now() - INACTIVE_DAYS * 86_400_000;
  return (u.lastSeenAt ?? u.createdAt).getTime() < cutoff;
}

// Delete a user and, if they were a trainer, unlink their clients back to solo so none are orphaned.
export async function deleteUserFully(ctx: MyContext, u: UserDoc) {
  if (u.role === "trainer") {
    for (const c of await listClients(ctx.db, u._id)) await unlinkClient(ctx.db, c._id).catch(() => {});
  }
  await deleteUserData(ctx.db, u._id);
}

export async function onCleanupDelete(ctx: MyContext, userId: number) {
  const lang = ctx.user.lang;
  if (!(await isOwner(ctx))) { await reply(ctx, t(lang, "admin_only")); return; }
  const u = await getUser(ctx.db, userId);
  if (!cleanupEligible(u, ctx.user._id)) { await reply(ctx, t(lang, "cleanup_skip")); return; }
  await deleteUserFully(ctx, u!);
  await recordAudit(ctx.db, ctx.user._id, "delete_user", userId, u?.profile.name ?? undefined);
  await reply(ctx, t(lang, "cleanup_deleted", { name: escapeHtml(u?.profile.name ?? `id ${userId}`) }));
  await cmdCleanup(ctx); // refresh the list
}

export async function onCleanupAll(ctx: MyContext, confirmed: boolean) {
  const lang = ctx.user.lang;
  if (!(await isOwner(ctx))) { await reply(ctx, t(lang, "admin_only")); return; }
  const nowIso = new Date().toISOString();
  const cutoff = new Date(Date.now() - INACTIVE_DAYS * 86_400_000).toISOString();
  const candidates = (await listInactive(ctx.db, cutoff, nowIso)).filter((u) => u._id !== ctx.user._id);
  if (!confirmed) {
    const kb = new InlineKeyboard()
      .text(t(lang, "cleanup_yes"), "clean:allyes")
      .text(t(lang, "cleanup_no"), "menu:open");
    await reply(ctx, t(lang, "cleanup_all_confirm", { n: candidates.length }), kb);
    return;
  }
  let n = 0;
  for (const u of candidates) {
    if (!cleanupEligible(u, ctx.user._id)) continue;
    await deleteUserFully(ctx, u);
    await recordAudit(ctx.db, ctx.user._id, "delete_user", u._id, u.profile.name ?? undefined);
    n++;
  }
  await reply(ctx, t(lang, "cleanup_deleted_all", { n }), menuBtn(lang));
}
