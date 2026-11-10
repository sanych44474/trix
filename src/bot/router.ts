// Dispatch layer: createBot() with the middleware, the launcher gate and the handlers that are
// still reachable. The private chat is retired (ADR-0012): users work in the Mini App and the
// Android app, and the bot keeps only /start pairing, the app's Telegram sign-in, payments, the
// asks it sends itself (price poll, inactive-user ask, sharing consent), squads in groups and the
// owner's tools.
import { skipMutedRecipients } from "../notify";
import { cmdPaySupport, cmdSupport, onPreCheckout, onSuccessfulPayment } from "./support";
import { Bot } from "grammy";
import { botClientOptions } from "../adapters/telegram/rawApi";
import { logInfo } from "../log";
import { cmdAdmin, cmdAnnounce, cmdOwnerReport, cmdUsers, cmdWhatsNew } from "./owner";
import { cmdPricePoll } from "./pricePoll";
import { cmdRefreshVideos, cmdSetVideo } from "./ownerVideos";
import { bumpEvent } from "../adapters/d1/v2Analytics";
import { recordPresence } from "../adapters/d1/v2Presence";
import { getOrCreateUser, updateUser } from "../adapters/d1/v2Users";
import { localParts } from "../domain/localTime";
import { handleGroupUpdate } from "./squad";
import { type Env } from "../types";
import { type MyContext } from "../adapters/telegram/context";
import { setAppUrl } from "../notify/appLinks";
import { defaultLang, normalizeEvent } from "./commonCmds";
import { cmdStart } from "./start";
import { cmdAskInactive, cmdCleanup } from "./cleanup";
import { onError } from "../features/aiDefer";
import { launcherGate } from "./launcher";
import { CB_EXACT, CB_PREFIX } from "./callbackRoutes";
import { routeUserText } from "./textRoutes";

/** Owner menu buttons (the owner hub's own entries). */
export const MENU_MAP: Record<string, (c: MyContext) => Promise<void>> = {
  "menu:users": cmdUsers,
  "menu:ownerreport": cmdOwnerReport,
  "menu:whatsnew": cmdWhatsNew,
};


