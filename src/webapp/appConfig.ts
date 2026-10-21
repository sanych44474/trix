// Public configuration for the native app: the oldest build that may still run (below it the app
// blocks and updates) and the newest one published (below it the app offers a background update).
// Worker vars, so raising the minimum takes a Worker deploy, not an app release.
import type { Env } from "../types";

function versionCode(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export function handleAppConfig(req: Request, url: URL, env: Env): Response | null {
  if (url.pathname !== "/api/v2/app/config" || req.method !== "GET") return null;
  const android = {
    minVersionCode: versionCode(env.ANDROID_MIN_VERSION_CODE),
    latestVersionCode: Math.max(versionCode(env.ANDROID_MIN_VERSION_CODE), versionCode(env.ANDROID_LATEST_VERSION_CODE)),
  };
  return Response.json({ data: { android } }, { headers: { "cache-control": "public, max-age=300" } });
}
