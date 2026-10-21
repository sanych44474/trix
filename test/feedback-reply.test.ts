// The owner answers feedback from the bot (Reply button) or the owner console; the author gets it
// through the outbox and in their in-app inbox, and the console shows the reply.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCtx, newDb } from "./harness";
import { getOrCreateUser, getUser } from "../src/adapters/d1/v2Users";
import { setOwnerChatId } from "../src/adapters/d1/v2Admin";
import { insertFeedback, listFeedback } from "../src/adapters/d1/v2Feedback";
import { listInbox } from "../src/adapters/d1/v2Inbox";
import { feedbackReplyMarkup, replyToFeedback } from "../src/features/feedback/replyFeedback";
import { handleFeedbackReply, onFeedbackReplyButton } from "../src/bot/feedbackReply";
import { handleOwnerApi } from "../src/webapp/ownerApi";

const OWNER = 5;
const AUTHOR = 700;

async function setup() {
  const db = newDb();
  await getOrCreateUser(db, OWNER, OWNER, "en", "Owner");
  await setOwnerChatId(db, OWNER);
  await getOrCreateUser(db, AUTHOR, AUTHOR, "uk", "Denys");
  const id = (await insertFeedback(db, { userId: AUTHOR, text: "Search can't find a dish", date: "2026-10-21" }))!;
  return { db, id };
}

test("a reply reaches the author, closes the feedback and lands in their inbox", async () => {
  const { db, id } = await setup();
  const sent: Array<{ to: number; text: string }> = [];
  const sender = { api: { sendMessage: async (to: number, text: string) => { sent.push({ to, text }); return {} as never; } } };
  const result = await replyToFeedback({ DB: db, TELEGRAM_BOT_TOKEN: "t" } as never, sender as never, id, "Added an AI breakdown for dishes");
  assert.equal(result, "sent");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, AUTHOR);
  assert.match(sent[0].text, /AI breakdown for dishes/);
  assert.match(sent[0].text, /Search can/);
  const row = (await listFeedback(db, "all")).rows.find((r) => r.id === id)!;
  assert.equal(row.status, "done");
  assert.equal(row.reply, "Added an AI breakdown for dishes");
  const inbox = await listInbox(db, AUTHOR);
  assert.equal(inbox.items[0].kind, "feedback_reply");
  assert.equal(inbox.unread, 1);
  assert.equal(await replyToFeedback({ DB: db, TELEGRAM_BOT_TOKEN: "t" } as never, sender as never, 9999, "x"), "not_found");
});

test("bot: only the owner's Reply button opens the reply, and the text is delivered", async () => {
  const { db, id } = await setup();
  assert.deepEqual(feedbackReplyMarkup(id), { inline_keyboard: [[{ text: "↩️ Reply", callback_data: `fbr:${id}` }]] });
  assert.equal(feedbackReplyMarkup(null), undefined);

  const stranger = makeCtx(db, (await getUser(db, AUTHOR)) as never);
  await onFeedbackReplyButton(stranger.ctx as never, String(id));
  assert.equal((await getUser(db, AUTHOR))!.session.mode, "idle", "non-owners can't reply");

  const owner = makeCtx(db, (await getUser(db, OWNER)) as never);
  await onFeedbackReplyButton(owner.ctx as never, String(id));
  assert.equal((await getUser(db, OWNER))!.session.mode, "feedback_reply");
  const typing = makeCtx(db, (await getUser(db, OWNER)) as never);
  await handleFeedbackReply(typing.ctx as never, "Thanks, fixed!");
  assert.ok(typing.sent.some((m) => m.to === AUTHOR && /Thanks, fixed!/.test(m.text)), "author got it");
  assert.ok(typing.sent.some((m) => m.to === "self" && /Reply sent/.test(m.text)), "owner sees it was sent");
  assert.equal((await getUser(db, OWNER))!.session.mode, "idle");
});

test("owner console: POST /api/owner/feedback/:id/reply delivers; others get 404", async () => {
  const { db, id } = await setup();
  const env = { DB: db, ALLOW_DEBUG_USER: "1", TELEGRAM_BOT_TOKEN: "t" } as never;
  const call = (who: number, body: unknown) => {
    const path = `/api/owner/feedback/${id}/reply?debugUser=${who}`;
    return handleOwnerApi(new Request(`https://x${path}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), new URL(`https://x${path}`), env);
  };
  const realFetch = globalThis.fetch;
  const sent: Array<{ chat_id: number; text: string }> = [];
  globalThis.fetch = (async (url: string, init?: { body?: string }) => {
    if (new URL(String(url)).hostname === "api.telegram.org" && init?.body) sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
  }) as unknown as typeof fetch;
  try {
    assert.equal((await call(AUTHOR, { text: "hi" })).status, 404);
    assert.equal((await call(OWNER, { text: "" })).status, 400);
    const ok = await call(OWNER, { text: "Done in the next release" });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true, delivered: true, queued: false });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].chat_id, AUTHOR);
  } finally {
    globalThis.fetch = realFetch;
  }
});
