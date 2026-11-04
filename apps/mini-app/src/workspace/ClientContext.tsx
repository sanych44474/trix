// The client's context under their question in the trainer inbox: the week against the plan, the
// quests they finished and their last workouts. The server builds it (src/domain/clientSnapshot.ts);
// the trainer's Telegram message carries the same facts.
import { t, type Lang } from "../i18n";
import type { ClientSnapshot } from "../types";
import { WEEKDAY_KEYS } from "../App";
import { questText } from "../questText";

export function ClientContext({ lang, snapshot }: { lang: Lang; snapshot: ClientSnapshot }) {
  const week = snapshot.weekPlanned > 0
    ? t(lang, "qctx_week", { done: snapshot.weekDone, planned: snapshot.weekPlanned })
    : t(lang, "qctx_week_noplan", { done: snapshot.weekDone });
  const doneQuests = snapshot.quests.filter((q) => q.done);
  return <div className="client-context">
    <small><strong>{week}</strong>{snapshot.quests.length > 0 && ` · ${t(lang, "qctx_quests", { done: snapshot.questsDone, total: snapshot.quests.length })}`}</small>
    {doneQuests.length > 0 && <small>{doneQuests.map((q) => `✓ ${questText(lang, q)}`).join(" · ")}</small>}
    {snapshot.recent.length === 0 && <small>{t(lang, "qctx_none")}</small>}
    {snapshot.recent.map((w) => {
      const facts = [
        w.planned !== null ? t(lang, "qctx_ex", { done: w.done, planned: w.planned }) : t(lang, "qctx_ex_noplan", { done: w.done }),
        ...(w.durationMin ? [t(lang, "qctx_min", { n: w.durationMin })] : []),
        ...(w.rpe ? [`RPE ${w.rpe}`] : []),
        ...(w.completed ? [] : [t(lang, "qctx_unfinished")]),
      ].join(", ");
      return <small key={w.date}>
        {t(lang, WEEKDAY_KEYS[w.weekday - 1])} {w.date.slice(8, 10)}.{w.date.slice(5, 7)}{w.label ? ` · ${w.label}` : ""} — {facts}{w.top.length ? ` · ${w.top.join(", ")}` : ""}
      </small>;
    })}
    {snapshot.daysSinceLast !== null && snapshot.daysSinceLast >= 4 && <small className="client-context-gap">{t(lang, "qctx_gap", { n: snapshot.daysSinceLast })}</small>}
  </div>;
}
