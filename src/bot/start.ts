// /start and the onboarding interview entry points.
import { InlineKeyboard } from "grammy";
import { logInfo } from "../log";
import type { UserDoc } from "../types";
import { pendingRequestForClient } from "../adapters/d1/v2Trainer";
import { getUser, updateUser } from "../adapters/d1/v2Users";
import { escapeHtml, t } from "../locales/i18n";
import { resumePendingPlan } from "./planGen";
import { joinByCode, joinByProspectCode } from "../features/trainer/trainer";
import { showSharedProgram } from "../features/trainer/programSharing";
import { trainerMenu } from "../features/trainer/trainerCommon";
import { onboardingStep, renderObStep } from "./onboarding";
import { langMenu } from "./keyboards";
import { showNextBestAction } from "./nextBestAction";
import { HTML, clearEditOwner, reply, type MyContext } from "../adapters/telegram/context";

// Start (or restart) the deterministic button-based intake wizard (no per-turn AI).
export async function startInterview(ctx: MyContext) {
  await updateUser(ctx.db, ctx.user._id, { session: { mode: "onboarding", step: 0 } });
  ctx.user.session = { mode: "onboarding", step: 0 };
  await renderObStep(ctx, 0);
}

// Menu: continue an in-progress interview, or restart the intake to rebuild the plan.
export async function cmdInterview(ctx: MyContext) {
  const lang = ctx.user.lang;
  if (ctx.user.session.mode === "onboarding") {
    await onboardingStep(ctx); // resume where they left off
    return;
  }
  await reply(ctx, t(lang, "interview_restart"));
  await startInterview(ctx);
}

export async function cmdStart(ctx: MyContext, payload?: string) {
  logInfo("app_open", { surface: "bot" });
  await clearEditOwner(ctx);
  const u = ctx.user;
  const lang = u.lang;
  const hi = u.profile.name ? `${escapeHtml(u.profile.name)}! ` : "";

  // Deep link to a shared program → preview + "take it".
  if (payload?.startsWith("prog_")) {
    await showSharedProgram(ctx, payload.slice(5));
    return;
  }
  // Deep link from a trainer's invite → auto-pair.
  if (payload?.startsWith("tr_")) {
    await joinByCode(ctx, payload.slice(3));
    return;
  }
  // Personal invite for one named prospect ("add a client" — see trainer.ts joinByProspectCode).
  if (payload?.startsWith("trp_")) {
    await joinByProspectCode(ctx, payload.slice(4));
    return;
  }
  // Referral link: remember who invited (once, and only before onboarding — no retro-claims).
  // Falls through to the normal start flow; the inviter's reward fires when this user onboards.
  if (payload?.startsWith("ref_")) {
    const inviter = Number(payload.slice(4));
    if (Number.isFinite(inviter) && inviter > 0 && inviter !== u._id && !u.onboarded && !u.profile.referredBy) {
      u.profile = { ...u.profile, referredBy: inviter };
      await updateUser(ctx.db, u._id, { profile: u.profile }).catch(() => {});
    }
  }
  // Accountability buddy link: pair two users mutually so each sees the other's weekly activity.
  if (payload?.startsWith("buddy_")) {
    const mate = Number(payload.slice(6));
    if (Number.isFinite(mate) && mate > 0 && mate !== u._id) {
      const other = await getUser(ctx.db, mate).catch(() => null);
      if (other) {
        // Re-pairing with someone new must not leave a stale, one-sided link behind: if either
        // side already has a DIFFERENT buddy, unlink that old buddy first (only if the old
        // buddy's own link still points back — don't clobber a third party's unrelated state).
        // Otherwise the old buddy's buddyId keeps pointing at someone who's moved on, which the
        // weekly duel sweep (allBuddyPairs) would otherwise have to defend against on its own.
        const unlinkOldBuddyOf = async (person: UserDoc) => {
          const oldId = person.profile.buddyId;
          if (!oldId || oldId === mate || oldId === u._id) return;
          const old = await getUser(ctx.db, oldId).catch(() => null);
          if (old && old.profile.buddyId === person._id) {
            await updateUser(ctx.db, old._id, { profile: { ...old.profile, buddyId: undefined } }).catch(() => {});
          }
        };
        await Promise.all([unlinkOldBuddyOf(u), unlinkOldBuddyOf(other)]);
        u.profile = { ...u.profile, buddyId: mate };
        await updateUser(ctx.db, u._id, { profile: u.profile }).catch(() => {});
        await updateUser(ctx.db, mate, { profile: { ...other.profile, buddyId: u._id } }).catch(() => {});
        await reply(ctx, t(lang, "buddy_paired", { name: escapeHtml(other.profile.name ?? `id ${mate}`) })).catch(() => {});
        await ctx.api.sendMessage(other.chatId, t(other.lang, "buddy_paired", { name: escapeHtml(u.profile.name ?? `id ${u._id}`) }), HTML).catch(() => {});
      }
    }
  }
  if (u.session.mode === "plan_pending") {
    await resumePendingPlan(ctx);
    return;
  }
  if (u.role === "trainer") {
    await reply(ctx, hi + t(lang, "trainer_home"), trainerMenu(lang));
    return;
  }
  if (u.role === "client") {
    // Roadmap item 5: one prioritized action instead of a bare "welcome back" + full menu —
    // the menu is still one tap away (mainMenu/moreMenu), just not the FIRST thing shown.
    await reply(ctx, hi + t(lang, "welcome_back"));
    await showNextBestAction(ctx);
    return;
  }
  // solo
  const pending = await pendingRequestForClient(ctx.db, u._id);
  if (pending) {
    const tr = await getUser(ctx.db, pending.trainerId);
    const kb = new InlineKeyboard().text(t(lang, "req_cancel"), `req:cancel:${pending.id}`);
    await reply(ctx, t(lang, "req_waiting", { name: escapeHtml(tr?.profile.name ?? "trainer") }), kb);
    return;
  }
  if (u.onboarded) {
    await reply(ctx, hi + t(lang, "welcome_back"));
    await showNextBestAction(ctx);
    return;
  }
  // Stuck mid-interview (started but never finished) → resume and re-send the current
  // question instead of bouncing back to the language picker and losing their answers.
  if (u.session.mode === "onboarding") {
    await reply(ctx, t(lang, "interview_resume"));
    await onboardingStep(ctx);
    return;
  }
  // brand new → ask LANGUAGE first; the lang choice then leads to disclaimer + role choice.
  await reply(ctx, t(lang, "choose_language"), langMenu());
}
