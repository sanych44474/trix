// Squads in the app: a few friends, one weekly board of who trained. Make a squad here and invite
// people with a link (t.me/<bot>?start=sq_CODE joins it), join with a code someone sent, leave.
// Squads made with /squad in a Telegram group show up here too.
import { useEffect, useState } from "react";
import { api, typedBody } from "./api";
import { t, type Lang } from "./i18n";
import { telegramShareUrl } from "./logic/share";
import { track } from "./logic/track";
import type { SquadInfo } from "./types";

function share(link: string, text: string) {
  const url = telegramShareUrl(link, text);
  const tg = window.Telegram?.WebApp;
  if (tg?.openTelegramLink) tg.openTelegramLink(url);
  else window.open(url, "_blank", "noopener");
}

/** The code inside an invite link (…?start=sq_CODE), or the text itself if it is a bare code. */
export function inviteCodeFrom(input: string): string {
  const m = input.match(/sq_([a-z0-9]+)/i);
  return (m ? m[1] : input).trim().toLowerCase();
}

type Result = { ok: boolean; id?: number; reason?: "joined" | "already" | "not_found" | "full" | "too_many" };

export function SquadsCard({ lang }: { lang: Lang }) {
  const [squads, setSquads] = useState<SquadInfo[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [title, setTitle] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<number | null>(null);

  const load = () => api<{ squads: SquadInfo[] }>("/api/v2/squads").then((d) => { setSquads(d.squads); setFailed(false); }).catch(() => setFailed(true));
  useEffect(() => { void load(); }, []);

  const post = async (key: string, body: Parameters<typeof typedBody<"editSquads">>[0]) => {
    setBusy(key); setNote(null);
    try {
      const r = await api<Result>("/api/v2/squads", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"editSquads">(body) });
      if (!r.ok && r.reason) setNote(t(lang, `squad_app_${r.reason}`));
      else if (r.reason === "already") setNote(t(lang, "squad_app_already"));
      return r.ok;
    } catch { setNote(t(lang, "generic_error")); return false; } finally { setBusy(null); }
  };

  const create = async () => { if (await post("create", { action: "create", title: title.trim() })) { setTitle(""); track("app_squad_create"); await load(); } };
  const join = async () => { if (await post("join", { action: "join", code: inviteCodeFrom(code) })) { setCode(""); track("app_squad_join"); await load(); } };
  const leave = async (id: number) => { if (await post(`leave:${id}`, { action: "leave", id })) { setLeaving(null); await load(); } };

  return <section className="card card-default">
    <div className="section-head"><div><span className="eyebrow">{t(lang, "squads_eyebrow")}</span><h2>{t(lang, "squads_title")}</h2></div></div>
    {failed && <p className="muted">{t(lang, "generic_error")}</p>}
    {!squads && !failed && <div className="skeleton" />}
    {squads?.length === 0 && <p className="muted">{t(lang, "squad_app_intro")}</p>}
    {squads?.map((s) => <div className="squad-block" key={s.id}>
      <div className="section-head"><strong>{s.title || t(lang, "squads_default_title")}</strong><span className="tag">{t(lang, "squads_members_count", { n: s.memberCount })}</span></div>
      <div className="volume-list">{s.entries.map((e) => <div className="volume-row" key={e.name}><div><strong>{e.medal} {e.name}</strong>{e.me && <small>{t(lang, "you_label")}</small>}</div><span>{e.workouts}</span></div>)}</div>
      <p className="muted">{s.silent > 0 ? t(lang, "squads_silent_hint", { n: s.silent, total: s.total }) : t(lang, "squads_all_in_hint", { total: s.total })}</p>
      <div className="button-row">
        {s.inviteLink && <button className="button button-primary" onClick={() => share(s.inviteLink as string, t(lang, "squad_app_share_text", { title: s.title || "" }))}>{t(lang, "squad_app_invite_btn")}</button>}
        {leaving === s.id
          ? <><button className="button button-ghost danger-button" disabled={busy !== null} onClick={() => void leave(s.id)}>{t(lang, "squad_app_leave_confirm")}</button><button className="text-button" onClick={() => setLeaving(null)}>{t(lang, "close")}</button></>
          : <button className="text-button" onClick={() => setLeaving(s.id)}>{t(lang, "squad_app_leave_btn")}</button>}
      </div>
    </div>)}
    <div className="squad-forms">
      <div className="input-row"><input value={title} maxLength={40} placeholder={t(lang, "squad_app_title_ph")} onChange={(e) => setTitle(e.target.value)} /><button className="button button-ghost" disabled={!title.trim() || busy !== null} onClick={() => void create()}>{busy === "create" ? "…" : t(lang, "squad_app_create_btn")}</button></div>
      <div className="input-row"><input value={code} maxLength={200} placeholder={t(lang, "squad_app_code_ph")} onChange={(e) => setCode(e.target.value)} /><button className="button button-ghost" disabled={!code.trim() || busy !== null} onClick={() => void join()}>{busy === "join" ? "…" : t(lang, "squad_app_join_btn")}</button></div>
    </div>
    {note && <div className="save-note">{note}</div>}
  </section>;
}
