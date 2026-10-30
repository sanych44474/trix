// Price poll: "would you pay about $4-5 a month?" sent by the owner through the broadcast queue,
// answered in the bot (bot/pricePoll.ts), summarised for the owner (domain/pricePoll.ts).
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { newDb, makeCtx } from "./harness";
import { getOrCreateUser, getUser, updateUser } from "../src/adapters/d1/v2Users";
import { setOwnerChatId } from "../src/adapters/d1/v2Admin";
import { listPollAnswers } from "../src/adapters/d1/v2PricePoll";
import { parsePollPrice, summarizePoll } from "../src/domain/pricePoll";
import { handleBroadcastBatch, type BroadcastMessage } from "../src/features/owner/broadcastQueue";
import { queuePricePoll } from "../src/features/owner/pricePoll";
import { cmdPricePoll, handlePollPrice, handlePollWish, onPollChoice, onPollSkip } from "../src/bot/pricePoll";
import { launcherGate } from "../src/bot/launcher";
import { setAppUrl } from "../src/notify/appLinks";
import type { Env, UserDoc } from "../src/types";

afterEach(() => setAppUrl(undefined));

test("parsePollPrice reads a dollar amount from free text", () => {
  assert.equal(parsePollPrice("3"), 3);
  assert.equal(parsePollPrice("2,5$"), 2.5);
  assert.equal(parsePollPrice("$4 на місяць"), 4);
  assert.equal(parsePollPrice("0"), 0);
  assert.equal(parsePollPrice("не знаю"), null);
  assert.equal(parsePollPrice("500"), null);
});

test("summarizePoll counts answers, the median typed price and who pays at least $4", () => {
  const s = summarizePoll([
    { choice: "yes" },
    { choice: "custom", price: 2 },
    { choice: "custom", price: 5 },
    { choice: "custom", price: 3 },
    { choice: "no" },
  ]);
  assert.deepEqual(s, { total: 5, yes: 1, custom: 3, no: 1, medianPrice: 3, payAtProposed: 0.4 });
  assert.equal(summarizePoll([]).payAtProposed, 0);
  assert.equal(summarizePoll([]).medianPrice, undefined);
});

async function user(db: ReturnType<typeof newDb>, id: number) {
  return (await getOrCreateUser(db, id, id, "uk", `U${id}`)) as unknown as UserDoc;
}

test("own price: button → typed price → wish; the wish also lands in the feedback inbox", async () => {
  const db = newDb();
  const u = await user(db, 41);
  const { ctx, sent } = makeCtx(db, u as unknown as Record<string, unknown>);

  await onPollChoice(ctx as never, "custom");
  assert.equal(u.session.mode, "poll_price");
  await handlePollPrice(ctx as never, "дорого");
  assert.equal(u.session.mode, "poll_price", "a bad amount keeps asking");
  await handlePollPrice(ctx as never, "2,5");
  assert.equal(u.session.mode, "poll_wish");
  await handlePollWish(ctx as never, "  Додайте трекер сну  ");
  assert.equal(u.session.mode, "idle");

  const [row] = await listPollAnswers(db);
  assert.deepEqual({ choice: row!.choice, price: row!.price, wish: row!.wish }, { choice: "custom", price: 2.5, wish: "Додайте трекер сну" });
  const fb = await db.prepare("SELECT text FROM v2_feedback WHERE accountId = 41").first<{ text: string }>();
  assert.equal(fb!.text, "[Price poll] Додайте трекер сну");
  assert.match(sent.at(-1)!.text, /Дякуємо/);
});

test("yes then skip keeps the answer without a wish; a later answer overwrites the earlier one", async () => {
  const db = newDb();
  const u = await user(db, 42);
  const { ctx } = makeCtx(db, u as unknown as Record<string, unknown>);
  await onPollChoice(ctx as never, "custom");
  await handlePollPrice(ctx as never, "3");
  await onPollChoice(ctx as never, "yes");
  await onPollSkip(ctx as never);
  const answers = await listPollAnswers(db);
  assert.equal(answers.length, 1);
  assert.equal(answers[0]!.choice, "yes");
  assert.equal(answers[0]!.price, undefined, "switching to yes clears the old typed price");
  assert.equal(u.session.mode, "idle");
});

