// The Telegram Stars donation invoice (the bot's /support and the Mini App's donate button).
// Moved from bot/support.ts.
import type { Lang } from "../../types";
import { t } from "../../locales/i18n";
import { supportPayload } from "../../adapters/d1/v2Support";

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
