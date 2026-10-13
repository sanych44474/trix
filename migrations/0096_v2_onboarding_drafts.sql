-- The Mini App questionnaire's answers so far, saved as the person goes (the phone keeps its own
-- copy too). Lets the owner console show which question someone stopped at instead of a bare
-- "onboarding", and lets a different device resume where they left off. Deleted when onboarding
-- completes (questionnaire or ready program) and with the account.
CREATE TABLE IF NOT EXISTS v2_onboarding_drafts (
  accountId INTEGER PRIMARY KEY REFERENCES v2_accounts(id) ON DELETE CASCADE,
  answers TEXT NOT NULL,           -- JSON, the wizard's Answers (capped at 4 KB by the API)
  answered INTEGER NOT NULL,       -- questions answered
  total INTEGER NOT NULL,          -- questions in this person's questionnaire
  updatedAt TEXT NOT NULL
);
