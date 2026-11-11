// An account created by email or Google sign-in has no Telegram chat. Both sign-in routes build
// it from the same statements (adapters/d1/v2AppAccount.ts), so the shape cannot drift between them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { newAppAccount } from "../src/adapters/d1/v2AppAccount";
import { getUser } from "../src/adapters/d1/v2Users";

test("newAppAccount: the batch creates a loadable solo account that Telegram delivery skips", async () => {
  const db = newDb();
  const { accountId, statements } = newAppAccount(db as never, "uk", "2026-11-10T00:00:00.000Z");
  assert.equal(statements.length, 4);
  await (db as unknown as D1Database).batch(statements);

  assert.ok(accountId <= -1_000_000_000, "negative, so it can never collide with a Telegram id");
  const account = db.raw.prepare("SELECT chatId, role, status, botBlocked FROM v2_accounts WHERE id = ?").get(accountId) as { chatId: number; role: string; status: string; botBlocked: number };
  assert.equal(account.role, "solo");
  assert.equal(account.status, "active");
  assert.equal(account.botBlocked, 1, "no chat to deliver to");
  assert.ok(account.chatId <= -4_000_000_000_000_000, "a synthetic chat id outside Telegram's range");
  const user = await getUser(db as never, accountId);
  assert.equal(user?.lang, "uk");
  assert.equal(user?.onboarded, false);
});

test("newAppAccount: each call draws a new id", () => {
  const db = newDb();
  const ids = new Set(Array.from({ length: 20 }, () => newAppAccount(db as never, "en", "2026-11-10T00:00:00.000Z").accountId));
  assert.equal(ids.size, 20);
});
