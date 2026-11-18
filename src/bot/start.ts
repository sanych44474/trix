// /start: its pairing payloads (ADR-0012), then the Open-app button.
import { joinByInviteCode } from "../features/squad/join";
import { logInfo } from "../log";
import { updateUser } from "../adapters/d1/v2Users";
import { t } from "../locales/i18n";
import { joinByCode, joinByProspectCode } from "../features/trainer/trainer";
import { sendLauncher } from "./launcher";
import { promptTelegramLogin } from "./telegramLogin";
import { requestBuddy } from "./buddyRequest";
import { clearEditOwner, reply, type MyContext } from "../adapters/telegram/context";

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
  // Accountability buddy link: ask the link's owner, who pairs the two by accepting (buddyRequest.ts).
  if (payload?.startsWith("buddy_")) {
    await requestBuddy(ctx, Number(payload.slice(6)));
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
