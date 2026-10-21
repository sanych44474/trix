// The comeback interview's steps, shared by the bot (bot/vacation.ts) and the apps' API
// (webapp/trainingExtrasApi.ts). Pure: no chat or DB access.
import type { t } from "../../locales/i18n";

type TKey = Parameters<typeof t>[1];
export interface ComebackStep { key: string; q: TKey; kind: "text" | "buttons"; buttons?: { label: TKey; value: string }[] }

export function comebackSteps(): ComebackStep[] {
  return [
    { key: "feel", q: "comeback_q_feel", kind: "text" },
    { key: "goals", q: "comeback_q_goals", kind: "buttons", buttons: [
      { label: "comeback_goals_same", value: "same" }, { label: "comeback_goals_changed", value: "changed" }] },
    { key: "weight", q: "comeback_q_weight", kind: "buttons", buttons: [
      { label: "comeback_wt_up", value: "up" }, { label: "comeback_wt_same", value: "same" }, { label: "comeback_wt_down", value: "down" }] },
    { key: "changed", q: "comeback_q_changed", kind: "buttons", buttons: [
      { label: "comeback_yes", value: "yes" }, { label: "comeback_no", value: "no" }] },
    { key: "decision", q: "comeback_q_decision", kind: "buttons", buttons: [
      { label: "comeback_keep", value: "keep" }, { label: "comeback_adjust", value: "adjust" }, { label: "comeback_recreate", value: "recreate" }] },
  ];
}
