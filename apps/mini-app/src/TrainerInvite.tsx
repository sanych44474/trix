// "Invite clients" for a trainer: the shareable profile link (t.me/<bot>?start=tr_<code>) with
// Telegram's share sheet and a copy button, plus single-use personal invites for a named person
// (the same trp_<code> links the bot's "➕ Personal invite" makes). GET/POST /api/v2/trainer/invite.
import { useEffect, useState } from "react";
import { api, typedBody } from "./api";
import { t, type Lang } from "./i18n";
import type { TrainerInvite, TrainerProspectInvite } from "./types";
import { telegramShareUrl } from "./logic/share";

function share(link: string, text: string) {
  const url = telegramShareUrl(link, text);
  const tg = window.Telegram?.WebApp;
  if (tg?.openTelegramLink) tg.openTelegramLink(url);
  else window.open(url, "_blank", "noopener");
}

function LinkRow({ lang, link, text }: { lang: Lang; link: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2500); }).catch(() => {});
  };
  return <>
    <div className="input-row"><input readOnly value={link} onFocus={(event) => event.target.select()} aria-label={t(lang, "tinvite_link_label")} /></div>
    <div className="button-row">
      <button className="button button-primary" onClick={() => share(link, text)}>{t(lang, "tinvite_share_btn")}</button>
      <button className="button button-ghost" onClick={copy}>{copied ? t(lang, "invite_copied_note") : t(lang, "invite_copy_btn")}</button>
    </div>
  </>;
}

export function TrainerInviteCard({ lang }: { lang: Lang }) {
  const [data, setData] = useState<TrainerInvite | null>(null);
  const [failed, setFailed] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [fresh, setFresh] = useState<TrainerProspectInvite | null>(null);
  useEffect(() => { api<TrainerInvite>("/api/v2/trainer/invite").then(setData).catch(() => setFailed(true)); }, []);
  if (failed || !data) return null;

  const create = async () => {
    setBusy(true); setError(false);
    try {
      const invite = await api<TrainerProspectInvite>("/api/v2/trainer/invite", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"createTrainerInvite">({ name: name.trim() }) });
      setFresh(invite);
      setName("");
      setData((current) => current ? { ...current, prospects: [invite, ...current.prospects] } : current);
    } catch { setError(true); } finally { setBusy(false); }
  };
  const full = data.maxClients != null && data.clients >= data.maxClients;
  const personalText = (who: string) => t(lang, "tinvite_personal_text", { name: who });

  return <section id="trainer-invite" className="card card-default trainer-invite">
    <div className="section-head"><div><span className="eyebrow">{t(lang, "tinvite_eyebrow")}</span><h2>{t(lang, "tinvite_title")}</h2></div>
      <span className="tag">{data.maxClients != null ? `${data.clients}/${data.maxClients}` : `${data.clients}`}</span></div>
    {!data.approved ? <p>{t(lang, "tinvite_pending")}</p> : !data.link ? <p>{t(lang, "tinvite_no_bot")}</p> : <>
      <p>{t(lang, "tinvite_body")}</p>
      {(!data.accepting || full) && <p className="muted">{t(lang, full ? "tinvite_full" : "tinvite_closed")}</p>}
      <LinkRow lang={lang} link={data.link} text={data.shareText} />
      <h3 className="trainer-invite-sub">{t(lang, "tinvite_personal_title")}</h3>
      <p className="muted">{t(lang, "tinvite_personal_body")}</p>
      <div className="input-row">
        <input value={name} maxLength={60} placeholder={t(lang, "tinvite_name_ph")} onChange={(event) => setName(event.target.value)} />
        <button className="button button-ghost" disabled={busy || name.trim().length < 2} onClick={() => void create()}>{busy ? "…" : t(lang, "tinvite_create_btn")}</button>
      </div>
      {error && <p className="muted">{t(lang, "generic_error")}</p>}
      {fresh && <div className="trainer-invite-fresh"><strong>{fresh.name}</strong><LinkRow lang={lang} link={fresh.link} text={personalText(fresh.name)} /></div>}
      {data.prospects.filter((p) => p.link !== fresh?.link).length > 0 && <>
        <small className="muted">{t(lang, "tinvite_waiting")}</small>
        <ul className="trainer-invite-list">{data.prospects.filter((p) => p.link !== fresh?.link).map((p) => <li key={p.link}>
          <span>{p.name}</span>
          <button className="text-button" onClick={() => share(p.link, personalText(p.name))}>{t(lang, "tinvite_share_btn")}</button>
        </li>)}</ul>
      </>}
    </>}
  </section>;
}
