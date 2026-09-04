---
name: supabase-migration
description: Use when creating or modifying database tables, RLS policies, indexes, or triggers in this repo. Covers the required migration file naming convention and the mandatory structure (RLS enable + isolation policy) every new table needs.
---

# Supabase migration

## Migration file naming

Format: `supabase/migrations/YYYYMMDDHHMMSS_description.sql`
Example: `supabase/migrations/20260501120000_add_doctor_schedules.sql`

## Required structure for every new table

```sql
-- 1. Create table
CREATE TABLE IF NOT EXISTS table_name (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  -- your columns here
  created_at timestamptz DEFAULT now()
);

-- 2. Enable RLS (MANDATORY)
ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;

-- 3. Hospital isolation policy (MANDATORY)
CREATE POLICY "Hospital isolation" ON table_name
  FOR ALL USING (hospital_id = get_user_hospital_id());

-- 4. Performance indexes
CREATE INDEX IF NOT EXISTS idx_table_name_hospital
  ON table_name(hospital_id, created_at DESC);
```

## Rules

- Always use `IF NOT EXISTS` — migrations must be idempotent.
- Never `DROP TABLE` — use a status column + soft delete instead.
- Always add RLS before inserting any data.
- Run the migration in Supabase Dashboard → SQL Editor to verify before committing.
