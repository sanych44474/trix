// Every send to another person goes through the notification outbox (notify.ts), and a name or
// answer reaches Telegram escaped exactly once. Covers: an app-only recipient (chatId <= 0) goes to
// push through the outbox; a repeated event is delivered once (dedup by key); a "&" in a name is
// escaped once, not "&amp;amp;"; the onboarding nudge is one use case shared by the bot and the
// Mini App.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb, makeCtx } from "./harness";
import { getOrCreateUser, getUser } from "../src/adapters/d1/v2Users";
import { notifyTrainerOfClient } from "../src/features/trainer/trainer";
import { nudgeOnboarding } from "../src/features/onboarding/nudge";
import { t } from "../src/locales/i18n";
import type { UserDoc } from "../src/types";

type Db = ReturnType<typeof newDb>;

async function user(db: Db, id: number, chatId: number, name: string): Promise<UserDoc> {
  await getOrCreateUser(db, id, chatId, "en", name);
  return (await getUser(db, id)) as UserDoc;
}

async function outbox(db: Db, kind: string) {
  return db
    .prepare("SELECT accountId, chatId, status, lastError, payload FROM v2_notifications WHERE kind = ? ORDER BY id")
    .bind(kind)
    .all<{ accountId: number; chatId: number; status: string; lastError: string | null; payload: string }>();
}

test("a name with '&' reaches the chat escaped once, not as '&amp;amp;'", async () => {
  const db = newDb();
  const trainer = await user(db, 920, 920, "Coach");
  const client = await user(db, 921, 921, "Tom & Jerry");
  const { ctx, sent } = makeCtx(db, trainer as unknown as Record<string, unknown>);

  await notifyTrainerOfClient(ctx as never, trainer, client, false);

  const text = sent.find((s) => s.to === 920)?.text ?? "";
  assert.equal(text, "👤 <b>Tom &amp; Jerry</b> joined via your link.");
});

test("the onboarding nudge is deduplicated: the same person and step is queued once", async () => {
  const db = newDb();
  const client = { ...(await user(db, 941, 0, "Lena")), chatId: 0 } as UserDoc;
  const env = { DB: db, TELEGRAM_BOT_TOKEN: "test" };
  const first = await nudgeOnboarding(env as never, client, t("en", "cc_intv_remind_text"));
  const again = await nudgeOnboarding(env as never, client, t("en", "cc_intv_remind_text"));
  assert.equal(again.sent, false, "a second tap on Remind is a duplicate");
  assert.notEqual(first, again);
  const rows = (await outbox(db, "onboarding_nudge")).results;
  assert.equal(rows.length, 1, "one nudge row, not one per tap");
});
test("the onboarding nudge sends the Mini App link when the app is configured", async () => {
  const db = newDb();
  const client = { ...(await user(db, 950, 0, "Ivo")), chatId: 0 } as UserDoc;
  const env = { DB: db, TELEGRAM_BOT_TOKEN: "test", WORKER_URL: "https://app.example.test", V2_APP_ENABLED: "1" };

  // No push device is registered, so the outbox records the row as failed; the payload is what matters here.
  await nudgeOnboarding(env as never, client, "Please finish onboarding.");

  const payload = JSON.parse((await outbox(db, "onboarding_nudge")).results[0].payload) as { text: string; extra: { reply_markup: { inline_keyboard: { web_app?: { url: string } }[][] } } };
  assert.match(payload.text, /Please finish onboarding\./);
  assert.match(payload.extra.reply_markup.inline_keyboard[0][0].web_app?.url ?? "", /^https:\/\/app\.example\.test\/app-v2\?/);
});
