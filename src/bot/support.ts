// Voluntary support in Telegram Stars. The product is free and stays free; this is a tip jar.
// Stars (currency "XTR") need no payment provider -- the invoice is paid inside Telegram.
// Telegram's rules for bots that accept payments require a /paysupport command, answered here.
//
// Flow: /support (or the Mini App's "Support" card) -> invoice for 50/100/250 ⭐ ->
// pre_checkout_query (must be answered within 10 s) -> successful_payment -> thank-you + a row
// in v2_support_payments (the charge id keeps a refund possible). The webhook must subscribe to
// pre_checkout_query for this to work: scripts/setup-telegram.mjs registers it.
import { InlineKeyboard } from "grammy";
import type { Lang } from "../types";
import { t } from "../locales/i18n";
import { type MyContext, reply } from "../adapters/telegram/context";
import { parseSupportPayload, recordSupportPayment, SUPPORT_STAR_AMOUNTS, supportPayload } from "../adapters/d1/v2Support";
import { getOwnerChatId } from "../adapters/d1/v2Admin";
import { logInfo } from "../log";

/** The createInvoiceLink / sendInvoice body for a support payment (Bot API field names). */
export function supportInvoice(lang: Lang, stars: number) {
  return {
    title: t(lang, "support_invoice_title"),
    description: t(lang, "support_invoice_desc"),
    payload: supportPayload(stars),
    currency: "XTR",
    prices: [{ label: t(lang, "support_invoice_label"), amount: stars }],
  };
}

export async function cmdSupport(ctx: MyContext): Promise<void> {
  const lang = ctx.user.lang;
  const kb = new InlineKeyboard();
  for (const stars of SUPPORT_STAR_AMOUNTS) kb.text(`${stars} ⭐`, `support:${stars}`);
  await reply(ctx, t(lang, "support_intro"), kb);
}

export async function onSupportAmount(ctx: MyContext, rest: string): Promise<void> {
  const stars = parseSupportPayload(`support:${rest}`);
  if (stars === null) return;
  const inv = supportInvoice(ctx.user.lang, stars);
  await ctx.api.sendInvoice(ctx.user.chatId, inv.title, inv.description, inv.payload, inv.currency, inv.prices);
}

export async function cmdPaySupport(ctx: MyContext): Promise<void> {
  await reply(ctx, t(ctx.user.lang, "support_paysupport"));
}

/** Only our own payloads are accepted; anything else is declined with a reason. */
export async function onPreCheckout(ctx: MyContext): Promise<void> {
  const q = ctx.preCheckoutQuery;
  if (!q) return;
  const stars = parseSupportPayload(q.invoice_payload);
  if (stars === null || q.currency !== "XTR" || q.total_amount !== stars) {
    await ctx.answerPreCheckoutQuery(false, { error_message: t(ctx.user.lang, "support_declined") });
    return;
  }
  await ctx.answerPreCheckoutQuery(true);
}

export async function onSuccessfulPayment(ctx: MyContext): Promise<void> {
  const p = ctx.message?.successful_payment;
  if (!p) return;
  const stars = parseSupportPayload(p.invoice_payload);
  if (stars === null) return;
  const fresh = await recordSupportPayment(ctx.db, ctx.user._id, p.total_amount, p.telegram_payment_charge_id);
  if (!fresh) return; // a redelivered update: already thanked
  logInfo("support_payment", { stars: p.total_amount });
  await reply(ctx, t(ctx.user.lang, "support_thanks", { n: p.total_amount }));
  const ownerChatId = await getOwnerChatId(ctx.db).catch(() => null);
  if (ownerChatId && ownerChatId !== ctx.user.chatId) {
    const who = ctx.user.username ? `@${ctx.user.username}` : ctx.user.profile.name ?? `id ${ctx.user._id}`;
    await ctx.api.sendMessage(ownerChatId, `⭐ ${p.total_amount} — ${who}`).catch(() => {});
  }
}
