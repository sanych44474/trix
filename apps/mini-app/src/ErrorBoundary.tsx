// A render crash used to leave a blank white screen. This catches it, reports it
// (logic/errorReport) and offers a reload instead.
import { Component, type ReactNode } from "react";
import { reportError } from "./logic/errorReport";
import { t, type Lang } from "./i18n";

export class ErrorBoundary extends Component<{ lang: Lang; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { reportError(error); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="crash-screen">
      <strong>{t(this.props.lang, "crash_title")}</strong>
      <p>{t(this.props.lang, "crash_detail")}</p>
      <button className="button button-primary" onClick={() => window.location.reload()}>{t(this.props.lang, "crash_reload")}</button>
    </div>;
  }
}
