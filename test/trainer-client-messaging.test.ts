// Bug report: "тренер не может общаться через бота с клиентами" — handleTrainerMessage sent via a
// direct ctx.api.sendMessage with the result swallowed (.catch(() => {})), then unconditionally
// replied "✅ Sent." to the trainer on the very next line, regardless of whether Telegram actually
// delivered anything. A blocked bot, a stale chat, or a transient 429 all looked identical to a
// successful send from the trainer's side. Now routed through the same notification outbox the
// scheduler uses (schedulerOutbox.ts): a transient failure retries instead of vanishing, a
// permanent block is reported and recorded, and the trainer is told which actually happened.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GrammyError } from "grammy";
import { newDb, makeCtx } from "./harness";
import { getOrCreateUser, getUser, updateUser } from "../src/adapters/d1/v2Users";
import { linkClient } from "../src/adapters/d1/v2Trainer";
import { handleClientReply, handleTrainerMessage } from "../src/features/trainer/trainer";
import type { UserDoc } from "../src/types";

function grammyErr(errorCode: number, retryAfterSeconds?: number): GrammyError {
  return new GrammyError(
    "Error",
    { ok: false, error_code: errorCode, description: "x", parameters: retryAfterSeconds ? { retry_after: retryAfterSeconds } : undefined },
    "sendMessage",
    {},
  );
}

async function pairedTrainerAndClient(db: ReturnType<typeof newDb>, trainerId: number, clientId: number): Promise<{ trainer: UserDoc; client: UserDoc }> {
  await getOrCreateUser(db, trainerId, trainerId, "en", "Coach");
  await updateUser(db, trainerId, { role: "trainer" });
  await getOrCreateUser(db, clientId, clientId, "en", "Maxim");
  await linkClient(db, clientId, trainerId);
  await updateUser(db, clientId, { role: "client", trainerId });
  return {
    trainer: (await getUser(db, trainerId)) as UserDoc,
    client: (await getUser(db, clientId)) as UserDoc,
  };
}

async function outboxStatus(db: ReturnType<typeof newDb>, kind: string): Promise<string | undefined> {
  const r = await db.prepare("SELECT status FROM v2_notifications WHERE kind = ? ORDER BY id DESC LIMIT 1").bind(kind).first<{ status: string }>();
  return r?.status;
}

test("handleTrainerMessage: a successful send tells the trainer it was sent", async () => {
  const db = newDb();
  const { trainer, client } = await pairedTrainerAndClient(db, 800, 801);
  const { ctx, sent } = makeCtx(db, { ...trainer, session: { mode: "msg_client", targetId: 801 } } as unknown as Record<string, unknown>);

  await handleTrainerMessage(ctx as never, "How's the shoulder feeling?");

  assert.equal(sent[sent.length - 1].text, "✅ Sent.");
  assert.equal(await outboxStatus(db, "trainer_msg"), "sent");
});

test("handleTrainerMessage: a blocked client is reported as blocked, not 'Sent', and botBlocked is recorded", async () => {
  const db = newDb();
  const { trainer } = await pairedTrainerAndClient(db, 810, 811);
  const { ctx, sent } = makeCtx(db, { ...trainer, session: { mode: "msg_client", targetId: 811 } } as unknown as Record<string, unknown>);
  ctx.api.sendMessage = (async () => { throw grammyErr(403); }) as typeof ctx.api.sendMessage;

  await handleTrainerMessage(ctx as never, "Ready for tomorrow?");

  const last = sent[sent.length - 1].text;
  assert.notEqual(last, "✅ Sent.", "must not claim success when Telegram rejected the chat");
  assert.match(last, /Maxim/);
  assert.equal(await outboxStatus(db, "trainer_msg"), "blocked");
  const reloadedClient = await getUser(db, 811);
  assert.equal(reloadedClient?.botBlocked, true, "a 403 must be recorded so future sends stop retrying");
});

test("handleTrainerMessage: a transient failure (429) is queued for retry, NOT reported as sent -- the exact regression this closes", async () => {
  const db = newDb();
  const { trainer } = await pairedTrainerAndClient(db, 820, 821);
  const { ctx, sent } = makeCtx(db, { ...trainer, session: { mode: "msg_client", targetId: 821 } } as unknown as Record<string, unknown>);
  ctx.api.sendMessage = (async () => { throw grammyErr(429, 30); }) as typeof ctx.api.sendMessage;

  await handleTrainerMessage(ctx as never, "Quick check-in");

  const last = sent[sent.length - 1].text;
  assert.notEqual(last, "✅ Sent.", "a 429 must not be reported as a successful delivery");
  assert.equal(await outboxStatus(db, "trainer_msg"), "pending", "must stay queued for the retry sweep, not be dropped");
  const reloadedClient = await getUser(db, 821);
  assert.notEqual(reloadedClient?.botBlocked, true, "a rate limit is not a block");
});

test("handleTrainerMessage: an unrelated client (not this trainer's) is refused, unaffected by the outbox change", async () => {
  const db = newDb();
  await getOrCreateUser(db, 830, 830, "en", "Coach");
  await updateUser(db, 830, { role: "trainer" });
  await getOrCreateUser(db, 831, 831, "en", "SomeoneElsesClient"); // never linked to 830
  const trainer = (await getUser(db, 830)) as UserDoc;
  const { ctx, sent } = makeCtx(db, { ...trainer, session: { mode: "msg_client", targetId: 831 } } as unknown as Record<string, unknown>);

  await handleTrainerMessage(ctx as never, "Hi");

  assert.equal(sent.length, 1);
  assert.doesNotMatch(sent[0].text, /Sent/);
});

test("handleClientReply: mirrors the same delivery-aware feedback for the trainer-bound direction", async () => {
  const db = newDb();
  const { trainer, client } = await pairedTrainerAndClient(db, 840, 841);
  const { ctx, sent } = makeCtx(db, { ...client, session: { mode: "msg_trainer", targetId: 840 } } as unknown as Record<string, unknown>);
  ctx.api.sendMessage = (async () => { throw grammyErr(403); }) as typeof ctx.api.sendMessage;

  await handleClientReply(ctx as never, "All good, thanks!");

  assert.notEqual(sent[sent.length - 1].text, "✅ Sent.");
  assert.equal(await outboxStatus(db, "client_reply"), "blocked");
  const reloadedTrainer = await getUser(db, 840);
  assert.equal(reloadedTrainer?.botBlocked, true);
});
