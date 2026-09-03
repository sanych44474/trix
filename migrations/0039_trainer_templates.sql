-- 0039: reusable trainer program templates. A trainer saves any client's plan under a name
-- and later assigns it to another client — the template goes through adaptPlan (weekday
-- remap, weight scaling to bodyweight/PRs) before becoming that client's draft.
-- Apply manually: npx wrangler d1 execute trix --remote --file migrations/0039_trainer_templates.sql

CREATE TABLE IF NOT EXISTS trainer_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trainerId INTEGER NOT NULL,
  name TEXT NOT NULL,
  plan TEXT NOT NULL, -- BankPlan-shaped JSON: { split, nutrition, supplements, methodology, stepsTarget? }
  createdAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trainer_templates_trainer ON trainer_templates(trainerId);
