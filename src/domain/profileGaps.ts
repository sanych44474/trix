// What the profile still lacks for an accurate plan and calorie targets. Onboarding asks only the
// essentials (and the no-questionnaire entry -- a ready program -- asks nothing), so these are
// filled in afterwards, one question at a time, from the Today "fine-tune" card. Until then the
// engine uses defaults (mealplan.computeTargets: 75 kg, 175 cm, 30 y, light activity).
import type { UserProfile } from "../types";

type ProfileGap = "sex" | "age" | "heightCm" | "weightKg" | "sessionMinutes" | "lifestyle" | "dietPrefs";

/** The gaps in the order the card asks them: the ones that move calories the most first. */
export function profileGaps(p: UserProfile): ProfileGap[] {
  const gaps: ProfileGap[] = [];
  if (!p.sex) gaps.push("sex");
  if (!p.age) gaps.push("age");
  if (!p.heightCm) gaps.push("heightCm");
  if (!p.weightKg) gaps.push("weightKg");
  if (!p.lifestyle) gaps.push("lifestyle");
  if (!p.sessionMinutes) gaps.push("sessionMinutes");
  if (!p.dietPrefs) gaps.push("dietPrefs");
  return gaps;
}

/** Fields that feed the calorie formula: filling one of them in recomputes the targets. */
export const CALORIE_FIELDS: Array<keyof UserProfile> = ["sex", "age", "heightCm", "weightKg", "lifestyle"];
