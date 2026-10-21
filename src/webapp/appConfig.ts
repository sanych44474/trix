// Public configuration for the native app: the oldest build that may still run (below it the app
// blocks and updates) and the newest one published (below it the app offers a background update).
// Worker vars, so raising the minimum takes a Worker deploy, not an app release.
//
// Builds installed from an APK (not Play) update themselves from Cloudflare: scripts/publish-apk.mjs
// puts the APK and a small manifest under releases/android/ in R2, `download` below points at it and
// GET /download/android serves it. The app checks the SHA-256 before Android's own install prompt.
import type { Env } from "../types";

export const APK_KEY = "releases/android/latest.apk";
export const APK_MANIFEST_KEY = "releases/android/latest.json";

export interface ApkManifest {
  versionCode: number;
  versionName: string;
  sha256: string;
  size: number;
}

function versionCode(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export function parseApkManifest(raw: unknown): ApkManifest | null {
  const m = raw as Partial<ApkManifest> | null;
  if (!m || !Number.isInteger(m.versionCode) || (m.versionCode as number) < 1) return null;
  if (typeof m.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(m.sha256)) return null;
  if (!Number.isInteger(m.size) || (m.size as number) < 1) return null;
  return { versionCode: m.versionCode as number, versionName: typeof m.versionName === "string" ? m.versionName.slice(0, 40) : "", sha256: m.sha256, size: m.size as number };
}

async function apkManifest(env: Env): Promise<ApkManifest | null> {
  const obj = await env.R2_PHOTOS?.get(APK_MANIFEST_KEY).catch(() => null);
  if (!obj) return null;
  return parseApkManifest(await obj.json().catch(() => null));
}

export async function handleAppConfig(req: Request, url: URL, env: Env): Promise<Response | null> {
  if (url.pathname !== "/api/v2/app/config" || req.method !== "GET") return null;
  const min = versionCode(env.ANDROID_MIN_VERSION_CODE);
  const apk = await apkManifest(env);
  const android = {
    minVersionCode: min,
    latestVersionCode: Math.max(min, versionCode(env.ANDROID_LATEST_VERSION_CODE), apk?.versionCode ?? 1),
    ...(apk ? { download: { url: `${url.origin}/download/android`, ...apk } } : {}),
  };
  return Response.json({ data: { android } }, { headers: { "cache-control": "public, max-age=300" } });
}

/** GET /download/android: the latest published APK (also what a "download the app" link points at). */
export async function handleApkDownload(req: Request, url: URL, env: Env): Promise<Response | null> {
  if (url.pathname !== "/download/android" || (req.method !== "GET" && req.method !== "HEAD")) return null;
  const [apk, manifest] = await Promise.all([env.R2_PHOTOS?.get(APK_KEY).catch(() => null), apkManifest(env)]);
  if (!apk) return new Response("Not found", { status: 404 });
  const name = `HackLimits-${manifest?.versionName || manifest?.versionCode || "latest"}.apk`.replace(/[^A-Za-z0-9._-]/g, "_");
  return new Response(req.method === "HEAD" ? null : apk.body, {
    headers: {
      "content-type": "application/vnd.android.package-archive",
      "content-disposition": `attachment; filename="${name}"`,
      "content-length": String(apk.size),
      "cache-control": "no-cache",
      "x-content-type-options": "nosniff",
    },
  });
}
