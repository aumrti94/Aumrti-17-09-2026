-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: investigation_order_schema_hardening
-- Purpose  : Add CHECK constraints, composite index, explicit RLS policies, and
--            a pg_notify INSERT trigger to lab_orders and radiology_orders.
-- Idempotent: Yes — uses IF NOT EXISTS, DROP IF EXISTS, CREATE OR REPLACE.
-- Region   : ap-south-1 (Mumbai) — Indian data residency.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. COLUMN ALIGNMENT ──────────────────────────────────────────────────────
-- billing_status + ordered_at were added by 20260516000001.
-- Re-declare with IF NOT EXISTS so this migration is self-contained if applied
-- on a fresh database after 20260516000001.

ALTER TABLE public.lab_orders
  ADD COLUMN IF NOT EXISTS billing_status text NOT NULL DEFAULT 'unbilled'
    CHECK (billing_status IN ('unbilled', 'billed', 'waived')),
  ADD COLUMN IF NOT EXISTS ordered_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.radiology_orders
  ADD COLUMN IF NOT EXISTS billing_status text NOT NULL DEFAULT 'unbilled'
    CHECK (billing_status IN ('unbilled', 'billed', 'waived')),
  ADD COLUMN IF NOT EXISTS ordered_at timestamptz NOT NULL DEFAULT now();

-- ── 2. CHECK CONSTRAINTS — priority ──────────────────────────────────────────
-- Priority is consistently 'routine' | 'urgent' | 'stat' across all callers.
-- DROP before ADD because Postgres has no ADD CONSTRAINT IF NOT EXISTS.

ALTER TABLE public.lab_orders
  DROP CONSTRAINT IF EXISTS lab_orders_priority_check;
ALTER TABLE public.lab_orders
  ADD CONSTRAINT lab_orders_priority_check
    CHECK (priority IN ('routine', 'urgent', 'stat'));

ALTER TABLE public.radiology_orders
  DROP CONSTRAINT IF EXISTS radiology_orders_priority_check;
ALTER TABLE public.radiology_orders
  ADD CONSTRAINT radiology_orders_priority_check
    CHECK (priority IN ('routine', 'urgent', 'stat'));

-- ── 3. CHECK CONSTRAINTS — status ────────────────────────────────────────────
-- These enums are derived from actual INSERT statements in the application.
-- The PRD enum ('pending','resulted','billed') is NOT used by any caller and
-- would break every INSERT from the frontend if applied.

ALTER TABLE public.lab_orders
  DROP CONSTRAINT IF EXISTS lab_orders_status_check;
ALTER TABLE public.lab_orders
  ADD CONSTRAINT lab_orders_status_check
    CHECK (status IN (
      'ordered',
      'sample_collected',
      'in_process',
      'partial_results',
      'result_entered',
      'completed',
      'cancelled'
    ));

ALTER TABLE public.radiology_orders
  DROP CONSTRAINT IF EXISTS radiology_orders_status_check;
ALTER TABLE public.radiology_orders
  ADD CONSTRAINT radiology_orders_status_check
    CHECK (status IN (
      'ordered',
      'scheduled',
      'patient_arrived',
      'in_progress',
      'images_acquired',
      'reported',
      'validated',
      'cancelled'
    ));

-- ── 4. BACKFILL — legacy billed boolean → billing_status ─────────────────────
-- 20260516000001 backfilled via bill_line_items.source_record_id (primary signal).
-- Also honour the legacy billed = true boolean as a secondary signal for rows
-- billed through paths that did not write bill_line_items.

UPDATE public.lab_orders
SET billing_status = 'billed'
WHERE billed = true
  AND billing_status = 'unbilled';

UPDATE public.radiology_orders
SET billing_status = 'billed'
WHERE billed = true
  AND billing_status = 'unbilled';

-- ── 5. INDEXES ────────────────────────────────────────────────────────────────
-- (hospital_id, billing_status, order_date) already exists from 20260516000001.
-- Add composite index for LeakageScanner queries that filter on both status
-- AND billing_status (e.g. status = 'ordered' AND billing_status = 'unbilled').

