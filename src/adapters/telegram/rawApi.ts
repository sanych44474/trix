// Telegram Bot API over plain fetch, for code that has no grammY Bot (the Mini App's request
// handlers, the cron's alert path). grammY's `bot.api` is the other adapter for the same job.
//
// Two things this exists to get right, because six hand-written copies each got them wrong:
//  - a refusal is an ERROR. Telegram answers a blocked bot or a rate limit with HTTP 4xx and a JSON
//    body, not a thrown exception, so a bare `await fetch(...)` reports success for a message that
//    never arrived. rawTelegramApi turns a refusal into the same GrammyError grammY throws, which
//    is exactly what the notification outbox classifies (403 -> blocked, 429 -> retry, ...);
//  - the copies disagreed on what to do with a failure (swallow, return a boolean, ignore). The
//    two helpers below are the two behaviours callers actually want.
import { GrammyError, type Api } from "grammy";

type Params = Record<string, unknown>;

// The one place in the codebase that builds a Bot API URL (test/architecture.test.ts holds every
// other module to that). FormData bodies (photo / document uploads) go as multipart.
async function call(token: string, method: string, params: Params | FormData): Promise<unknown> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, params instanceof FormData
    ? { method: "POST", body: params }
    : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params) });
  const body = (await res.json().catch(() => null)) as
    | { ok: true; result: unknown }
    | { ok: false; error_code: number; description: string; parameters?: { retry_after?: number } }
    | null;
  if (body && body.ok) return body.result;
  const failure = body && !body.ok ? body : { ok: false as const, error_code: res.status, description: `HTTP ${res.status}` };
  throw new GrammyError(`Call to '${method}' failed! (${failure.error_code}: ${failure.description})`, failure, method, params instanceof FormData ? {} : params);
}

type Token = { TELEGRAM_BOT_TOKEN: string };

/** Any Bot API method. Resolves with its `result`; throws GrammyError on a refusal (and the
 *  network error as-is) -- for callers that must know, or that feed the notification outbox. */
export function telegramCall<T = unknown>(env: Token, method: string, params: Params): Promise<T> {
  return call(env.TELEGRAM_BOT_TOKEN, method, params) as Promise<T>;
}

/** Any Bot API method, never throwing: the `result`, or null when Telegram refused or the request
 *  failed. For side messages that must not fail the request that triggered them. */
export async function telegramTry<T = unknown>(env: Token, method: string, params: Params): Promise<T | null> {
  try {
    return (await call(env.TELEGRAM_BOT_TOKEN, method, params)) as T;
  } catch {
    return null;
  }
}

/** A multipart upload (sendPhoto / sendDocument with file bytes), never throwing: the `result`, or
 *  null. */
export async function telegramUpload<T = unknown>(env: Token, method: string, form: FormData): Promise<T | null> {
  try {
    return (await call(env.TELEGRAM_BOT_TOKEN, method, form)) as T;
  } catch {
    return null;
  }
}

/** The slice of grammY's Api that sending a message needs, over fetch. Throws GrammyError on a
 * refusal, so it can stand in for `bot.api` behind the notification outbox. */
export function rawTelegramApi(env: { TELEGRAM_BOT_TOKEN: string }): Pick<Api, "sendMessage"> {
  return {
    sendMessage: ((chatId: number | string, text: string, other?: Params) =>
      call(env.TELEGRAM_BOT_TOKEN, "sendMessage", { chat_id: chatId, text, ...other })) as Api["sendMessage"],
  };
}

/** Sends an HTML message, and says whether it landed. Never throws: for the "tell the other person"
 * messages that must not fail the request that triggered them. */
export async function sendBestEffort(env: { TELEGRAM_BOT_TOKEN: string }, chatId: number, text: string, replyMarkup?: unknown): Promise<boolean> {
  try {
    await call(env.TELEGRAM_BOT_TOKEN, "sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...(replyMarkup ? { reply_markup: replyMarkup } : {}) });
    return true;
  } catch {
    return false;
  }
}

/** The bytes of a file Telegram stores (`file_path` from getFile). The file endpoint is the other
 *  Bot API URL; it embeds the token too, so it is built here as well. */
export function fetchTelegramFile(env: Token, filePath: string): Promise<Response> {
  return fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`);
}
