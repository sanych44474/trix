// Local UI atoms for the train view: duplicated rather than imported from App.tsx on purpose
// (same convention Workspace.tsx/ProfileView.tsx use) -- keeps these files free of a circular
// import back to the module that renders <TrainView />.
import { ApiError } from "../api";
import { t, type Lang } from "../i18n";

export function Card({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "accent" | "muted" }) {
  return <section className={`card card-${tone}`}>{children}</section>;
}

export function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="empty"><span className="empty-mark">—</span><strong>{title}</strong><small>{detail}</small></div>;
}

export function ErrorState({ lang, error, retry }: { lang: Lang; error: unknown; retry: () => void }) {
  const message = error instanceof ApiError && error.code === "unauthorized" ? t(lang, "unauthorized_error") : t(lang, "generic_error");
  return (
    <Card tone="muted">
      <div className="error-state">
        <strong>{message}</strong>
        <button className="button button-ghost" onClick={retry}>{t(lang, "retry")}</button>
      </div>
    </Card>
  );
}

export function Loading() {
  return <div className="view-stack"><div className="skeleton skeleton-hero" /><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>;
}
