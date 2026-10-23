// Every send to another person goes through the notification outbox (notify.ts), and a name or
// answer reaches Telegram escaped exactly once. Covers: an app-only recipient (chatId <= 0) goes to
// push through the outbox; a repeated event is delivered once (dedup by key); a "&" in a name is
// escaped once, not "&amp;amp;"; the onboarding nudge is one use case shared by the bot and the
// Mini App.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb, makeCtx } from "./harness";
import { getOrCreateUser, getUser } from "../src/adapters/d1/v2Users";
import { linkClient } from "../src/adapters/d1/v2Trainer";
import { registerPushDevice } from "../src/adapters/d1/v2Push";
import { notifyTrainerOfClient } from "../src/features/trainer/trainer";
import { deliverTrainerAnswer } from "../src/features/trainer/trainerComms";
import { pingClientIntake } from "../src/features/trainer/clientCard";
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

test("an app-only client (chatId 0) gets a trainer's answer through the outbox, by push, never Telegram", async () => {
  const db = newDb();
  const trainer = await user(db, 900, 900, "Coach");
  const client = await user(db, 901, 0, "AppOnly");
  await linkClient(db, 901, 900);
  await registerPushDevice(db, 901, "fcm-token-aaaaaaaaaaaaaaaaaaaaaaaa", "android", "1.0.0");
  const { ctx, sent } = makeCtx(db, trainer as unknown as Record<string, unknown>);

  await deliverTrainerAnswer(ctx as never, client._id, "Good, keep going", 77);

  assert.equal(sent.filter((s) => s.to === 0).length, 0, "nothing addressed to a chat id of 0");
  const rows = (await outbox(db, "trainer_answer")).results;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].chatId, 0);
  assert.equal(rows[0].status, "failed");
  assert.equal(rows[0].lastError, "push_failed", "the push path ran (no FCM configured in this test, so it failed for good)");
});

test("a repeated event is delivered once: the same answer id is deduplicated by key", async () => {
  const db = newDb();
  const trainer = await user(db, 910, 910, "Coach");
  const client = await user(db, 911, 911, "Maxim");
  await linkClient(db, 911, 910);
  const { ctx, sent } = makeCtx(db, trainer as unknown as Record<string, unknown>);

  await deliverTrainerAnswer(ctx as never, client._id, "Rest day tomorrow", 5);
  await deliverTrainerAnswer(ctx as never, client._id, "Rest day tomorrow", 5);

  assert.equal(sent.filter((s) => s.to === 911).length, 1, "a webhook retry does not message the client twice");
  assert.equal((await outbox(db, "trainer_answer")).results.length, 1);
});

test("a name with '&' reaches the chat escaped once, not as '&amp;amp;'", async () => {
  const db = newDb();
  const trainer = await user(db, 920, 920, "Coach");
  const client = await user(db, 921, 921, "Tom & Jerry");
  const { ctx, sent } = makeCtx(db, trainer as unknown as Record<string, unknown>);

  await notifyTrainerOfClient(ctx as never, trainer, client, false);

  const text = sent.find((s) => s.to === 920)?.text ?? "";
  assert.equal(text, "👤 <b>Tom &amp; Jerry</b> joined via your link.");
});

test("an answer containing '<' and '&' is escaped once in the client's chat", async () => {
  const db = newDb();
  const trainer = await user(db, 930, 930, "Coach");
  const client = await user(db, 931, 931, "Ann");
  await linkClient(db, 931, 930);
  const { ctx, sent } = makeCtx(db, trainer as unknown as Record<string, unknown>);

  await deliverTrainerAnswer(ctx as never, client._id, "squats < 5 & rest", 9);

  const text = sent.find((s) => s.to === 931)?.text ?? "";
  assert.match(text, /squats &lt; 5 &amp; rest/);
  assert.doesNotMatch(text, /&amp;amp;/);
});

test("the onboarding nudge is one use case: the bot's intake ping and the Mini App's nudge share one outbox key", async () => {
  const db = newDb();
  const trainer = await user(db, 940, 940, "Coach");
  const client = { ...(await user(db, 941, 0, "Lena")), chatId: 0 } as UserDoc;
  const { ctx } = makeCtx(db, trainer as unknown as Record<string, unknown>);

  await pingClientIntake(ctx as never, client, 941, "Lena", "en");
  const fromWebapp = await nudgeOnboarding(ctx.env as never, client, t("en", "cc_intv_remind_text"));
  assert.equal(fromWebapp.sent, false, "same person, same step: the bot already queued it, so the webapp call is a duplicate");

  const rows = (await outbox(db, "onboarding_nudge")).results;
  assert.equal(rows.length, 1, "one nudge row, not one per entry point");
  assert.match(JSON.parse(rows[0].payload).text, /\(1\/\d+\)/, "the wizard resumes at the first unanswered step");
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
