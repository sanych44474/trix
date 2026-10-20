-- FCM 25.1 (June 2026) moved Android push registration from tokens to the Firebase Installation ID
-- (FID). Each device row says which one it holds, because the send request targets them through
-- different fields (`token` vs `fid`). Existing rows are tokens.
ALTER TABLE v2_push_devices ADD COLUMN kind TEXT NOT NULL DEFAULT 'token' CHECK (kind IN ('token', 'fid'));
