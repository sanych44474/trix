// The price poll the owner sends to every reachable user: why the product needs money (the app
// stores, better AI models), "would you pay about $4-5 a month?" with three buttons, then "what to
// add or remove". The message and keyboard are shared by the queue consumer (broadcastQueue.ts)
// and the owner's preview (bot/pricePoll.ts).
import { InlineKeyboard } from "grammy";
import { listOnboardedUsers } from "../../adapters/d1/v2Users";
import { recordAudit } from "../../adapters/d1/v2Admin";
import { t } from "../../locales/i18n";
import type { Env, Lang } from "../../types";
import type { BroadcastMessage } from "./broadcastQueue";

export function pricePollText(lang: Lang): string {
  return t(lang, "pp_question");
}

export function pricePollKb(lang: Lang): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(lang, "pp_yes_btn"), "pp:yes").row()
    .text(t(lang, "pp_custom_btn"), "pp:custom").row()
    .text(t(lang, "pp_no_btn"), "pp:no");
}

/** Queue the poll for every onboarded, reachable user. Users who already answered are skipped by
 *  the consumer, so sending it twice only reaches the ones who haven't. */
export async function queuePricePoll(env: Env, queue: Queue<BroadcastMessage>, ownerId: number): Promise<{ queued: number }> {
  const recipients = (await listOnboardedUsers(env.DB)).filter((u) => !u.blocked && !u.botBlocked);
  for (let i = 0; i < recipients.length; i += 100) {
    await queue.sendBatch(recipients.slice(i, i + 100).map((u) => ({ body: { kind: "poll" as const, userId: u._id } })));
  }
  await recordAudit(env.DB, ownerId, "price_poll", undefined, `queued ${recipients.length}`).catch(() => {});
  return { queued: recipients.length };
}
