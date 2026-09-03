-- 0044: "instructor" capability — the owner promotes a trainer to instructor (the owner has it
-- implicitly). Instructors get the "share a program" powers (link / direct-assign / public
-- library — added in phases). A plain trainer without the flag cannot share broadly.
-- Apply manually: npx wrangler d1 execute trix --remote --file migrations/0044_instructor.sql

ALTER TABLE trainers ADD COLUMN isInstructor INTEGER NOT NULL DEFAULT 0;
