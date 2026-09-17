---
name: supabase-migration
description: Use when creating or modifying database tables, columns, RLS policies, indexes, triggers, or RPC functions in this repo. Covers the migration file convention, the mandatory RLS isolation policy, the public.users vs auth.users foreign-key rule that has its own CI gate, audit triggers on PHI tables, and the check scripts that must pass before the change can merge.
---

# Supabase migrations in Aumrti

Exemplar to copy from:
[20261106000001_bed_transfers.sql](../../../supabase/migrations/20261106000001_bed_transfers.sql).

612 migrations exist. Before writing one, grep the history for the table you are touching — most
"new" tables turn out to have prior art, and repair migrations record why a column is shaped the way
it is.

## File naming

`supabase/migrations/YYYYMMDDHHMMSS_snake_case_description.sql`

The timestamp must sort **after** every existing file. Check `ls supabase/migrations | tail -3`
first — an out-of-order timestamp either never runs or runs before its dependencies.

## The shape every new table must have

```sql
-- One or two sentences on WHY this table exists and what breaks without it.
-- The migration history here is the primary design record; comments are read far
-- more often than they are written.
CREATE TABLE IF NOT EXISTS public.bed_transfers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id    UUID NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  admission_id   UUID NOT NULL REFERENCES public.admissions(id) ON DELETE CASCADE,
  transferred_by UUID REFERENCES public.users(id),   -- NOT auth.users — see below
  is_deleted     BOOLEAN NOT NULL DEFAULT false,     -- soft delete, never DROP
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- MANDATORY. Enforced by npm run check:rls-coverage.
ALTER TABLE public.bed_transfers ENABLE ROW LEVEL SECURITY;

-- MANDATORY. USING governs read/update/delete; WITH CHECK governs insert/update.
-- State both — an isolation policy with only USING lets a write name another tenant.
DROP POLICY IF EXISTS "hospital_isolation" ON public.bed_transfers;
CREATE POLICY "hospital_isolation" ON public.bed_transfers
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- Index the query patterns you are actually adding, and say which.
CREATE INDEX IF NOT EXISTS idx_bed_transfers_admission
  ON public.bed_transfers(admission_id, transferred_at);
CREATE INDEX IF NOT EXISTS idx_bed_transfers_hospital
  ON public.bed_transfers(hospital_id);
```

`public.get_user_hospital_id()` is the only tenant helper in this codebase — 1,026 uses. Do not
hand-roll a subquery against `users`.

## The `_by` column rule — read this before adding any attribution column

There are **two different user identities**:

- `auth.users.id` — the Supabase auth uid
- `public.users.id` — the app-side staff row

They were the same value until migration `20260322111223` decoupled them. Since then they diverge
for every account created after that point. The application writes `public.users.id` (it comes from
`HospitalContext` as `userId`), and ~70 tables FK to `public.users(id)` accordingly.

A batch of migrations around 20260901–20260910 wrote `REFERENCES auth.users(id)` on their `*_by`
columns instead. Those tables now accept writes only from pre-decoupling accounts and raise a
foreign-key violation for everyone else. That is what silently broke every tab of the ICU
Workspace, Medication Reconciliation, and Dental Lab Orders.

**So: any column ending `_by` (or `_doctor`) references `public.users(id)`.**

`npm run check:user-fk` fails the build otherwise. If a column genuinely holds an auth uid — it is
written from `supabase.auth.getUser()` rather than from `HospitalContext` — add it to the
`ALLOWLIST` in [check-user-fk-convention.mjs](../../../scripts/check-user-fk-convention.mjs) with a
comment justifying it. That allowlist is the one place the check can be silently defeated; treat
adding to it as a decision, not a formality.

Repointing an existing column? Follow
[20261106000003_fix_user_fk_targets.sql](../../../supabase/migrations/20261106000003_fix_user_fk_targets.sql)
— it remaps existing values through `users.auth_user_id` first, so clinical attribution survives the
change instead of being nulled.

## Idempotency

`IF NOT EXISTS` on tables and indexes, `CREATE OR REPLACE` on functions,
`DROP POLICY IF EXISTS` before `CREATE POLICY` (416 migrations do this — policies have no
`OR REPLACE`, so re-running without the drop errors).

**Never `DROP TABLE` in a production migration.** Add `is_deleted BOOLEAN DEFAULT false` and
filter on it. Never drop or retype a column holding clinical or financial history either.

## PHI tables need an audit trigger

Any table holding patient-identifying or clinical data:

```sql
DROP TRIGGER IF EXISTS log_phi_bed_transfers ON public.bed_transfers;
CREATE TRIGGER log_phi_bed_transfers
  AFTER INSERT OR UPDATE OR DELETE ON public.bed_transfers
  FOR EACH ROW EXECUTE FUNCTION public.log_phi_change();
```

`public.emit_api_event` is the other common trigger (30 uses) — attach it when the table's changes
should reach webhook subscribers. Never write PHI into a trigger's `RAISE NOTICE`.

## Then wire up the application side

A migration alone is half the change. `types.ts` is generated and lags the live schema, so
`npm run check:db-contract` treats a name it has never seen as a hard failure — unless that name
appears in a `CREATE TABLE` in the migration history, in which case it is reported as *pending*.
That is why migration and calling code belong in the same change.

## Before you call it done

```bash
npm run check:rls-coverage   # every CREATEd table has RLS somewhere
npm run check:user-fk        # no *_by column pointing at auth.users
npm run check:db-contract    # every .from()/.rpc() name resolves
```

All three are heuristic text scans over `supabase/migrations/`, not live-DB checks — they run
anywhere, and they are the same gates CI runs.

Multi-tenant isolation claims need an automated two-hospital test, never a manual check alone.

RPC functions, enums, generated columns, backfills, and the RLS patterns for cross-tenant
reference tables: [references/patterns.md](references/patterns.md).