// The "More" screen (lazy chunk): library, squads, plates, week card, profile photo, extras.
import { FormCheck } from "./media/FormCheck";
import { ImportCsv } from "./media/ImportCsv";
import { SquadsCard } from "./Squads";
import { ReadyPrograms } from "./ReadyPrograms";
import { FindTrainer } from "./FindTrainer";
import { useEffect, useState } from "react";
import { api, typedBody } from "./api";
import type { Dashboard, LibraryProgram, LibraryResponse, PlatesResponse, ProfilePhoto, WeekCardResponse } from "./types";
import { t, type Lang } from "./i18n";
import type { View } from "./logic/navigation";
import { Icon, type IconName } from "./icons";
import { AppShortcutsCard, SupportCard, WeekStoryButton } from "./TelegramExtras";
import { ReleaseItems } from "./WhatsNew";
import type { ReleaseItem } from "./logic/releaseDelivery";
import { BecomeTrainerCard } from "./BecomeTrainer";
import { formatNumber, Metric, Empty, ErrorState, photoUrl, apiUpload, composeCompare, drawWeekCard } from "./App";

export function ExtrasView({ lang, role, links = [], onOpen }: { lang: Lang; role: Dashboard["viewer"]["role"]; links?: Array<{ view: View; label: string }>; onOpen?: (view: View) => void }) {
  // week card
  const [week, setWeek] = useState<WeekCardResponse | null>(null);
  const [weekError, setWeekError] = useState<unknown>(null);
  const [weekBusy, setWeekBusy] = useState(false);
  const [weekSent, setWeekSent] = useState(false);
  const [weekCanvasUrl, setWeekCanvasUrl] = useState<string | null>(null);
  const [weekBlob, setWeekBlob] = useState<Blob | null>(null);
  const loadWeek = () => { setWeekError(null); api<WeekCardResponse>("/api/v2/weekcard").then(setWeek).catch(setWeekError); };
  useEffect(loadWeek, []);
  const generateWeekCard = () => {
    if (!week?.stats) return;
    const canvas = drawWeekCard(lang, week.stats, week.name);
    canvas.toBlob((blob) => { if (!blob) return; setWeekBlob(blob); setWeekCanvasUrl(URL.createObjectURL(blob)); });
  };
  const sendWeekCard = async () => {
    if (!weekBlob) return;
    setWeekBusy(true); setWeekSent(false);
    try {
      const form = new FormData();
      form.append("photo", weekBlob, "weekcard.png");
      await apiUpload("/api/v2/weekcard", form);
      setWeekSent(true);
    } catch (err) { setWeekError(err); } finally { setWeekBusy(false); }
  };

  // photo compare + invite (both ride the same /api/v2/profile GET this view already fetches
  // for photos -- self-scoped, unlike /api/v2/weekcard's clientId-delegatable response, which is
  // why the referral link lives here and not on the week-card fetch).
  const [photos, setPhotos] = useState<ProfilePhoto[] | null>(null);
  const [photosError, setPhotosError] = useState<unknown>(null);
  const [referral, setReferral] = useState<{ referralLink: string; referredCount: number } | null>(null);
  const loadPhotos = () => { setPhotosError(null); api<{ photos: ProfilePhoto[]; referralLink: string; referredCount: number }>("/api/v2/profile").then((data) => { setPhotos(data.photos); setReferral({ referralLink: data.referralLink, referredCount: data.referredCount }); }).catch(setPhotosError); };
  useEffect(loadPhotos, []);
  const [inviteCopied, setInviteCopied] = useState(false);
  const copyInviteLink = () => {
    if (!referral?.referralLink) return;
    navigator.clipboard?.writeText(referral.referralLink).then(() => { setInviteCopied(true); setTimeout(() => setInviteCopied(false), 2500); }).catch(() => {});
  };
  const [fromId, setFromId] = useState<number | null>(null);
  const [toId, setToId] = useState<number | null>(null);
  const [compareBusy, setCompareBusy] = useState(false);
  const [compareSent, setCompareSent] = useState(false);
  const [compareError, setCompareError] = useState<unknown>(null);
  const sendCompare = async () => {
    if (!photos || fromId == null || toId == null) return;
    const a = photos.find((p) => p.id === fromId);
    const b = photos.find((p) => p.id === toId);
    if (!a || !b) return;
    setCompareBusy(true); setCompareSent(false); setCompareError(null);
    try {
      const blob = await composeCompare(photoUrl(fromId), photoUrl(toId));
      if (!blob) throw new Error("compose failed");
      const form = new FormData();
      form.append("photo", blob, "progress.png");
      form.append("from", a.takenAt);
      form.append("to", b.takenAt);
      await apiUpload("/api/v2/photocompare", form);
      setCompareSent(true);
    } catch (err) { setCompareError(err); } finally { setCompareBusy(false); }
  };

  // plates calculator
  const [platesKg, setPlatesKg] = useState("");
  const [plates, setPlates] = useState<PlatesResponse | null>(null);
  const [platesBusy, setPlatesBusy] = useState(false);
  const calcPlates = async () => {
    const kg = Number(platesKg);
    if (!Number.isFinite(kg) || kg <= 0) return;
    setPlatesBusy(true);
    try { setPlates(await api<PlatesResponse>(`/api/v2/plates?kg=${kg}`)); } catch { setPlates(null); } finally { setPlatesBusy(false); }
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

  // squads
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

    <div className="fold-group">
    <Fold title={t(lang, "rp_eyebrow")} open={fold === "rp_title"} onToggle={() => toggleFold("rp_title")}>
      <p className="muted">{t(lang, "rp_detail")}</p>
      <ReadyPrograms lang={lang} />
    </Fold>

    <Fold title={t(lang, "form_check_title")} open={fold === "form_check_title"} onToggle={() => toggleFold("form_check_title")}>
      <FormCheck lang={lang} />
    </Fold>

    <Fold title={t(lang, "weekcard_title")} open={fold === "weekcard_title"} onToggle={() => toggleFold("weekcard_title")}>
      {weekError !== null ? <ErrorState lang={lang} error={weekError} retry={loadWeek} /> : !week ? <div className="skeleton" /> : !week.stats ? <Empty title={t(lang, "weekcard_empty_title")} detail={t(lang, "weekcard_empty_detail")} /> : <>
        <p className="muted">{week.stats.since.slice(5)} → {week.stats.until.slice(5)}</p>
        <div className="metric-grid compact">
          <Metric label={t(lang, "weekcard_workouts")} value={week.stats.planned ? `${week.stats.done}/${week.stats.planned}` : `${week.stats.done}`} />
          <Metric label={t(lang, "weekcard_sets")} value={`${week.stats.totalSets}`} />
          <Metric label={t(lang, "weekcard_volume")} value={`${formatNumber(week.stats.volumeKg)} kg`} />
        </div>
        <div className="metric-grid compact">
          <Metric label={t(lang, "metric_streak")} value={`${week.stats.streak}`} />
          <Metric label={t(lang, "weekcard_level")} value={`${week.stats.level}`} detail={`${week.stats.xp} XP`} />
          {week.stats.prs > 0 && <Metric label={t(lang, "weekcard_prs")} value={`${week.stats.prs}`} />}
        </div>
        <div className="button-row" style={{ marginTop: 12 }}>
          <button className="button button-ghost" onClick={generateWeekCard}>{t(lang, "weekcard_generate_btn")}</button>
          {weekCanvasUrl && <button className="button button-primary" disabled={weekBusy} onClick={() => void sendWeekCard()}>{weekBusy ? t(lang, "saving_ellipsis") : t(lang, "weekcard_send_btn")}</button>}
          <WeekStoryButton lang={lang} stats={week.stats} />
        </div>
        {weekCanvasUrl && <img src={weekCanvasUrl} alt="" style={{ marginTop: 10, width: "100%", borderRadius: 12 }} />}
        {weekSent && <div className="save-note">{t(lang, "weekcard_sent_note")}</div>}
      </>}
    </Fold>

    <Fold title={t(lang, "invite_title")} open={fold === "invite_title"} onToggle={() => toggleFold("invite_title")} meta={referral && referral.referredCount > 0 && <span className="tag">{t(lang, "invite_count", { n: referral.referredCount })}</span>}>
      {!referral ? <div className="skeleton" /> : !referral.referralLink ? null : <>
        <p className="muted">{t(lang, "invite_detail")}</p>
        <div className="input-row"><input readOnly value={referral.referralLink} onFocus={(event) => event.target.select()} /><button className="button button-primary" onClick={copyInviteLink}>{inviteCopied ? t(lang, "invite_copied_note") : t(lang, "invite_copy_btn")}</button></div>
      </>}
    </Fold>

    <Fold title={t(lang, "photocompare_title")} open={fold === "photocompare_title"} onToggle={() => toggleFold("photocompare_title")}>
      {photosError !== null ? <ErrorState lang={lang} error={photosError} retry={loadPhotos} /> : !photos ? <div className="skeleton" /> : photos.length < 2 ? <Empty title={t(lang, "photocompare_empty_title")} detail={t(lang, "photocompare_need_two")} /> : <>
        <div className="input-row">
          <label className="form-field"><span>{t(lang, "photocompare_from_label")}</span><select value={fromId ?? ""} onChange={(event) => setFromId(Number(event.target.value) || null)}><option value="">—</option>{photos.map((p) => <option key={p.id} value={p.id}>{p.takenAt}</option>)}</select></label>
          <label className="form-field"><span>{t(lang, "photocompare_to_label")}</span><select value={toId ?? ""} onChange={(event) => setToId(Number(event.target.value) || null)}><option value="">—</option>{photos.map((p) => <option key={p.id} value={p.id}>{p.takenAt}</option>)}</select></label>
        </div>
        <div className="button-row" style={{ marginTop: 10 }}>
          <button className="button button-primary" disabled={compareBusy || fromId == null || toId == null || fromId === toId} onClick={() => void sendCompare()}>{compareBusy ? t(lang, "saving_ellipsis") : t(lang, "photocompare_send_btn")}</button>
        </div>
        {compareSent && <div className="save-note">{t(lang, "photocompare_sent_note")}</div>}
        {compareError !== null && <div className="save-note error-note">{t(lang, "generic_error")}</div>}
      </>}
    </Fold>

    <Fold title={t(lang, "plates_title")} open={fold === "plates_title"} onToggle={() => toggleFold("plates_title")}>
      <div className="input-row">
        <input type="number" inputMode="decimal" value={platesKg} placeholder={t(lang, "plates_kg_ph")} onChange={(event) => setPlatesKg(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void calcPlates(); }} />
        <button className="button button-ghost" onClick={() => void calcPlates()} disabled={platesBusy}>{platesBusy ? "…" : t(lang, "plates_calc_btn")}</button>
      </div>
      {plates && <div style={{ marginTop: 10 }}>
        {plates.plan ? <p className="muted"><strong>{plates.plan.loaded} kg</strong> · {t(lang, "plates_per_side")}: {plates.plan.perSide.length ? plates.plan.perSide.join(" + ") : "—"}{plates.plan.leftover ? ` · ${t(lang, "plates_leftover", { n: plates.plan.leftover })}` : ""}</p> : null}
        {plates.ramp.length > 0 && <><p className="muted" style={{ marginTop: 8 }}>{t(lang, "plates_warmup_title")}</p><ul className="factor-list">{plates.ramp.map((w, i) => <li key={i}>{w.weight} kg × {w.reps}{w.pct ? ` (${w.pct}%)` : ""}</li>)}</ul></>}
      </div>}
    </Fold>

    <Fold title={t(lang, "library_title")} open={fold === "library_title"} onToggle={() => toggleFold("library_title")}>
      {libraryError !== null ? <ErrorState lang={lang} error={libraryError} retry={loadLibrary} /> : !library ? <div className="skeleton" /> : library.programs.length === 0 ? <Empty title={t(lang, "library_empty_title")} detail={t(lang, "library_empty_detail")} /> : <div className="plan-list">{library.programs.map((p) => <div className="plan-row" key={p.code}><div><strong>{p.name}</strong><small>{t(lang, "library_taken_count", { n: p.takenCount })}</small></div>{library.role !== "client" && <button className="button button-ghost" disabled={takingCode !== null} onClick={() => void takeProgram(p)}>{takingCode === p.code ? "…" : t(lang, "library_take_btn")}</button>}</div>)}</div>}
      {takenName && <div className="save-note">{t(lang, "library_taken_note", { name: takenName })}</div>}
    </Fold>

    {role === "solo" && <Fold title={t(lang, "trainer_find_eyebrow")} open={fold === "trainer_find_title"} onToggle={() => toggleFold("trainer_find_title")}>
      <p className="muted">{t(lang, "trainer_find_app_detail")}</p>
      <div className="button-row"><button className="button button-primary" onClick={() => setFindTrainer(true)}>{t(lang, "ob_role_trainer_btn")}</button></div>
    </Fold>}

    {whatsnew && <Fold title={t(lang, "whatsnew_eyebrow")} open={fold === "whatsnew_title"} onToggle={() => toggleFold("whatsnew_title")}>
      {whatsnew.items || whatsnew.text ? <ReleaseItems items={whatsnew.items} text={whatsnew.text} /> : <pre className="owner-report">{whatsnew.html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")}</pre>}
    </Fold>}

    <Fold title={t(lang, "import_app_title")} open={fold === "import_app_title"} onToggle={() => toggleFold("import_app_title")}>
      <ImportCsv lang={lang} />
    </Fold>
    </div>

    {role === "solo" || role === "trainer" ? <BecomeTrainerCard lang={lang} role={role} /> : null}

    <SquadsCard lang={lang} />

    <AppShortcutsCard lang={lang} />
    <SupportCard lang={lang} />
  </div>;
}

/** A tool on the More page: one row (title, optional badge), its content unfolded below it. */
function Fold({ title, meta, open, onToggle, children }: { title: string; meta?: React.ReactNode; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return <section className={open ? "card fold open" : "card fold"}>
    <button type="button" className="fold-head" aria-expanded={open} onClick={onToggle}>
      <span className="grow">{title}</span>{meta}<Icon name="chevron" size={20} className={open ? "row-chevron open" : "row-chevron"} />
    </button>
    {open && <div className="fold-body">{children}</div>}
  </section>;
}
