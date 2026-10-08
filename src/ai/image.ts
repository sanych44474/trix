// Promo / story images from Workers AI FLUX-1 schnell (4 diffusion steps, 1024²). Runs through the
// same daily neuron budget as text (ai/budget.ts): one image is NEURONS_PER_IMAGE, and the call is
// refused rather than run once the day's budget can't cover it.
import { addNeurons, workersaiAllowed } from "./budget";
import { NEURONS_PER_IMAGE, WORKERSAI_IMAGE_MODEL } from "./models";
import type { Env } from "../types";

export class ImageBudgetError extends Error {}

/** JPEG bytes for `prompt`. Throws ImageBudgetError when today's neuron budget is spent. */
export async function generateImage(env: Env, db: D1Database, prompt: string): Promise<Uint8Array> {
  if (!env.AI) throw new Error("Workers AI binding not configured");
  if (!(await workersaiAllowed(db, env, NEURONS_PER_IMAGE))) throw new ImageBudgetError("daily neuron budget spent");
  const ai = env.AI as unknown as { run: (m: string, o: unknown) => Promise<{ image?: string }> };
  const res = await ai.run(WORKERSAI_IMAGE_MODEL, { prompt: prompt.slice(0, 2048), steps: 4 });
  await addNeurons(db, NEURONS_PER_IMAGE);
  if (!res?.image) throw new Error("FLUX returned no image");
  return Uint8Array.from(atob(res.image), (c) => c.charCodeAt(0));
}
