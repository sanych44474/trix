// Typed failure for the Mini App handlers. The v2 seam reads `code` and `retryable` from the body
// instead of guessing from the free-text reason; `error` keeps that reason for the legacy /api/*
// clients, which read it as a string.
import { retryableFor, type V2ErrorCode } from "../contracts/v2";

export function typedFailure(status: number, code: V2ErrorCode, message: string): Response {
  return Response.json({ error: message, code, retryable: retryableFor(code) }, { status });
}
