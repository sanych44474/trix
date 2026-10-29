// Rep drop-off inside one session, for the session summary. Rule: for a reps exercise, take the
// filled sets, keep the ones within 2.5 kg of the heaviest set (lighter warm-ups fall out), and
// flag it when there are at least 3 of them and the last set's reps are <= 60% of the first's,
// or -- when the first set has 8 reps or fewer -- it fell by 4 or more reps. Time and distance
// exercises are skipped. Worst first (lowest last/first ratio). Test: test/mini-app-rep-dropoff.test.ts.

export interface RepDropoff {
  name: string;
  weight: number; // kg of the working sets (0 for bodyweight)
  reps: number[]; // working-set reps in order
}

interface DropoffSet { weight: number; reps: number }
interface DropoffExercise { name: string; metric: string; setsDone?: DropoffSet[] }

const SAME_WEIGHT_KG = 2.5;

export function repDropoffs(exercises: DropoffExercise[]): RepDropoff[] {
  const hits: Array<RepDropoff & { ratio: number; drop: number }> = [];
  for (const exercise of exercises) {
    if (exercise.metric !== "reps") continue;
    const filled = (exercise.setsDone ?? []).filter((set) => set.reps > 0);
    if (filled.length === 0) continue;
    const top = Math.max(...filled.map((set) => set.weight));
    const working = filled.filter((set) => set.weight >= top - SAME_WEIGHT_KG);
    if (working.length < 3) continue;
    const first = working[0].reps;
    const last = working[working.length - 1].reps;
    const steep = last <= first * 0.6 || (first <= 8 && first - last >= 4);
    if (!steep) continue;
    hits.push({ name: exercise.name, weight: top, reps: working.map((set) => set.reps), ratio: last / first, drop: first - last });
  }
  return hits.sort((a, b) => a.ratio - b.ratio || b.drop - a.drop).map(({ name, weight, reps }) => ({ name, weight, reps }));
}
