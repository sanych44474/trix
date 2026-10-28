// A render crash used to leave a blank white screen. This catches it, reports it
// (logic/errorReport) and offers a reload instead.
import { Component, type ReactNode } from "react";
import { reportError } from "./logic/errorReport";
import { t, type Lang } from "./i18n";

// A deploy replaces the lazy-loaded chunks. A tab still running the old build asks for a chunk that
// no longer exists: that is a reload away from fixed, not a crash.
const STALE_CHUNK = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;
const RELOAD_FLAG = "trix:chunk-reload";

function isStaleChunk(error: unknown): boolean {
  const e = error as { name?: unknown; message?: unknown } | null;
  return e?.name === "ChunkLoadError" || (typeof e?.message === "string" && STALE_CHUNK.test(e.message));
}

/** Reloads once per session (the flag stops a chunk that is really missing from looping). */
function reloadForStaleChunk(error: unknown): boolean {
  if (!isStaleChunk(error)) return false;
  try {
    if (sessionStorage.getItem(RELOAD_FLAG)) return false;
    sessionStorage.setItem(RELOAD_FLAG, "1");
  } catch { return false; }
  window.location.reload();
  return true;
}

export class ErrorBoundary extends Component<{ lang: Lang; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { if (!reloadForStaleChunk(error)) reportError(error); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="crash-screen">
      <strong>{t(this.props.lang, "crash_title")}</strong>
      <p>{t(this.props.lang, "crash_detail")}</p>
      <button className="button button-primary" onClick={() => window.location.reload()}>{t(this.props.lang, "crash_reload")}</button>
    </div>;
  }
}
