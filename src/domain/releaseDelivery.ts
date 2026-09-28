// Who still needs the latest release note, in the chat and in the Mini App. Two per-user marks in
// `reminders` (the JSON dedup state the scheduler already keeps): `releaseSent` -- the bot
// delivered it to their chat -- and `releaseSeen` -- they dismissed the in-app card. Either one
// means the note reached them, so it never shows twice; the Telegram broadcast can stop and
// resume without resending; someone who joined after the release isn't told what's "new".
// Pure; test/release-delivery.test.ts.
// The UserDoc fields this reads, spelled out so the Mini App can import the parser without
// pulling the Worker's types (and their Cloudflare globals) into its build.
type Reader = {
  onboarded: boolean;
  blocked?: boolean;
  botBlocked?: boolean;
  reminders?: { releaseSent?: string; releaseSeen?: string };
  createdAt: Date;
};

/** The in-app "What's new" card is due for this user and release. */
export function releaseDueInApp(user: Reader, version: string): boolean {
  if (!user.onboarded) return false;
  if (user.reminders?.releaseSeen === version || user.reminders?.releaseSent === version) return false;
  return user.createdAt.toISOString().slice(0, 10) <= version;
}

/** Telegram broadcast recipients still owed this release (reachable, not yet sent). */
export function releaseRecipients<T extends Reader>(users: T[], version: string): T[] {
  return users.filter((u) => u.onboarded && !u.blocked && !u.botBlocked && u.reminders?.releaseSent !== version);
}

export interface ReleaseItem { icon: string; title: string; body: string }

/**
 * A release-note body (the *bold* markdown in releaseNotes.ts) as cards for the Mini App: one per
 * paragraph shaped "emoji *Title* — text". The greeting line and the bot-only closing line
 * ("Tap *Menu → Dashboard*") are dropped; a paragraph without that shape keeps its text as body.
 */
export function parseReleaseNote(text: string): ReleaseItem[] {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return paragraphs
    .slice(1) // greeting
    .filter((p) => !/(Menu|Меню)\s*→/.test(p))
    .map((p) => {
      const m = /^(\S+)\s+\*([^*]+)\*\s*[—–-]?\s*([\s\S]*)$/u.exec(p);
      const strip = (s: string) => s.replace(/\*([^*]+)\*/g, "$1").replace(/_([^_]+)_/g, "$1").trim();
      // "*Title* — lowercase continuation" reads as one sentence in chat; on a card it's its own line.
      const cap = (x: string) => x.charAt(0).toLocaleUpperCase() + x.slice(1);
      return m ? { icon: m[1]!, title: strip(m[2]!), body: cap(strip(m[3]!)) } : { icon: "", title: "", body: strip(p) };
    });
}
