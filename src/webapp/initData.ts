// Telegram WebApp initData validation (Workers WebCrypto).
// Spec: secret_key = HMAC_SHA256(key = "WebAppData", msg = botToken);
//       hash       = hex(HMAC_SHA256(key = secret_key, msg = data_check_string)),
// where data_check_string is all fields except `hash`, sorted, joined as "k=v" with "\n".

async function hmacKey(raw: BufferSource): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

/**
 * Verify initData authenticity and freshness. Returns the Telegram user id on success,
 * null on any failure (missing/tampered hash, stale auth_date, no user).
 */
export async function validateInitData(
  initData: string,
  botToken: string,
  maxAgeSec = 86_400,
  nowMs = Date.now(),
): Promise<{ userId: number } | null> {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return null;
  }
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const dcs = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");
  const enc = new TextEncoder();
  const secret = await crypto.subtle.sign("HMAC", await hmacKey(enc.encode("WebAppData")), enc.encode(botToken));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(dcs)));
  const hex = [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hex !== hash.toLowerCase()) return null;
  const authDate = Number(params.get("auth_date"));
  if (!authDate || nowMs / 1000 - authDate > maxAgeSec) return null;
  try {
    const user = JSON.parse(params.get("user") ?? "null") as { id?: number } | null;
    return typeof user?.id === "number" && user.id > 0 ? { userId: user.id } : null;
  } catch {
    return null;
  }
}
