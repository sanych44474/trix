// Google sign-in: a real RS256-signed ID token checked against a stubbed Google key set. Android
// Credential Manager tokens carry the Web client ID in `aud` and the Android client ID in `azp`;
// that shape must sign in, and a token for another audience or nonce must not.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { handleProviderAuth } from "../src/webapp/providerAuth";
import type { Env } from "../src/types";

const origin = "https://trix.example";
const WEB_CLIENT = "123-web.apps.googleusercontent.com";
const ANDROID_CLIENT = "123-android.apps.googleusercontent.com";

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const b64json = (value: unknown) => b64url(new TextEncoder().encode(JSON.stringify(value)));

async function googleKeys() {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"],
  ) as CryptoKeyPair;
  const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "k1", use: "sig", alg: "RS256" };
  const sign = async (claims: Record<string, unknown>) => {
    const body = `${b64json({ alg: "RS256", kid: "k1", typ: "JWT" })}.${b64json(claims)}`;
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(body));
    return `${body}.${b64url(new Uint8Array(sig))}`;
  };
  return { jwk, sign };
}

function post(path: string, body: unknown) {
  return new Request(`${origin}${path}`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
}

test("Google sign-in: an Android Credential Manager token (azp = Android client) signs in; wrong audience or nonce does not", async (t) => {
  const { jwk, sign } = await googleKeys();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) =>
    String(input).startsWith("https://www.googleapis.com/oauth2/v3/certs")
      ? Response.json({ keys: [jwk] }, { headers: { "cache-control": "max-age=60" } })
      : realFetch(input)) as typeof fetch;
  t.after(() => { globalThis.fetch = realFetch; });

  const db = newDb();
  const env = { DB: db, GOOGLE_CLIENT_ID: WEB_CLIENT, RL_AUTH: { limit: async () => ({ success: true }) } } as unknown as Env;
  const nonce = async () => {
    const res = await handleProviderAuth(post("/api/v2/auth/google/nonce", {}), new URL(`${origin}/api/v2/auth/google/nonce`), env);
    return (await res!.json() as { data: { challengeId: string; nonce: string } }).data;
  };
  const verify = (challengeId: string, idToken: string) =>
    handleProviderAuth(post("/api/v2/auth/google/verify", { challengeId, idToken }), new URL(`${origin}/api/v2/auth/google/verify`), env);
  const now = Math.floor(Date.now() / 1000);
  const claims = (n: string, over: Record<string, unknown> = {}) => ({
    iss: "https://accounts.google.com", aud: WEB_CLIENT, azp: ANDROID_CLIENT, sub: "google-sub-1",
    email: "ann@example.com", email_verified: true, iat: now, exp: now + 600, nonce: n, ...over,
  });

  const c1 = await nonce();
  assert.equal((await verify(c1.challengeId, await sign(claims(c1.nonce, { aud: "someone-else.apps.googleusercontent.com" }))))!.status, 401, "wrong audience");
  const c2 = await nonce();
  assert.equal((await verify(c2.challengeId, await sign(claims("f".repeat(64)))))!.status, 401, "nonce from another challenge");

  const c3 = await nonce();
  const ok = await verify(c3.challengeId, await sign(claims(c3.nonce)));
  assert.equal(ok!.status, 200, "the Android token shape signs in");
  assert.match(ok!.headers.get("set-cookie") ?? "", /__Host-trix_session=.*HttpOnly/);
  assert.equal((await verify(c3.challengeId, await sign(claims(c3.nonce))))!.status, 401, "a challenge is single-use");
});

test("providers says whether email codes can be sent, so the app can hide email sign-in", async () => {
  const url = new URL(`${origin}/api/v2/auth/providers`);
  const get = async (env: Partial<Env>) => ((await (await handleProviderAuth(new Request(url), url, env as Env))!.json()) as { data: { emailAvailable: boolean } }).data.emailAvailable;
  assert.equal(await get({}), false);
  assert.equal(await get({ RESEND_API_KEY: "re_x", AUTH_EMAIL_FROM: "a@b.c", AUTH_SECRET: "s".repeat(32) }), true);
  assert.equal(await get({ RESEND_API_KEY: "re_x", AUTH_SECRET: "s".repeat(32) }), false);
});
