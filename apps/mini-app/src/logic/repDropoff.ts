// The rule lives in src/domain/repDropoff.ts (shared with the save response). This is the Mini App's
// entry point: a thin wrapper, so components keep importing from logic/. Test: test/mini-app-rep-dropoff.test.ts.
import { repDropoffs as dropoffRule, type RepDropoff as DomainRepDropoff } from "../../../../src/domain/repDropoff";

export type RepDropoff = DomainRepDropoff;

type DropoffExercise = Parameters<typeof dropoffRule>[0][number];

export function repDropoffs(exercises: DropoffExercise[]): RepDropoff[] {
  return dropoffRule(exercises);
}