export function createBot(env: Env, exCtx?: ExecutionContext): Bot<MyContext> {
  setAppUrl(env.WORKER_URL, env.V2_APP_ENABLED === "1" ? "/app-v2" : "/app");
  const bot = new Bot<MyContext>(env.TELEGRAM_BOT_TOKEN, botClientOptions);

  // docs/slos.md's telegram_send_failure. An API transformer is the one real choke point for
  // outbound Bot API traffic: every ctx.api.*/bot.api.* call in the bot AND the scheduler goes
  // through here, so one hook replaces chasing dozens of scattered `.catch(() => {})` sites that
  // each swallow their own error. Re-throws unchanged -- this observes, it must not alter
  // behavior (callers' own catches still see exactly the error they saw before).
  bot.api.config.use(async (prev, method, payload, signal) => {
    try {
      return await prev(method, payload, signal);
    } catch (err) {
      if (method.startsWith("send") || method === "copyMessage") {
        const msg = err instanceof Error ? err.message : String(err);
        // Coarse buckets only -- the useful split is "the user is gone" vs "we're being
        // throttled" vs "something else broke", not the exact Telegram description string.
        const kind = /blocked|deactivated|chat not found|kicked/i.test(msg)
          ? "blocked"
          : /too many requests|retry after|flood/i.test(msg)
            ? "rate_limited"
            : "other";
        logInfo("telegram_send_failure", { kind, method });
      }
      throw err;
    }
  });

  // Avoid a getMe round-trip on every webhook invocation. Requires BOT_ID + BOT_USERNAME; a
  // deployment that leaves them unset simply pays for getMe via grammY's own bot.init().
  const botId = Number(env.BOT_ID);
  const botUser = env.BOT_USERNAME?.replace(/^@/, "");
  if (botId && botUser) bot.botInfo = {
    id: botId,
    is_bot: true,
    first_name: env.BOT_NAME || botUser,
    username: botUser,
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
    can_manage_bots: false,
    has_topics_enabled: false,
    allows_users_to_create_topics: false,
    supports_join_request_queries: false,
  };

  // Group chats are handled by squad mode and NEVER fall through to the handlers below. Every
  // one of them assumes a private 1:1 chat: a group update reaching them would print someone's
  // plan into the group, and getOrCreateUser would stamp the GROUP's chat id onto a brand-new
  // user row, sending all of that person's future reminders to the group instead of to them.
  bot.use(async (ctx, next) => {
    if ((ctx.chat?.type ?? "private") === "private") return next();
    if (!ctx.from) return;
    ctx.env = env;
    ctx.db = env.DB;
    ctx.waitUntil = exCtx ? (p) => exCtx.waitUntil(p.catch((e) => console.error("waitUntil task error", e))) : (p) => void p.catch(() => {});
    await handleGroupUpdate(ctx, new Date().toISOString().slice(0, 10));
  });

  bot.use(async (ctx, next) => {
    const from = ctx.from;
    const chatId = ctx.chat?.id ?? from?.id;
    if (!from || chatId === undefined) return;
    ctx.env = env;
    ctx.db = env.DB;
    ctx.waitUntil = exCtx ? (p) => exCtx.waitUntil(p.catch((e) => console.error("waitUntil task error", e))) : (p) => void p.catch(() => {});
    ctx.api.config.use(skipMutedRecipients(env.DB, chatId));
    ctx.user = await getOrCreateUser(ctx.db, from.id, chatId, defaultLang(from.language_code), from.first_name);
    // Backfill name for users created before name capture existed.
    if (!ctx.user.profile.name && from.first_name) {
      ctx.user.profile = { ...ctx.user.profile, name: from.first_name };
      await updateUser(ctx.db, ctx.user._id, { profile: ctx.user.profile });
    }
    // Capture/refresh the Telegram @username as it changes (used in the owner report).
    if (from.username && from.username !== ctx.user.username) {
      ctx.user.username = from.username;
      await updateUser(ctx.db, ctx.user._id, { username: from.username });
    }
    // Record the LAST GENUINE interaction (only here and in the Mini App's auth -- never from the
    // cron) and open a session when the gap is wide (domain/presence.ts). This is the only reliable
    // "is this user active" signal: updatedAt is bumped by the scheduler too.
    ctx.waitUntil(recordPresence(ctx.db, ctx.user, "bot"));
    // Owner-banned users are ignored entirely until the owner unblocks them.
    if (ctx.user.blocked) return;
    await next();
  });

  // The chat is retired: a private message, command or tap gets the Open-app button instead of
  // running (see launcher.ts for what still goes through).
  bot.use(async (ctx, next) => {
    if (await launcherGate(ctx)) return;
    await next();
  });

  bot.command("start", async (ctx) => {
    await cmdStart(ctx, ctx.match?.trim() || undefined);
  });
  // Payments (Telegram Stars).
  bot.command("support", cmdSupport);
  bot.command("paysupport", cmdPaySupport);
  bot.on("pre_checkout_query", onPreCheckout);
  bot.on("message:successful_payment", onSuccessfulPayment);
  // Owner tools.
  bot.command("cleanup", cmdCleanup);
  bot.command("askinactive", cmdAskInactive);
  bot.command("admin", async (ctx) => {
    await cmdAdmin(ctx as MyContext, ctx.match.trim());
  });
  bot.command("ownerreport", cmdOwnerReport);
  bot.command("whatsnew", cmdWhatsNew);
  bot.command("refreshvideos", cmdRefreshVideos);
  bot.command("setvideo", async (ctx) => {
    await cmdSetVideo(ctx as MyContext, ctx.match.trim());
  });
  bot.command("users", cmdUsers);
  bot.command("announce", cmdAnnounce);
  bot.command("pricepoll", cmdPricePoll);

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    await ctx.answerCallbackQuery().catch(() => {});
    // Usage analytics: count every tap under a normalized key.
    ctx.waitUntil(bumpEvent(ctx.db, ctx.user._id, normalizeEvent(data), localParts(ctx.user.profile.timezone).date));
    try {
      const exact = CB_EXACT[data];
      if (exact) { await exact(ctx, "", data); return; }
      for (const [prefix, handler] of CB_PREFIX) {
        if (data.startsWith(prefix)) { await handler(ctx, data.slice(prefix.length), data); return; }
      }
      const fn = MENU_MAP[data];
      if (fn) await fn(ctx);
    } catch (err) {
      await onError(ctx, err, "callback");
    }
  });

  bot.on("message:text", async (ctx) => {
    try {
      await routeUserText(ctx, ctx.message.text.trim());
    } catch (err) {
      await onError(ctx, err, "text");
    }
  });

  return bot;
}
