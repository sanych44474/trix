// Payments in the retired chat (ADR-0012): Telegram's rules for bots that take payments require a
// /paysupport command, so it must reach its handler for everyone, through the launcher gate.
// /support opens the app, where the donation is made. Driven through createBot() so the real gate
// and router decide, as in production.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Update } from "grammy/types";
import { newDb } from "./harness";
import { getOrCreateUser, updateUser } from "../src/adapters/d1/v2Users";
import { setOwnerChatId } from "../src/adapters/d1/v2Admin";
import { createBot } from "../src/bot/router";
import { setAppUrl } from "../src/notify/appLinks";
import { t } from "../src/locales/i18n";
import type { Env } from "../src/types";

afterEach(() => setAppUrl(undefined));

interface Call { method: string; payload: Record<string, unknown> }

/** Runs one update through the real bot and returns the Bot API calls it made. */
async function run(db: ReturnType<typeof newDb>, update: Omit<Update, "update_id">): Promise<Call[]> {
  const env = { DB: db, TELEGRAM_BOT_TOKEN: "1:test", WORKER_URL: "https://trix.example", V2_APP_ENABLED: "1", BOT_ID: "1", BOT_USERNAME: "trix_test_bot" } as unknown as Env;
  const bot = createBot(env);
  const calls: Call[] = [];
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    return { ok: true, result: true } as never;
  });
  await bot.handleUpdate({ update_id: 1, ...update } as Update);
  return calls;
}

const command = (id: number, text: string): Omit<Update, "update_id"> => ({
  message: {
    message_id: 1, date: 0, text,
    chat: { id, type: "private", first_name: "Olena" },
    from: { id, is_bot: false, first_name: "Olena", language_code: "uk" },
    entities: [{ type: "bot_command", offset: 0, length: text.length }],
  },
});

const sentTexts = (calls: Call[]) => calls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload.text));
const hasAppButton = (calls: Call[]) => calls.some((c) => JSON.stringify(c.payload.reply_markup ?? {}).includes("web_app"));

async function athlete(db: ReturnType<typeof newDb>, id: number) {
  await setOwnerChatId(db, 1); // someone else is the owner
  await getOrCreateUser(db, id, id, "uk", "Olena");
  await updateUser(db, id, { onboarded: true, profile: { name: "Olena", chatRetired: true } });
}

test("/paysupport from a non-owner reaches its handler through the gate, not the Open-app button", async () => {
  const db = newDb();
  await athlete(db, 801);
  const calls = await run(db, command(801, "/paysupport"));
  assert.deepEqual(sentTexts(calls), [t("uk", "support_paysupport")]);
  assert.equal(hasAppButton(calls), false, "no launcher");
});

test("/support from a non-owner still opens the app's More screen, where donations are made", async () => {
  const db = newDb();
  await athlete(db, 802);
  const calls = await run(db, command(802, "/support"));
  assert.deepEqual(sentTexts(calls), [t("uk", "launch_text")]);
  assert.match(JSON.stringify(calls[0]!.payload.reply_markup), /view=more/);
});

test("a declined pre-checkout from a non-owner is answered through the gate and points to the app", async () => {
  const db = newDb();
  await athlete(db, 803);
  const calls = await run(db, {
    pre_checkout_query: {
      id: "q1", currency: "XTR", total_amount: 99, invoice_payload: "support:99",
      from: { id: 803, is_bot: false, first_name: "Olena", language_code: "uk" },
    },
  });
  const answer = calls.find((c) => c.method === "answerPreCheckoutQuery");
  assert.equal(answer?.payload.ok, false);
  assert.equal(answer?.payload.error_message, t("uk", "support_declined"));
  for (const lang of ["uk", "en"] as const) {
    assert.doesNotMatch(t(lang, "support_declined"), /\/support/, `${lang}: /support only opens the app`);
  }
});
