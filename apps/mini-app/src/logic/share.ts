// Telegram's share sheet for a link (the user picks the chat). Mirrors src/bot/links.ts shareUrl.
export function telegramShareUrl(link: string, text: string): string {
  return `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
}
