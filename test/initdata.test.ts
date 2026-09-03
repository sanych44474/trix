import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { validateInitData } from "../src/webapp/initData";

const TOKEN = "12345:TEST_TOKEN";

/** Forge initData the way Telegram signs it (double HMAC over the sorted data-check-string). */
function forge(fields: Record<string, string>): string {
  const dcs = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(TOKEN).digest();
  const hash = createHmac("sha256", secret).update(dcs).digest("hex");
  const p = new URLSearchParams(fields);
  p.set("hash", hash);
  return p.toString();
}

const NOW = 1_800_000_000_000; // fixed clock for determinism
const fresh = String(Math.floor(NOW / 1000) - 60);

test("validateInitData: accepts a correctly signed, fresh payload", async () => {
  const initData = forge({ auth_date: fresh, user: JSON.stringify({ id: 42, first_name: "A" }) });
  const res = await validateInitData(initData, TOKEN, 86_400, NOW);
  assert.deepEqual(res, { userId: 42 });
});

test("validateInitData: rejects a tampered hash", async () => {
  const initData = forge({ auth_date: fresh, user: JSON.stringify({ id: 42 }) });
  const bad = initData.replace(/hash=\w{6}/, "hash=000000");
  assert.equal(await validateInitData(bad, TOKEN, 86_400, NOW), null);
});

test("validateInitData: rejects a payload signed for another bot token", async () => {
  const initData = forge({ auth_date: fresh, user: JSON.stringify({ id: 42 }) });
  assert.equal(await validateInitData(initData, "999:OTHER", 86_400, NOW), null);
});

test("validateInitData: rejects stale auth_date", async () => {
  const old = String(Math.floor(NOW / 1000) - 100_000);
  const initData = forge({ auth_date: old, user: JSON.stringify({ id: 42 }) });
  assert.equal(await validateInitData(initData, TOKEN, 86_400, NOW), null);
});

test("validateInitData: rejects missing hash or missing user", async () => {
  assert.equal(await validateInitData("auth_date=1&user=%7B%22id%22%3A1%7D", TOKEN, 86_400, NOW), null);
  const noUser = forge({ auth_date: fresh });
  assert.equal(await validateInitData(noUser, TOKEN, 86_400, NOW), null);
});
