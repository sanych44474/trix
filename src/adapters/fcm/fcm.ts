// Firebase Cloud Messaging HTTP v1, without the Admin SDK (it doesn't run on Workers). The service
// account key is the FCM_SERVICE_ACCOUNT secret (the JSON Google hands out); it signs a short JWT
// that Google exchanges for an OAuth access token, cached until shortly before it expires.
import type { Env } from "../../types";

interface ServiceAccount { project_id: string; client_email: string; private_key: string; token_uri?: string }
export type PushResult = "sent" | "unregistered" | "retry" | "failed";
export interface PushMessage { title: string; body: string; data?: Record<string, string> }

const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const TOKEN_URI = "https://oauth2.googleapis.com/token";
let cached: { email: string; token: string; expiresAt: number } | null = null;

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlJson = (v: unknown) => b64url(new TextEncoder().encode(JSON.stringify(v)));

function pemToDer(pem: string): ArrayBuffer {
  const base64 = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)).buffer;
}

export function parseServiceAccount(raw: string | undefined): ServiceAccount | null {
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw) as Partial<ServiceAccount>;
    return sa.project_id && sa.client_email && sa.private_key ? (sa as ServiceAccount) : null;
  } catch {
    return null;
  }
}

async function accessToken(sa: ServiceAccount): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.email === sa.client_email && cached.expiresAt > now + 60) return cached.token;
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(sa.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const unsigned = `${b64urlJson({ alg: "RS256", typ: "JWT" })}.${b64urlJson({ iss: sa.client_email, scope: SCOPE, aud: sa.token_uri ?? TOKEN_URI, iat: now, exp: now + 3600 })}`;
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)));
  const res = await fetch(sa.token_uri ?? TOKEN_URI, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64url(signature)}` }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) return null;
  cached = { email: sa.client_email, token: body.access_token, expiresAt: now + (body.expires_in ?? 3600) };
  return body.access_token;
}

/** One message to one device. "unregistered" = drop the token; "retry" = rate limit or Google-side
 * error; "failed" = not configured or rejected for good. Never throws. */
export async function sendPush(env: Pick<Env, "FCM_SERVICE_ACCOUNT">, token: string, msg: PushMessage): Promise<PushResult> {
  const sa = parseServiceAccount(env.FCM_SERVICE_ACCOUNT);
  if (!sa) return "failed";
  try {
    const oauth = await accessToken(sa);
    if (!oauth) return "retry";
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: "POST",
      headers: { authorization: `Bearer ${oauth}`, "content-type": "application/json" },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: msg.title, body: msg.body },
          ...(msg.data ? { data: msg.data } : {}),
          android: { priority: "high", notification: { channel_id: "reminders" } },
        },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) return "sent";
    if (res.status === 404) return "unregistered";
    const err = (await res.json().catch(() => null)) as { error?: { status?: string; details?: { errorCode?: string }[] } } | null;
    const code = err?.error?.details?.find((d) => d.errorCode)?.errorCode ?? err?.error?.status;
    if (code === "UNREGISTERED" || (res.status === 400 && code === "INVALID_ARGUMENT")) return "unregistered";
    if (res.status === 401) cached = null;
    return res.status === 429 || res.status >= 500 || res.status === 401 ? "retry" : "failed";
  } catch {
    return "retry";
  }
}
