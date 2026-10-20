// Telegram HTML (what every notification is written in) to plain text for a push notification.
// Pure; test/push.test.ts.

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'", "&nbsp;": " " };

export function telegramHtmlToPlain(html: string): string {
  // Strip tags until nothing changes, so nested or split markup can't leave a tag behind. The
  // result is plain text for a push notification, never rendered as HTML.
  let text = html.replace(/<br\s*\/?>/gi, "\n");
  for (let previous = ""; previous !== text; ) {
    previous = text;
    text = text.replace(/<[^<>]*>/g, "");
  }
  return text
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A push shows a title and a short body: the first line is the title when the message has one. */
export function pushParts(html: string, appName: string): { title: string; body: string } {
  const plain = telegramHtmlToPlain(html);
  const [first, ...rest] = plain.split("\n");
  const body = rest.join("\n").trim();
  return body && first.length <= 60 ? { title: first, body: body.slice(0, 1000) } : { title: appName, body: plain.slice(0, 1000) };
}
