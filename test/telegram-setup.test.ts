// The Worker's own Telegram setup (src/telegramSetup.ts): which Bot API calls it makes, and that
// it runs once per version, retrying after a failure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getSetting, setOwnerChatId } from "../src/adapters/d1/v2Admin";
import { ensureTelegramSetup, PROFILE, setupCalls, TELEGRAM_SETUP_VERSION } from "../src/telegramSetup";

test("setup calls: /start only, both languages, menu button to the Mini App", () => {
  const calls = setupCalls("https://trix.example/app-v2");
  assert.deepEqual(calls.filter((c) => c.method === "setMyCommands").map((c) => c.body.commands), [
    [{ command: "start", description: "Open trix" }],
    [{ command: "start", description: "Відкрити trix" }],
  ]);
  assert.deepEqual(calls.at(-1), { method: "setChatMenuButton", body: { menu_button: { type: "web_app", text: "trix", web_app: { url: "https://trix.example/app-v2" } } } });
  assert.equal(setupCalls("u", 42).filter((c) => (c.body.scope as { chat_id?: number } | undefined)?.chat_id === 42).length, 2, "the owner's chat scope is reset too");
});

test("profile texts fit Telegram's limits", () => {
  for (const p of Object.values(PROFILE)) {
    assert.ok(p.description.length <= 512);
    assert.ok(p.short.length <= 120);
  }
});

async function withTelegram<T>(ok: boolean, run: (methods: string[]) => Promise<T>): Promise<T> {
  const methods: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    const u = new URL(String(url));
    if (u.hostname === "api.telegram.org") methods.push(u.pathname.split("/").at(-1) ?? "");
    return new Response(JSON.stringify(ok ? { ok: true } : { ok: false, description: "nope" }), { status: 200 });
  }) as unknown as typeof fetch;
  try { return await run(methods); } finally { globalThis.fetch = realFetch; }
}

test("ensureTelegramSetup: applies once per version, retries after a failure", async () => {
  const db = newDb();
  await setOwnerChatId(db, 77);
  const env = { DB: db, TELEGRAM_BOT_TOKEN: "t", WORKER_URL: "https://trix.example", V2_APP_ENABLED: "1" } as never;

  await withTelegram(false, async (methods) => {
    await ensureTelegramSetup(env);
    assert.ok(methods.length > 0);
  });
  assert.equal(await getSetting(db, "telegram_setup_version"), "failed", "a failed run is retried next cron");

  await withTelegram(true, async (methods) => {
    await ensureTelegramSetup(env);
    assert.equal(methods.length, 9);
    await ensureTelegramSetup(env);
    assert.equal(methods.length, 9, "nothing more once this version is applied");
  });
  assert.equal(await getSetting(db, "telegram_setup_version"), TELEGRAM_SETUP_VERSION);
});
