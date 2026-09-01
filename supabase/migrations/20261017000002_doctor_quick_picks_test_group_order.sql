-- Extend doctor_quick_picks category constraint to include per-doctor
-- drag-to-reorder priority for tests/studies within a lab category, lab
-- panel, or radiology modality picker. One row per doctor holds all groups;
-- items is TestGroupOrderEntry[] = { groupKey: string; order: string[] }[].

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
      'radiology_templates',
      'test_group_order'
    ));
