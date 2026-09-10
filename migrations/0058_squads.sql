-- Squad mode: the bot living in a group chat friends already use, keeping a weekly scoreboard.
-- One squad per group chat; membership is opt-in per user and independent of the 1:1 buddy pair.
CREATE TABLE IF NOT EXISTS squads (
  chatId    INTEGER PRIMARY KEY,       -- Telegram group/supergroup chat id (negative)
  title     TEXT,                      -- chat title at registration time, for logs/owner report
  createdBy INTEGER NOT NULL,          -- users.id of whoever ran /squad first
  createdAt TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS squad_members (
  chatId   INTEGER NOT NULL,
  userId   INTEGER NOT NULL,
  joinedAt TEXT    NOT NULL,
  PRIMARY KEY (chatId, userId)
);

-- Fan-out the other way: "which squads should hear about this user's PR".
CREATE INDEX IF NOT EXISTS idx_squad_members_user ON squad_members(userId);
