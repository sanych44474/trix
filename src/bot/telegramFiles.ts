// Downloading photos, voice notes and documents a user sent, via the Bot API file endpoint.
import { type InlineImage } from "../ai";
import { MyContext } from "../adapters/telegram/context";

export async function downloadImage(ctx: MyContext, fileId: string): Promise<InlineImage> {
  const file = await ctx.api.getFile(fileId);
  const url = `https://api.telegram.org/file/bot${ctx.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  return { mimeType: "image/jpeg", dataBase64: abToB64(buf) };
}

export async function downloadFile(ctx: MyContext, fileId: string): Promise<ArrayBuffer> {
  const file = await ctx.api.getFile(fileId);
  const url = `https://api.telegram.org/file/bot${ctx.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
  const res = await fetch(url);
  return res.arrayBuffer();
}

export function abToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
