// Which exercises are measured in time or distance rather than weight×reps, from the name alone.
// Split out of setFormat.ts with no imports, so the Mini App can use it too.

// Name signatures for exercises whose data isn't weight×reps — used as a fallback when neither
// an explicit `metric` nor a unit in `sets` is present (older plans, catalog-added exercises).
// Conservative: "row erg"/"rowing machine" (cardio) is matched, bare "row"/"тяга" (a back lift) is NOT.
export const TIME_NAME_RE = /планк|вис(?![а-яії])|утриман|статичн|холлоу|\b(?:plank|dead ?hang|bar hang|hang|wall ?sit|hollow ?hold|l-?sit|iso(?:metric)? ?hold)\b/iu;

export const DISTANCE_NAME_RE = /гребл|гребн|веслуванн|біг|пробіжк|доріж|велотренаж|велосипед(?!.*(скруч|лежач))|еліпт|еліпс|степер|плаванн|\b(?:rowing machine|row(?:ing)? erg|rower|ergometer|treadmill|running|run|jog(?:ging)?|cycling|spin bike|bike|elliptical|ski ?erg|stair ?(?:climber|master)|swimming|swim)\b/iu;

// Whole-name cardio that the word patterns above must not match inside longer names: the bot's own
// cardio menu logs "Rowing"/"Walking" (and Strava imports "Hiking"), but "Barbell Rowing" is a
// back lift and "Farmer's walk" a loaded carry. Without this, English-language cardio from the
// menu never counted as conditioning load.
export const CARDIO_EXACT_NAME_RE = /^\s*(?:rowing|walking|walk|hiking|hike|ходьба|прогулянка|похід)\s*$/iu;

/** The metric a name implies when nothing else is known (a swapped-in exercise). */
export function metricFromName(name: string): "reps" | "time" | "distance" {
  if (DISTANCE_NAME_RE.test(name) || CARDIO_EXACT_NAME_RE.test(name)) return "distance";
  if (TIME_NAME_RE.test(name)) return "time";
  return "reps";
}
