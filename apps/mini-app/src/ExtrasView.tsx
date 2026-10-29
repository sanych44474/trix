// The "More" screen (lazy chunk), in three groups: training (programs, form check), people (invite,
// trainers, squads) and the app (import, release notes, shortcuts, support). The week card and photo
// compare live on Progress, the plate calculator on Training.
import { FormCheck } from "./media/FormCheck";
import { ImportCsv } from "./media/ImportCsv";
import { SquadsCard } from "./Squads";
import { ReadyPrograms } from "./ReadyPrograms";
import { FindTrainer } from "./FindTrainer";
import { useEffect, useState } from "react";
import { api, typedBody } from "./api";
import type { Dashboard, LibraryProgram, LibraryResponse } from "./types";
import { t, type Lang } from "./i18n";
import type { View } from "./logic/navigation";
import { Icon, type IconName } from "./icons";
import { AndroidAppCard, AppShortcutsCard, SupportCard } from "./TelegramExtras";
import { ReleaseItems } from "./WhatsNew";
import type { ReleaseItem } from "./logic/releaseDelivery";
import { BecomeTrainerCard } from "./BecomeTrainer";
import { Empty, ErrorState } from "./App";
import { Fold } from "./Fold";

export function ExtrasView({ lang, role, links = [], onOpen }: { lang: Lang; role: Dashboard["viewer"]["role"]; links?: Array<{ view: View; label: string }>; onOpen?: (view: View) => void }) {
  // invite: the referral link rides /api/v2/profile -- self-scoped, unlike /api/v2/weekcard's
  // clientId-delegatable response, which is why it is fetched here and not with the week card.
  const [referral, setReferral] = useState<{ referralLink: string; referredCount: number } | null>(null);
  useEffect(() => { api<{ referralLink: string; referredCount: number }>("/api/v2/profile").then((data) => setReferral({ referralLink: data.referralLink, referredCount: data.referredCount })).catch(() => {}); }, []);
  const [inviteCopied, setInviteCopied] = useState(false);
  const copyInviteLink = () => {
    if (!referral?.referralLink) return;
    navigator.clipboard?.writeText(referral.referralLink).then(() => { setInviteCopied(true); setTimeout(() => setInviteCopied(false), 2500); }).catch(() => {});
  };
  // program library
  const [library, setLibrary] = useState<LibraryResponse | null>(null);
  const [libraryError, setLibraryError] = useState<unknown>(null);
  const loadLibrary = () => { setLibraryError(null); api<LibraryResponse>("/api/v2/library").then(setLibrary).catch(setLibraryError); };
  useEffect(loadLibrary, []);
  const [takingCode, setTakingCode] = useState<string | null>(null);
  const [takenName, setTakenName] = useState<string | null>(null);
  const takeProgram = async (program: LibraryProgram) => {
    setTakingCode(program.code); setTakenName(null);
    try { await api("/api/v2/library", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"takeLibraryProgram">({ code: program.code }) }); setTakenName(program.name); }
    catch (err) { setLibraryError(err); } finally { setTakingCode(null); }
  };

  // Choose a trainer: the directory of approved trainers taking clients (FindTrainer), full screen.
  const [findTrainer, setFindTrainer] = useState(false);
  // One section open at a time: the page is a menu of tools, not a feed of cards.
  const [fold, setFold] = useState<string | null>(null);
  const toggleFold = (key: string) => setFold((current) => current === key ? null : key);

  // /api/v2/whatsnew was registered in v2Api.ts but nothing ever called it -- the release note
  // was reachable only through the bot's /whatsnew command. It's Telegram-HTML, so it's stripped
  // to plain text the same way the owner report is.
  const [whatsnew, setWhatsnew] = useState<{ version: string; html: string; text?: string; items?: ReleaseItem[] } | null>(null);
  useEffect(() => { api<{ version: string; html: string; text?: string; items?: ReleaseItem[] }>("/api/v2/whatsnew").then(setWhatsnew).catch(() => setWhatsnew(null)); }, []);

  if (findTrainer) return <FindTrainer lang={lang} onBack={() => setFindTrainer(false)} onAccepted={() => window.location.reload()} />;

  return <div className="view-stack">
    <div className="page-title"><h1>{t(lang, "extras_title")}</h1></div>
    {links.length > 0 && onOpen && <div className="list">
      {links.map((link) => <button type="button" key={link.view} className="list-item" onClick={() => onOpen(link.view)}><Icon name={link.view as IconName} /><span className="grow">{link.label}</span><Icon name="chevron" size={20} className="row-chevron" /></button>)}
    </div>}

    <h2 className="group-head eyebrow">{t(lang, "more_group_training")}</h2>
    <div className="fold-group">
      <Fold title={t(lang, "rp_eyebrow")} open={fold === "rp_title"} onToggle={() => toggleFold("rp_title")}>
        <p className="muted">{t(lang, "rp_detail")}</p>
        <ReadyPrograms lang={lang} />
      </Fold>
      <Fold title={t(lang, "library_title")} open={fold === "library_title"} onToggle={() => toggleFold("library_title")}>
        {libraryError !== null ? <ErrorState lang={lang} error={libraryError} retry={loadLibrary} /> : !library ? <div className="skeleton" /> : library.programs.length === 0 ? <Empty title={t(lang, "library_empty_title")} detail={t(lang, "library_empty_detail")} /> : <div className="plan-list">{library.programs.map((p) => <div className="plan-row" key={p.code}><div><strong>{p.name}</strong><small>{t(lang, "library_taken_count", { n: p.takenCount })}</small></div>{library.role !== "client" && <button className="button button-ghost" disabled={takingCode !== null} onClick={() => void takeProgram(p)}>{takingCode === p.code ? "…" : t(lang, "library_take_btn")}</button>}</div>)}</div>}
        {takenName && <div className="save-note">{t(lang, "library_taken_note", { name: takenName })}</div>}
      </Fold>
      <Fold title={t(lang, "form_check_title")} open={fold === "form_check_title"} onToggle={() => toggleFold("form_check_title")}>
        <FormCheck lang={lang} />
      </Fold>
    </div>

    <h2 className="group-head eyebrow">{t(lang, "more_group_people")}</h2>
    <div className="fold-group">
      <Fold title={t(lang, "invite_title")} open={fold === "invite_title"} onToggle={() => toggleFold("invite_title")} meta={referral && referral.referredCount > 0 && <span className="tag">{t(lang, "invite_count", { n: referral.referredCount })}</span>}>
        {!referral ? <div className="skeleton" /> : !referral.referralLink ? null : <>
          <p className="muted">{t(lang, "invite_detail")}</p>
          <div className="input-row"><input readOnly value={referral.referralLink} onFocus={(event) => event.target.select()} /><button className="button button-primary" onClick={copyInviteLink}>{inviteCopied ? t(lang, "invite_copied_note") : t(lang, "invite_copy_btn")}</button></div>
        </>}
      </Fold>
      {role === "solo" && <Fold title={t(lang, "trainer_find_eyebrow")} open={fold === "trainer_find_title"} onToggle={() => toggleFold("trainer_find_title")}>
        <p className="muted">{t(lang, "trainer_find_app_detail")}</p>
        <div className="button-row"><button className="button button-primary" onClick={() => setFindTrainer(true)}>{t(lang, "ob_role_trainer_btn")}</button></div>
      </Fold>}
      <Fold title={t(lang, "squads_title")} open={fold === "squads_title"} onToggle={() => toggleFold("squads_title")}><SquadsCard lang={lang} /></Fold>
      {role === "solo" && <Fold title={t(lang, "become_trainer_eyebrow")} open={fold === "become_trainer_title"} onToggle={() => toggleFold("become_trainer_title")}><BecomeTrainerCard lang={lang} role={role} /></Fold>}
    </div>
    {role === "trainer" && <BecomeTrainerCard lang={lang} role={role} />}

    <h2 className="group-head eyebrow">{t(lang, "more_group_app")}</h2>
    <div className="fold-group">
      <Fold title={t(lang, "import_app_title")} open={fold === "import_app_title"} onToggle={() => toggleFold("import_app_title")}>
        <ImportCsv lang={lang} />
      </Fold>
      {whatsnew && <Fold title={t(lang, "whatsnew_eyebrow")} open={fold === "whatsnew_title"} onToggle={() => toggleFold("whatsnew_title")}>
        {whatsnew.items || whatsnew.text ? <ReleaseItems items={whatsnew.items} text={whatsnew.text} /> : <pre className="owner-report">{whatsnew.html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")}</pre>}
      </Fold>}
    </div>
    <AppShortcutsCard lang={lang} />
    <AndroidAppCard lang={lang} />
    <SupportCard lang={lang} />
  </div>;
}
