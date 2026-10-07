// The chat is retired: the bot answers with one Open-app button, deep-linked where it can, and the
// questionnaire is the app's first screen for a new athlete.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { newDb, makeCtx, type Sent } from "./harness";
import { getOrCreateUser, getUser, updateUser } from "../src/adapters/d1/v2Users";
import { applyTrainer, approveTrainer, listProspects } from "../src/adapters/d1/v2Trainer";
import { handleProspectName, joinByProspectCode, sharePromptKb, startProspectInvite } from "../src/features/trainer/trainer";
import { onboardingUrlFromEnv } from "../src/bot/onboardingApp";
import { launcherGate, viewForCallback, viewForCommand } from "../src/bot/launcher";
import { setOwnerChatId } from "../src/adapters/d1/v2Admin";
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

test("launcher: a tap on an old button opens the matching screen; the first answer also removes the keyboard", async () => {
  setAppUrl(APP, "/app-v2");
  const db = newDb();
  const user = await solo(db, 510, { onboarded: true });
  const { ctx, sent } = makeCtx(db, user as never);
  Object.assign(ctx, { callbackQuery: { data: "menu:today" } });
  assert.equal(await launcherGate(ctx as never), true);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0].markup, { remove_keyboard: true });
  assert.match(webAppUrls(sent[1])[0] ?? "", /view=today$/);
  // Second time: no notice, just the button.
  const again = makeCtx(db, (await getUser(db, 510)) as never);
  Object.assign(again.ctx, { message: { text: "/plan" } });
  assert.equal(await launcherGate(again.ctx as never), true);
  assert.equal(again.sent.length, 1);
  assert.match(webAppUrls(again.sent[0])[0] ?? "", /view=plan$/);
});

test("launcher: a new athlete is sent to the questionnaire whatever they type", async () => {
  setAppUrl(APP, "/app-v2");
  const db = newDb();
  const { ctx, sent } = makeCtx(db, (await solo(db, 511)) as never);
  Object.assign(ctx, { message: { text: "привіт" } });
  assert.equal(await launcherGate(ctx as never), true);
  assert.match(webAppUrls(sent.at(-1)!)[0] ?? "", /view=onboarding$/);
});

test("launcher: lets through trainer/buddy deep links, payments, the owner, groups, and runs nothing without the app", async () => {
  const db = newDb();
  const user = await solo(db, 512, { onboarded: true });
  const cases: Array<[string, Record<string, unknown>, Record<string, unknown>, boolean]> = [
    ["trainer link", user as never, { message: { text: "/start tr_abc" } }, true],
    ["buddy link", user as never, { message: { text: "/start buddy_9" } }, true],
    ["payment", user as never, { message: { successful_payment: {} } }, true],
    ["group", user as never, { message: { text: "hi" }, chat: { id: -1, type: "group" } }, true],
    ["no app", user as never, { message: { text: "hi" } }, false],
  ];
  for (const [name, u, extra, withApp] of cases) {
    setAppUrl(withApp ? APP : undefined, "/app-v2");
    const { ctx } = makeCtx(db, u);
    Object.assign(ctx, extra);
    assert.equal(await launcherGate(ctx as never), false, name);
  }
  setAppUrl(APP, "/app-v2");
  await setOwnerChatId(db, 512);
  const { ctx } = makeCtx(db, user as never);
  Object.assign(ctx, { message: { text: "/announce hi" } });
  assert.equal(await launcherGate(ctx as never), false, "owner");
});

test("launcher: old commands and buttons map to the screens that replaced them", () => {
  assert.equal(viewForCommand("nutrition"), "fuel");
  assert.equal(viewForCommand("records"), "progress");
  assert.equal(viewForCommand("clients"), "role");
  assert.equal(viewForCommand("nonsense"), undefined);
  assert.equal(viewForCallback("set:hour"), "settings");
  assert.equal(viewForCallback("menu:settings"), "settings");
  assert.equal(viewForCallback("gl:save"), "train");
  assert.equal(viewForCallback("req:accept:5"), "role");
});

test("/start for a brand-new user: the welcome with one Start button that opens the questionnaire", async () => {
  setAppUrl(APP, "/app-v2");
  const db = newDb();
  const { ctx, sent } = makeCtx(db, (await solo(db, 513)) as never);
  await cmdStart(ctx as never);
  const last = sent.at(-1)!;
  assert.match(last.text, /trix/);
  assert.equal(webAppUrls(last).length, 1);
  assert.match(webAppUrls(last)[0], /view=onboarding$/);
});
