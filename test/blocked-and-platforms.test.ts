// Two owner questions: does the app understand that a user blocked the bot (and that they came back),
// and who uses the Android app versus the bot. Blocking is driven through createBot() so the real
// middleware decides, as in production.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Update } from "grammy/types";
import { newDb } from "./harness";
import { getOrCreateUser, getUser, updateUser } from "../src/adapters/d1/v2Users";
import { setOwnerChatId } from "../src/adapters/d1/v2Admin";
import { registerPushDevice } from "../src/adapters/d1/v2Push";
import { recordPresence } from "../src/adapters/d1/v2Presence";
import { countReach, countSessionAccountsBySurface } from "../src/adapters/d1/v2Analytics";
import { createBot } from "../src/bot/router";
import { setAppUrl } from "../src/notify/appLinks";
import { blockedByChatMemberStatus } from "../src/domain/delivery";
import { miniAppUser } from "../src/webapp/auth";
import { loadOwnerSnapshot, buildOwnerMetrics } from "../src/features/owner/ownerMetrics";
import { orOverview } from "../src/features/owner/ownerReport";
import type { Env } from "../src/types";

afterEach(() => setAppUrl(undefined));

async function run(db: ReturnType<typeof newDb>, update: Omit<Update, "update_id">) {
  const env = { DB: db, TELEGRAM_BOT_TOKEN: "1:test", WORKER_URL: "https://trix.example", V2_APP_ENABLED: "1", BOT_ID: "1", BOT_USERNAME: "trix_test_bot" } as unknown as Env;
  const bot = createBot(env);
  bot.api.config.use(async () => ({ ok: true, result: true }) as never);
  await bot.handleUpdate({ update_id: 1, ...update } as Update);
}

const memberChange = (id: number, status: string, chatType = "private"): Omit<Update, "update_id"> => ({
  my_chat_member: {
    chat: { id, type: chatType, first_name: "Olena" }, from: { id, is_bot: false, first_name: "Olena" }, date: 0,
    old_chat_member: { status: "member", user: { id: 1, is_bot: true, first_name: "Bot" } },
    new_chat_member: { status, user: { id: 1, is_bot: true, first_name: "Bot" } },
  },
} as never);

const hello = (id: number): Omit<Update, "update_id"> => ({
  message: { message_id: 1, date: 0, text: "hi", chat: { id, type: "private", first_name: "Olena" }, from: { id, is_bot: false, first_name: "Olena", language_code: "uk" } },
});

async function member(db: ReturnType<typeof newDb>, id: number) {
  await setOwnerChatId(db, 1);
  await getOrCreateUser(db, id, id, "uk", "Olena");
  await updateUser(db, id, { onboarded: true });
}
const flag = async (db: ReturnType<typeof newDb>, id: number) => (await getUser(db, id))?.botBlocked;

test("telegram's member status maps to blocked / unblocked, and everything else says nothing", () => {
  assert.equal(blockedByChatMemberStatus("kicked"), true);
  assert.equal(blockedByChatMemberStatus("member"), false);
  for (const s of ["left", "administrator", "creator", "restricted"]) assert.equal(blockedByChatMemberStatus(s), null, s);
});

test("blocking the bot is noticed at once, and unblocking clears it", async () => {
  const db = newDb();
  await member(db, 901);
  await run(db, memberChange(901, "kicked"));
  assert.equal(await flag(db, 901), true);
  await run(db, memberChange(901, "member"));
  assert.equal(await flag(db, 901), false);
});

test("a member change in a group, or for someone we never met, changes nothing", async () => {
  const db = newDb();
  await member(db, 902);
  await run(db, memberChange(902, "kicked", "group"));
  assert.equal(await flag(db, 902), false, "a group says nothing about the private chat");
  await run(db, memberChange(903, "kicked"));
  assert.equal(await getUser(db, 903), null, "no account is created just because someone blocked the bot");
});

test("a flagged user who writes to the bot again is unflagged, through the launcher gate", async () => {
  setAppUrl("https://app.example");
  const db = newDb();
  await member(db, 904);
  await updateUser(db, 904, { botBlocked: true });
  await run(db, hello(904));
  assert.equal(await flag(db, 904), false, "they can clearly receive again");
});

test("sessions are counted per surface, once per account, and the Android app is told apart by its header", async () => {
  const db = newDb();
  for (const id of [1, 2, 3]) await getOrCreateUser(db, id, id, "en", `U${id}`);
  const user = async (id: number) => (await getUser(db, id))!;
  await recordPresence(db, await user(1), "bot");
  await recordPresence(db, await user(2), "android");
  await recordPresence(db, await user(3), "miniapp");
  await recordPresence(db, await user(3), "android", Date.now() + 2 * 3_600_000); // a second, later session
  const day = new Date().toISOString().slice(0, 10);
  assert.deepEqual(await countSessionAccountsBySurface(db, day), { bot: 1, miniapp: 1, android: 2 });
  assert.deepEqual(await countSessionAccountsBySurface(db, "9999-01-01"), { bot: 0, miniapp: 0, android: 0 });

  const env = { DB: db, ALLOW_DEBUG_USER: "1", TELEGRAM_BOT_TOKEN: "1:t" } as unknown as Env;
  await getOrCreateUser(db, 4, 4, "en", "U4");
  const req = (headers: Record<string, string>) => new Request("https://trix.example/api/v2/me?debugUser=4", { headers });
  await miniAppUser(req({ "x-client": "native" }), new URL("https://trix.example/api/v2/me?debugUser=4"), env);
  assert.equal((await countSessionAccountsBySurface(db, day)).android, 3, "x-client: native and no Origin is the Android app");
  await getOrCreateUser(db, 5, 5, "en", "U5");
  await miniAppUser(req({ "x-client": "native", origin: "https://evil.example" }), new URL("https://trix.example/api/v2/me?debugUser=5"), env);
  assert.equal((await countSessionAccountsBySurface(db, day)).android, 3, "a page that sets the header is not the app");
  assert.equal((await countSessionAccountsBySurface(db, day)).miniapp, 2);
});

