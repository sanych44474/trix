// sendLong splits a long HTML reply into Telegram-sized messages (4096 chars max, each one valid
// HTML on its own, never empty).
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb, makeCtx } from "./harness";
import { sendLong } from "../src/adapters/telegram/context";

const TELEGRAM_MAX = 4096;

async function sendAll(text: string): Promise<string[]> {
  const { ctx, sent } = makeCtx(newDb(), { _id: 1, chatId: 1, lang: "en", session: { mode: "idle" } });
  await sendLong(ctx as never, text);
  return sent.map((s) => s.text);
}

test("sendLong: a short text is one message", async () => {
  assert.deepEqual(await sendAll("hello\nworld"), ["hello\nworld"]);
});

test("sendLong: a first line longer than the limit sends no empty message and no oversize one", async () => {
  const parts = await sendAll(`${"a".repeat(3900)}\ntail`);
  assert.ok(parts.length >= 2);
  for (const p of parts) {
    assert.ok(p.length > 0, "empty message");
    assert.ok(p.length <= TELEGRAM_MAX, `message of ${p.length} chars`);
  }
  assert.equal(parts.join("").replaceAll("\n", ""), `${"a".repeat(3900)}tail`); // nothing lost
});

test("sendLong: a single line longer than Telegram's cap is hard-split", async () => {
  const parts = await sendAll("b".repeat(9000));
  assert.ok(parts.length >= 3);
  for (const p of parts) assert.ok(p.length <= TELEGRAM_MAX, `message of ${p.length} chars`);
  assert.equal(parts.join(""), "b".repeat(9000));
});

test("sendLong: a <pre> block cut between messages is closed and reopened, so each part parses", async () => {
  const rows = Array.from({ length: 120 }, (_, i) => `client ${String(i).padStart(3, "0")}  ${"x".repeat(40)}`);
  const parts = await sendAll(`<b>Clients</b>\n<pre>${rows.join("\n")}</pre>\nend`);
  assert.ok(parts.length >= 2);
  for (const p of parts) {
    assert.ok(p.length <= TELEGRAM_MAX);
    assert.equal((p.match(/<pre>/g) ?? []).length, (p.match(/<\/pre>/g) ?? []).length, `unbalanced <pre> in: ${p.slice(0, 60)}…`);
  }
  for (const r of rows) assert.ok(parts.some((p) => p.includes(r)), `lost row ${r}`);
});
