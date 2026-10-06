// Pure helpers for the media screens (meal photo, form check, voice): portion re-weighing of an
// AI meal estimate, image downscaling bounds and the upload limits the server enforces.

export type MealItem = { desc: string; kcal: number; protein: number; fats: number; carbs: number; grams?: number; query?: string };

/** Server limits (src/webapp/mediaApi.ts, src/bot/formCheck.ts). */
export const MAX_VIDEO_BYTES = 14 * 1024 * 1024;
export const MAX_VIDEO_SEC = 60;
export const MAX_VOICE_SEC = 60;
export const PHOTO_MAX_SIDE = 1280;

const r1 = (n: number) => Math.round(n * 10) / 10;

/** The item re-weighed to `grams`: macros scale with the portion. Unknown weight → unchanged. */
export function reweigh(item: MealItem, grams: number): MealItem {
  if (!item.grams || !Number.isFinite(grams) || grams <= 0) return item;
  const k = grams / item.grams;
  return { ...item, grams: Math.round(grams), kcal: Math.round(item.kcal * k), protein: r1(item.protein * k), fats: r1(item.fats * k), carbs: r1(item.carbs * k) };
}

export function sumMeal(items: MealItem[]): { kcal: number; protein: number; fats: number; carbs: number } {
  return items.reduce((a, i) => ({ kcal: a.kcal + i.kcal, protein: r1(a.protein + i.protein), fats: r1(a.fats + i.fats), carbs: r1(a.carbs + i.carbs) }), { kcal: 0, protein: 0, fats: 0, carbs: 0 });
}

/** Size an image is drawn at before upload: the longer side capped at `max`, aspect kept. */
export function fitWithin(width: number, height: number, max = PHOTO_MAX_SIDE): { width: number; height: number } {
  const side = Math.max(width, height);
  if (side <= max || side <= 0) return { width, height };
  const k = max / side;
  return { width: Math.round(width * k), height: Math.round(height * k) };
}

export type VideoCheck = "ok" | "too_big" | "too_long";

/** Same size/length gate as the server, checked before uploading 14 MB for nothing. */
export function videoCheck(bytes: number, seconds?: number): VideoCheck {
  if (bytes > MAX_VIDEO_BYTES) return "too_big";
  if (seconds !== undefined && seconds > MAX_VIDEO_SEC + 0.5) return "too_long";
  return "ok";
}

/** A recorder MIME type the browser supports (Telegram's Android WebView: webm/opus; iOS: mp4). */
export function pickAudioType(isSupported: (type: string) => boolean): string | undefined {
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((type) => isSupported(type));
}

/**
 * Length in seconds of an MP4 / MOV clip from its movie header ("mvhd" box), read from the file
 * bytes -- phones record ISO-BMFF video, and this avoids loading the clip into a <video>.
 * Undefined when there is no readable header (the server still caps the upload size).
 */
export function mp4Seconds(bytes: Uint8Array): number | undefined {
  for (let i = 4; i + 32 <= bytes.length; i++) {
    if (bytes[i] !== 0x6d || bytes[i + 1] !== 0x76 || bytes[i + 2] !== 0x68 || bytes[i + 3] !== 0x64) continue; // "mvhd"
    const view = new DataView(bytes.buffer, bytes.byteOffset + i + 4);
    const version = view.getUint8(0);
    const timescale = view.getUint32(version === 1 ? 20 : 12);
    const duration = version === 1 ? Number(view.getBigUint64(24)) : view.getUint32(16);
    return timescale > 0 ? duration / timescale : undefined;
  }
  return undefined;
}