test("reach: Android installs, reachable Telegram chats, blocked ones, and app-only accounts", async () => {
  const db = newDb();
  await getOrCreateUser(db, 11, 11, "en", "Tg");
  await getOrCreateUser(db, 12, 12, "en", "Blocked");
  await getOrCreateUser(db, 13, 13, "en", "Both");
  await getOrCreateUser(db, 14, -14, "en", "AppOnly");
  await getOrCreateUser(db, 15, 15, "en", "NotOnboarded");
  await getOrCreateUser(db, 16, 16, "en", "Banned");
  for (const id of [11, 12, 13, 14, 16]) await updateUser(db, id, { onboarded: true });
  await updateUser(db, 12, { botBlocked: true });
  await updateUser(db, 16, { blocked: true });
  await registerPushDevice(db, 13, "tok-a", "android", "1.0");
  await registerPushDevice(db, 13, "tok-b", "android", "1.0"); // two phones, still one person
  await registerPushDevice(db, 14, "tok-c", "android", "1.0");
  await registerPushDevice(db, 11, "tok-i", "ios", "1.0");
  assert.deepEqual(await countReach(db), { android: 2, telegram: 2, blockedBot: 1, appOnly: 1 });
});

test("the owner report and the metrics feed carry the platform split", async () => {
  const db = newDb();
  await getOrCreateUser(db, 21, 21, "en", "Ann");
  await updateUser(db, 21, { onboarded: true });
  await registerPushDevice(db, 21, "tok", "android", "1.0");
  await recordPresence(db, (await getUser(db, 21))!, "android");
  const text = await orOverview(db, await loadOwnerSnapshot(db));
  assert.match(text, /Android app: <b>1<\/b> installed \(push\) · active 7d <b>1<\/b>/);
  assert.match(text, /Telegram bot: <b>1<\/b> reachable, <b>0<\/b> blocked it/);
  const metrics = await buildOwnerMetrics(db);
  assert.deepEqual(metrics.platforms.sessions7d, { bot: 0, miniapp: 0, android: 1 });
  assert.equal(metrics.platforms.reach.android, 1);
});

test("android report: builds in use, and what the app reported, crashes counted apart", async () => {
  const { recordError } = await import("../src/adapters/d1/v2AiTelemetry");
  const { androidVersionSpread } = await import("../src/adapters/d1/v2Push");
  const { androidErrorSummary } = await import("../src/adapters/d1/v2AiTelemetry");
  const { orErrors } = await import("../src/features/owner/ownerReport");
  const db = newDb();
  for (const id of [31, 32, 33]) await getOrCreateUser(db, id, id, "en", `U${id}`);
  await registerPushDevice(db, 31, "t1", "android", "1.4.0");
  await registerPushDevice(db, 32, "t2", "android", "1.4.0");
  await registerPushDevice(db, 33, "t3", "android", "1.3.0");
  await registerPushDevice(db, 33, "t4", "android", null);
  await registerPushDevice(db, 31, "t5", "ios", "9.9.9");
  assert.deepEqual((await androidVersionSpread(db)).map((v) => [v.version, v.devices, v.people]).sort(), [["1.3.0", 1, 1], ["1.4.0", 2, 2], ["unknown", 1, 1]]);

  await recordError(db, { userId: 31, kind: "native", errorType: "client_native", message: "Crash: NullPointerException: x" });
  await recordError(db, { userId: 32, kind: "native", errorType: "client_native", message: "IOException: timeout" });
  await recordError(db, { userId: 33, kind: "native", errorType: "client_native", message: "IOException: timeout" });
  await recordError(db, { userId: 31, kind: "webapp", errorType: "client_js", message: "not the app" });
  const sum = await androidErrorSummary(db, "2000-01-01T00:00:00Z");
  assert.deepEqual([sum.total, sum.crashes, sum.people], [3, 1, 3], "the web error is not counted");
  assert.deepEqual({ ...sum.top[0] }, { message: "IOException: timeout", n: 2, people: 2 });
  assert.equal((await androidErrorSummary(db, "2999-01-01T00:00:00Z")).total, 0);

  const text = await orErrors(db);
  assert.match(text, /Android app/);
  assert.match(text, /Reports 7d: <b>3<\/b> \(1 crash\) from <b>3<\/b> people/);
  assert.match(text, /2× IOException: timeout \(2 people\)/);
  assert.equal((await buildOwnerMetrics(db)).android.errors7d.total, 3);
});
