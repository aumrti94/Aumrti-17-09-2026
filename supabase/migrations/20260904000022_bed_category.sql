-- Add bed category and equipment flags to beds table
ALTER TABLE beds ADD COLUMN IF NOT EXISTS bed_category text
  DEFAULT 'general'
  CHECK (bed_category IN ('general','semi_private','private','icu','nicu','sicu','picu','hdu','isolation'));

ALTER TABLE beds ADD COLUMN IF NOT EXISTS oxygen_equipped boolean DEFAULT false;
ALTER TABLE beds ADD COLUMN IF NOT EXISTS has_monitor boolean DEFAULT false;
ALTER TABLE beds ADD COLUMN IF NOT EXISTS is_ac boolean DEFAULT false;
