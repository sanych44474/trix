// The native app registers its FCM token after sign-in and removes it on sign-out:
//   POST   /api/v2/push/devices  { token, platform: "android" | "ios", appVersion?, kind?: "token" | "fid" }
//   DELETE /api/v2/push/devices  { token }
// Authenticated like every /api/v2 route (bearer session from the app).
import { registerPushDevice, unregisterPushDevice, type PushKind, type PushPlatform } from "../adapters/d1/v2Push";
import { miniAppUser } from "./auth";
import { readAuthJson } from "./authHttp";
import type { Env } from "../types";

const TOKEN_RE = /^[A-Za-z0-9_:\-]{20,4096}$/;

export async function handlePushApi(req: Request, url: URL, env: Env): Promise<Response | null> {
  if (url.pathname !== "/api/v2/push/devices") return null;
  if (req.method !== "POST" && req.method !== "DELETE") return Response.json({ error: "method not allowed" }, { status: 405 });
  const user = await miniAppUser(req, url, env);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = await readAuthJson(req);
  const token = typeof body?.token === "string" && TOKEN_RE.test(body.token) ? body.token : null;
  if (!token) return Response.json({ error: "bad request" }, { status: 400 });
  if (req.method === "DELETE") {
    await unregisterPushDevice(env.DB, user._id, token);
    return Response.json({ ok: true });
  }
  const platform: PushPlatform | null = body?.platform === "android" || body?.platform === "ios" ? body.platform : null;
  if (!platform) return Response.json({ error: "bad request" }, { status: 400 });
  const appVersion = typeof body?.appVersion === "string" ? body.appVersion.slice(0, 32) : null;
  // `fid` = a Firebase Installation ID (FCM 25.1+); older app builds send a registration token.
  const kind: PushKind = body?.kind === "fid" ? "fid" : "token";
  await registerPushDevice(env.DB, user._id, token, platform, appVersion, kind);
  return Response.json({ ok: true });
}
