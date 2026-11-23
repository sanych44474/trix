-- Who logged a workout session on the account's behalf: the trainer's account id. NULL means the
-- account itself saved it. Attribution only, like v2_plans.authoredBy: no foreign key, cleared by
-- deleteUserData when the trainer's account is deleted. The last writer owns the mark, so the
-- client re-saving the day clears it (docs/adr/0018-trainer-authored-workout-logs.md). Schema only.
ALTER TABLE v2_workout_sessions ADD COLUMN loggedBy INTEGER;
