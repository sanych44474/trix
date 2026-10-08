// src/domain/secrets.ts: constant-time comparison plus the signing schemes the bot has already put
// into links and chats. The compatibility tests re-derive each scheme with raw Web Crypto, NOT with
// the module, so they fail if the module ever drifts from what is already out in the world.
import { test } from "node:test";
import assert from "node:assert/strict";
import { macHex, safeEqual, secretMatches, verifyMac } from "../src/domain/secrets";
import { buildVideoOpenLink, signVideoOpen, verifyVideoOpen } from "../src/domain/videoLink";
import { weekMapUrl } from "../src/webapp/weekMap";
import { signState, verifyState } from "../src/adapters/d1/v2Strava";
import { validateInitData } from "../src/webapp/initData";
import { TRACKED_MUSCLES } from "../src/domain/muscleLoad";

const enc = new TextEncoder();
async function rawHmac(key: Uint8Array | string, msg: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", typeof key === "string" ? enc.encode(key) : (key as BufferSource), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}
const hex = (b: Uint8Array, n = b.length) => [...b.slice(0, n)].map((x) => x.toString(16).padStart(2, "0")).join("");

test("safeEqual: equal, different, different length, empty, non-ASCII", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "abcd"), false);
  assert.equal(safeEqual("abcd", "abc"), false);
  assert.equal(safeEqual("", ""), true);
  assert.equal(safeEqual("", "a"), false);
  assert.equal(safeEqual("сідниці", "сідниці"), true);
  assert.equal(safeEqual("сідниці", "сідница"), false);
});

test("secretMatches: an unset or empty expected secret never authorizes, even against an empty credential", () => {
  assert.equal(secretMatches("s3cret", "s3cret"), true);
  assert.equal(secretMatches("wrong", "s3cret"), false);
  assert.equal(secretMatches(null, "s3cret"), false);
  assert.equal(secretMatches("", ""), false);
  assert.equal(secretMatches(null, undefined), false);
  assert.equal(secretMatches("anything", undefined), false);
  assert.equal(secretMatches("anything", ""), false);
});

test("verifyMac rejects an empty and a tampered signature", async () => {
  const sig = await macHex("k", "m", 8);
  assert.equal(await verifyMac("k", "m", sig, 8), true);
  assert.equal(await verifyMac("k", "m", "", 8), false);
  assert.equal(await verifyMac("k", "m2", sig, 8), false);
  assert.equal(await verifyMac("k2", "m", sig, 8), false);
});

test("compat: /v link signature is HMAC(token, 'uid:url') truncated to 8 bytes", async () => {
  const expected = hex(await rawHmac("123:token", "42:https://youtu.be/x"), 8);
  assert.equal(await signVideoOpen(42, "https://youtu.be/x", "123:token"), expected);
  assert.equal(await verifyVideoOpen(42, "https://youtu.be/x", expected, "123:token"), true);
  assert.equal(await verifyVideoOpen(43, "https://youtu.be/x", expected, "123:token"), false);
  assert.equal(await verifyVideoOpen(42, "https://youtu.be/x", "", "123:token"), false);
  assert.match(await buildVideoOpenLink("https://w.example", "https://youtu.be/x", 42, "123:token"), new RegExp(`sig=${expected}$`));
});

test("compat: weekly body-map link signature is HMAC(token, 'weekmap:sex:zones') truncated to 8 bytes", async () => {
  const zones = "n".repeat(TRACKED_MUSCLES.length);
  const url = await weekMapUrl("https://w.example", "male", zones, "123:token");
  assert.ok(url, "a well-formed zone string produces a link");
  assert.equal(new URL(url).searchParams.get("sig"), hex(await rawHmac("123:token", `weekmap:m:${zones}`), 8));
});

test("compat: Strava OAuth state is HMAC('strava-state:'+secret, 'id.exp') truncated to 16 bytes", async () => {
  const now = Date.UTC(2026, 9, 8);
  const state = await signState(7, "client-secret", now);
  const [id, exp, sig] = state.split(".");
  assert.equal(sig, hex(await rawHmac("strava-state:client-secret", `${id}.${exp}`), 16));
  assert.equal(await verifyState(state, "client-secret", now), 7);
  assert.equal(await verifyState(state, "other-secret", now), null);
  assert.equal(await verifyState(state, "client-secret", now + 16 * 60 * 1000), null, "expired");
});

test("compat: Telegram initData is verified per the documented two-step HMAC", async () => {
  const botToken = "123:token";
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 99 }), query_id: "q" });
  const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const secret = await rawHmac("WebAppData", botToken);
  params.set("hash", hex(await rawHmac(secret, dcs)));
  assert.deepEqual(await validateInitData(params.toString(), botToken), { userId: 99 });
  params.set("hash", "0".repeat(64));
  assert.equal(await validateInitData(params.toString(), botToken), null);
});
