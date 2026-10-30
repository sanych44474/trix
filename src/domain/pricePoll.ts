// Price poll: parsing a typed price and summarising the answers. Pure; the bot and the owner
// report use it (bot/pricePoll.ts, adapters/d1/v2PricePoll.ts).

export type PollChoice = "yes" | "custom" | "no";

export interface PollAnswer {
  choice: PollChoice;
  price?: number;
}

export interface PollSummary {
  total: number;
  yes: number;
  custom: number;
  no: number;
  /** Median of the prices people typed (custom answers only). */
  medianPrice?: number;
  /** Share of answers that would pay at least the proposed price: "yes" plus custom >= it. */
  payAtProposed: number;
}

/** The price the poll proposes, in USD a month (the lower bound of the $4-5 range). */
export const PROPOSED_PRICE = 4;
const MAX_PRICE = 100;

/** A monthly price in USD from free text: "3", "2.5", "2,5$", "$4 на місяць". Null when there is
 *  no number or it is outside 0..100. Zero is a valid answer ("I would not pay"). */
export function parsePollPrice(text: string): number | null {
  const m = text.replace(",", ".").match(/\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  if (!Number.isFinite(n) || n < 0 || n > MAX_PRICE) return null;
  return Math.round(n * 100) / 100;
}

export function summarizePoll(answers: PollAnswer[]): PollSummary {
  const prices = answers.filter((a) => a.choice === "custom" && a.price !== undefined).map((a) => a.price as number).sort((a, b) => a - b);
  const mid = Math.floor(prices.length / 2);
  const medianPrice = prices.length ? (prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2) : undefined;
  const yes = answers.filter((a) => a.choice === "yes").length;
  const atProposed = yes + prices.filter((p) => p >= PROPOSED_PRICE).length;
  return {
    total: answers.length,
    yes,
    custom: answers.filter((a) => a.choice === "custom").length,
    no: answers.filter((a) => a.choice === "no").length,
    ...(medianPrice !== undefined ? { medianPrice } : {}),
    payAtProposed: answers.length ? atProposed / answers.length : 0,
  };
}
