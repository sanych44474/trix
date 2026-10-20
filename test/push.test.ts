// Native-app push: the FCM HTTP v1 sender (service-account JWT -> OAuth token -> messages:send),
// the outbox routing an account with no Telegram chat to push, and device registration.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser } from "../src/adapters/d1/v2Users";
import { listPushTokens, registerPushDevice } from "../src/adapters/d1/v2Push";
import { sendPush } from "../src/adapters/fcm/fcm";
import { enqueueAndDeliver } from "../src/schedulerOutbox";
import { pushParts, telegramHtmlToPlain } from "../src/domain/plainText";
import { handlePushApi } from "../src/webapp/pushApi";
import type { Env } from "../src/types";

async function serviceAccount() {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"],
  ) as CryptoKeyPair;
  const der = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).toString("base64");
  const pem = `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----\n`;
  return JSON.stringify({ project_id: "hl-test", client_email: "fcm@hl-test.iam.gserviceaccount.com", private_key: pem });
}

/** Stub Google: the OAuth exchange and FCM send. `fcm` decides each send's HTTP outcome by token. */
function stubGoogle(fcm: (token: string) => Response) {
  const real = globalThis.fetch;
  const sent: Array<{ token: string; field: string; title: string; body: string }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://oauth2.googleapis.com/token") {
      const params = new URLSearchParams(String(init?.body));
      assert.equal(params.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
      assert.equal(params.get("assertion")?.split(".").length, 3, "a signed JWT");
      return Response.json({ access_token: "ya29.test", expires_in: 3600 });
    }
    if (url === "https://fcm.googleapis.com/v1/projects/hl-test/messages:send") {
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer ya29.test");
      const { message } = JSON.parse(String(init?.body)) as { message: { token?: string; fid?: string; notification: { title: string; body: string } } };
      const address = message.fid ?? message.token ?? "";
      sent.push({ token: address, field: message.fid ? "fid" : "token", ...message.notification });
      return fcm(address);
    }
    return real(input, init);
  }) as typeof fetch;
  return { sent, restore: () => { globalThis.fetch = real; } };
}

const TOKEN_A = "fcm-token-aaaaaaaaaaaaaaaaaaaaaaaa";
const TOKEN_B = "fcm-token-bbbbbbbbbbbbbbbbbbbbbbbb";
const unregistered = () => Response.json({ error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } }, { status: 404 });

test("telegramHtmlToPlain / pushParts", () => {
  assert.equal(telegramHtmlToPlain("<b>Leg day</b> &amp; core<br>3 &lt; 4"), "Leg day & core\n3 < 4");
  assert.deepEqual(pushParts("🏋️ <b>Time to train</b>\nSquat 3x5", "Hack Limits"), { title: "🏋️ Time to train", body: "Squat 3x5" });
  assert.deepEqual(pushParts("Just one line", "Hack Limits"), { title: "Hack Limits", body: "Just one line" });
});

test("sendPush: signs in with the service account, sends, and reports a dead token", async (t) => {
  const google = stubGoogle((tok) => (tok === TOKEN_A ? Response.json({ name: "projects/hl-test/messages/1" }) : unregistered()));
  t.after(google.restore);
  const env = { FCM_SERVICE_ACCOUNT: await serviceAccount() };
  assert.equal(await sendPush(env, { token: TOKEN_A }, { title: "T", body: "B" }), "sent");
  assert.equal(await sendPush(env, { token: TOKEN_B }, { title: "T", body: "B" }), "unregistered");
  assert.equal(await sendPush({ FCM_SERVICE_ACCOUNT: undefined }, { token: TOKEN_A }, { title: "T", body: "B" }), "failed", "not configured");
  assert.equal(await sendPush(env, { token: TOKEN_A, kind: "fid" }, { title: "T", body: "B" }), "sent");
  assert.equal(google.sent.at(-1)!.field, "fid", "an installation ID goes in message.fid, not message.token");
});

test("outbox: an account with no Telegram chat (chatId 0) gets the reminder by push; dead tokens are dropped", async (t) => {
  const google = stubGoogle((tok) => (tok === TOKEN_A ? Response.json({ name: "m" }) : unregistered()));
  t.after(google.restore);
  const db = newDb();
  await getOrCreateUser(db, 51, 51, "en", "AppOnly");
  await registerPushDevice(db, 51, TOKEN_A, "android", "1.0.0");
  await registerPushDevice(db, 51, TOKEN_B, "android", "1.0.0");
  const env = { DB: db, FCM_SERVICE_ACCOUNT: await serviceAccount() } as unknown as Env;
  const bot = { api: { sendMessage: async () => { throw new Error("must not touch Telegram"); } } } as never;

  const result = await enqueueAndDeliver(env, bot, { userId: 51, chatId: 0, kind: "reminder", idempotencyKey: "d1:train", text: "🏋️ <b>Time to train</b>\nSquat 3x5" });
  assert.equal(result, "sent");
  assert.deepEqual(google.sent.find((s) => s.token === TOKEN_A), { token: TOKEN_A, field: "token", title: "🏋️ Time to train", body: "Squat 3x5" });
  assert.deepEqual((await listPushTokens(db, 51)).map((t) => t.token), [TOKEN_A], "the uninstalled device's token is gone");
});

test("outbox: no Telegram chat and no device -> failed for good, not retried forever", async () => {
  const db = newDb();
  await getOrCreateUser(db, 52, 52, "en", "Nowhere");
  const env = { DB: db } as unknown as Env;
  const result = await enqueueAndDeliver(env, {} as never, { userId: 52, chatId: 0, kind: "reminder", idempotencyKey: "d1:x", text: "hi" });
  assert.equal(result, "failed");
});

test("push API: register, re-register moves the token, unregister only removes your own", async () => {
  const db = newDb();
  await getOrCreateUser(db, 61, 61, "en", "A");
  await getOrCreateUser(db, 62, 62, "en", "B");
  const env = { DB: db, ALLOW_DEBUG_USER: "1", TELEGRAM_BOT_TOKEN: "t" } as unknown as Env;
  const call = (user: number, method: string, body: unknown) => {
    const p = `/api/v2/push/devices?debugUser=${user}`;
    return handlePushApi(new Request(`https://x${p}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), new URL(`https://x${p}`), env);
  };
  assert.equal((await call(61, "POST", { token: TOKEN_A, platform: "android" }))!.status, 200);
  assert.equal((await call(61, "POST", { token: "x", platform: "android" }))!.status, 400);
  assert.equal((await call(61, "POST", { token: TOKEN_A, platform: "windows" }))!.status, 400);
  await call(62, "POST", { token: TOKEN_A, platform: "android" });
  assert.deepEqual([(await listPushTokens(db, 61)).length, (await listPushTokens(db, 62)).map((t) => t.token)], [0, [TOKEN_A]], "same phone, new account");
  await call(61, "DELETE", { token: TOKEN_A });
  assert.deepEqual((await listPushTokens(db, 62)).map((t) => t.token), [TOKEN_A], "someone else's token is not removable");
  await call(62, "DELETE", { token: TOKEN_A });
  assert.deepEqual(await listPushTokens(db, 62), []);
  await call(62, "POST", { token: TOKEN_B, platform: "android", kind: "fid" });
  assert.deepEqual((await listPushTokens(db, 62)).map((t) => [t.token, t.kind]), [[TOKEN_B, "fid"]], "the app says it registered an installation ID");
});
