# Migration patterns — detail

## The tenant helper

```sql
CREATE OR REPLACE FUNCTION public.get_user_hospital_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT hospital_id FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1
$$;
```

Two things worth internalising from it:

- It joins on `auth_user_id`, not `id` — the decoupling described in SKILL.md, visible in one line.
- It is `SECURITY DEFINER` with a pinned `search_path`. Any function an RLS policy calls must be,
  or the policy recurses into the RLS of the tables the function itself reads.

## RPC functions

212 functions in the history are `SECURITY DEFINER`. That bypasses RLS by design, so such a
function must scope by tenant *itself*:

```sql
CREATE OR REPLACE FUNCTION public.get_ward_occupancy(p_ward_id UUID)
RETURNS TABLE (bed_id UUID, is_occupied BOOLEAN)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT b.id, (a.id IS NOT NULL)
  FROM public.beds b
  LEFT JOIN public.admissions a ON a.bed_id = b.id AND a.status = 'admitted'
  WHERE b.ward_id = p_ward_id
    AND b.hospital_id = public.get_user_hospital_id();   -- REQUIRED
$$;
```

Omitting that last predicate turns the function into a cross-tenant read of every hospital's beds.
`SECURITY DEFINER` without an explicit tenant filter is the single highest-risk thing you can write
in this repo.

Always pin `SET search_path` — without it a `SECURITY DEFINER` function resolves unqualified names
against the caller's `search_path`.

Prefer `STABLE` for read-only functions (the planner can then inline and cache them within a
statement); `VOLATILE` only when the function writes.

New RPCs are called from the app as `supabase.rpc("get_ward_occupancy", …)`, and the name must
resolve in `types.ts` or `npm run check:db-contract` fails.

## Reference tables with no tenant

Some tables are genuinely global — ICD-10 codes, the drug master, GST rate slabs, the lab test
catalogue. They still need RLS; the policy just isn't an isolation policy:

```sql
ALTER TABLE public.icd10_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_all_authenticated" ON public.icd10_codes;
CREATE POLICY "read_all_authenticated" ON public.icd10_codes
  FOR SELECT TO authenticated USING (true);
```

Read-only to `authenticated`, writes reserved to the service role. Do **not** add such a table to
the `ALLOWLIST` in `check-rls-coverage.mjs` — that allowlist is for tables with no RLS at all, and
it is currently empty. Keep it that way.

If a table is *mostly* global but hospitals may add their own rows, use a nullable `hospital_id`
where `NULL` means "system-provided":

```sql
USING (hospital_id IS NULL OR hospital_id = public.get_user_hospital_id())
WITH CHECK (hospital_id = public.get_user_hospital_id())
```

Read both; write only your own.

## Adding a column

```sql
ALTER TABLE public.admissions
  ADD COLUMN IF NOT EXISTS discharge_summary_id UUID REFERENCES public.discharge_summaries(id);
```

Adding a `NOT NULL` column to a populated table needs a default or a three-step
(add nullable → backfill → set not null). A bare `ADD COLUMN … NOT NULL` fails on any table with
rows, and these tables all have rows in production.

Widening a type is safe; narrowing is not. Never retype a column holding financial or clinical
history — add the new column and migrate readers.

## Backfills

Keep them in the same migration as the schema change, and make them re-runnable:

```sql
UPDATE public.bills
   SET payer_type = 'self'
 WHERE payer_type IS NULL;
```

A backfill touching a large PHI table should be batched rather than done in one statement — see
`supabase/functions/phi-backfill-encrypt` for the pattern used when the volume warrants a function
instead of a migration.

## Enums

```sql
DO $$ BEGIN
  CREATE TYPE public.transfer_reason AS ENUM ('clinical', 'patient_request', 'infection_control');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
```

`CREATE TYPE` has no `IF NOT EXISTS`, hence the exception block. Adding a value later is
`ALTER TYPE … ADD VALUE IF NOT EXISTS`; **removing** one is not practically possible, so prefer a
`TEXT` column with a `CHECK` constraint when the value set is still moving.

## Indexes

Index what you are actually adding a query for, and say so in a comment. Composite column order
follows the query: equality columns first, then the ordering column.

```sql
-- Serves the one query every consumer needs: an admission's transfers in order.
CREATE INDEX IF NOT EXISTS idx_bed_transfers_admission
  ON public.bed_transfers(admission_id, transferred_at);
```

`hospital_id` deserves its own index on any table that grows per-tenant — every RLS policy
evaluates that predicate on every row touched.

Building an index on a large live table? `CREATE INDEX CONCURRENTLY` avoids the write lock, but it
cannot run inside a transaction block, so it needs its own migration file with nothing else in it.

## Checklist

- [ ] Timestamp sorts after `ls supabase/migrations | tail -3`
- [ ] Header comment explains why the table exists
- [ ] `hospital_id` column + `ENABLE ROW LEVEL SECURITY` + isolation policy with **both** `USING` and `WITH CHECK`
- [ ] Every `*_by` column references `public.users(id)`
- [ ] `IF NOT EXISTS` / `CREATE OR REPLACE` / `DROP POLICY IF EXISTS` — re-runnable
- [ ] No `DROP TABLE`; soft-delete column instead
- [ ] PHI table → audit trigger attached
- [ ] `SECURITY DEFINER` functions filter by `get_user_hospital_id()` and pin `search_path`
- [ ] `npm run check:rls-coverage && npm run check:user-fk && npm run check:db-contract`