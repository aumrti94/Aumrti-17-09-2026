-- Add discharge_notes text column to admissions table.
-- DischargeSummaryGenerator writes the free-text discharge summary here;
-- read paths in PatientTimelineDrawer, PatientPrintHubModal, and RecordsIndexTab read from it.
ALTER TABLE public.admissions
  ADD COLUMN IF NOT EXISTS discharge_notes text;
