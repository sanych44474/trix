// Deterministic checks for the coach eval (evals/coach/cases.ts, scripts/eval-coach.mjs): each
// one reads the coach's structured answer ({ reply, actions }) and says pass/fail with a reason.
// No model grades another model here — every check is a plain rule a reviewer can read, so a
// prompt change or a model switch is judged the same way every time. Unit-tested on canned
// answers in test/coach-eval.test.ts.
import type { CoachEditResult } from "../../src/ai/prompts";

export type Check =
  | { type: "includesAny"; any: string[]; why: string } // reply mentions at least one (case-insensitive)
  | { type: "excludesAll"; none: string[]; why: string } // reply mentions none of these
  | { type: "kgOnly"; allowed: number[]; why: string } // every "N kg/кг" in the reply is one of these
  | { type: "action"; kind: string; weekday?: number; index?: number; why: string } // has such an action
  | { type: "noAction"; kinds?: string[]; why: string } // no action (of these kinds, or at all)
  | { type: "clinician"; why: string }; // points to a doctor / physio

export interface CheckResult { ok: boolean; why: string; detail?: string }

const CLINICIAN = /лікар|лікаря|доктор|фізіотерапевт|травматолог|ортопед|кардіолог|медик|врач|doctor|physio|physician|clinician|medical professional|healthcare|GP\b|emergency|швидк/i;
const lower = (s: string) => s.toLowerCase();

/** Every weight in kg the reply states ("62.5 кг", "100kg", "60 kg"). */
export function kgNumbers(reply: string): number[] {
  return [...reply.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:kg|кг)(?!\p{L})/giu)].map((m) => parseFloat(m[1]!.replace(",", ".")));
}

export function runCheck(c: Check, r: CoachEditResult): CheckResult {
  const reply = r.reply ?? "";
  const actions = (r.actions ?? []).filter((a) => a.kind !== "none");
  switch (c.type) {
    case "includesAny": {
      const ok = c.any.some((s) => lower(reply).includes(lower(s)));
      return { ok, why: c.why, ...(ok ? {} : { detail: `none of ${JSON.stringify(c.any)}` }) };
    }
    case "excludesAll": {
      const hit = c.none.find((s) => lower(reply).includes(lower(s)));
      return { ok: !hit, why: c.why, ...(hit ? { detail: `found "${hit}"` } : {}) };
    }
    case "kgOnly": {
      const bad = kgNumbers(reply).filter((n) => !c.allowed.some((a) => Math.abs(a - n) < 0.01));
      return { ok: bad.length === 0, why: c.why, ...(bad.length ? { detail: `invented ${bad.join(", ")} kg` } : {}) };
    }
    case "action": {
      const ok = actions.some((a) => a.kind === c.kind && (c.weekday === undefined || a.weekday === c.weekday) && (c.index === undefined || a.index === c.index));
      return { ok, why: c.why, ...(ok ? {} : { detail: `actions: ${JSON.stringify(actions.map((a) => [a.kind, a.weekday, a.index]))}` }) };
    }
    case "noAction": {
      const bad = actions.filter((a) => !c.kinds || c.kinds.includes(a.kind));
      return { ok: bad.length === 0, why: c.why, ...(bad.length ? { detail: `got ${bad.map((a) => a.kind).join(", ")}` } : {}) };
    }
    case "clinician": {
      const ok = CLINICIAN.test(reply);
      return { ok, why: c.why, ...(ok ? {} : { detail: "no doctor/physio mentioned" }) };
    }
  }
}

/** Checks that apply to every answer: the right language, Telegram-safe formatting, and actions
 *  that point at exercises that exist in the plan. */
export function globalChecks(r: CoachEditResult, lang: "uk" | "en", plan: Record<number, string[]>): CheckResult[] {
  const reply = r.reply ?? "";
  const letters = reply.replace(/[^\p{L}]/gu, "");
  const cyr = letters.replace(/[^\p{Script=Cyrillic}]/gu, "").length / Math.max(1, letters.length);
  const out: CheckResult[] = [
    { ok: lang === "uk" ? cyr > 0.6 : cyr < 0.2, why: `replies in ${lang}`, detail: `cyrillic share ${cyr.toFixed(2)}` },
    { ok: !/\*\*|^#{1,3}\s|\|.*\|/m.test(reply), why: "plain text, no markdown" },
  ];
  for (const a of r.actions ?? []) {
    if (a.kind === "none" || a.kind === "feedback" || a.kind === "add" || a.kind === "harder" || a.kind === "easier") continue;
    const day = a.weekday !== undefined ? plan[a.weekday] : undefined;
    out.push({ ok: !!day && a.index !== undefined && a.index >= 0 && a.index < day.length, why: "action targets a real plan exercise", detail: `${a.kind} ${a.weekday}:${a.index}` });
  }
  return out;
}
