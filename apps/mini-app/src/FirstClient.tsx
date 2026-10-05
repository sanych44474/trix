// The trainer's first-client checklist (logic/firstClient.ts): shown in the trainer workspace
// until a first client has an assigned plan, or until the trainer hides it.
import { useEffect, useState } from "react";
import { api } from "./api";
import { t, type Key, type Lang } from "./i18n";
import { FIRST_CLIENT_STEPS, firstClientProgress, type ClientState } from "./logic/firstClient";

const HIDE_KEY = "trix:v2:first-client-hidden";

export function FirstClientChecklist({ lang, clients, onOpenPlan, onInvite }: { lang: Lang; clients: ClientState[]; onOpenPlan: (clientId: number) => void; onInvite: () => void }) {
  const [invites, setInvites] = useState<number | null>(null);
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(HIDE_KEY) === "1"; } catch { return false; } });
  useEffect(() => {
    if (hidden) return;
    api<{ prospects: unknown[] }>("/api/v2/trainer/invite").then((r) => setInvites(r.prospects.length)).catch(() => setInvites(0));
  }, [hidden]);
  if (hidden || invites === null) return null;
  const progress = firstClientProgress(clients, invites);
  if (!progress.next) return null;
  const doneCount = FIRST_CLIENT_STEPS.filter((s) => progress.done[s]).length;
  const hide = () => { setHidden(true); try { localStorage.setItem(HIDE_KEY, "1"); } catch { /* storage is optional */ } };
  return (
    <section className="card first-client">
      <div className="section-head">
        <div><span className="eyebrow">{t(lang, "fc_eyebrow")}</span><h2>{t(lang, "fc_title")}</h2></div>
        <span className="tag">{doneCount}/{FIRST_CLIENT_STEPS.length}</span>
      </div>
      <div className="fc-bar"><span style={{ width: `${(doneCount / FIRST_CLIENT_STEPS.length) * 100}%` }} /></div>
      <ol className="fc-steps">
        {FIRST_CLIENT_STEPS.map((step) => (
          <li key={step} className={progress.done[step] ? "done" : step === progress.next ? "next" : ""}>
            <span className="fc-mark" aria-hidden="true">{progress.done[step] ? "✓" : ""}</span>
            <div>
              <strong>{t(lang, `fc_${step}` as Key)}</strong>
              {step === progress.next && <small>{t(lang, `fc_${step}_hint` as Key)}</small>}
              {step === progress.next && step === "invite" && <button className="text-button" onClick={onInvite}>{t(lang, "fc_invite_btn")}</button>}
              {step === progress.next && step === "assigned" && progress.draftClientId !== null && <button className="text-button" onClick={() => onOpenPlan(progress.draftClientId!)}>{t(lang, "fc_review_btn")}</button>}
            </div>
          </li>
        ))}
      </ol>
      <button className="text-button fc-hide" onClick={hide}>{t(lang, "fc_hide")}</button>
    </section>
  );
}
