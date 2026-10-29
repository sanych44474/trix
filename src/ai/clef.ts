// Cloudflare Clef decision models on Workers AI (@cf/cloudflare/clef-flash): yes/no (noul), choice
// and score questions over a state (text or JSON) and up to 4 images. Used for cheap yes/no
// decisions (feedback triage, "is this food?", pain signal in coach chat), never for user-facing
// prose. Every failure returns null so callers keep their old behaviour.
//
// Request/response shapes: https://developers.cloudflare.com/workers-ai/models/clef-flash/
// (schema-input.json / schema-output.json).
//
// Spend counts against the same daily Workers AI neuron budget as the text and image calls
// (budget.ts): checked before the call, recorded after it.
import type { Env } from "../types";
import { addNeurons, workersaiAllowed } from "./budget";
import { CLEF_MODEL, estimateNeurons, neuronsForTokens } from "./models";

export type ClefImage = { content_type: "image/png" | "image/jpeg" | "image/webp"; base64: string };

export type ClefQuestion =
  | { type: "noul"; instructions: string }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };

export type ClefAnswer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: "score"; score: number; legend: Record<string, string>; probabilities: Record<string, number>; confidence: number };

export type ClefAnswers = Record<string, ClefAnswer>;

const MAX_IMAGES = 4;
const DEFAULT_TIMEOUT_MS = 3_000;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isProb = (v: unknown): v is number => isNum(v) && v >= 0 && v <= 1;
const isProbMap = (v: unknown): v is Record<string, number> =>
  typeof v === "object" && v !== null && !Array.isArray(v) && Object.values(v).every(isProb);

/** One answer, checked against the question it answers. */
function parseAnswer(q: ClefQuestion, a: unknown): ClefAnswer | null {
  if (typeof a !== "object" || a === null) return null;
  const o = a as Record<string, unknown>;
  if (q.type === "noul") {
    return o.type === "noul" && isProb(o.noul) ? { type: "noul", noul: o.noul } : null;
  }
  if (q.type === "choice") {
    if (o.type !== "choice" || typeof o.choice !== "string" || !isProbMap(o.probabilities) || !isProb(o.confidence)) return null;
    return { type: "choice", choice: o.choice, probabilities: o.probabilities, confidence: o.confidence };
  }
  if (o.type !== "score" || !isNum(o.score) || !isProbMap(o.probabilities) || !isProb(o.confidence)) return null;
  if (typeof o.legend !== "object" || o.legend === null || Array.isArray(o.legend)) return null;
  return { type: "score", score: o.score, legend: o.legend as Record<string, string>, probabilities: o.probabilities, confidence: o.confidence };
}

/** Every question must come back answered in its own type; anything else is a bad shape. */
function parseAnswers(questions: Record<string, ClefQuestion>, res: unknown): ClefAnswers | null {
  const answers = (res as { answers?: unknown } | null)?.answers;
  if (typeof answers !== "object" || answers === null) return null;
  const out: ClefAnswers = {};
  for (const [id, q] of Object.entries(questions)) {
    const parsed = parseAnswer(q, (answers as Record<string, unknown>)[id]);
    if (!parsed) return null;
    out[id] = parsed;
  }
  return out;
}

/** Ask Clef. Returns the answers keyed by question id, or null on ANY failure: no AI binding, the
 *  daily neuron budget spent, too many images, timeout, error or a bad response. Never throws. */
export async function clefAsk(
  env: Env,
  state: unknown,
  questions: Record<string, ClefQuestion>,
  opts: { images?: ClefImage[]; timeoutMs?: number } = {},
): Promise<ClefAnswers | null> {
  try {
    const images = opts.images ?? [];
    if (!env.AI || !env.DB || images.length > MAX_IMAGES) return null;
    const db = env.DB;
    const reserve = estimateNeurons(CLEF_MODEL, JSON.stringify({ state, questions }), "", images.length);
    if (!(await workersaiAllowed(db, env, reserve))) return null;

    const input = { model: "clef-flash", state, questions, ...(images.length ? { images } : {}) };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let res: unknown;
    let failed = false;
    try {
      res = await Promise.race([
        env.AI.run(CLEF_MODEL as keyof AiModels, input as never),
        new Promise<never>((_, rej) => {
          timer = setTimeout(() => rej(new Error("Clef timeout")), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        }),
      ]);
    } catch {
      failed = true;
    } finally {
      if (timer) clearTimeout(timer);
    }

    // A run that failed or timed out may still have been billed, so it counts at the estimate.
    const usage = (res as { usage?: { input_tokens?: unknown; output_tokens?: unknown } } | null)?.usage;
    const spent =
      !failed && usage && isNum(usage.input_tokens) && isNum(usage.output_tokens)
        ? neuronsForTokens(CLEF_MODEL, usage.input_tokens, usage.output_tokens)
        : reserve;
    await addNeurons(db, spent);

    return failed ? null : parseAnswers(questions, res);
  } catch {
    return null;
  }
}

/** Probability that a noul question is yes, or null when there is no such answer. */
export function noulProb(answers: ClefAnswers | null, id: string): number | null {
  const a = answers?.[id];
  return a?.type === "noul" ? a.noul : null;
}

/** The chosen option of a choice question, or null when there is no such answer. */
export function choiceOf(answers: ClefAnswers | null, id: string): { choice: string; confidence?: number } | null {
  const a = answers?.[id];
  return a?.type === "choice" ? { choice: a.choice, confidence: a.confidence } : null;
}
