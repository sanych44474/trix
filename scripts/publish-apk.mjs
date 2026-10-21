#!/usr/bin/env node
// Publishes a signed "direct" APK for self-update: uploads it and its manifest (versionCode,
// versionName, SHA-256, size) to R2 under releases/android/ (see src/webapp/appConfig.ts). Installed
// APK builds see the new version in /api/v2/app/config, download it from /download/android, check
// the hash and ask the user to install.
//
// LIVE: writes to the production bucket. Run only when a release is approved.
//   node scripts/publish-apk.mjs <path/to/app-direct-release.apk> <versionCode> <versionName>
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const [apkPath, versionCodeArg, versionName = ""] = process.argv.slice(2);
const versionCode = Number(versionCodeArg);
if (!apkPath || !Number.isInteger(versionCode) || versionCode < 1) {
  console.error("usage: node scripts/publish-apk.mjs <apk> <versionCode> <versionName>");
  process.exit(2);
}

const bytes = readFileSync(apkPath);
if (bytes.subarray(0, 2).toString("latin1") !== "PK") {
  console.error(`${apkPath} is not an APK (zip) file`);
  process.exit(2);
}
const manifest = { versionCode, versionName, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
const manifestPath = join(mkdtempSync(join(tmpdir(), "apk-")), "latest.json");
writeFileSync(manifestPath, JSON.stringify(manifest));

const BUCKET = "trix-photos";
const put = (key, file, type) =>
  execFileSync("npx", ["wrangler", "r2", "object", "put", `${BUCKET}/${key}`, "--file", file, "--content-type", type, "--remote"], { stdio: "inherit", shell: process.platform === "win32" });

// The APK first: the manifest is what makes clients download, so it must never point at a missing file.
put("releases/android/latest.apk", apkPath, "application/vnd.android.package-archive");
put("releases/android/latest.json", manifestPath, "application/json");
console.log(`published ${versionName || versionCode}: ${manifest.size} bytes, sha256 ${manifest.sha256}`);
