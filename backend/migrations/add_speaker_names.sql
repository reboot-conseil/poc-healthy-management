-- Add speaker_names column to sessions table
-- Run once against your database:
--   psql $DATABASE_URL -f migrations/add_speaker_names.sql

ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS speaker_names JSONB;
