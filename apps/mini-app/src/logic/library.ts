// Exercise library data and search (Library.tsx). Pure; test/mini-app-library.test.ts.

export interface LibraryEntry {
  id: string; // free-exercise-db id = image folder
  title: string; // English name
  titleUk: string; // Ukrainian name (scripts/data/exercise-names-uk.tsv), English if missing
  muscle: string; // body map slug
  equipment: string; // body | dumbbell | barbell | kettlebell | band | cable | machine | ezbar | ball | other
  level: "b" | "i" | "e";
}

export function parseLibrary(packed: string): LibraryEntry[] {
  return packed.split("\n").filter(Boolean).map((line) => {
    const [id, muscle, equipment, level, uk] = line.split("|") as [string, string, string, string, string | undefined];
    const title = id.replace(/_/g, " ");
    return { id, title, titleUk: uk || title, muscle, equipment, level: (level === "i" || level === "e" ? level : "b") as LibraryEntry["level"] };
  });
}

// Ukrainian (and a few Russian) movement words → the English words the names use, so "присідання
// з гантелями" finds "Dumbbell Squat". Stems, matched at the start of a query word.
const UA_WORDS: Array<[RegExp, string[]]> = [
  [/^присід|^присед/, ["squat"]], [/^випад|^выпад/, ["lunge"]], [/^жим/, ["press"]], [/^тяг/, ["row", "pull", "deadlift"]],
  [/^станов/, ["deadlift"]], [/^румун/, ["romanian"]], [/^згинан|^сгибан/, ["curl"]], [/^розгинан|^разгибан/, ["extension", "pushdown"]],
  [/^віджим|^отжим/, ["push-up", "pushup"]], [/^підтяг|^подтяг/, ["pull-up", "pullup", "chin"]], [/^планк/, ["plank"]],
  [/^скруч|^прес/, ["crunch", "sit-up"]], [/^мах|^розвед|^развед/, ["raise", "fly", "flye"]], [/^міст|^мост/, ["bridge", "thrust"]],
  [/^гантел/, ["dumbbell"]], [/^штанг/, ["barbell"]], [/^гир/, ["kettlebell"]], [/^блок|^кросовер|^кроссовер|^трос/, ["cable"]],
  [/^тренажер/, ["machine", "lever"]], [/^литк|^носк|^икр/, ["calf"]], [/^шраг/, ["shrug"]], [/^пуловер/, ["pullover"]],
  [/^гіперекст|^гиперэкст/, ["hyperextension"]], [/^берпі|^бёрпи|^берпи/, ["burpee"]], [/^стрибк|^прыж/, ["jump"]],
  [/^молот/, ["hammer"]], [/^француз/, ["skull", "lying triceps"]], [/^біг|^бег/, ["run", "jog"]],
];

// Each query word: itself (matched in the English or Ukrainian name) plus, for a known movement
// stem, its English words; a Ukrainian word also matches by its first 5 letters, so "гантелями"
// finds "з гантелями" and "гантелі" alike.
function queryWords(query: string): string[][] {
  return query.toLowerCase().split(/\s+/).filter((w) => w.length >= 2).map((w) => {
    const mapped = UA_WORDS.find(([re]) => re.test(w));
    const stem = /[а-яіїєґ]/.test(w) && w.length > 5 ? w.slice(0, 5) : w;
    return [stem, ...(mapped ? mapped[1] : [])];
  });
}

/** Every query word must match (any of its alternatives) somewhere in the English or Ukrainian name. */
export function filterLibrary(all: LibraryEntry[], f: { muscle?: string; equipment?: string; query?: string }): LibraryEntry[] {
  const words = f.query ? queryWords(f.query) : [];
  return all.filter((e) => {
    if (f.muscle && e.muscle !== f.muscle) return false;
    if (f.equipment && e.equipment !== f.equipment) return false;
    if (!words.length) return true;
    const name = `${e.title}|${e.titleUk}`.toLowerCase();
    return words.every((alts) => alts.some((a) => name.includes(a)));
  }).sort((a, b) => (a.level === b.level ? a.title.localeCompare(b.title) : a.level === "b" ? -1 : b.level === "b" ? 1 : a.level === "i" ? -1 : 1));
}
