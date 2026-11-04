// One weekly quest as the athlete reads it ("Hamstrings: 6 sets this week"). Shared by the Today
// week card and the trainer's inbox, which shows the quests a client has finished.
import { t, type Key, type Lang } from "./i18n";

export function questText(lang: Lang, q: { kind: string; muscle?: string; target: number }): string {
  const n = String(q.target);
  if (q.kind === "muscle_sets") return t(lang, "quest_muscle_sets", { n, muscle: t(lang, `muscle_${(q.muscle ?? "").replace("-", "_")}` as Key) });
  return t(lang, `quest_${q.kind}` as Key, { n });
}
