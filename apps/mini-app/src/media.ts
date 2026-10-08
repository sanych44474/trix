// Photo URLs, multipart upload and the canvas compositions behind the week card and the photo
// compare. Moved out of App.tsx verbatim; App.tsx re-exports the four public ones so every
// existing `from "./App"` import keeps working.
import { ApiError } from "./api";
import { t, type Lang } from "./i18n";
import type { WeekCardResponse } from "./types";

// ---- Extras helpers: week-card / photo-compare image composition, upload ----

/** Same debug-query passthrough api.ts's appendDebugQuery does (not exported there) -- lets a
 * localhost session without real Telegram initData still authorize via ?debugUser=. */
function debugAppend(path: string): string {
  if (window.Telegram?.WebApp?.initData) return path;
  const query = window.location.search.slice(1);
  if (!query) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${query}`;
}

function photoQuery(): string {
  const tma = window.Telegram?.WebApp?.initData;
  if (tma) return `&tma=${encodeURIComponent(tma)}`;
  return window.location.search.replace(/^\?/, "&");
}

export function photoUrl(id: number): string {
  return `/api/v2/photo?id=${id}${photoQuery()}`;
}

/** api() forces an "application/json" Content-Type on any request body, which corrupts a
 * multipart FormData upload (the browser needs to set its own boundary) -- so the two
 * image-upload endpoints (weekcard/photocompare) go through this instead, mirroring api()'s
 * auth/envelope handling but never touching Content-Type. */
export async function apiUpload(path: string, form: FormData): Promise<{ ok: boolean }> {
  const requestHeaders = new Headers();
  const initData = window.Telegram?.WebApp?.initData ?? "";
  if (initData) requestHeaders.set("Authorization", `tma ${initData}`);
  requestHeaders.set("Accept", "application/json");
  const response = await fetch(debugAppend(path), { method: "POST", headers: requestHeaders, body: form });
  let body: unknown = null;
  try { body = await response.json(); } catch { /* empty response */ }
  if (!response.ok) {
    const failure = body as { error?: { code?: string; message?: string } } | null;
    throw new ApiError(failure?.error?.code ?? "dependency_unavailable", failure?.error?.message ?? "Request failed", response.status);
  }
  if (body && typeof body === "object" && "data" in body) return (body as { data: { ok: boolean } }).data;
  return body as { ok: boolean };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
}

/** Side-by-side before/after canvas, matching the legacy vanilla webapp's photo-compare intent
 * (client composes the image; the bot has no server-side rendering) -- normalized to a common
 * height so two differently-cropped photos still line up. */
export async function composeCompare(urlA: string, urlB: string): Promise<Blob | null> {
  const [a, b] = await Promise.all([loadImage(urlA), loadImage(urlB)]);
  const h = 900;
  const wA = Math.round((a.width / a.height) * h);
  const wB = Math.round((b.width / b.height) * h);
  const canvas = document.createElement("canvas");
  canvas.width = wA + wB + 8;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#0b0d11";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(a, 0, 0, wA, h);
  ctx.drawImage(b, wA + 8, 0, wB, h);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
}

/** Canvas-rendered week-card PNG (same numbers as the text card /api/v2/weekcard already
 * returns) -- pushed to the viewer's own Telegram chat afterward, the same "webview can't offer
 * a file download" workaround every other export in this app uses. */
export function drawWeekCard(lang: Lang, stats: NonNullable<WeekCardResponse["stats"]>, name: string): HTMLCanvasElement {
  const W = 900;
  const H = 1180;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "#242b38");
  grad.addColorStop(1, "#141820");
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  g.fillStyle = "#eef1f6";
  g.font = "700 52px system-ui, -apple-system, sans-serif";
  g.fillText(`🏋️ ${name}`, 56, 130);
  g.fillStyle = "#ff5f3d";
  g.font = "400 30px system-ui, -apple-system, sans-serif";
  g.fillText(`${stats.since.slice(5)} → ${stats.until.slice(5)}`, 56, 178);
  g.strokeStyle = "rgba(255,95,61,.35)";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(56, 210);
  g.lineTo(W - 56, 210);
  g.stroke();
  const rows: [string, string][] = [
    [t(lang, "weekcard_workouts"), stats.planned ? `${stats.done}/${stats.planned}` : `${stats.done}`],
    [t(lang, "weekcard_sets"), `${stats.totalSets}`],
    [t(lang, "weekcard_volume"), `${stats.volumeKg} kg`],
    ...(stats.prs > 0 ? ([[t(lang, "weekcard_prs"), `${stats.prs} 🏆`]] as [string, string][]) : []),
    [t(lang, "metric_streak"), `${stats.streak} 🔥`],
    [t(lang, "weekcard_level"), `${stats.level} ⭐ (${stats.xp} XP)`],
  ];
  let y = 300;
  for (const [label, value] of rows) {
    g.fillStyle = "#8f99aa";
    g.font = "400 32px system-ui, -apple-system, sans-serif";
    g.fillText(label, 56, y);
    g.fillStyle = "#eef1f6";
    g.font = "700 46px system-ui, -apple-system, sans-serif";
    g.textAlign = "right";
    g.fillText(value, W - 56, y);
    g.textAlign = "left";
    y += 120;
  }
  g.fillStyle = "#4d7568";
  g.font = "400 24px system-ui, -apple-system, sans-serif";
  g.fillText("trix", 56, H - 36);
  return canvas;
}
