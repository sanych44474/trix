// Onboarding happens in the Mini App: the bot hands out one button, and until the questionnaire is
// done an athlete gets that button back for anything else instead of a menu.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { newDb, makeCtx, type Sent } from "./harness";
import { getOrCreateUser, getUser, updateUser } from "../src/adapters/d1/v2Users";
import { applyTrainer, approveTrainer, listProspects } from "../src/adapters/d1/v2Trainer";
import { handleProspectName, joinByProspectCode, sharePromptKb, startProspectInvite } from "../src/features/trainer/trainer";
import { onboardingGate, onboardingUrlFromEnv } from "../src/bot/onboardingApp";
import { setAppUrl } from "../src/bot/appLinks";
import { cmdStart } from "../src/bot/start";
import { t } from "../src/locales/i18n";
import type { UserDoc } from "../src/types";

const APP = "https://trix.example";
afterEach(() => setAppUrl(undefined));

/** URLs of web_app buttons in a sent message. */
const webAppUrls = (s: Sent) =>
  ((s.markup as { inline_keyboard?: Array<Array<{ web_app?: { url: string } }>> })?.inline_keyboard ?? [])
    .flat().map((b) => b.web_app?.url).filter(Boolean) as string[];

async function solo(db: ReturnType<typeof newDb>, id = 500, patch: Partial<UserDoc> = {}) {
  await getOrCreateUser(db, id, id, "uk", "Valeria");
  if (Object.keys(patch).length) await updateUser(db, id, patch);
  return (await getUser(db, id)) as UserDoc;
}

test("onboardingUrlFromEnv: points at the v2 app's onboarding view, nothing without WORKER_URL", () => {
  assert.equal(onboardingUrlFromEnv({}), undefined);
  assert.match(onboardingUrlFromEnv({ WORKER_URL: APP, V2_APP_ENABLED: "1" }) ?? "", /^https:\/\/trix\.example\/app-v2\?v=.+&view=onboarding$/);
});

test("gate: a not-onboarded athlete tapping a menu button gets the questionnaire button, not the menu", async () => {
  setAppUrl(APP, "/app-v2");
  const db = newDb();
  const { ctx, sent } = makeCtx(db, (await solo(db)) as never);
  Object.assign(ctx, { callbackQuery: { data: "menu:today" } });
  assert.equal(await onboardingGate(ctx as never), true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, t("uk", "ob_app_reminder"));
  assert.match(webAppUrls(sent[0])[0] ?? "", /view=onboarding/);
});

test("gate: reply-keyboard text and voice-free messages are gated too; /start and support are not", async () => {
  setAppUrl(APP, "/app-v2");
  const db = newDb();
  const user = await solo(db);
  for (const [text, gated] of [["📅 Сьогодні", true], ["/start", false], ["/support", false], ["/today", true]] as const) {
    const { ctx } = makeCtx(db, user as never);
    Object.assign(ctx, { message: { text } });
    assert.equal(await onboardingGate(ctx as never), gated, text);
  }
});

test("gate: lets through language, role, find-trainer and request taps, and the trainer-code step", async () => {
  setAppUrl(APP, "/app-v2");
  const db = newDb();
  const user = await solo(db);
  for (const data of ["lang:en", "role:find", "find:code", "req:cancel:3"]) {
    const { ctx } = makeCtx(db, user as never);
    Object.assign(ctx, { callbackQuery: { data } });
    assert.equal(await onboardingGate(ctx as never), false, data);
  }
  const { ctx } = makeCtx(db, { ...user, session: { mode: "client_code" } } as never);
  Object.assign(ctx, { message: { text: "ABC123" } });
  assert.equal(await onboardingGate(ctx as never), false);
});

test("gate: never applies to onboarded athletes, trainers, a pending plan, or without the app", async () => {
  const db = newDb();
  const base = await solo(db);
  const cases: Array<[string, Record<string, unknown>, boolean]> = [
    ["onboarded", { ...base, onboarded: true }, true],
    ["trainer", { ...base, role: "trainer" }, true],
    ["plan pending", { ...base, session: { mode: "plan_pending" } }, true],
    ["no app url", base as never, false],
  ];
  for (const [name, user, withApp] of cases) {
    setAppUrl(withApp ? APP : undefined, "/app-v2");
    const { ctx } = makeCtx(db, user);
    Object.assign(ctx, { callbackQuery: { data: "menu:today" } });
    assert.equal(await onboardingGate(ctx as never), false, name);
  }
});

test("/start for a brand-new user: one welcome with the app button first and one choice per row", async () => {
  setAppUrl(APP, "/app-v2");
  const db = newDb();
  const { ctx, sent } = makeCtx(db, (await solo(db)) as never);
  await cmdStart(ctx as never);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, new RegExp(t("uk", "ob_app_welcome").slice(0, 20).replace(/[*]/g, "\\*")));
  const rows = (sent[0].markup as { inline_keyboard: unknown[][] }).inline_keyboard;
  assert.ok(rows.every((row) => row.length === 1), "every button on its own row");
  assert.equal(webAppUrls(sent[0]).length, 1);
});

test("/start for a trainer's client who has not finished: the questionnaire button, no menu", async () => {
  setAppUrl(APP, "/app-v2");
  const db = newDb();
  await getOrCreateUser(db, 300, 300, "uk", "Max");
  await updateUser(db, 300, { role: "trainer" });
  const { ctx, sent } = makeCtx(db, (await solo(db, 501, { role: "client" })) as never);
  await cmdStart(ctx as never);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, new RegExp(t("uk", "ob_app_prompt").slice(0, 15)));
  assert.equal(webAppUrls(sent[0]).length, 1);
});

test("trainer invite for a new user: 'connected' + one questionnaire button, no sharing prompt or chat question", async () => {
  setAppUrl(APP, "/app-v2");
  const db = newDb();
  const trainer = (await getOrCreateUser(db, 300, 300, "uk", "Max")) as unknown as UserDoc;
  await updateUser(db, 300, { role: "trainer" });
  await applyTrainer(db, 300, { name: "Max" });
  await approveTrainer(db, 300, "code300");
  const { ctx: tctx } = makeCtx(db, trainer as never);
  await startProspectInvite(tctx as never);
  await handleProspectName(tctx as never, "Valeria");
  const code = (await listProspects(db, 300))[0].code;

  const { ctx, sent } = makeCtx(db, (await solo(db, 502)) as never);
  await joinByProspectCode(ctx as never, code);
  const mine = sent.filter((s) => s.to === "self");
  assert.equal(mine.length, 2, mine.map((s) => s.text).join(" | "));
  assert.match(mine[1].text, new RegExp(t("uk", "ob_app_prompt").slice(0, 15)));
  assert.equal(webAppUrls(mine[1]).length, 1);
  assert.ok(!mine.some((s) => s.text.includes(t("uk", "share_prompt_new").slice(0, 20))));
  assert.equal((await getUser(db, 502))?.session.mode, "onboarding");
});

test("sharing prompt (already-onboarded transfer): one button per row so labels are not cut", () => {
  const rows = sharePromptKb("uk").inline_keyboard;
  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => row.length === 1));
});
