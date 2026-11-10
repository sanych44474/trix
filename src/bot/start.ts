// /start: its pairing payloads (ADR-0012), then the Open-app button.
import { joinByInviteCode } from "../features/squad/join";
import { logInfo } from "../log";
import type { UserDoc } from "../types";
import { getUser, updateUser } from "../adapters/d1/v2Users";
import { escapeHtml, t } from "../locales/i18n";
import { joinByCode, joinByProspectCode } from "../features/trainer/trainer";
import { sendLauncher } from "./launcher";
import { promptTelegramLogin } from "./telegramLogin";
import { HTML, clearEditOwner, reply, type MyContext } from "../adapters/telegram/context";

export async function cmdStart(ctx: MyContext, payload?: string) {
  logInfo("app_open", { surface: "bot" });
  await clearEditOwner(ctx);
  const u = ctx.user;
  const lang = u.lang;

  // App sign-in link: ask first (telegramLogin.ts). Opening the link never signs anyone in.
  if (payload?.startsWith("login_")) {
    await promptTelegramLogin(ctx, payload.slice(6));
    return;
  }

  // A shared program opens in the app's library (ADR-0012: the chat preview is retired).
  if (payload?.startsWith("prog_")) {
    if (await sendLauncher(ctx, "library")) return;
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
  // Squad invite from the app (t.me/<bot>?start=sq_CODE): join, then open the squads screen.
  if (payload?.startsWith("sq_")) {
    const result = await joinByInviteCode(ctx.db, u._id, payload.slice(3)).catch(() => "not_found" as const);
    await reply(ctx, t(lang, `squad_invite_${result}`)).catch(() => {});
    if (await sendLauncher(ctx, "more")) return;
  }
  // With the Mini App, a plain /start (or one after a referral or buddy link) only points there.
  // ADR-0012: there is no chat fallback any more. Without an app URL (a dev deployment) the bot
  // says so instead of starting the retired chat interview or menus.
  if (await sendLauncher(ctx)) return;
  await reply(ctx, t(lang, "launch_no_app"));
}
