-- The per-user AI rate limit (aiAttemptCountForUserSince) and the daily form-check quota
-- (aiCallsToday) both filter v2_ai_calls by accountId and a createdAt window. The only index was on
-- createdAt, so each check scanned every AI call of the window across all users.
CREATE INDEX IF NOT EXISTS idx_v2_ai_calls_account_created ON v2_ai_calls(accountId, createdAt);
