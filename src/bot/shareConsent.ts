// Client-owned consent toggles for what a trainer can see. Workouts, plan and logs are always
// trainer-visible; body data and health details are strict opt-in — the client card only shows
// them once the client flips these on (see domain/clientCard's trainerCanSee). Extracted from
// bot.ts (god-file split; same barrel seam via bot.ts's `export * from "./bot/shareConsent"`).
import { InlineKeyboard } from "grammy";
import { updateUser } from "../db/repos";
import { t } from "../locales/i18n";
import { type MyContext, reply } from "../bot";

export async function showShareSettings(ctx: MyContext) {
  const lang = ctx.user.lang;
  const share = ctx.user.profile.shareWithTrainer;
  const kb = new InlineKeyboard()
    .text(`${share?.body ? "✅" : "🔒"} ${t(lang, "share_body_btn")}`, "share:tog:body")
    .row()
    .text(`${share?.health ? "✅" : "🔒"} ${t(lang, "share_health_btn")}`, "share:tog:health")
    .row()
    .text(t(lang, "back"), "menu:settings");
  await reply(ctx, t(lang, "share_title"), kb);
}

export async function toggleShare(ctx: MyContext, key: "body" | "health") {
  const profile = {
    ...ctx.user.profile,
    shareWithTrainer: { ...ctx.user.profile.shareWithTrainer, [key]: !ctx.user.profile.shareWithTrainer?.[key] },
  };
  await updateUser(ctx.db, ctx.user._id, { profile });
  ctx.user.profile = profile;
  await showShareSettings(ctx);
}
