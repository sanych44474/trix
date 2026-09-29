-- Weekly quests (src/domain/quests.ts): the quests themselves are picked deterministically from
-- last week's logs, so only completion is stored — one row per quest finished, which the XP
-- formula counts (domain/gamification.ts). (weekStart, code) makes a re-check idempotent.
CREATE TABLE IF NOT EXISTS v2_quests (
  accountId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  weekStart TEXT NOT NULL,          -- Monday, YYYY-MM-DD local
  code TEXT NOT NULL,               -- e.g. workouts | muscle_sets:hamstring | water_days
  completedAt TEXT NOT NULL,
  PRIMARY KEY (accountId, weekStart, code)
);
