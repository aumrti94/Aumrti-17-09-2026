-- Phase 11 of Lab/Pathology/LIMS completion plan: QC gating of result release.
--
-- An accredited lab (NABL/CAP) must not release patient results on an analytical run
-- whose QC is in a Westgard REJECT state. The app evaluated Westgard rules only for a
-- soft advisory toast; nothing blocked release. Phase 11 blocks the release action when
-- the latest QC for an order's test(s) is rejected, allowing a documented supervisor
-- override. These columns persist that override for the audit trail.

ALTER TABLE public.lab_orders ADD COLUMN IF NOT EXISTS qc_override_by uuid REFERENCES public.users(id);
ALTER TABLE public.lab_orders ADD COLUMN IF NOT EXISTS qc_override_reason text;
ALTER TABLE public.lab_orders ADD COLUMN IF NOT EXISTS qc_override_at timestamptz;
