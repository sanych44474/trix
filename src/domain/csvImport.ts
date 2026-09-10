// CSV import from third-party workout trackers -- pure, no DB. Supports the two exports users
// actually bring with them: Strong (https://www.strong.app) and Hevy (https://hevy.com). Header
// layouts verified against real sample exports (Strong: Date,Workout Name,Duration,Exercise
// Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE -- some app versions also
// add Weight Unit/Distance Unit columns, handled below if present. Hevy:
// title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,
// set_type,weight_kg,reps,distance_km,duration_seconds,rpe -- weight/distance are always metric).
import type { LoggedExercise, SetEntry } from "../types";

export interface ImportedDay {
  date: string; // YYYY-MM-DD
  exercises: LoggedExercise[];
  notes?: string;
}

export type ImportFormat = "strong" | "hevy";

const LB_TO_KG = 0.45359237;
const MI_TO_M = 1609.34;

/** Minimal RFC4180 CSV parser: quoted fields, embedded commas/newlines, doubled-quote escapes. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n") {
      row.push(field); rows.push(row); row = []; field = "";
    } else {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

export function detectImportFormat(header: string[]): ImportFormat | null {
  const h = header.map((x) => x.trim().toLowerCase());
  if (h.includes("exercise name") && h.includes("set order")) return "strong";
  if (h.includes("exercise_title") && h.includes("set_index")) return "hevy";
  return null;
}

function toRecords(rows: string[][]): Record<string, string>[] {
  if (!rows.length) return [];
  const [header, ...body] = rows;
  const keys = header.map((h) => h.trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

// A catalog exercise name rarely carries the equipment suffix both apps append ("Bench Press
// (Barbell)"); stripping it improves the odds an imported set groups under the same name a
// live-logged one would use, without attempting full fuzzy matching against the catalog.
function cleanExerciseName(name: string): string {
  return name.replace(/\s*\((Barbell|Dumbbell|Machine|Cable|Bodyweight|Assisted|Band|Plate|Smith|Kettlebell)\)\s*$/i, "").trim();
}

function num(v: string | undefined): number {
  const n = parseFloat((v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function finishDay(date: string, byExercise: Map<string, SetEntry[]>, notesSet: Set<string>): ImportedDay {
  const exercises: LoggedExercise[] = [];
  for (const [name, setsDone] of byExercise) {
    if (!setsDone.length) continue;
    const rpes = setsDone.map((s) => s.rpe).filter((r): r is number => typeof r === "number");
    exercises.push({ name, setsDone, skipped: false, rpe: rpes.length ? Math.max(...rpes) : undefined });
  }
  const notes = [...notesSet].filter(Boolean).join(" / ") || undefined;
  return { date, exercises, notes };
}

function parseStrong(rows: string[][]): ImportedDay[] {
  const records = toRecords(rows);
  const byDate = new Map<string, { byExercise: Map<string, SetEntry[]>; notes: Set<string> }>();
  for (const r of records) {
    const date = (r["Date"] ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const exName = cleanExerciseName(r["Exercise Name"] ?? "");
    if (!exName) continue;
    let weight = num(r["Weight"]);
    if ((r["Weight Unit"] ?? "").toLowerCase().startsWith("lb")) weight *= LB_TO_KG;
    let meters = num(r["Distance"]);
    if (meters > 0) meters *= (r["Distance Unit"] ?? "").toLowerCase().startsWith("mi") ? MI_TO_M : 1000;
    const seconds = num(r["Seconds"]);
    const reps = Math.round(num(r["Reps"]));
    const rpeRaw = r["RPE"];
    const set: SetEntry = {
      reps,
      weight: Math.round(weight * 10) / 10,
      ...(meters > 0 ? { meters: Math.round(meters) } : {}),
      ...(seconds > 0 ? { seconds: Math.round(seconds) } : {}),
      ...(rpeRaw && Number.isFinite(parseFloat(rpeRaw)) ? { rpe: parseFloat(rpeRaw) } : {}),
    };
    if (!set.reps && !set.weight && !set.meters && !set.seconds) continue; // an unloggable/blank row
    if (!byDate.has(date)) byDate.set(date, { byExercise: new Map(), notes: new Set() });
    const entry = byDate.get(date)!;
    if (!entry.byExercise.has(exName)) entry.byExercise.set(exName, []);
    entry.byExercise.get(exName)!.push(set);
    if (r["Workout Notes"]) entry.notes.add(r["Workout Notes"]);
  }
  return [...byDate.entries()].map(([date, { byExercise, notes }]) => finishDay(date, byExercise, notes));
}

const HEVY_MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

/** "22 Dec 2025, 08:00" -> "2025-12-22" */
function parseHevyDate(s: string): string | null {
  const m = /^(\d{1,2})\s+([A-Za-z]{3})\w*\s+(\d{4})/.exec(s.trim());
  if (!m) return null;
  const mon = HEVY_MONTHS[m[2].slice(0, 1).toUpperCase() + m[2].slice(1, 3).toLowerCase()];
  if (!mon) return null;
  return `${m[3]}-${mon}-${m[1].padStart(2, "0")}`;
}

function parseHevy(rows: string[][]): ImportedDay[] {
  const records = toRecords(rows);
  const byDate = new Map<string, { byExercise: Map<string, SetEntry[]>; notes: Set<string> }>();
  for (const r of records) {
    if ((r["set_type"] ?? "").toLowerCase() === "warmup") continue; // not a working set
    const date = parseHevyDate(r["start_time"] ?? "");
    if (!date) continue;
    const exName = cleanExerciseName(r["exercise_title"] ?? "");
    if (!exName) continue;
    const weight = num(r["weight_kg"]);
    const meters = num(r["distance_km"]) * 1000;
    const seconds = num(r["duration_seconds"]);
    const reps = Math.round(num(r["reps"]));
    const rpeRaw = r["rpe"];
    const set: SetEntry = {
      reps,
      weight: Math.round(weight * 10) / 10,
      ...(meters > 0 ? { meters: Math.round(meters) } : {}),
      ...(seconds > 0 ? { seconds: Math.round(seconds) } : {}),
      ...(rpeRaw && Number.isFinite(parseFloat(rpeRaw)) ? { rpe: parseFloat(rpeRaw) } : {}),
    };
    if (!set.reps && !set.weight && !set.meters && !set.seconds) continue;
    if (!byDate.has(date)) byDate.set(date, { byExercise: new Map(), notes: new Set() });
    const entry = byDate.get(date)!;
    if (!entry.byExercise.has(exName)) entry.byExercise.set(exName, []);
    entry.byExercise.get(exName)!.push(set);
    if (r["description"]) entry.notes.add(r["description"]);
  }
  return [...byDate.entries()].map(([date, { byExercise, notes }]) => finishDay(date, byExercise, notes));
}

/** Parse a full CSV export into per-day logged workouts. Returns null when the header doesn't
 * match a known format at all (caller should tell the user "unrecognized file" vs "empty file"). */
export function parseWorkoutCsv(text: string): { format: ImportFormat; days: ImportedDay[] } | null {
  const rows = parseCsvRows(text);
  if (!rows.length) return null;
  const format = detectImportFormat(rows[0]);
  if (!format) return null;
  const days = format === "strong" ? parseStrong(rows) : parseHevy(rows);
  return { format, days };
}
