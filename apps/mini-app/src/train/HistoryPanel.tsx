import { t, type Lang } from "../i18n";
import { fmtDuration } from "../logic/rest";
import type { WorkoutHistoryItem } from "../types";
import { Card, Empty, ErrorState, Loading } from "./ui";

export function HistoryPanel(props: {
  lang: Lang;
  tabs: React.ReactNode;
  history: WorkoutHistoryItem[] | null;
  error: unknown;
  busy: string | null;
  todayDate: string;
  minMissedDate: string;
  missedDate: string;
  onRetry: () => void;
  onRepeat: (date: string) => void;
  onFillFrom: (targetDate: string, sourceDate: string) => void;
  onStartBlank: (date: string) => void;
  onPickMissed: (date: string) => void;
}) {
  const { lang, history, error, busy, missedDate } = props;
  const busyLabel = (key: string, idle: string) => busy === key ? t(lang, "saving_ellipsis") : idle;
  return (
    <div className="view-stack">
      <div className="eyebrow">{t(lang, "history_eyebrow")}</div>
      <div className="page-title"><h1>{t(lang, "history_title")}</h1></div>
      {props.tabs}
      {error !== null && <ErrorState lang={lang} error={error} retry={props.onRetry} />}
      {error === null && history === null && <Loading />}
      {error === null && history !== null && (history.length === 0
        ? <Empty title={t(lang, "history_empty_title")} detail={t(lang, "history_empty_detail")} />
        : (
          <div className="exercise-list">
            {history.map((item) => (
              <Card key={item.date}>
                <div className="exercise-head">
                  <div><h2>{item.date}</h2></div>
                  <span className="tag">{t(lang, "history_row_exercises", { n: item.n })}{item.durationSec ? ` · ${fmtDuration(item.durationSec)}` : ""}</span>
                </div>
                <p className="muted">{item.title}</p>
                <div className="button-row">
                  <button className="button button-primary" disabled={busy !== null} onClick={() => props.onRepeat(item.date)}>{busyLabel(`repeat:${item.date}`, t(lang, "repeat_btn"))}</button>
                  <button className="button button-ghost" disabled={busy !== null} onClick={() => props.onFillFrom(item.date, item.date)}>{busyLabel(`fill:${item.date}`, t(lang, "train_edit_saved_btn"))}</button>
                  {item.date >= props.minMissedDate && item.date < props.todayDate && (
                    <button className="button button-ghost" disabled={busy !== null} onClick={() => props.onPickMissed(item.date)}>{t(lang, "log_missed_btn")}</button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        ))}
      <Card tone="muted">
        <div className="section-head">
          <div><span className="eyebrow">{t(lang, "log_missed_eyebrow")}</span><h2>{t(lang, "log_missed_title")}</h2></div>
        </div>
        <p className="muted">{t(lang, "log_missed_detail")}</p>
        <div className="input-row">
          <label className="form-field">
            <span>{t(lang, "pick_date_label")}</span>
            <input type="date" min={props.minMissedDate} max={props.todayDate} value={missedDate} onChange={(event) => props.onPickMissed(event.target.value)} />
          </label>
        </div>
        {missedDate && (
          <div className="button-row">
            <button className="button button-primary" disabled={busy !== null} onClick={() => props.onStartBlank(missedDate)}>{busyLabel(`blank:${missedDate}`, t(lang, "start_blank_btn"))}</button>
            {(history ?? []).filter((item) => item.date !== missedDate).slice(0, 3).map((item) => (
              <button key={item.date} className="button button-ghost" disabled={busy !== null} onClick={() => props.onFillFrom(missedDate, item.date)}>
                {busy === `fill:${item.date}` ? t(lang, "saving_ellipsis") : `${t(lang, "use_these_exercises_btn")} (${item.date})`}
              </button>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
