import { useEffect, useState } from "react";
import { api, jsonBody } from "./api";
import type { Dashboard } from "./types";

type WorkspaceProps = { dashboard: Dashboard };

type Buddy = {
  buddy: null | {
    name: string;
    level: number;
    xp: number;
    intoLevel: number;
    needed: number;
    streak: number;
    weekWorkouts: number;
    myWeekWorkouts: number;
    week: Array<{ date: string; ex: string[] }>;
    duel: { myWins: number; theirWins: number; myStreak: number };
  };
};

type Challenges = {
  active: Array<{ code: string; emoji: string; title: string; current: number; target: number; pct: number; done: boolean; daysLeft: number }>;
  available: Array<{ code: string; emoji: string; title: string; target: number; windowDays: number }>;
  won: number;
};

type Records = {
  records: Array<{ exercise: string; best: string; metric: string; updated: string | null }>;
  badges: Array<{ label: string; earned: boolean }>;
};

type Boards = {
  optedIn: boolean;
  consistency?: { rank: number; total: number; top: Array<{ pos: number; name: string; value: number; detail: string; me: boolean }> };
};

type TrainerQuestions = { questions: Array<{ id: number; clientId: number; client: string; text: string; draft: string; status: string }> };
type TrainerRequests = { requests: Array<{ id: number; clientId: number; name: string; note: string }> };
type OwnerReport = { html: string };
type OwnerUsers = { rows: Array<{ id?: number; name?: string; [key: string]: unknown }>; feedback: Array<{ who: string; date: string; text: string }> };
type InjuryPayload = {
  injuries: Array<{ area: string; severity: string; since: string; lastScore: number | null }>;
  areas: Array<{ value: string; label: string }>;
  severities: Array<{ value: string; label: string }>;
};

function Panel({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "accent" | "muted" }) {
  return <section className={`card card-${tone}`}>{children}</section>;
}

function WorkspaceError({ onRetry }: { onRetry: () => void }) {
  return <Panel tone="muted"><div className="error-state"><strong>Workspace data is unavailable.</strong><button className="button button-ghost" onClick={onRetry}>Retry</button></div></Panel>;
}

function ProgressBar({ value }: { value: number }) {
  return <div className="progress-track" aria-label={`${Math.round(value)}%`}><span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}

