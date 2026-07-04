-- Phase 16 of Lab/Pathology/LIMS AI features: interpretive comment on the lab report.
--
-- AI drafts a suggested interpretive comment (src/lib/labReportNarrative.ts); the
-- pathologist/tech always reviews and edits before it's saved here and printed on the
-- report — never auto-inserted unedited. The histopath equivalent (impression draft)
-- needs no schema change since pathology_cases.impression already exists (Phase 7).

ALTER TABLE public.lab_orders ADD COLUMN IF NOT EXISTS interpretive_comment text;
