import type { V2Envelope, V2Failure } from "./types";

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

function headers(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
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
