// Mini App auth: resolve the requesting user from the Telegram initData header.
import { getUser } from "../db/repos";
import { validateInitData } from "./initData";
import type { Env, UserDoc } from "../types";

/** Resolve the Mini-App user from the Telegram initData header (dev bypass via ?debugUser).
 * Also accepts initData via the `tma` query param — <img src> can't send headers, so the photo
 * proxy authorizes through the URL (the initData HMAC makes it self-authenticating). */
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
  } else if (!env.WORKER_URL) {
    const dbg = Number(url.searchParams.get("debugUser"));
    if (dbg > 0) userId = dbg;
  }
  if (!userId) return null;
  const user = await getUser(env.DB, userId);
  return user && !user.blocked ? user : null;
}
