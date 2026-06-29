-- Extend doctor_quick_picks category constraint to include lab and radiology templates
-- Doctors who refer to third-party labs/radiology can save their own quick-order lists

ALTER TABLE public.doctor_quick_picks
  DROP CONSTRAINT IF EXISTS doctor_quick_picks_category_check;

ALTER TABLE public.doctor_quick_picks
  ADD CONSTRAINT doctor_quick_picks_category_check
    CHECK (category IN (
      'complaints',
      'exam_findings',
      'diagnoses',
      'rx_templates',
      'lab_templates',
      'radiology_templates'
    ));