CREATE INDEX IF NOT EXISTS idx_lab_orders_status_billing
  ON public.lab_orders (hospital_id, status, billing_status);

CREATE INDEX IF NOT EXISTS idx_radiology_orders_status_billing
  ON public.radiology_orders (hospital_id, status, billing_status);

-- ── 6. ROW LEVEL SECURITY ─────────────────────────────────────────────────────

ALTER TABLE public.lab_orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.radiology_orders ENABLE ROW LEVEL SECURITY;

-- lab_orders: drop legacy catch-all policies then create explicit ones
DROP POLICY IF EXISTS "lab_orders_select"                          ON public.lab_orders;
DROP POLICY IF EXISTS "lab_orders_insert"                          ON public.lab_orders;
DROP POLICY IF EXISTS "lab_orders_update"                          ON public.lab_orders;
DROP POLICY IF EXISTS "Users can manage own hospital lab_orders"   ON public.lab_orders;
DROP POLICY IF EXISTS "Users can view own hospital lab_orders"     ON public.lab_orders;

CREATE POLICY "lab_orders_select"
  ON public.lab_orders
  FOR SELECT TO authenticated
  USING (hospital_id = public.get_user_hospital_id());

-- INSERT: hospital isolation + ordered_by must be the calling user's users.id.
-- The app stores the users table PK in ordered_by, not auth.uid() directly.
CREATE POLICY "lab_orders_insert"
  ON public.lab_orders
  FOR INSERT TO authenticated
  WITH CHECK (
    hospital_id = public.get_user_hospital_id()
    AND ordered_by = (
      SELECT id FROM public.users
      WHERE auth_user_id = auth.uid()
      LIMIT 1
    )
  );

-- UPDATE: hospital isolation only.
-- Column-level billing-role vs lab-role restrictions require a user_roles table
-- not yet established in this schema. Enforced at application layer for now.
CREATE POLICY "lab_orders_update"
  ON public.lab_orders
  FOR UPDATE TO authenticated
  USING  (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- radiology_orders: same pattern
DROP POLICY IF EXISTS "radiology_orders_select"                          ON public.radiology_orders;
DROP POLICY IF EXISTS "radiology_orders_insert"                          ON public.radiology_orders;
DROP POLICY IF EXISTS "radiology_orders_update"                          ON public.radiology_orders;
DROP POLICY IF EXISTS "Users can manage own hospital radiology_orders"   ON public.radiology_orders;
DROP POLICY IF EXISTS "Users can view own hospital radiology_orders"     ON public.radiology_orders;

CREATE POLICY "radiology_orders_select"
  ON public.radiology_orders
  FOR SELECT TO authenticated
  USING (hospital_id = public.get_user_hospital_id());

CREATE POLICY "radiology_orders_insert"
  ON public.radiology_orders
  FOR INSERT TO authenticated
  WITH CHECK (
    hospital_id = public.get_user_hospital_id()
    AND ordered_by = (
      SELECT id FROM public.users
      WHERE auth_user_id = auth.uid()
      LIMIT 1
    )
  );

CREATE POLICY "radiology_orders_update"
  ON public.radiology_orders
  FOR UPDATE TO authenticated
  USING  (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- ── 7. pg_notify TRIGGER — lab_orders INSERT ─────────────────────────────────
-- Supabase Realtime (LabPage.tsx) already delivers INSERT events to the frontend
-- via WAL logical replication. This trigger publishes to the named channel
-- "lab_order_created" for Edge Functions or native clients that use LISTEN
-- rather than Supabase postgres_changes. It does not interfere with Realtime.

CREATE OR REPLACE FUNCTION public.notify_lab_order_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM pg_notify(
    'lab_order_created',
    json_build_object(
      'order_id',       NEW.id,
      'hospital_id',    NEW.hospital_id,
      'patient_id',     NEW.patient_id,
      'priority',       NEW.priority,
      'billing_status', NEW.billing_status,
      'ordered_at',     NEW.ordered_at
    )::text
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_lab_order_created ON public.lab_orders;
CREATE TRIGGER trg_notify_lab_order_created
  AFTER INSERT ON public.lab_orders
  FOR EACH ROW EXECUTE FUNCTION public.notify_lab_order_created();
