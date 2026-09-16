-- Domain 8 (buddy/achievements/challenges/leaderboard/squads) completeness pass. 0069/0070 gave
-- v2_achievements/v2_challenges/v2_leaderboard_entries/v2_buddies/v2_squads/v2_squad_members a
-- PARTIAL shadow of the buddy/achievements-adjacent exports in src/db/repos/workouts.ts,
-- src/db/repos/tracking.ts's "---------- challenges ----------" section, and
-- src/db/repos/squads.ts. Comparing every in-scope export's actual column usage against the v2
-- schema (same exercise as 0073/0075/0076/0077/0078/0079) found two real gaps this migration
-- closes:
--
--   1. THE MISSING TABLE: buddy_duels (migrations/0057_buddy_duels.sql) -- the weekly
--      accountability-buddy win/loss tally recordBuddyDuel/buddyWinCount/buddyDuelHistory read
--      and write -- has no v2_* home at all. v2_buddy_duels below is a faithful 1:1 port, keyed
--      (userA, userB, weekKey) same as legacy; userA/userB naming matches the
--      v2_trainer_relationships clientId/trainerId precedent (a real FK pair, not a generic
--      accountId + peer column).
--   2. v2_squads (0070) is missing three columns squads.ts's in-scope exports actually read/
--      write: title (upsertSquad/getSquad/listSquads/squadsDueForRecap/squadsNeedingWake render
--      it), lastRecapWeek (squadsDueForRecap/markSquadRecapped gate the weekly recap fan-out on
--      it), and doWokenAt (squadsNeedingWake/markSquadWoken, migration 0062's DO-wake catch-up
--      sweep). 0069/0070/0071's backfills only ever carried id/chatId/createdByAccountId/
--      createdAt.
--
-- v2_buddies (0070) is NOT extended or used here -- see src/adapters/d1/v2Gamification.ts's
-- header comment for why the buddy PAIRING edge stays on v2_profiles.buddyId: Domain 1's
-- v2Users.ts already dual-writes it, and it is the only LIVE write path today (bot.ts's /start
-- buddy_<id> handler calls v2Users.updateUser, not any function owned by this domain) --
-- v2_buddies has no ongoing writer in the v2-native code and was populated once, at backfill
-- time. v2_achievements/v2_challenges/v2_leaderboard_entries need no schema change -- their
-- existing columns already cover every in-scope export (v2_leaderboard_entries stays
-- unpopulated: the product computes leaderboards live on read today, in legacy AND in this
-- migration's v2-native port -- see v2Gamification.ts).

CREATE TABLE IF NOT EXISTS v2_buddy_duels (
  userA     INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  userB     INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  weekKey   TEXT    NOT NULL,
  aCount    INTEGER NOT NULL,
  bCount    INTEGER NOT NULL,
  winnerId  INTEGER,
  createdAt TEXT    NOT NULL,
  PRIMARY KEY (userA, userB, weekKey)
);
CREATE INDEX IF NOT EXISTS idx_v2_buddy_duels_winner ON v2_buddy_duels(winnerId);

ALTER TABLE v2_squads ADD COLUMN title TEXT;
ALTER TABLE v2_squads ADD COLUMN lastRecapWeek TEXT;
ALTER TABLE v2_squads ADD COLUMN doWokenAt TEXT;

-- ---------- Idempotent backfill from legacy tables, same pattern as 0069/.../0079 ----------

INSERT OR IGNORE INTO v2_buddy_duels (userA, userB, weekKey, aCount, bCount, winnerId, createdAt)
SELECT userA, userB, weekKey, aCount, bCount, winnerId, createdAt FROM buddy_duels;

-- Fill in title/lastRecapWeek/doWokenAt for every v2_squads row 0069/0070/0071 already inserted.
UPDATE v2_squads SET
  title = (SELECT s.title FROM squads s WHERE s.chatId = v2_squads.chatId),
  lastRecapWeek = (SELECT s.lastRecapWeek FROM squads s WHERE s.chatId = v2_squads.chatId),
  doWokenAt = (SELECT s.doWokenAt FROM squads s WHERE s.chatId = v2_squads.chatId)
WHERE EXISTS (SELECT 1 FROM squads s WHERE s.chatId = v2_squads.chatId);

-- Catch-up for any legacy squad row every prior migration missed (same reasoning as 0071's
-- repair migration) -- now carrying the three columns that were missing from that repair too.
INSERT OR IGNORE INTO v2_squads (id, chatId, createdByAccountId, createdAt, title, lastRecapWeek, doWokenAt)
SELECT chatId, chatId, createdBy, createdAt, title, lastRecapWeek, doWokenAt FROM squads;
