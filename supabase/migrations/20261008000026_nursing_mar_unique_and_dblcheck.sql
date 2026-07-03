-- Phase 1 of nursing module completion plan: fix live MAR bugs.
-- 1) NursingPage.tsx's Kanban "mark done" upsert assumes a unique constraint on
--    (admission_id, medication_id, scheduled_date, scheduled_time) that has never existed —
--    add it so the upsert can succeed instead of erroring.
ALTER TABLE public.nursing_mar
  ADD CONSTRAINT nursing_mar_admission_med_schedule_unique
  UNIQUE (admission_id, medication_id, scheduled_date, scheduled_time);
