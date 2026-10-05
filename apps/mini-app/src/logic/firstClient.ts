// The trainer's first-client path, step by step: invite someone, they join, they finish the
// intake, the trainer reviews the draft and assigns it. The owner roster showed trainers stall
// between these steps; the checklist names the next one. Pure; test/mini-app-first-client.test.ts.
export type FirstClientStep = "invite" | "joined" | "intake" | "assigned";

export interface ClientState { id: number; onboarded?: boolean; plan?: "active" | "draft" | "none" }

export interface FirstClientProgress {
  done: Record<FirstClientStep, boolean>;
  next: FirstClientStep | null; // null = the path is complete
  draftClientId: number | null; // a client whose draft is waiting for review, if any
}

export const FIRST_CLIENT_STEPS: FirstClientStep[] = ["invite", "joined", "intake", "assigned"];

export function firstClientProgress(clients: ClientState[], invitesSent: number): FirstClientProgress {
  const joined = clients.length > 0;
  const done: Record<FirstClientStep, boolean> = {
    invite: invitesSent > 0 || joined,
    joined,
    intake: clients.some((c) => c.onboarded),
    assigned: clients.some((c) => c.plan === "active"),
  };
  // A later step implies the earlier ones (an assigned plan means the client did join, etc.).
  if (done.assigned) done.intake = true;
  return {
    done,
    next: FIRST_CLIENT_STEPS.find((s) => !done[s]) ?? null,
    draftClientId: clients.find((c) => c.plan === "draft")?.id ?? null,
  };
}
