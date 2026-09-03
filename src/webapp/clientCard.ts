// Client-card payload for the trainer Mini App view: one JSON with the trainer's own notes,
// consent-gated client data (body/health), billing bookkeeping and the client's full dashboard
// payload (for the embedded charts). Assembly is pure (assembleClientCardPayload, unit-tested);
// buildClientCardPayload only fetches rows.
import { trainerCanSee } from "../domain/clientCard";
import { computeCyclePhase } from "../domain/cycle";
import { localParts } from "../domain/progression";
import { getClientBilling, getClientCard, getClientNote, listActiveInjuries, listProgressPhotos } from "../db/repos";
import { buildDashboardPayload, type DashboardPayload } from "./dashboard";
import type { ClientCardDoc, InjuryDoc, UserDoc } from "../types";

export interface ClientCardPayload {
  client: { id: number; name: string; onboarded: boolean; flagged: boolean };
  // Female + cycleTracking + health consent only.
  cycle?: { phase: string; day: number };
  note: string | null;
  card: { healthNotes: string | null; personalNotes: string | null; birthday: string | null } | null;
  shared: {
    body?: {
      heightCm?: number;
      weightKg?: number;
      age?: number;
      sex?: string;
      goalWeight?: number;
      measurements?: Record<string, number>;
    };
    health?: {
      limitations?: string;
      injuries: Array<{ area: string; severity: string; since: string; lastScore?: number }>;
    };
  };
  billing: { paidUntil: string | null; sessionsLeft: number | null } | null;
  photos?: { id: number; takenAt: string }[];
  dashboard: DashboardPayload;
}

/** Pure payload assembly from pre-fetched rows — exported for unit tests.
 * All consent gating (shareWithTrainer) happens HERE, so a fetch-layer mistake
 * can't leak: rows passed in are re-checked against the client's profile. */
export function assembleClientCardPayload(
  client: UserDoc,
  today: string,
  rows: {
    card: ClientCardDoc | null;
    note: string | null;
    injuries: InjuryDoc[];
    billing: { paidUntil: string | null; sessionsLeft: number | null } | null;
    dashboard: DashboardPayload;
  },
): ClientCardPayload {
  const profile = client.profile;
  const shared: ClientCardPayload["shared"] = {};

  if (trainerCanSee(profile, "body")) {
    const measurements: Record<string, number> = {};
    for (const [k, v] of Object.entries(profile.measurements ?? {})) {
      if (typeof v === "number") measurements[k] = v;
    }
    shared.body = {
      ...(profile.heightCm !== undefined ? { heightCm: profile.heightCm } : {}),
      ...(profile.weightKg !== undefined ? { weightKg: profile.weightKg } : {}),
      ...(profile.age !== undefined ? { age: profile.age } : {}),
      ...(profile.sex !== undefined ? { sex: profile.sex } : {}),
      ...(profile.goalWeight !== undefined ? { goalWeight: profile.goalWeight } : {}),
      ...(Object.keys(measurements).length ? { measurements } : {}),
    };
  }

  if (trainerCanSee(profile, "health")) {
    shared.health = {
      ...(profile.limitations ? { limitations: profile.limitations } : {}),
      injuries: rows.injuries.map((i) => {
        const last = i.checkinsHistory[i.checkinsHistory.length - 1];
        return {
          area: i.area,
          severity: i.severity,
          since: i.reportedAt.slice(0, 10),
          ...(last ? { lastScore: last.score } : {}),
        };
      }),
    };
  }

  // Cycle phase is health-gated (computeCyclePhase itself requires female + cycleTracking
  // + a logged period start, so a male / non-tracking profile yields no chip).
  const cycle = trainerCanSee(profile, "health") ? computeCyclePhase(profile, today) : null;

  return {
    client: {
      id: client._id,
      name: profile.name ?? `id ${client._id}`,
      onboarded: client.onboarded,
      flagged: !!client.flagged,
    },
    ...(cycle ? { cycle: { phase: cycle.phase, day: cycle.day } } : {}),
    note: rows.note ? rows.note : null,
    card: rows.card
      ? { healthNotes: rows.card.healthNotes, personalNotes: rows.card.personalNotes, birthday: rows.card.birthday }
      : null,
    shared,
    billing: rows.billing ? { paidUntil: rows.billing.paidUntil, sessionsLeft: rows.billing.sessionsLeft } : null,
    dashboard: rows.dashboard,
  };
}

export async function buildClientCardPayload(db: D1Database, trainer: UserDoc, client: UserDoc): Promise<ClientCardPayload> {
  // The cycle chip runs on the CLIENT's local date (same as the bot's client card).
  const today = localParts(client.profile.timezone).date;
  const [card, note, injuries, billing, dashboard, photos] = await Promise.all([
    getClientCard(db, trainer._id, client._id),
    getClientNote(db, trainer._id, client._id).catch(() => null),
    // Skip the injuries query entirely when health isn't shared (free-tier subrequest budget).
    trainerCanSee(client.profile, "health")
      ? listActiveInjuries(db, client._id).catch(() => [] as InjuryDoc[])
      : Promise.resolve([] as InjuryDoc[]),
    getClientBilling(db, trainer._id, client._id).catch(() => null),
    buildDashboardPayload(db, client),
    listProgressPhotos(db, client._id, 8).catch(() => []),
  ]);
  const payload = assembleClientCardPayload(client, today, { card, note, injuries, billing, dashboard });
  payload.photos = photos.map((ph) => ({ id: ph.id, takenAt: ph.takenAt.slice(0, 10) }));
  return payload;
}
