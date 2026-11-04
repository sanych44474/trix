-- Indexes for queries that ran as full table scans on hot paths (architecture review, stage 3).
-- Schema only; no data is changed.

-- listClients / countClients run on every trainer request: WHERE trainerId = ? AND status = 'active'.
-- The primary key (clientId, trainerId) leads with clientId, so this scanned every relationship.
CREATE INDEX IF NOT EXISTS idx_v2_trainer_rel_trainer ON v2_trainer_relationships(trainerId, status, clientId);

-- pendingRecoveryCount runs every minute over status != 'completed'. A partial index holds only
-- the unfinished onboardings (a small set), so the count stops scanning every account's row.
CREATE INDEX IF NOT EXISTS idx_v2_onboarding_open ON v2_onboarding(sessionMode, sessionRetryAfter) WHERE status != 'completed';

-- listVacationEnded runs every hour: vacationUntil IS NOT NULL AND vacationUntil <= ?.
CREATE INDEX IF NOT EXISTS idx_v2_accounts_vacation ON v2_accounts(vacationUntil) WHERE vacationUntil IS NOT NULL;
