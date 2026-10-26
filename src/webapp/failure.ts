// Typed failure for the Mini App handlers. The v2 seam reads `code` and `retryable` from the body
// instead of guessing from the free-text reason; `error` keeps that reason for the legacy /api/*
// clients, which read it as a string.
import { retryableFor, type V2ErrorCode } from "../contracts/v2";

export function typedFailure(status: number, code: V2ErrorCode, message: string, extra?: Record<string, unknown>): Response {
  return Response.json({ error: message, ...extra, code, retryable: retryableFor(code) }, { status });
}

/** The code a bare HTTP status stands for, where a handler has nothing more specific to say. */
export function failureCode(status: number): V2ErrorCode {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "dependency_unavailable";
  return "validation_error";
}
