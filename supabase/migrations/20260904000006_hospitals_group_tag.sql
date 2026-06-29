-- Group tag for CEO multi-branch board filtering
ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS group_tag text;
CREATE INDEX IF NOT EXISTS idx_hospitals_group_tag ON hospitals(group_tag) WHERE group_tag IS NOT NULL;
