-- Client reviews of trainers. One review per (trainer, client); the trainers table keeps a
-- denormalized ratingSum/ratingCount for fast directory display, recomputed on each write.

CREATE TABLE IF NOT EXISTS trainer_reviews (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  trainerId INTEGER NOT NULL,
  clientId  INTEGER NOT NULL,
  rating    INTEGER NOT NULL,          -- 1..5
  text      TEXT,
  createdAt TEXT    NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_review_unique  ON trainer_reviews(trainerId, clientId);
CREATE INDEX        IF NOT EXISTS idx_review_trainer ON trainer_reviews(trainerId, createdAt);
