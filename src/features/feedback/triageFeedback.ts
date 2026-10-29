// Second opinion on feedback the keyword rules could not place ("other"): Clef picks a category
// and the stored row is moved only when it is confident. Lives in features/ because it is an AI
// use case; the rule and the threshold are pure in domain/feedbackTriage.ts.
import { choiceOf, clefAsk, type ClefQuestion } from "../../ai/clef";
import { setFeedbackCategoryIfOther } from "../../adapters/d1/v2Feedback";
import { classifyFeedback, clefCategory } from "../../domain/feedbackTriage";
import type { Env } from "../../types";

// "other" is a criterion so Clef can abstain (greetings, questions, unclear text) instead of
// being forced into one of the four categories. The text may be Ukrainian, Russian or English.
const TRIAGE: Record<string, ClefQuestion> = {
  category: {
    type: "choice",
    instructions:
      "Classify a user's feedback about a fitness and nutrition app. The text may be in Ukrainian, Russian or English. Pick the single best category.",
    criteria: {
      bug: "reports something broken, failing, crashing, lost or behaving incorrectly",
      idea: "suggests a new feature or a change, or asks for something to be added",
      complaint: "expresses dissatisfaction or frustration with how something is designed or works, without describing a malfunction",
      praise: "thanks or compliments the app",
      other: "none of the above, for example a greeting, a question or unclear text",
    },
  },
};

/** Ask Clef about a row the rules left as "other" and move it when Clef is confident. Never
 *  throws; on any miss the row keeps "other". Rule hits never call the model. */
export async function triageFeedbackCategory(env: Env, id: number, text: string): Promise<void> {
  if (classifyFeedback(text) !== "other") return;
  const answers = await clefAsk(env, text, TRIAGE);
  const category = clefCategory(choiceOf(answers, "category"));
  if (category) await setFeedbackCategoryIfOther(env.DB, id, category).catch(() => {});
}
