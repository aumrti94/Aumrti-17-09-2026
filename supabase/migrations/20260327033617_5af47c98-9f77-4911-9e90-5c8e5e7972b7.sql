
ALTER TABLE public.teleconsult_sessions DROP CONSTRAINT teleconsult_sessions_doctor_id_fkey;
ALTER TABLE public.teleconsult_sessions ADD CONSTRAINT teleconsult_sessions_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES public.users(id);
