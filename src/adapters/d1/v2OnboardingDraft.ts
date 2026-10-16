// Mini App questionnaire drafts (migration 0096): saved while the person answers, read back on a
// new device, shown as "answered/total" in the owner console, deleted on completion.
import { nowIso } from "./shared";

interface OnboardingDraft {
  answers: string;
  answered: number;
  total: number;
  updatedAt: string;
}

export async function saveOnboardingDraft(db: D1Database, accountId: number, answers: string, answered: number, total: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO v2_onboarding_drafts (accountId, answers, answered, total, updatedAt) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(accountId) DO UPDATE SET answers = excluded.answers, answered = excluded.answered, total = excluded.total, updatedAt = excluded.updatedAt`,
    )
    .bind(accountId, answers, answered, total, nowIso())
    .run();
}

export async function getOnboardingDraft(db: D1Database, accountId: number): Promise<OnboardingDraft | null> {
  return (await db.prepare("SELECT answers, answered, total, updatedAt FROM v2_onboarding_drafts WHERE accountId = ?").bind(accountId).first<OnboardingDraft>()) ?? null;
}

export async function deleteOnboardingDraft(db: D1Database, accountId: number): Promise<void> {
  await db.prepare("DELETE FROM v2_onboarding_drafts WHERE accountId = ?").bind(accountId).run();
}

/** answered/total per account with a draft (owner console). */
export async function onboardingDraftProgress(db: D1Database): Promise<Map<number, { answered: number; total: number }>> {
  const r = await db.prepare("SELECT accountId, answered, total FROM v2_onboarding_drafts").all<{ accountId: number; answered: number; total: number }>();
  return new Map((r.results ?? []).map((x) => [x.accountId, { answered: x.answered, total: x.total }]));
}
