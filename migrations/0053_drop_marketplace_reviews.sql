-- The public browsable trainer directory and its reviews are retired: at one approved trainer,
-- a browsable catalog with ratings is a moderation obligation for zero market. Trainers keep
-- acquiring and keeping clients through the request/accept flow and personal invite links
-- (tr_<code>), neither of which reads trainer_reviews or the rating columns.
--
-- The application code (catalog browse/filter/detail, star ratings, review submission) was
-- removed in the same change that adds this migration — see the commit that introduces this
-- file.
DROP TABLE IF EXISTS trainer_reviews;
ALTER TABLE trainers DROP COLUMN ratingSum;
ALTER TABLE trainers DROP COLUMN ratingCount;
