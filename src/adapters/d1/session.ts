// D1 read replication through the Sessions API. A Mini App request runs on a session: reads may
// be served by the nearest read replica, and the session's bookmark goes back to the client
// (x-d1-bookmark) and returns with its next request, so a user always reads at least what they
// themselves last wrote. A request without a bookmark (the app's first call) starts at the
// primary, so data written moments ago in the chat is never missing. The bot webhook keeps using
// the primary directly. Works whether or not replication is enabled on the database: without
// replicas every read simply goes to the primary.

export const BOOKMARK_HEADER = "x-d1-bookmark";
const BOOKMARK_RE = /^[A-Za-z0-9._:\-]{1,200}$/;

export interface ReadSession {
  db: D1Database; // D1Database-shaped view over the session
  bookmark(): string | null;
}

export function openReadSession(db: D1Database, bookmark: string | null): ReadSession | null {
  if (!db || typeof (db as { withSession?: unknown }).withSession !== "function") return null; // tests, old runtimes
  let session: D1DatabaseSession;
  try {
    session = db.withSession(bookmark && BOOKMARK_RE.test(bookmark) ? bookmark : "first-primary");
  } catch {
    try { session = db.withSession("first-primary"); } catch { return null; } // a stale/foreign bookmark
  }
  // The handlers are typed against D1Database; a session has prepare/batch, the rest (exec,
  // nested sessions) goes to the underlying database.
  const view = {
    prepare: (q: string) => session.prepare(q),
    batch: <T>(s: D1PreparedStatement[]) => session.batch<T>(s),
    exec: (q: string) => db.exec(q),
    withSession: (c?: string) => db.withSession(c),
    dump: () => db.dump(),
  } as unknown as D1Database;
  return { db: view, bookmark: () => { try { return session.getBookmark(); } catch { return null; } } };
}
