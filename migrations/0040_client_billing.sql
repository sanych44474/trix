-- 0040: lightweight per-client billing bookkeeping for trainers. No payment processing —
-- just "paid until" and/or a prepaid session-package counter, plus a scheduler nudge to the
-- trainer when either runs out (nudgedAt dedupes the nudge).
-- Apply manually: npx wrangler d1 execute trix --remote --file migrations/0040_client_billing.sql

CREATE TABLE IF NOT EXISTS client_billing (
  trainerId INTEGER NOT NULL,
  clientId INTEGER NOT NULL,
  paidUntil TEXT,          -- ISO date; NULL = not tracked
  sessionsLeft INTEGER,    -- prepaid sessions remaining; NULL = not tracked
  nudgedAt TEXT,           -- last "expired / ran out" nudge sent to the trainer (ISO date)
  updatedAt TEXT NOT NULL,
  PRIMARY KEY (trainerId, clientId)
);
