// Mini App auth: resolve the requesting user from Telegram initData or a first-party app session.
import { getUser } from "../adapters/d1/v2Users";
import { recordPresence } from "../adapters/d1/v2Presence";
import { validateInitData } from "./initData";
import { sessionIdentity, sessionTokenFromRequest } from "./appSessions";
import type { Env, UserDoc } from "../types";

export type MiniAppAuthMethod = "telegram" | "email" | "google" | "debug";
export interface MiniAppIdentity {
  user: UserDoc;
  method: MiniAppAuthMethod;
}

/** Resolve the Mini-App user from Telegram initData or its HttpOnly app session (dev bypass via ?debugUser, gated
 * on the explicit ALLOW_DEBUG_USER opt-in — see wrangler.toml's comment on that var for why it is
 * not tied to WORKER_URL). Also accepts initData via the `tma` query param — <img src> can't send
 * headers, so the photo proxy authorizes through the URL (the initData HMAC is
 * self-authenticating). */
export async function miniAppIdentity(req: Request, url: URL, env: Env): Promise<MiniAppIdentity | null> {
  const auth = req.headers.get("authorization") ?? "";
  const tmaQ = url.searchParams.get("tma");
  let userId: number | null = null;
  let method: MiniAppAuthMethod | null = null;
  if (auth.startsWith("tma ")) {
    const valid = await validateInitData(auth.slice(4), env.TELEGRAM_BOT_TOKEN);
    userId = valid?.userId ?? null;
    if (userId !== null) method = "telegram";
  }
  if (userId === null && tmaQ) {
    const valid = await validateInitData(tmaQ, env.TELEGRAM_BOT_TOKEN);
    userId = valid?.userId ?? null;
    if (userId !== null) method = "telegram";
  }
  if (userId === null) {
    const token = sessionTokenFromRequest(req);
    if (token) {
      const session = await sessionIdentity(env.DB, token);
      userId = session?.accountId ?? null;
      if (session) method = session.method;
    }
  }
  if (userId === null && env.ALLOW_DEBUG_USER === "1") {
    const dbg = Number(url.searchParams.get("debugUser"));
    if (dbg > 0) {
      userId = dbg;
      method = "debug";
    }
  }
  if (userId === null || method === null) return null;
  const user = await getUser(env.DB, userId);
  if (!user || user.blocked) return null;
  // Every authenticated Mini App request is proof the person is here. This is the Mini App's half of
  // "last seen" (the bot writes the other half), throttled to one write a minute.
  await recordPresence(env.DB, user, "miniapp");
  return { user, method };
}

export async function miniAppUser(req: Request, url: URL, env: Env): Promise<UserDoc | null> {
  return (await miniAppIdentity(req, url, env))?.user ?? null;
}
