-- Repairable, idempotent continuation for squad data if 0070 was applied before its final
-- backfill statements were included.
INSERT OR IGNORE INTO v2_squads (id, chatId, createdByAccountId, createdAt)
SELECT chatId, chatId, createdBy, createdAt FROM squads;
INSERT OR IGNORE INTO v2_squad_members (squadId, accountId, joinedAt)
SELECT chatId, userId, joinedAt FROM squad_members;
