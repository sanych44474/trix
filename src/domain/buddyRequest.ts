// Accountability buddy requests: opening someone's buddy link sends them a request, and only their
// Accept pairs the two (bot/buddyRequest.ts). Pure; test/buddy-request.test.ts.
import type { UserDoc } from "../types";

/** A request is gone after this long: the person asked has moved on, and an old button must not
 * pair anyone. */
export const BUDDY_REQUEST_TTL_MS = 7 * 86_400_000;

export interface BuddyRequest {
  to: number; // the account asked
  at: string; // ISO time the request was sent
}

/** True when `req` is a live request to account `to`. The callback data only names the requester;
 * this stored request is the proof that they asked this person. */
export function buddyRequestIsFor(req: BuddyRequest | undefined, to: number, now: Date): boolean {
  if (!req || req.to !== to) return false;
  const at = Date.parse(req.at);
  return Number.isFinite(at) && now.getTime() - at <= BUDDY_REQUEST_TTL_MS;
}

type Person = Pick<UserDoc, "_id" | "profile">;

/** Each side's previous buddy when `a` and `b` pair, if that is a third person. The caller unlinks
 * an old buddy only when the old buddy's own link still points back at `of`, so a third party's
 * unrelated pairing is never touched. */
export function previousBuddies(a: Person, b: Person): Array<{ oldId: number; of: number }> {
  const out: Array<{ oldId: number; of: number }> = [];
  for (const person of [a, b]) {
    const oldId = person.profile.buddyId;
    if (oldId && oldId !== a._id && oldId !== b._id) out.push({ oldId, of: person._id });
  }
  return out;
}
