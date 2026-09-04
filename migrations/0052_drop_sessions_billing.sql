-- Trainer↔client session booking and prepaid-billing bookkeeping are retired: `sessions` had
-- zero rows and `client_billing` had zero rows in production at the time of removal. Trainers
-- acquire and keep clients through the existing request/accept and direct-invite-link flows,
-- neither of which touched these tables, so no client relationship depends on this data.
--
-- The application code for both (booking calendars, group booking, .ics export, meeting links,
-- paid-until / prepaid-session tracking, renewal nudges) was removed in the same change that
-- adds this migration — see the commit that introduces this file.
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS client_billing;
