import type { operations } from "../../../packages/contracts/generated";
import type { RequestBody, V2Envelope, V2Failure } from "./types";

export class ApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

function appendDebugQuery(path: string): string {
  if (window.Telegram?.WebApp?.initData) return path;
  const query = window.location.search.slice(1);
  if (!query) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${query}`;
}

// D1 session bookmark (src/adapters/d1/session.ts): echoed back on every call so reads after
// our own writes never come from a replica that hasn't caught up. In memory only — a fresh app
// open starts at the primary anyway.
let d1Bookmark: string | null = null;
export function rememberBookmark(res: Response): void {
  const b = res.headers.get("x-d1-bookmark");
  if (b) d1Bookmark = b;
}

function headers(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  if (d1Bookmark) headers.set("x-d1-bookmark", d1Bookmark);
  const initData = window.Telegram?.WebApp?.initData ?? "";
  if (initData) headers.set("Authorization", `tma ${initData}`);
  headers.set("Accept", "application/json");
  return headers;
}

export async function api<T>(path: string, init: RequestInit & { idempotencyKey?: string } = {}): Promise<T> {
  const requestHeaders = headers(init.headers);
  if (init.body && !requestHeaders.has("Content-Type")) requestHeaders.set("Content-Type", "application/json");
  if (init.idempotencyKey) requestHeaders.set("Idempotency-Key", init.idempotencyKey);
  const response = await fetch(appendDebugQuery(path), { ...init, headers: requestHeaders });
  rememberBookmark(response);
  let body: unknown = null;
  try { body = await response.json(); } catch { /* empty response */ }
  if (!response.ok) {
    const failure = body as V2Failure | null;
    throw new ApiError(failure?.error?.code ?? "dependency_unavailable", failure?.error?.message ?? "Request failed", response.status);
  }
  if (body && typeof body === "object" && "data" in body) return (body as V2Envelope<T>).data;
  return body as T;
}

export function jsonBody(value: unknown): BodyInit {
  return JSON.stringify(value);
}

/** `jsonBody` for a route the OpenAPI contract describes: the body is checked against that
 *  operation's declared request schema, so a renamed or misspelled field fails `npm run
 *  typecheck:webapp` instead of 400'ing at runtime. Prefer this over `jsonBody` for any
 *  /api/v2/* route with a `requestBody` in the contract.
 *
 *  A handful of routes take no body at all (requestClientPhoto, nudgeClientInterview,
 *  askInactiveUsers, moderateUser -- the action is entirely in the path). `RequestBody` is
 *  `never` for those, which is correct: they stay on plain `jsonBody({})`. */
export function typedBody<Op extends keyof operations>(value: RequestBody<Op>): BodyInit {
  return JSON.stringify(value);
}

/** Multipart upload with the same auth/envelope handling as api(). api() forces a JSON
 *  Content-Type, which breaks a FormData body (the browser must set its own boundary). */
export async function apiForm<T>(path: string, form: FormData): Promise<T> {
  const requestHeaders = new Headers();
  if (d1Bookmark) requestHeaders.set("x-d1-bookmark", d1Bookmark);
  const initData = window.Telegram?.WebApp?.initData ?? "";
  if (initData) requestHeaders.set("Authorization", `tma ${initData}`);
  requestHeaders.set("Accept", "application/json");
  const response = await fetch(appendDebugQuery(path), { method: "POST", headers: requestHeaders, body: form });
  rememberBookmark(response);
  let body: unknown = null;
  try { body = await response.json(); } catch { /* empty response */ }
  if (!response.ok) {
    const failure = body as V2Failure | null;
    throw new ApiError(failure?.error?.code ?? "dependency_unavailable", failure?.error?.message ?? "Request failed", response.status);
  }
  if (body && typeof body === "object" && "data" in body) return (body as V2Envelope<T>).data;
  return body as T;
}
