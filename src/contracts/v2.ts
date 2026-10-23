/** Shared REST v2 contract primitives.
 *
 * The Worker owns the implementation, while the React client consumes the same
 * response envelope. Keeping this seam small lets the old /api/* handlers remain
 * available during the staged migration.
 */
export const V2_ERROR_CODES = [
  "validation_error",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "rate_limited",
  "dependency_unavailable",
] as const;

export type V2ErrorCode = (typeof V2_ERROR_CODES)[number];

/** Codes a client may retry unchanged: the service is throttled or down, or the session is not there
 * yet (a save queued before the app had login data goes through once it has). Not the request. */
const RETRYABLE_ERROR_CODES: readonly V2ErrorCode[] = ["unauthorized", "rate_limited", "dependency_unavailable"];

export function isV2ErrorCode(value: unknown): value is V2ErrorCode {
  return typeof value === "string" && (V2_ERROR_CODES as readonly string[]).includes(value);
}

export function retryableFor(code: V2ErrorCode): boolean {
  return RETRYABLE_ERROR_CODES.includes(code);
}

export interface V2Error {
  code: V2ErrorCode;
  message: string;
  retryable: boolean;
  requestId?: string;
  details?: Record<string, unknown>;
}

export interface V2Success<T> {
  data: T;
  meta?: {
    version: 2;
    requestId?: string;
  };
}

export interface V2Failure {
  error: V2Error;
}

export type V2Response<T> = V2Success<T> | V2Failure;

export function isV2Failure(value: unknown): value is V2Failure {
  if (!value || typeof value !== "object") return false;
  const error = (value as { error?: unknown }).error;
  return !!error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string";
}
