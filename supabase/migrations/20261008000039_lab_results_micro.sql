-- Phase 6 of Lab/Pathology/LIMS completion plan: microbiology results into the
-- purpose-built lab_results table + preliminary/final culture lifecycle.
--
-- lab_results was created (20260904000026) with organism_identified / sensitivity_json /
-- colony_count columns specifically for antibiograms, but the workspace has been writing
-- that data as a JSON string into lab_order_items.notes instead — so the structured
-- columns sat empty and unused. This links lab_results to the item it belongs to and
-- adds a preliminary→final report status so culture reports can be issued in two stages.

ALTER TABLE public.lab_results ADD COLUMN IF NOT EXISTS order_item_id uuid REFERENCES public.lab_order_items(id) ON DELETE CASCADE;
ALTER TABLE public.lab_results ADD COLUMN IF NOT EXISTS report_status text NOT NULL DEFAULT 'final';
ALTER TABLE public.lab_results ADD COLUMN IF NOT EXISTS finalized_at timestamptz;
ALTER TABLE public.lab_results ADD COLUMN IF NOT EXISTS finalized_by uuid REFERENCES public.users(id);
ALTER TABLE public.lab_results ADD COLUMN IF NOT EXISTS specimen_type text;

ALTER TABLE public.lab_results DROP CONSTRAINT IF EXISTS lab_results_report_status_check;
ALTER TABLE public.lab_results
  ADD CONSTRAINT lab_results_report_status_check
  CHECK (report_status IN ('preliminary', 'final'));

CREATE INDEX IF NOT EXISTS idx_lab_results_order_item ON public.lab_results (order_item_id);

-- lab_results already has RLS + a hospital_isolation policy from 20260904000026 using a
-- users subquery; align it with the get_user_hospital_id() helper used elsewhere and add
-- WITH CHECK so the dual-write inserts are hospital-scoped.
DROP POLICY IF EXISTS "hospital_isolation" ON public.lab_results;
CREATE POLICY "hospital_isolation" ON public.lab_results
  FOR ALL TO authenticated
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());
