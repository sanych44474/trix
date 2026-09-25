// Mini App auth: resolve the requesting user from the Telegram initData header.
import { getUser } from "../adapters/d1/v2Users";
import { validateInitData } from "./initData";
import type { Env, UserDoc } from "../types";

/** Resolve the Mini-App user from the Telegram initData header (dev bypass via ?debugUser, gated
 * on the explicit ALLOW_DEBUG_USER opt-in — see wrangler.toml's comment on that var for why it is
 * not tied to WORKER_URL). Also accepts initData via the `tma` query param — <img src> can't send
 * headers, so the photo proxy authorizes through the URL (the initData HMAC is
 * self-authenticating). */
export async function miniAppUser(req: Request, url: URL, env: Env): Promise<UserDoc | null> {
  const auth = req.headers.get("authorization") ?? "";
  const tmaQ = url.searchParams.get("tma");
  let userId: number | null = null;
  if (auth.startsWith("tma ")) {
    const valid = await validateInitData(auth.slice(4), env.TELEGRAM_BOT_TOKEN);
    userId = valid?.userId ?? null;
  } else if (tmaQ) {
    const valid = await validateInitData(tmaQ, env.TELEGRAM_BOT_TOKEN);
    userId = valid?.userId ?? null;
  } else if (env.ALLOW_DEBUG_USER === "1") {
    const dbg = Number(url.searchParams.get("debugUser"));
    if (dbg > 0) userId = dbg;
  }
  if (!userId) return null;
  const user = await getUser(env.DB, userId);
  return user && !user.blocked ? user : null;
}
