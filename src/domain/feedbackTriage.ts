// A first guess at what a piece of feedback is, so the owner console can sort it: bug / idea /
// complaint / praise / rating / other. Keyword rules in Ukrainian, Russian and English — cheap,
// instant, no AI call per message; the owner corrects a wrong guess with one tap. Order matters:
// a star rating is a rating, "doesn't work" beats "please add". Pure; test/feedback-triage.test.ts.

export const FEEDBACK_CATEGORIES = ["bug", "idea", "complaint", "praise", "rating", "other"] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];
export const FEEDBACK_STATUSES = ["new", "done", "wontfix"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

const RULES: Array<[FeedbackCategory, RegExp]> = [
  ["rating", /^⭐\s*\d\/5/u],
  ["bug", /баг|глюч|помилк|ошибк|не\s*працю|не\s*работа|не\s*відкрива|не\s*открыва|не\s*зберіга|не\s*сохраня|завис|вилета|вылета|скида|зника|исчеза|крашит|\bbug\b|broken|crash|doesn'?t work|not working|error|freez|reset/iu],
  ["idea", /додай|добав|хоч(у|еться)|було б|было бы|можна\s*(б|було)|можно\s*(бы|было)|пропон|предлага|ідея|идея|функці|функци|\bidea\b|feature|please add|would be (nice|great|cool)|could you add|wish/iu],
  ["complaint", /незручн|неудобн|погано|плохо|дратує|раздража|складно|сложно|незрозуміл|непонятн|повільн|медленн|дорого|annoying|confusing|slow|hate|bad|terrible|hard to/iu],
  ["praise", /дякую|спасибі|спасибо|клас|супер|круто|чудов|отличн|топ\b|подоба|нравит|люблю|\bthanks?\b|thank you|love|great|awesome|amazing|nice/iu],
];

export function classifyFeedback(text: string): FeedbackCategory {
  const s = text.replace(/^\[AI coach\]\s*/, "");
  for (const [cat, re] of RULES) if (re.test(s)) return cat;
  return "other";
}
