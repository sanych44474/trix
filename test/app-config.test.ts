// The native app's update gate reads these numbers; a missing or malformed var must never ask for
// an impossible version (it falls back to 1), and "latest" can't be below "min". APK installs also
// get the self-update download (manifest in R2), and /download/android serves the file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { APK_KEY, APK_MANIFEST_KEY, handleApkDownload, handleAppConfig, parseApkManifest } from "../src/webapp/appConfig";
import type { Env } from "../src/types";

const url = new URL("https://trix.example/api/v2/app/config");
const get = async (env: Partial<Env>) => (await handleAppConfig(new Request(url, { method: "GET" }), url, env as Env))!;
const SHA = "a".repeat(64);

/** An R2 bucket holding the given objects (only what the handlers use). */
function bucket(objects: Record<string, string>) {
  return {
    get: async (key: string) => {
      if (!(key in objects)) return null;
      const body = objects[key];
      return { size: body.length, body: new Response(body).body, json: async () => JSON.parse(body) };
    },
  } as unknown as R2Bucket;
}

test("app config returns the configured Android versions", async () => {
  const res = await get({ ANDROID_MIN_VERSION_CODE: "3", ANDROID_LATEST_VERSION_CODE: "7" });
  assert.deepEqual(await res.json(), { data: { android: { minVersionCode: 3, latestVersionCode: 7 } } });
});

test("app config falls back to 1 and keeps latest >= min", async () => {
  assert.deepEqual(await (await get({ ANDROID_MIN_VERSION_CODE: "", ANDROID_LATEST_VERSION_CODE: "abc" })).json(), { data: { android: { minVersionCode: 1, latestVersionCode: 1 } } });
  assert.deepEqual(await (await get({ ANDROID_MIN_VERSION_CODE: "5", ANDROID_LATEST_VERSION_CODE: "2" })).json(), { data: { android: { minVersionCode: 5, latestVersionCode: 5 } } });
});

test("a published APK raises latest and adds the self-update download", async () => {
  const manifest = { versionCode: 4, versionName: "0.2.0", sha256: SHA, size: 3_200_000 };
  const res = await get({ ANDROID_MIN_VERSION_CODE: "1", ANDROID_LATEST_VERSION_CODE: "2", R2_PHOTOS: bucket({ [APK_MANIFEST_KEY]: JSON.stringify(manifest) }) });
  assert.deepEqual(await res.json(), {
    data: { android: { minVersionCode: 1, latestVersionCode: 4, download: { url: "https://trix.example/download/android", ...manifest } } },
  });
});

test("a malformed APK manifest is ignored, never offered", () => {
  assert.equal(parseApkManifest({ versionCode: 4, versionName: "x", sha256: "nope", size: 1 }), null);
  assert.equal(parseApkManifest({ versionCode: 0, sha256: SHA, size: 1 }), null);
  assert.equal(parseApkManifest(null), null);
  assert.deepEqual(parseApkManifest({ versionCode: 2, sha256: SHA, size: 10 }), { versionCode: 2, versionName: "", sha256: SHA, size: 10 });
});

test("/download/android serves the APK as an attachment, 404 before one is published", async () => {
  const dl = new URL("https://trix.example/download/android");
  const env = { R2_PHOTOS: bucket({ [APK_KEY]: "APKBYTES", [APK_MANIFEST_KEY]: JSON.stringify({ versionCode: 4, versionName: "0.2.0", sha256: SHA, size: 8 }) }) } as unknown as Env;
  const res = (await handleApkDownload(new Request(dl), dl, env))!;
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/vnd.android.package-archive");
  assert.match(res.headers.get("content-disposition") ?? "", /HackLimits-0\.2\.0\.apk/);
  assert.equal(await res.text(), "APKBYTES");
  const none = (await handleApkDownload(new Request(dl), dl, { R2_PHOTOS: bucket({}) } as unknown as Env))!;
  assert.equal(none.status, 404);
});

test("app config ignores other paths and methods", async () => {
  const other = new URL("https://trix.example/api/v2/app/other");
  assert.equal(await handleAppConfig(new Request(other), other, {} as Env), null);
  assert.equal(await handleAppConfig(new Request(url, { method: "POST" }), url, {} as Env), null);
  assert.equal(await handleApkDownload(new Request(other), other, {} as Env), null);
});
