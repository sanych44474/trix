// Where a user can be reached and what an uploaded image really is. Pure; test/delivery.test.ts.

/** True when the bot can message this account. Accounts created by email or Google sign-in have a
 * synthetic negative chat id and botBlocked set; a person who blocked the bot can't be messaged
 * either. Anything that used to "send it to their Telegram chat" must check this first. */
export function hasTelegramChat(user: { chatId: number; botBlocked?: boolean }): boolean {
  return user.chatId > 0 && !user.botBlocked;
}

/** Largest progress photo accepted; phone cameras stay well under this after the app's resize. */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

export type ImageType = "image/jpeg" | "image/png" | "image/webp";

/** The image type from its first bytes, ignoring whatever the client claims. null = not an image
 * we store. */
export function sniffImage(bytes: Uint8Array): ImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return "image/png";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}
