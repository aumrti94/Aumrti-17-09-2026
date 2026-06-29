-- Hospital-level discharge workflow configuration (persists settings from Settings → Discharge Workflow page)
ALTER TABLE public.hospitals
  ADD COLUMN IF NOT EXISTS discharge_workflow jsonb DEFAULT NULL;

-- Hospital-level saved custom workflow presets (user-named configurations)
ALTER TABLE public.hospitals
  ADD COLUMN IF NOT EXISTS discharge_workflow_presets jsonb DEFAULT '[]';

-- Per-admission custom clearance state (for non-Doctor/Billing/Pharmacy steps like OT, Lab, Radiology)
ALTER TABLE public.admissions
  ADD COLUMN IF NOT EXISTS custom_clearances jsonb DEFAULT '{}';
