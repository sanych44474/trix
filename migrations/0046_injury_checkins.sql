-- 0046: pain check-in history on injuries so users can see how an area has trended over time
-- (rather than a binary "OK / still hurts" that leaves the trainer / coach guessing). Each
-- follow-up records a 0..10 pain score keyed by date; the buttons in the follow-up prompt map
-- to a small preset scale (0 all-good, 3 twinge, 6 moderate, 8 severe).

ALTER TABLE injuries ADD COLUMN checkinsHistory TEXT NOT NULL DEFAULT '[]';
