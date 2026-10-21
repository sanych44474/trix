-- The owner's reply to a piece of feedback (from the bot or the owner console). The author gets it
-- in Telegram or as a push, and in their in-app inbox; the console shows it next to the feedback.
ALTER TABLE v2_feedback ADD COLUMN reply TEXT;
ALTER TABLE v2_feedback ADD COLUMN repliedAt TEXT;
