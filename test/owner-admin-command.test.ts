// `/admin <secret>` in the bot. The secret is also the HTTP /admin/* secret, so the command must not
// tell a wrong guess from a right one once an owner exists, and it must be throttled per user (the
// HTTP surface is throttled per IP; the bot path had no limit at all).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCtx, newDb } from "./harness";
import { getOrCreateUser } from "../src/adapters/d1/v2Users";
import { getOwnerChatId } from "../src/adapters/d1/v2Admin";
import { cmdAdmin } from "../src/bot/owner";
import { t } from "../src/locales/i18n";

const SECRET = "owner-secret-for-tests-0123456789";
const OWNER = 1;
const OTHER = 2;

async function setup() {
  const db = newDb();
  await getOrCreateUser(db, OWNER, OWNER, "uk", "Owner");
  await getOrCreateUser(db, OTHER, OTHER, "uk", "Other");
  return db;
}

function adminCtx(db: ReturnType<typeof newDb>, userId: number, env: Record<string, unknown> = {}) {
  const user = { _id: userId, chatId: userId, lang: "uk", session: { mode: "idle" }, profile: {} };
  const made = makeCtx(db, user as never, { ADMIN_SECRET: SECRET, ...env });
  let deleted = 0;
  Object.assign(made.ctx, { deleteMessage: async () => { deleted++; return true; } });
  return { ...made, deletedCount: () => deleted };
}

test("admin: after a claim, a right secret from another chat gets the same reply as a wrong one", async () => {
  const db = await setup();
  const claim = adminCtx(db, OWNER);
  await cmdAdmin(claim.ctx as never, SECRET);
  assert.equal(claim.sent[0].text, t("uk", "admin_claimed"));

  const wrong = adminCtx(db, OTHER);
  await cmdAdmin(wrong.ctx as never, "not-the-secret");
  const right = adminCtx(db, OTHER);
  await cmdAdmin(right.ctx as never, SECRET);

  assert.equal(wrong.sent[0].text, t("uk", "admin_bad"));
  assert.equal(right.sent[0].text, wrong.sent[0].text, "an owner existing must not confirm the secret");
  assert.equal(await getOwnerChatId(db), OWNER, "the claim is not taken over");
});

test("admin: the per-user throttle blocks a guess before the secret is compared", async () => {
  const db = await setup();
  const keys: string[] = [];
  const blocked = adminCtx(db, OTHER, { RL_ADMIN: { limit: async ({ key }: { key: string }) => { keys.push(key); return { success: false }; } } });
  await cmdAdmin(blocked.ctx as never, SECRET);
  assert.equal(blocked.sent[0].text, t("uk", "admin_bad"), "over the limit a right secret is refused too");
  assert.deepEqual(keys, [`bot:${OTHER}`], "the counter is keyed by user");
  assert.equal(await getOwnerChatId(db), undefined, "nothing was claimed");

  const open = adminCtx(db, OWNER, { RL_ADMIN: { limit: async () => ({ success: true }) } });
  await cmdAdmin(open.ctx as never, SECRET);
  assert.equal(open.sent[0].text, t("uk", "admin_claimed"), "under the limit the command works");
});

test("admin: the command message is deleted whatever the outcome, so the secret leaves the chat", async () => {
  const db = await setup();
  const wrong = adminCtx(db, OTHER);
  await cmdAdmin(wrong.ctx as never, "nope");
  const throttled = adminCtx(db, OTHER, { RL_ADMIN: { limit: async () => ({ success: false }) } });
  await cmdAdmin(throttled.ctx as never, SECRET);
  assert.equal(wrong.deletedCount(), 1);
  assert.equal(throttled.deletedCount(), 1);
});
