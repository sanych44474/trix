// Display helpers for logged food descriptions.


// Strip a trailing weight token ("~250 г" / "(250 g)") from a food desc so the grams shown stay in sync.
export function cleanFoodName(desc: string): string {
  return desc.replace(/[~(]?\s*\d+[.,]?\d*\s*(г|g|грам\w*|gram\w*)\.?\)?\s*$/iu, "").trim() || desc;
}
