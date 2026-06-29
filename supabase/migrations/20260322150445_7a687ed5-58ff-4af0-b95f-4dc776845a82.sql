
-- Add only the missing FK for surgeon and anaesthetist references to users
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ot_schedules_surgeon_id_fkey') THEN
    ALTER TABLE public.ot_schedules ADD CONSTRAINT ot_schedules_surgeon_id_fkey FOREIGN KEY (surgeon_id) REFERENCES public.users(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ot_schedules_anaesthetist_id_fkey') THEN
    ALTER TABLE public.ot_schedules ADD CONSTRAINT ot_schedules_anaesthetist_id_fkey FOREIGN KEY (anaesthetist_id) REFERENCES public.users(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ot_schedules_scrub_nurse_id_fkey') THEN
    ALTER TABLE public.ot_schedules ADD CONSTRAINT ot_schedules_scrub_nurse_id_fkey FOREIGN KEY (scrub_nurse_id) REFERENCES public.users(id);
  END IF;
END $$;
