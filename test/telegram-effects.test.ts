import { test } from "node:test";
import assert from "node:assert/strict";
import { reactToUser, reply, MESSAGE_EFFECTS } from "../src/adapters/telegram/context";

const ctxOf = (opts: { failEffect?: boolean } = {}) => {
  const sent: Array<Record<string, unknown>> = [];
  const reactions: unknown[] = [];
  const ctx = {
    chat: { id: 7, type: "private" },
    message: { message_id: 42, chat: { id: 7 } },
    reply: async (text: string, extra: Record<string, unknown>) => {
      if (opts.failEffect && extra.message_effect_id) throw new Error("400 EFFECT_ID_INVALID");
      sent.push({ text, ...extra });
    },
    api: { setMessageReaction: async (...a: unknown[]) => { reactions.push(a); return true; } },
  };
  return { ctx: ctx as never, sent, reactions };
};

test("reply with an effect sends message_effect_id in private chats", async () => {
  const { ctx, sent } = ctxOf();
  await reply(ctx, "New record!", undefined, "celebrate");
  assert.equal(sent[0]!.message_effect_id, MESSAGE_EFFECTS.celebrate);
});

test("a rejected effect never loses the message", async () => {
  const { ctx, sent } = ctxOf({ failEffect: true });
  await reply(ctx, "New record!", undefined, "celebrate");
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.message_effect_id, undefined);
});

test("reactToUser reacts on the user's own message", async () => {
  const { ctx, reactions } = ctxOf();
  await reactToUser(ctx, "🔥");
  assert.deepEqual(reactions[0], [7, 42, [{ type: "emoji", emoji: "🔥" }]]);
});
