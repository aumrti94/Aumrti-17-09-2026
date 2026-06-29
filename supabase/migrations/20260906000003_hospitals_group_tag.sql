-- Add group_tag to hospitals for CEO Board filtering
-- Applied: 2026-05-08

ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS group_tag text;
