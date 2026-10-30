// Price poll in the bot. Users: three buttons (pay $4-5 / own price / not ready), then an
// optional "what to add or remove". Owner: /pricepoll shows the results so far and sends the poll
// to everyone behind a confirm. The message itself lives in features/owner/pricePoll.ts.
import { InlineKeyboard } from "grammy";
import { insertFeedback } from "../adapters/d1/v2Feedback";
import { listPollAnswers, listPollAnswersByUser, recordPollChoice, recordPollPrice, recordPollWish } from "../adapters/d1/v2PricePoll";
import { localParts } from "../domain/localTime";
import { parsePollPrice, summarizePoll, type PollChoice } from "../domain/pricePoll";
import { broadcastQueue } from "../features/owner/broadcastQueue";
import { isOwner } from "../features/owner/ownerAccess";
import { pricePollKb, pricePollText, queuePricePoll } from "../features/owner/pricePoll";
import { escapeHtml, t } from "../locales/i18n";
import { type MyContext, reply, setMode } from "../adapters/telegram/context";
import { menuBtn } from "../adapters/telegram/keyboards";

const WISH_MAX = 1000;

function skipKb(ctx: MyContext): InlineKeyboard {
  return new InlineKeyboard().text(t(ctx.user.lang, "pp_skip_btn"), "pp:skip");
}

async function askWish(ctx: MyContext) {
  await setMode(ctx, "poll_wish");
  await reply(ctx, t(ctx.user.lang, "pp_wish_prompt"), skipKb(ctx));
}

/** A tap on one of the three answer buttons. */
export async function onPollChoice(ctx: MyContext, choice: PollChoice) {
  await recordPollChoice(ctx.db, ctx.user._id, choice);
  if (choice === "custom") {
    await setMode(ctx, "poll_price");
    await reply(ctx, t(ctx.user.lang, "pp_price_prompt"));
    return;
  }
  await askWish(ctx);
}

export async function handlePollPrice(ctx: MyContext, text: string) {
  const price = parsePollPrice(text);
  if (price === null) {
    await reply(ctx, t(ctx.user.lang, "pp_price_invalid"));
    return;
  }
  await recordPollPrice(ctx.db, ctx.user._id, price);
  await askWish(ctx);
}

export async function handlePollWish(ctx: MyContext, text: string) {
  const wish = text.trim().slice(0, WISH_MAX);
  await setMode(ctx, "idle");
  if (wish) {
    await recordPollWish(ctx.db, ctx.user._id, wish);
    // Also into the feedback inbox, so the owner triages it with everything else.
    const { date } = localParts(ctx.user.profile.timezone);
    await insertFeedback(ctx.db, { userId: ctx.user._id, username: ctx.from?.username, text: `[Price poll] ${wish}`, date }).catch(() => null);
  }
  await reply(ctx, t(ctx.user.lang, "pp_thanks"), menuBtn(ctx.user.lang));
}

export async function onPollSkip(ctx: MyContext) {
  await setMode(ctx, "idle");
  await reply(ctx, t(ctx.user.lang, "pp_thanks"), menuBtn(ctx.user.lang));
}

/** Owner: results so far, a preview of the message, and the send button. */
export async function cmdPricePoll(ctx: MyContext) {
  const lang = ctx.user.lang;
  if (!(await isOwner(ctx))) { await reply(ctx, t(lang, "admin_only")); return; }
  const answers = await listPollAnswers(ctx.db);
  const s = summarizePoll(answers);
  const wishes = answers.filter((a) => a.wish).slice(0, 15).map((a) => `• ${escapeHtml(a.wish as string)}`);
  const lines = [
    t(lang, "pp_results", {
      total: s.total,
      yes: s.yes,
      custom: s.custom,
      no: s.no,
      median: s.medianPrice !== undefined ? `$${s.medianPrice}` : "—",
      pct: Math.round(s.payAtProposed * 100),
    }),
    ...(wishes.length ? ["", t(lang, "pp_results_wishes"), ...wishes] : []),
  ];
  const kb = new InlineKeyboard();
  if (s.total) kb.text(t(lang, "pp_who_btn"), "pp:who").row();
  kb.text(t(lang, "pp_send_btn"), "pp:ask").row().text(t(lang, "menu_open"), "menu:open");
  await reply(ctx, lines.join("\n"), kb);
}

/** Owner: every answer with who gave it (name / @username — answer — price — wish). */
export async function onPollWho(ctx: MyContext) {
  const lang = ctx.user.lang;
  if (!(await isOwner(ctx))) { await reply(ctx, t(lang, "admin_only")); return; }
  const rows = await listPollAnswersByUser(ctx.db);
  if (!rows.length) { await reply(ctx, t(lang, "pp_who_empty"), menuBtn(lang)); return; }
  const choiceLabel = { yes: t(lang, "pp_who_yes"), custom: t(lang, "pp_who_custom"), no: t(lang, "pp_who_no") };
  const lines = rows.map((r) => {
    const who = [r.name, r.username ? `@${r.username}` : undefined].filter(Boolean).join(" ") || `id ${r.userId}`;
    const price = r.choice === "custom" && r.price !== undefined ? ` $${r.price}` : "";
    const wish = r.wish ? `\n   💬 ${escapeHtml(r.wish)}` : "";
    return `• <b>${escapeHtml(who)}</b> — ${choiceLabel[r.choice]}${price}${wish}`;
  });
  await reply(ctx, [t(lang, "pp_who_title", { n: rows.length }), ...lines].join("\n"), menuBtn(lang));
}

/** Owner: show exactly what users will get, behind a confirm. */
export async function onPollAsk(ctx: MyContext) {
  const lang = ctx.user.lang;
  if (!(await isOwner(ctx))) { await reply(ctx, t(lang, "admin_only")); return; }
  await reply(ctx, t(lang, "pp_preview"));
  await reply(ctx, pricePollText(lang), pricePollKb(lang));
  const kb = new InlineKeyboard().text(t(lang, "pp_confirm_btn"), "pp:send").text(t(lang, "whatsnew_cancel"), "menu:open");
  await reply(ctx, t(lang, "pp_confirm"), kb);
}

export async function onPollSend(ctx: MyContext) {
  const lang = ctx.user.lang;
  if (!(await isOwner(ctx))) { await reply(ctx, t(lang, "admin_only")); return; }
  const queue = broadcastQueue(ctx.env);
  if (!queue) { await reply(ctx, t(lang, "pp_no_queue"), menuBtn(lang)); return; }
  const { queued } = await queuePricePoll(ctx.env, queue, ctx.user._id);
  await reply(ctx, t(lang, "broadcast_queued", { n: queued }), menuBtn(lang));
}