function SocialWorkspace() {
  const [data, setData] = useState<{ buddy: Buddy; challenges: Challenges; records: Records; boards: Boards } | null>(null);
  const [injuries, setInjuries] = useState<InjuryPayload | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [steps, setSteps] = useState("");
  const [injuryArea, setInjuryArea] = useState("");
  const [injurySeverity, setInjurySeverity] = useState("");

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
    catch { setError(true); }
    finally { setBusy(null); }
  };

  if (error) return <WorkspaceError onRetry={load} />;
  if (!data || !injuries) return <div className="workspace-loading"><div className="skeleton" /><div className="skeleton" /></div>;
  const buddy = data.buddy.buddy;
  const board = data.boards.consistency;

  return <div className="view-stack">
    <div className="eyebrow">CONNECT · SOCIAL · RECORDS</div>
    <div className="page-title"><h1>Stay accountable</h1><span>{data.challenges.won} challenges won</span></div>

    {buddy ? <Panel tone="accent"><div className="section-head"><div><span className="eyebrow">BUDDY</span><h2>{buddy.name}</h2></div><span className="tag">Level {buddy.level}</span></div><p>{buddy.myWeekWorkouts} sessions for you · {buddy.weekWorkouts} for {buddy.name} · {buddy.streak} week streak</p><ProgressBar value={buddy.needed ? buddy.intoLevel / buddy.needed * 100 : 100} /></Panel> : <Panel><div className="section-head"><div><span className="eyebrow">BUDDY</span><h2>No buddy connected</h2></div></div><p className="muted">Invite a training partner from Telegram to compare consistency and keep the loop alive.</p></Panel>}

    <Panel><div className="section-head"><div><span className="eyebrow">CHALLENGES</span><h2>Build momentum</h2></div><span className="tag">{data.challenges.active.length} active</span></div>{data.challenges.active.length ? <div className="challenge-list">{data.challenges.active.map((challenge) => <div className="challenge-row" key={challenge.code}><div><strong>{challenge.emoji} {challenge.title}</strong><small>{challenge.current} / {challenge.target} · {challenge.daysLeft} days left</small><ProgressBar value={challenge.pct} /></div><span className={challenge.done ? "status-badge status-done" : "status-badge"}>{challenge.done ? "Done" : `${Math.round(challenge.pct)}%`}</span></div>)}</div> : <p className="muted">Join a challenge to give this week a clear target.</p>}{data.challenges.available.length > 0 && <div className="button-row challenge-actions">{data.challenges.available.slice(0, 2).map((challenge) => <button className="button button-ghost" key={challenge.code} onClick={() => void post(`challenge:${challenge.code}`, "/api/v2/challenges", { code: challenge.code })} disabled={busy === `challenge:${challenge.code}`}>{busy === `challenge:${challenge.code}` ? "Joining…" : `Join ${challenge.emoji} ${challenge.title}`}</button>)}</div>}</Panel>

    <Panel><div className="section-head"><div><span className="eyebrow">PERSONAL RECORDS</span><h2>Proof of progress</h2></div><span className="tag">{data.records.records.length}</span></div>{data.records.records.length ? <div className="record-list">{data.records.records.slice(0, 8).map((record) => <div className="record-row" key={record.exercise}><div><strong>{record.exercise}</strong><small>{record.updated ?? "recent"} · {record.metric}</small></div><span>{record.best}</span></div>)}</div> : <p className="muted">Complete a strength session to establish your first record.</p>}{data.records.badges.some((badge) => badge.earned) && <div className="badge-list">{data.records.badges.filter((badge) => badge.earned).slice(0, 6).map((badge) => <span className="tag" key={badge.label}>{badge.label}</span>)}</div>}</Panel>

    <Panel><div className="section-head"><div><span className="eyebrow">COMMUNITY BOARD</span><h2>{data.boards.optedIn ? "Consistency" : "Private mode"}</h2></div></div>{!data.boards.optedIn ? <p className="muted">Leaderboard sharing is off. Enable competition from the bot settings when you want to compare.</p> : board ? <><p className="muted">Your rank: {board.rank > 0 ? `#${board.rank}` : "—"} of {board.total}</p><div className="record-list">{board.top.map((entry) => <div className={entry.me ? "record-row board-me" : "record-row"} key={`${entry.pos}-${entry.name}`}><strong>#{entry.pos} {entry.name}</strong><span>{entry.value} {entry.detail}</span></div>)}</div></> : <p className="muted">The board is warming up. Check back after the next metrics refresh.</p>}</Panel>

    <Panel><div className="section-head"><div><span className="eyebrow">QUICK LOG</span><h2>Keep the baseline current</h2></div></div><div className="button-row"><button className="button button-primary" onClick={() => void post("water", "/api/v2/log", { kind: "water", ml: 250 })} disabled={busy === "water"}>{busy === "water" ? "…" : "+250 ml water"}</button><input className="compact-input" value={steps} inputMode="numeric" placeholder="steps" onChange={(event) => setSteps(event.target.value)} /><button className="button button-ghost" onClick={() => void post("steps", "/api/v2/log", { kind: "steps", steps: Number(steps) })} disabled={busy === "steps" || !steps}>{busy === "steps" ? "…" : "Save steps"}</button></div></Panel>

    <Panel><div className="section-head"><div><span className="eyebrow">RECOVERY</span><h2>Report an injury</h2></div></div>{injuries.injuries.length > 0 && <div className="injury-list">{injuries.injuries.map((injury) => <div className="record-row" key={`${injury.area}-${injury.since}`}><div><strong>{injury.area}</strong><small>since {injury.since}</small></div><span>{injury.severity}</span></div>)}</div>}<div className="button-row"><select value={injuryArea} onChange={(event) => setInjuryArea(event.target.value)}>{injuries.areas.map((area) => <option key={area.value} value={area.value}>{area.label}</option>)}</select><select value={injurySeverity} onChange={(event) => setInjurySeverity(event.target.value)}>{injuries.severities.map((severity) => <option key={severity.value} value={severity.value}>{severity.label}</option>)}</select><button className="button button-ghost" onClick={() => void post("injury", "/api/v2/injuries", { area: injuryArea, severity: injurySeverity })} disabled={busy === "injury"}>{busy === "injury" ? "Saving…" : "Report"}</button></div></Panel>
  </div>;
}

function TrainerWorkspace({ dashboard }: WorkspaceProps) {
  const [questions, setQuestions] = useState<TrainerQuestions | null>(null);
  const [requests, setRequests] = useState<TrainerRequests | null>(null);
  const [broadcast, setBroadcast] = useState("");
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const load = () => Promise.all([api<TrainerQuestions>("/api/v2/trainer/questions"), api<TrainerRequests>("/api/v2/requests")]).then(([q, r]) => { setQuestions(q); setRequests(r); });
  useEffect(() => { void load().catch(() => setError(true)); }, []);
  const act = async (path: string, body: unknown) => { setBusy(true); try { await api(path, { method: "POST", idempotencyKey: crypto.randomUUID(), body: jsonBody(body) }); await load(); } catch { setError(true); } finally { setBusy(false); } };
  if (error) return <WorkspaceError onRetry={() => { setError(false); void load().catch(() => setError(true)); }} />;
  return <div className="view-stack"><div className="eyebrow">TRAINER WORKSPACE</div><div className="page-title"><h1>Coach the right thing</h1><span>{dashboard.trainer?.clients.length ?? 0} clients</span></div><Panel tone="accent"><div className="section-head"><div><span className="eyebrow">CLIENT PULSE</span><h2>Needs attention first</h2></div></div><div className="client-list">{(dashboard.trainer?.clients ?? []).slice(0, 8).map((client) => <div className="client-row" key={client.id}><div><strong>{client.name}</strong><small>{client.workoutPct}% workout · {client.nutritionPct}% nutrition</small></div><span className={client.atRisk || client.flagged ? "status-badge status-attention" : "status-badge"}>{client.flagged ? "Flagged" : client.atRisk ? "At risk" : "On track"}</span></div>)}</div></Panel><Panel><div className="section-head"><div><span className="eyebrow">REQUESTS</span><h2>New client requests</h2></div><span className="tag">{requests?.requests.length ?? 0}</span></div>{requests?.requests.length ? <div className="client-list">{requests.requests.map((request) => <div className="client-row" key={request.id}><div><strong>{request.name}</strong><small>{request.note || "No note"}</small></div><div className="button-row"><button className="button button-primary" disabled={busy} onClick={() => void act("/api/v2/requests", { id: request.id, action: "accept" })}>Accept</button><button className="button button-ghost" disabled={busy} onClick={() => void act("/api/v2/requests", { id: request.id, action: "decline" })}>Decline</button></div></div>)}</div> : <p className="muted">No pending requests.</p>}</Panel><Panel><div className="section-head"><div><span className="eyebrow">CLIENT QUESTIONS</span><h2>Close the loop</h2></div><span className="tag">{questions?.questions.filter((q) => q.status !== "answered").length ?? 0} open</span></div>{questions?.questions.length ? <div className="question-list">{questions.questions.slice(0, 8).map((question) => <div className="question-card" key={question.id}><strong>{question.client}</strong><p>{question.text}</p>{question.status === "answered" ? <small className="muted">Answered</small> : <div className="input-row"><input value={answers[question.id] ?? question.draft} placeholder="Write a useful answer" onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} /><button className="button button-primary" disabled={busy || !answers[question.id]?.trim()} onClick={() => void act(`/api/v2/trainer/question/${question.id}/answer`, { text: answers[question.id] })}>Send</button></div>}</div>)}</div> : <p className="muted">Questions from clients will appear here.</p>}</Panel><Panel><div className="section-head"><div><span className="eyebrow">BROADCAST</span><h2>One clear message</h2></div></div><div className="input-row"><input value={broadcast} maxLength={2000} placeholder="Message all active clients" onChange={(event) => setBroadcast(event.target.value)} /><button className="button button-ghost" disabled={busy || !broadcast.trim()} onClick={() => void act("/api/v2/trainer/broadcast", { text: broadcast })}>Send to clients</button></div></Panel></div>;
}

function OwnerWorkspace() {
  const [report, setReport] = useState<OwnerReport | null>(null);
  const [users, setUsers] = useState<OwnerUsers | null>(null);
  const [sent, setSent] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const load = () => { setError(false); Promise.all([api<OwnerReport>("/api/v2/owner/report?section=overview"), api<OwnerUsers>("/api/v2/owner/users")]).then(([nextReport, nextUsers]) => { setReport(nextReport); setUsers(nextUsers); }).catch(() => setError(true)); };
  useEffect(load, []);
  const askInactive = async () => { try { const result = await api<{ sent: number }>("/api/v2/owner/ask-inactive", { method: "POST", idempotencyKey: crypto.randomUUID(), body: jsonBody({}) }); setSent(result.sent); } catch { setError(true); } };
  if (error) return <WorkspaceError onRetry={load} />;
  if (!report || !users) return <div className="workspace-loading"><div className="skeleton" /><div className="skeleton" /></div>;
  return <div className="view-stack"><div className="eyebrow">OWNER OPERATIONS</div><div className="page-title"><h1>System pulse</h1><span>{users.rows.length} users</span></div><Panel><div className="section-head"><div><span className="eyebrow">OVERVIEW</span><h2>Live report</h2></div><button className="button button-ghost" onClick={() => void askInactive()}>Ask inactive users</button></div><pre className="owner-report">{report.html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")}</pre>{sent !== null && <div className="save-note">Sent to {sent} users.</div>}</Panel><Panel><div className="section-head"><div><span className="eyebrow">ROSTER</span><h2>Recent users</h2></div></div><div className="client-list">{users.rows.slice(0, 12).map((user, index) => <div className="client-row" key={`${user.id ?? index}-${index}`}><strong>{String(user.name ?? user.id ?? `User ${index + 1}`)}</strong><span className="status-badge">#{index + 1}</span></div>)}</div></Panel></div>;
}

export function WorkspaceView({ dashboard }: WorkspaceProps) {
  if (dashboard.owner) return <OwnerWorkspace />;
  if (dashboard.viewer.role === "trainer") return <TrainerWorkspace dashboard={dashboard} />;
  return <SocialWorkspace />;
}
