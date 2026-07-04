-- Phase 13 of Lab/Pathology/LIMS AI features: wrong-blood-in-tube / sample mix-up
-- detection acknowledgement trail.
--
-- The deterministic mismatch indicators themselves (blood-group conflict, sex-specific
-- test violation, Hb/Hct "rule of three" implausibility) are computed on the fly from
-- existing data — nothing to store. What needs persisting is the human decision: a
-- pathologist/tech reviewed a flagged high-severity indicator and confirmed the result
-- is valid for this patient (or ordered a recollection instead). This mirrors the
-- qc_override columns added in Phase 11.

ALTER TABLE public.lab_orders ADD COLUMN IF NOT EXISTS mixup_acknowledged_by uuid REFERENCES public.users(id);
ALTER TABLE public.lab_orders ADD COLUMN IF NOT EXISTS mixup_ack_reason text;
ALTER TABLE public.lab_orders ADD COLUMN IF NOT EXISTS mixup_acknowledged_at timestamptz;
