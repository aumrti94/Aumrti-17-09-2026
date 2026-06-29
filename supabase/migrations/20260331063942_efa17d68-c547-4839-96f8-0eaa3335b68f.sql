
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sepsis_alerts') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sepsis_alerts' AND policyname = 'Hospital isolation for sepsis_alerts') THEN
      CREATE POLICY "Hospital isolation for sepsis_alerts"
        ON public.sepsis_alerts FOR ALL TO authenticated
        USING (hospital_id = (SELECT hospital_id FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1))
        WITH CHECK (hospital_id = (SELECT hospital_id FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1));
    END IF;
  END IF;
END $$;
