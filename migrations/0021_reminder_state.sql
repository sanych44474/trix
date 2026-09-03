-- Reminder dedup state moved OUT of the session JSON into its own column. It used to live in
-- users.session.lastReminders / lastNudge, but every user-facing session write (setMode etc.)
-- replaces the session object and dropped it — so any interaction after a reminder wiped the
-- dedup mark and the reminder fired again the same day. A dedicated column is untouched by
-- session writes. Shape: { "sent": { "<key>": "YYYY-MM-DD" }, "lastNudge": "YYYY-MM-DD" }.
ALTER TABLE users ADD COLUMN reminders TEXT;
