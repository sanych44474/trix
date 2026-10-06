// The athlete/social space: buddy, challenges, records, leaderboards, quick log and injuries.
import { useEffect, useState } from "react";
import { api, jsonBody } from "../api";
import type { Dashboard, InjuryPayload } from "../types";
import { t, type Lang } from "../i18n";
import { Buddy, Challenges, Records, Boards, Panel, WorkspaceError, ProgressBar } from "./shared";
import { AiCoachView } from "./AiCoachView";

export function SocialWorkspace({ lang, role }: { lang: Lang; role: Dashboard["viewer"]["role"] }) {
  const [data, setData] = useState<{ buddy: Buddy; challenges: Challenges; records: Records; boards: Boards } | null>(null);
  const [injuries, setInjuries] = useState<InjuryPayload | null>(null);
  const [error, setError] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [steps, setSteps] = useState("");
  const [injuryArea, setInjuryArea] = useState("");
  const [injurySeverity, setInjurySeverity] = useState("");
  const [subview, setSubview] = useState<"main" | "coach">("main");

  const load = () => {
    setError(false);
    Promise.all([
      api<Buddy>("/api/v2/buddy"),
      api<Challenges>("/api/v2/challenges"),
      api<Records>("/api/v2/records"),
      api<Boards>("/api/v2/boards"),
      api<InjuryPayload>("/api/v2/injuries"),
    ]).then(([buddy, challenges, records, boards, injuryData]) => {
      setData({ buddy, challenges, records, boards });
      setInjuries(injuryData);
      setInjuryArea(injuryData.areas[0]?.value ?? "");
      setInjurySeverity(injuryData.severities[0]?.value ?? "");
    }).catch(() => setError(true));
  };
  useEffect(load, []);

  const post = async (key: string, path: string, body: unknown) => {
    setBusy(key);
    try { await api(path, { method: "POST", idempotencyKey: crypto.randomUUID(), body: jsonBody(body) }); load(); }
    catch { setActionError(true); }
    finally { setBusy(null); }
  };

  // A client's coach is a human: the same screen routes their question to their trainer instead.
  const routed = role === "client";
  if (subview === "coach") return <AiCoachView lang={lang} routed={routed} onBack={() => setSubview("main")} />;
  if (error) return <WorkspaceError lang={lang} onRetry={load} />;
  if (!data || !injuries) return <div className="workspace-loading"><div className="skeleton" /><div className="skeleton" /></div>;
  const buddy = data.buddy.buddy;
  const board = data.boards.consistency;

  return <div className="view-stack">
    <div className="eyebrow">{t(lang, "social_eyebrow")}</div>
    {actionError && <Panel tone="muted"><div className="error-state"><strong>{t(lang, "generic_error")}</strong><button className="button button-ghost" onClick={() => setActionError(false)}>{t(lang, "close")}</button></div></Panel>}
    <div className="page-title"><h1>{t(lang, "stay_accountable_title")}</h1><span>{t(lang, "challenges_won", { n: data.challenges.won })}</span></div>
    {/* Both roles get this button: solo/trainer reach the AI coach, a client reaches their own
        trainer through it (coachApi.ts routes the question). It used to be hidden from clients,
        which left them with no coach entry point of any kind. */}
    <div className="button-row"><button className="button button-ghost" onClick={() => setSubview("coach")}>{t(lang, routed ? "ask_trainer_nav_btn" : "ai_coach_nav_btn")}</button></div>

    {buddy ? <Panel tone="accent"><div className="section-head"><div><span className="eyebrow">{t(lang, "buddy_eyebrow")}</span><h2>{buddy.name}</h2></div><span className="tag">{t(lang, "level_n", { n: buddy.level })}</span></div><p>{t(lang, "buddy_stats", { my: buddy.myWeekWorkouts, their: buddy.weekWorkouts, name: buddy.name, streak: buddy.streak })}</p><ProgressBar value={buddy.needed ? buddy.intoLevel / buddy.needed * 100 : 100} /></Panel> : <Panel><div className="section-head"><div><span className="eyebrow">{t(lang, "buddy_eyebrow")}</span><h2>{t(lang, "no_buddy_title")}</h2></div></div><p className="muted">{t(lang, "no_buddy_detail")}</p></Panel>}

    <Panel><div className="section-head"><div><span className="eyebrow">{t(lang, "challenges_eyebrow")}</span><h2>{t(lang, "build_momentum_title")}</h2></div><span className="tag">{t(lang, "n_active", { n: data.challenges.active.length })}</span></div>{data.challenges.active.length ? <div className="challenge-list">{data.challenges.active.map((challenge) => <div className="challenge-row" key={challenge.code}><div><strong>{challenge.emoji} {challenge.title}</strong><small>{t(lang, "challenge_progress_line", { current: challenge.current, target: challenge.target, n: challenge.daysLeft })}</small><ProgressBar value={challenge.pct} /></div><span className={challenge.done ? "status-badge status-done" : "status-badge"}>{challenge.done ? t(lang, "done_label") : t(lang, "pct_label", { n: Math.round(challenge.pct) })}</span></div>)}</div> : <p className="muted">{t(lang, "join_challenge_hint")}</p>}{data.challenges.available.length > 0 && <div className="button-row challenge-actions">{data.challenges.available.slice(0, 2).map((challenge) => <button className="button button-ghost" key={challenge.code} onClick={() => void post(`challenge:${challenge.code}`, "/api/v2/challenges", { code: challenge.code })} disabled={busy === `challenge:${challenge.code}`}>{busy === `challenge:${challenge.code}` ? t(lang, "joining_ellipsis") : t(lang, "join_challenge_btn", { emoji: challenge.emoji, title: challenge.title })}</button>)}</div>}</Panel>

    <Panel><div className="section-head"><div><span className="eyebrow">{t(lang, "records_eyebrow")}</span><h2>{t(lang, "proof_progress_title")}</h2></div><span className="tag">{data.records.records.length}</span></div>{data.records.records.length ? <div className="record-list">{data.records.records.slice(0, 8).map((record) => <div className="record-row" key={record.exercise}><div><strong>{record.exercise}</strong><small>{t(lang, "record_updated_metric", { updated: record.updated ?? t(lang, "recent_label"), metric: record.metric })}</small></div><span>{record.best}</span></div>)}</div> : <p className="muted">{t(lang, "no_records_hint")}</p>}{data.records.badges.some((badge) => badge.earned) && <div className="badge-list">{data.records.badges.filter((badge) => badge.earned).slice(0, 6).map((badge) => <span className="tag" key={badge.label}>{badge.label}</span>)}</div>}</Panel>

    <Panel><div className="section-head"><div><span className="eyebrow">{t(lang, "community_board_eyebrow")}</span><h2>{data.boards.optedIn ? t(lang, "consistency_label") : t(lang, "private_mode_label")}</h2></div></div>{!data.boards.optedIn ? <p className="muted">{t(lang, "board_off_hint")}</p> : board ? <><p className="muted">{t(lang, "your_rank_line", { rank: board.rank > 0 ? `#${board.rank}` : "—", total: board.total })}</p><div className="record-list">{board.top.map((entry) => <div className={entry.me ? "record-row board-me" : "record-row"} key={`${entry.pos}-${entry.name}`}><strong>#{entry.pos} {entry.name}</strong><span>{entry.value} {entry.detail}</span></div>)}</div></> : <p className="muted">{t(lang, "board_warming_hint")}</p>}</Panel>

    <Panel><div className="section-head"><div><span className="eyebrow">{t(lang, "quick_log_eyebrow")}</span><h2>{t(lang, "keep_baseline_current_title")}</h2></div></div><div className="button-row"><button className="button button-primary" onClick={() => void post("water", "/api/v2/log", { kind: "water", ml: 250 })} disabled={busy === "water"}>{busy === "water" ? "…" : t(lang, "water_250_btn")}</button><input className="compact-input" value={steps} inputMode="numeric" placeholder={t(lang, "steps_ph")} onChange={(event) => setSteps(event.target.value)} /><button className="button button-ghost" onClick={() => void post("steps", "/api/v2/log", { kind: "steps", steps: Number(steps) })} disabled={busy === "steps" || !steps}>{busy === "steps" ? "…" : t(lang, "save_steps_btn")}</button></div></Panel>

    <Panel><div className="section-head"><div><span className="eyebrow">{t(lang, "recovery_eyebrow")}</span><h2>{t(lang, "report_injury_title")}</h2></div></div>{injuries.injuries.length > 0 && <div className="injury-list">{injuries.injuries.map((injury) => <div className="record-row" key={`${injury.area}-${injury.since}`}><div><strong>{injury.area}</strong><small>{t(lang, "since_date", { date: injury.since })}</small></div><span>{injury.severity}</span></div>)}</div>}<div className="button-row"><select value={injuryArea} onChange={(event) => setInjuryArea(event.target.value)}>{injuries.areas.map((area) => <option key={area.value} value={area.value}>{area.label}</option>)}</select><select value={injurySeverity} onChange={(event) => setInjurySeverity(event.target.value)}>{injuries.severities.map((severity) => <option key={severity.value} value={severity.value}>{severity.label}</option>)}</select><button className="button button-ghost" onClick={() => void post("injury", "/api/v2/injuries", { area: injuryArea, severity: injurySeverity })} disabled={busy === "injury"}>{busy === "injury" ? t(lang, "saving_ellipsis") : t(lang, "report_btn")}</button></div></Panel>
  </div>;
}
