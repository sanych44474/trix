-- Squads in the Mini App: a squad no longer needs a Telegram group. App squads get a positive id
-- (group chat ids are always negative) and an invite code people join by (t.me/<bot>?start=sq_CODE).
ALTER TABLE v2_squads ADD COLUMN inviteCode TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_squads_invite ON v2_squads(inviteCode);
