// Accountability buddy pairing asks first. Opening t.me/<bot>?start=buddy_<A> sends A a request
// with Accept and Decline; only A's Accept pairs them. Pairing at once let anyone type any id and
// attach themselves to a stranger, replacing that person's buddy and seeing their activity.
// The rules are in domain/buddyRequest.ts.
import { InlineKeyboard } from "grammy";
import { t } from "../locales/i18n";
import { getUser, updateUser } from "../adapters/d1/v2Users";
import { hasTelegramChat } from "../domain/delivery";
import { buddyRequestIsFor, previousBuddies } from "../domain/buddyRequest";
import { HTML, reply, type MyContext } from "../adapters/telegram/context";
import type { UserDoc } from "../types";

const nameOf = (u: UserDoc) => u.profile.name ?? `id ${u._id}`;

/** /start buddy_<mateId>: the opener asks `mateId` to be their buddy. */
export async function requestBuddy(ctx: MyContext, mateId: number): Promise<void> {
  const u = ctx.user;
  const lang = u.lang;
  if (!Number.isFinite(mateId) || mateId <= 0 || mateId === u._id) return;
  const other = await getUser(ctx.db, mateId).catch(() => null);
  if (!other) return;
  const name = nameOf(other);
  if (u.profile.buddyId === other._id && other.profile.buddyId === u._id) {
    await reply(ctx, t(lang, "buddy_already", { name })).catch(() => {});
    return;
  }
  const now = new Date();
  if (buddyRequestIsFor(u.profile.buddyRequest, other._id, now)) {
    await reply(ctx, t(lang, "buddy_req_pending", { name })).catch(() => {});
    return;
  }
  const kb = new InlineKeyboard()
    .text(t(other.lang, "buddy_req_accept_btn"), `bdy:ok:${u._id}`)
    .text(t(other.lang, "buddy_req_decline_btn"), `bdy:no:${u._id}`);
  const sent = hasTelegramChat(other) && await ctx.api
    .sendMessage(other.chatId, t(other.lang, "buddy_req_prompt", { name: nameOf(u) }), { ...HTML, reply_markup: kb })
    .then(() => true, () => false);
  if (!sent) {
    await reply(ctx, t(lang, "buddy_req_unreachable")).catch(() => {});
    return;
  }
  // One pending request at a time: a new link replaces the old request.
  u.profile = { ...u.profile, buddyRequest: { to: other._id, at: now.toISOString() } };
  await updateUser(ctx.db, u._id, { profile: u.profile }).catch(() => {});
  await reply(ctx, t(lang, "buddy_req_sent", { name })).catch(() => {});
}

/** Accept or Decline on a buddy request; `rest` is the requester's id from the callback data. */
export async function answerBuddyRequest(ctx: MyContext, rest: string, accept: boolean): Promise<void> {
  const me = ctx.user;
  const lang = me.lang;
  const requesterId = Number(rest);
  const requester = Number.isInteger(requesterId) && requesterId > 0 && requesterId !== me._id
    ? await getUser(ctx.db, requesterId).catch(() => null)
    : null;
  // Callback data can be forged: only the requester's own stored request proves they asked me.
  const answer = (text: string) => ctx.editMessageText(text, HTML).catch(() => reply(ctx, text).catch(() => {}));
  if (!requester || !buddyRequestIsFor(requester.profile.buddyRequest, me._id, new Date())) {
    await answer(t(lang, "buddy_req_invalid"));
    return;
  }
  const notifyRequester = (text: string) =>
    hasTelegramChat(requester) ? ctx.api.sendMessage(requester.chatId, text, HTML).catch(() => {}) : undefined;
  if (!accept) {
    await updateUser(ctx.db, requester._id, { profile: { ...requester.profile, buddyRequest: undefined } }).catch(() => {});
    await answer(t(lang, "buddy_req_declined_ok"));
    await notifyRequester(t(requester.lang, "buddy_req_declined"));
    return;
  }
  // Re-pairing with someone new must not leave a stale, one-sided link behind: if either side
  // already has a DIFFERENT buddy, unlink that old buddy first (only if the old buddy's own link
  // still points back — don't clobber a third party's unrelated state). Otherwise the old buddy's
  // buddyId keeps pointing at someone who's moved on, which the weekly duel sweep (allBuddyPairs)
  // would otherwise have to defend against on its own.
  await Promise.all(previousBuddies(me, requester).map(async ({ oldId, of }) => {
    const old = await getUser(ctx.db, oldId).catch(() => null);
    if (old && old.profile.buddyId === of) {
      await updateUser(ctx.db, old._id, { profile: { ...old.profile, buddyId: undefined } }).catch(() => {});
    }
  }));
  me.profile = { ...me.profile, buddyId: requester._id };
  await updateUser(ctx.db, me._id, { profile: me.profile }).catch(() => {});
  await updateUser(ctx.db, requester._id, { profile: { ...requester.profile, buddyId: me._id, buddyRequest: undefined } }).catch(() => {});
  await answer(t(lang, "buddy_paired", { name: nameOf(requester) }));
  await notifyRequester(t(requester.lang, "buddy_paired", { name: nameOf(me) }));
}