test("the queue delivers the poll with its three buttons, and skips people who already answered", async () => {
  const db = newDb();
  for (const id of [1, 2, 3]) {
    await getOrCreateUser(db, id, id * 10, "uk", `U${id}`);
    await updateUser(db, id, { onboarded: true });
  }
  await updateUser(db, 3, { botBlocked: true });
  const env = { DB: db, TELEGRAM_BOT_TOKEN: "test" } as unknown as Env;
  const queued: BroadcastMessage[] = [];
  const queue = { sendBatch: async (m: Array<{ body: BroadcastMessage }>) => { queued.push(...m.map((x) => x.body)); } } as unknown as Queue<BroadcastMessage>;
  assert.deepEqual(await queuePricePoll(env, queue, 1), { queued: 2 });
  assert.deepEqual(queued, [{ kind: "poll", userId: 1 }, { kind: "poll", userId: 2 }]);

  const u2 = await user(db, 2);
  await onPollChoice(makeCtx(db, u2 as unknown as Record<string, unknown>).ctx as never, "no");

  const bodies: Array<{ chat_id: number; text: string; reply_markup?: { inline_keyboard: Array<Array<{ callback_data: string }>> } }> = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({ ok: true, result: {} });
  }) as typeof fetch;
  const log: string[] = [];
  try {
    await handleBroadcastBatch({ messages: queued.map((body, i) => ({ body, ack: () => log.push(`ack:${i}`), retry: () => log.push(`retry:${i}`) })) } as unknown as MessageBatch<BroadcastMessage>, env);
  } finally {
    globalThis.fetch = real;
  }
  assert.deepEqual(log, ["ack:0", "ack:1"]);
  assert.equal(bodies.length, 1, "user 2 already answered");
  assert.equal(bodies[0]!.chat_id, 10);
  assert.match(bodies[0]!.text, /\$4–5 на місяць/);
  assert.deepEqual(bodies[0]!.reply_markup!.inline_keyboard.flat().map((b) => b.callback_data), ["pp:yes", "pp:custom", "pp:no"]);
});

test("/pricepoll is owner-only and reports the results", async () => {
  const db = newDb();
  await setOwnerChatId(db, 7);
  const owner = await user(db, 7);
  const other = await user(db, 8);
  await onPollChoice(makeCtx(db, other as unknown as Record<string, unknown>).ctx as never, "yes");

  const stranger = makeCtx(db, other as unknown as Record<string, unknown>);
  await cmdPricePoll(stranger.ctx as never);
  assert.doesNotMatch(stranger.sent[0]!.text, /Відповідей/);

  const { ctx, sent } = makeCtx(db, owner as unknown as Record<string, unknown>);
  await cmdPricePoll(ctx as never);
  assert.match(sent[0]!.text, /Відповідей: 1/);
  assert.match(sent[0]!.text, /Готові платити від \$4: 100%/);
});

test("in production (chat retired) the poll's buttons and typed answers pass the launcher gate", async () => {
  // The gate answers everything else with the Open-app button. The poll worked only for the owner,
  // who skips the gate, until its buttons and its two text steps were let through.
  setAppUrl("https://trix.example", "/app-v2");
  const db = newDb();
  await getOrCreateUser(db, 60, 60, "uk", "Denys");
  await updateUser(db, 60, { onboarded: true, profile: { chatRetired: true } });
  const u = (await getUser(db, 60)) as UserDoc;
  const gate = async (extra: Record<string, unknown>) => {
    const { ctx, sent } = makeCtx(db, u as unknown as Record<string, unknown>);
    Object.assign(ctx, extra);
    return { passed: !(await launcherGate(ctx as never)), sent };
  };
  for (const data of ["pp:yes", "pp:custom", "pp:no", "pp:skip"]) {
    assert.equal((await gate({ callbackQuery: { data } })).passed, true, data);
  }
  assert.equal((await gate({ message: { text: "3" } })).passed, false, "idle: a number is not a poll answer");

  u.session = { ...u.session, mode: "poll_price" };
  assert.equal((await gate({ message: { text: "3" } })).passed, true);
  u.session = { ...u.session, mode: "poll_wish" };
  assert.equal((await gate({ message: { text: "Разовий внесок замість підписки" } })).passed, true);
  assert.equal((await gate({ message: { text: "/plan" } })).passed, false, "commands still open the app");
});
