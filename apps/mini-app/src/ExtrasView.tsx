// The "More" screen (lazy chunk): library, squads, plates, week card, profile photo, extras.
import { FormCheck } from "./media/FormCheck";
import { useEffect, useState } from "react";
import { api, typedBody } from "./api";
import type { Dashboard, LibraryProgram, LibraryResponse, PlatesResponse, ProfilePhoto, SquadInfo, WeekCardResponse } from "./types";
import { t, type Lang } from "./i18n";
import { AppShortcutsCard, SupportCard, WeekStoryButton } from "./TelegramExtras";
import { ReleaseItems } from "./WhatsNew";
import { BecomeTrainerCard } from "./BecomeTrainer";
import { formatNumber, Card, Metric, Empty, ErrorState, photoUrl, apiUpload, composeCompare, drawWeekCard } from "./App";

export function ExtrasView({ lang, role, onOpenLibrary }: { lang: Lang; role: Dashboard["viewer"]["role"]; onOpenLibrary: () => void }) {
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

  // find a trainer (send a join request by trainer id -- there is no public trainer directory
  // in this product; see src/features/trainer/trainer.ts's openFindTrainer comment. This reuses
  // the exact same request record extrasApi.ts's /api/trainers already creates via createRequest,
  // the same one the trainer's own Requests inbox accepts/declines)
  const [trainerId, setTrainerId] = useState("");
  const [trainerNote, setTrainerNote] = useState("");
  const [trainerBusy, setTrainerBusy] = useState(false);
  const [trainerSent, setTrainerSent] = useState(false);
  const [trainerError, setTrainerError] = useState<unknown>(null);
  const sendTrainerRequest = async () => {
    const id = Number(trainerId);
    if (!Number.isFinite(id) || id <= 0) return;
    setTrainerBusy(true); setTrainerError(null); setTrainerSent(false);
    try {
      await api("/api/v2/trainers", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"requestTrainer">({ trainerId: id, ...(trainerNote.trim() ? { note: trainerNote.trim() } : {}) }) });
      setTrainerSent(true); setTrainerId(""); setTrainerNote("");
    } catch (err) { setTrainerError(err); } finally { setTrainerBusy(false); }
  };

  // squads
  // /api/v2/whatsnew was registered in v2Api.ts but nothing ever called it -- the release note
  // was reachable only through the bot's /whatsnew command. It's Telegram-HTML, so it's stripped
  // to plain text the same way the owner report is.
  const [whatsnew, setWhatsnew] = useState<{ version: string; html: string; text?: string } | null>(null);
  useEffect(() => { api<{ version: string; html: string; text?: string }>("/api/v2/whatsnew").then(setWhatsnew).catch(() => setWhatsnew(null)); }, []);

  const [squads, setSquads] = useState<SquadInfo[] | null>(null);
  const [squadsError, setSquadsError] = useState<unknown>(null);
  const loadSquads = () => { setSquadsError(null); api<{ squads: SquadInfo[] }>("/api/v2/squads").then((data) => setSquads(data.squads)).catch(setSquadsError); };
  useEffect(loadSquads, []);

  return <div className="view-stack">
    <div className="eyebrow">{t(lang, "extras_eyebrow")}</div>
    <div className="page-title"><h1>{t(lang, "extras_title")}</h1></div>

    <Card tone="accent">
      <div className="section-head"><div><span className="eyebrow">{t(lang, "exlib_eyebrow")}</span><h2>{t(lang, "library_card_title")}</h2></div><span className="action-arrow">📚</span></div>
      <p>{t(lang, "library_card_body")}</p>
      <div className="button-row"><button className="button button-light" onClick={onOpenLibrary}>{t(lang, "library_open_btn")}</button></div>
    </Card>

    <Card>
      <div className="section-head"><div><span className="eyebrow">{t(lang, "form_check_eyebrow")}</span><h2>{t(lang, "form_check_title")}</h2></div><span className="action-arrow">🎥</span></div>
      <FormCheck lang={lang} />
    </Card>

    <Card>
      <div className="section-head"><div><span className="eyebrow">{t(lang, "weekcard_eyebrow")}</span><h2>{t(lang, "weekcard_title")}</h2></div></div>
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
    </Card>

    <Card>
      <div className="section-head"><div><span className="eyebrow">{t(lang, "invite_eyebrow")}</span><h2>{t(lang, "invite_title")}</h2></div>{referral && referral.referredCount > 0 && <span className="tag">{t(lang, "invite_count", { n: referral.referredCount })}</span>}</div>
      {!referral ? <div className="skeleton" /> : !referral.referralLink ? null : <>
        <p className="muted">{t(lang, "invite_detail")}</p>
        <div className="input-row"><input readOnly value={referral.referralLink} onFocus={(event) => event.target.select()} /><button className="button button-primary" onClick={copyInviteLink}>{inviteCopied ? t(lang, "invite_copied_note") : t(lang, "invite_copy_btn")}</button></div>
      </>}
    </Card>

    <Card>
      <div className="section-head"><div><span className="eyebrow">{t(lang, "photocompare_eyebrow")}</span><h2>{t(lang, "photocompare_title")}</h2></div></div>
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
    </Card>

    <Card>
      <div className="section-head"><div><span className="eyebrow">{t(lang, "plates_eyebrow")}</span><h2>{t(lang, "plates_title")}</h2></div></div>
      <div className="input-row">
        <input type="number" inputMode="decimal" value={platesKg} placeholder={t(lang, "plates_kg_ph")} onChange={(event) => setPlatesKg(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void calcPlates(); }} />
        <button className="button button-ghost" onClick={() => void calcPlates()} disabled={platesBusy}>{platesBusy ? "…" : t(lang, "plates_calc_btn")}</button>
      </div>
      {plates && <div style={{ marginTop: 10 }}>
        {plates.plan ? <p className="muted"><strong>{plates.plan.loaded} kg</strong> · {t(lang, "plates_per_side")}: {plates.plan.perSide.length ? plates.plan.perSide.join(" + ") : "—"}{plates.plan.leftover ? ` · ${t(lang, "plates_leftover", { n: plates.plan.leftover })}` : ""}</p> : null}
        {plates.ramp.length > 0 && <><p className="muted" style={{ marginTop: 8 }}>{t(lang, "plates_warmup_title")}</p><ul className="factor-list">{plates.ramp.map((w, i) => <li key={i}>{w.weight} kg × {w.reps}{w.pct ? ` (${w.pct}%)` : ""}</li>)}</ul></>}
      </div>}
    </Card>

    <Card>
      <div className="section-head"><div><span className="eyebrow">{t(lang, "library_eyebrow")}</span><h2>{t(lang, "library_title")}</h2></div></div>
      {libraryError !== null ? <ErrorState lang={lang} error={libraryError} retry={loadLibrary} /> : !library ? <div className="skeleton" /> : library.programs.length === 0 ? <Empty title={t(lang, "library_empty_title")} detail={t(lang, "library_empty_detail")} /> : <div className="plan-list">{library.programs.map((p) => <div className="plan-row" key={p.code}><div><strong>{p.name}</strong><small>{t(lang, "library_taken_count", { n: p.takenCount })}</small></div>{library.role !== "client" && <button className="button button-ghost" disabled={takingCode !== null} onClick={() => void takeProgram(p)}>{takingCode === p.code ? "…" : t(lang, "library_take_btn")}</button>}</div>)}</div>}
      {takenName && <div className="save-note">{t(lang, "library_taken_note", { name: takenName })}</div>}
    </Card>

    {role === "solo" && <Card>
      <div className="section-head"><div><span className="eyebrow">{t(lang, "trainer_find_eyebrow")}</span><h2>{t(lang, "trainer_find_title")}</h2></div></div>
      <p className="muted">{t(lang, "trainer_find_detail")}</p>
      <div className="form-grid">
        <label className="form-field"><span>{t(lang, "field_trainer_id")}</span><input type="number" value={trainerId} onChange={(event) => setTrainerId(event.target.value)} /></label>
        <label className="form-field"><span>{t(lang, "field_note_optional")}</span><input value={trainerNote} maxLength={300} onChange={(event) => setTrainerNote(event.target.value)} /></label>
      </div>
      <div className="button-row" style={{ marginTop: 10 }}>
        <button className="button button-primary" disabled={trainerBusy || !trainerId.trim()} onClick={() => void sendTrainerRequest()}>{trainerBusy ? t(lang, "saving_ellipsis") : t(lang, "trainer_request_btn")}</button>
      </div>
      {trainerSent && <div className="save-note">{t(lang, "trainer_request_sent_note")}</div>}
      {trainerError !== null && <div className="save-note error-note">{t(lang, "generic_error")}</div>}
    </Card>}

    {whatsnew && <Card>
      <div className="section-head"><div><span className="eyebrow">{t(lang, "whatsnew_eyebrow")}</span><h2>{t(lang, "whatsnew_title")}</h2></div><span className="tag">{t(lang, "whatsnew_version", { v: whatsnew.version })}</span></div>
      {whatsnew.text ? <ReleaseItems text={whatsnew.text} /> : <pre className="owner-report">{whatsnew.html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")}</pre>}
    </Card>}

    {role === "solo" || role === "trainer" ? <BecomeTrainerCard lang={lang} role={role} /> : null}

    <Card>
      <div className="section-head"><div><span className="eyebrow">{t(lang, "squads_eyebrow")}</span><h2>{t(lang, "squads_title")}</h2></div></div>
      {squadsError !== null ? <ErrorState lang={lang} error={squadsError} retry={loadSquads} /> : !squads ? <div className="skeleton" /> : squads.length === 0 ? <Empty title={t(lang, "squads_empty_title")} detail={t(lang, "squads_empty_detail")} /> : squads.map((s, i) => <div key={i} style={{ marginBottom: i < squads.length - 1 ? 18 : 0 }}>
        <div className="section-head"><strong>{s.title || t(lang, "squads_default_title")}</strong><span className="tag">{t(lang, "squads_members_count", { n: s.memberCount })}</span></div>
        <div className="volume-list">{s.entries.map((e) => <div className="volume-row" key={e.name}><div><strong>{e.medal} {e.name}</strong>{e.me && <small>{t(lang, "you_label")}</small>}</div><span>{e.workouts}</span></div>)}</div>
        <p className="muted" style={{ marginTop: 6 }}>{s.silent > 0 ? t(lang, "squads_silent_hint", { n: s.silent, total: s.total }) : t(lang, "squads_all_in_hint", { total: s.total })}</p>
      </div>)}
    </Card>
    <AppShortcutsCard lang={lang} />
    <SupportCard lang={lang} />
  </div>;
}
