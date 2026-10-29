// The "is this food?" gate in front of the meal-photo vision chain: one Clef noul on the same image
// the vision call gets. Only a confident "not food" (< 0.15) short-circuits. Everything else, a
// Clef failure included, returns false and the vision chain runs as it did before.
import { clefAsk, noulProb, type ClefImage } from "../../ai/clef";
import type { InlineImage } from "../../ai/errors";
import type { Env } from "../../types";

export const CLEF_MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const NOT_FOOD_BELOW = 0.15;
const FOOD_NOUL =
  "This photo shows food or a drink that a person is about to eat or drink (a plate, a meal, a snack, a packaged food label counts).";

function clefType(mimeType: string): ClefImage["content_type"] | null {
  return mimeType === "image/png" || mimeType === "image/jpeg" || mimeType === "image/webp" ? mimeType : null;
}

function decodedBytes(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}

/** True only when Clef is confident (< 0.15) that the photo shows no food. Never throws; any
 *  unknown, failed or skipped check is false. */
export async function isNotFoodPhoto(env: Env, image: InlineImage): Promise<boolean> {
  const content_type = clefType(image.mimeType);
  if (!content_type || decodedBytes(image.dataBase64) > CLEF_MAX_IMAGE_BYTES) return false;
  const answers = await clefAsk(env, {}, { food: { type: "noul", instructions: FOOD_NOUL } }, {
    images: [{ content_type, base64: image.dataBase64 }],
  });
  const p = noulProb(answers, "food");
  return p !== null && p < NOT_FOOD_BELOW;
}
