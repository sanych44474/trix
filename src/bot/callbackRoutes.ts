// Inline-button routing in the private chat. The chat is retired (ADR-0012): launcherGate lets a
// non-owner's tap through only for the app's Telegram sign-in and the asks the bot itself sends
// (price poll, inactive-user ask, sharing consent); the rest is the owner's tools.
//
// Exact matches first, then CB_PREFIX in registration order (first match wins).
import { onSupportAmount } from "./support";
import { menuBtn } from "../adapters/telegram/keyboards";
import { onWhatsNewSend, ownerUserAction, sendOwnerSection, showOwnerHub, showWhatsNewConfirm } from "./owner";
import { onPollAsk, onPollChoice, onPollSend, onPollSkip, onPollWho } from "./pricePoll";
import { type MyContext, reply, setMode } from "../adapters/telegram/context";
import { t } from "../locales/i18n";
import { cmdAskInactive, onCleanupAll, onCleanupDelete, onInactiveReply } from "./cleanup";
import { startVideoSet } from "./ownerVideos";
import { onTrainerApprove, onTrainerReject } from "../features/trainer/trainer";
import { onFeedbackReplyButton } from "./feedbackReply";
import { toggleShare } from "./shareConsent";
import { answerTelegramLogin } from "./telegramLogin";
import type { Weekday } from "../types";

type CbHandler = (ctx: MyContext, rest: string, data: string) => Promise<unknown> | unknown;

export const CB_EXACT: Record<string, CbHandler> = {
  // Sharing consent, sent by the bot after pairing with a trainer.
  "share:skip": (ctx) => reply(ctx, t(ctx.user.lang, "share_skipped")),
  // The owner's "still here?" ask to inactive users, and its cleanup tools.
  "inact:stay": (ctx) => onInactiveReply(ctx, "stay"),
  "inact:leave": (ctx) => onInactiveReply(ctx, "leave"),
  "inact:fbskip": async (ctx) => { await setMode(ctx, "idle"); await reply(ctx, t(ctx.user.lang, "inact_fb_thanks"), menuBtn(ctx.user.lang)); },
  "clean:all": (ctx) => onCleanupAll(ctx, false),
  "clean:allyes": (ctx) => onCleanupAll(ctx, true),
  "clean:ask": (ctx) => cmdAskInactive(ctx),
  // The price poll.
  "pp:yes": (ctx) => onPollChoice(ctx, "yes"),
  "pp:custom": (ctx) => onPollChoice(ctx, "custom"),
  "pp:no": (ctx) => onPollChoice(ctx, "no"),
  "pp:skip": (ctx) => onPollSkip(ctx),
  "pp:ask": (ctx) => onPollAsk(ctx),
  "pp:send": (ctx) => onPollSend(ctx),
  "pp:who": (ctx) => onPollWho(ctx),
  // Owner hub and release notes.
  "menu:open": (ctx) => showOwnerHub(ctx),
  "menu:ownerhub": (ctx) => showOwnerHub(ctx),
  "wn:ask": (ctx) => showWhatsNewConfirm(ctx),
  "wn:send": (ctx) => onWhatsNewSend(ctx),
};

export const CB_PREFIX: [string, CbHandler][] = [
  // The native app's Telegram sign-in.
  ["tglogin:ok:", (ctx, rest) => answerTelegramLogin(ctx, rest, true)],
  ["tglogin:no:", (ctx, rest) => answerTelegramLogin(ctx, rest, false)],
  ["share:tog:", (ctx, rest) => (rest === "body" || rest === "health" ? toggleShare(ctx, rest) : undefined)],
  // Payments.
  ["support:", (ctx, rest) => onSupportAmount(ctx, rest)],
  // Owner tools.
  ["orep:", (ctx, rest) => sendOwnerSection(ctx, rest)],
  ["trainer:approve:", (ctx, rest) => onTrainerApprove(ctx, Number(rest))],
  ["trainer:reject:", (ctx, rest) => onTrainerReject(ctx, Number(rest))],
  ["ou:", (ctx, _r, data) => { const [, id, action, arg] = data.split(":"); return ownerUserAction(ctx, Number(id), action, arg); }],
  ["vid:set:", (ctx, _r, data) => { const [, , wd, idx] = data.split(":"); return startVideoSet(ctx, Number(wd) as Weekday, Number(idx)); }],
  ["fbr:", (ctx, rest) => onFeedbackReplyButton(ctx, rest)],
  ["clean:del:", (ctx, rest) => onCleanupDelete(ctx, Number(rest))],
];

/** Which route a callback's data resolves to (an exact key or a prefix), or null for none. */
export function cbRouteFor(data: string): string | null {
  if (CB_EXACT[data]) return data;
  for (const [prefix] of CB_PREFIX) if (data.startsWith(prefix)) return prefix;
  return null;
}
