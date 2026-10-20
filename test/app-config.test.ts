// The native app's update gate reads these numbers; a missing or malformed var must never ask for
// an impossible version (it falls back to 1), and "latest" can't be below "min".
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleAppConfig } from "../src/webapp/appConfig";
import type { Env } from "../src/types";

const url = new URL("https://trix.example/api/v2/app/config");
const get = (env: Partial<Env>) => handleAppConfig(new Request(url, { method: "GET" }), url, env as Env);

test("app config returns the configured Android versions", async () => {
  const res = get({ ANDROID_MIN_VERSION_CODE: "3", ANDROID_LATEST_VERSION_CODE: "7" });
  assert.ok(res);
  assert.deepEqual(await res.json(), { data: { android: { minVersionCode: 3, latestVersionCode: 7 } } });
});

test("app config falls back to 1 and keeps latest >= min", async () => {
  assert.deepEqual(await get({ ANDROID_MIN_VERSION_CODE: "", ANDROID_LATEST_VERSION_CODE: "abc" })!.json(), { data: { android: { minVersionCode: 1, latestVersionCode: 1 } } });
  assert.deepEqual(await get({ ANDROID_MIN_VERSION_CODE: "5", ANDROID_LATEST_VERSION_CODE: "2" })!.json(), { data: { android: { minVersionCode: 5, latestVersionCode: 5 } } });
});

test("app config ignores other paths and methods", () => {
  const other = new URL("https://trix.example/api/v2/app/other");
  assert.equal(handleAppConfig(new Request(other), other, {} as Env), null);
  assert.equal(handleAppConfig(new Request(url, { method: "POST" }), url, {} as Env), null);
});
