
-- Add permissive RLS policies for package_bookings and corporate_accounts
-- Allow anon+authenticated to SELECT/INSERT/UPDATE for development

DO $$ BEGIN
  -- package_bookings policies
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'package_bookings' AND policyname = 'Allow select package_bookings by hospital') THEN
    CREATE POLICY "Allow select package_bookings by hospital" ON public.package_bookings FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'package_bookings' AND policyname = 'Allow insert package_bookings') THEN
    CREATE POLICY "Allow insert package_bookings" ON public.package_bookings FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'package_bookings' AND policyname = 'Allow update package_bookings') THEN
    CREATE POLICY "Allow update package_bookings" ON public.package_bookings FOR UPDATE USING (true) WITH CHECK (true);
  END IF;

  -- corporate_accounts policies
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'corporate_accounts' AND policyname = 'Allow select corporate_accounts') THEN
    CREATE POLICY "Allow select corporate_accounts" ON public.corporate_accounts FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'corporate_accounts' AND policyname = 'Allow insert corporate_accounts') THEN
    CREATE POLICY "Allow insert corporate_accounts" ON public.corporate_accounts FOR INSERT WITH CHECK (true);
  END IF;

  -- health_packages read policy
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'health_packages' AND policyname = 'Allow select health_packages') THEN
    CREATE POLICY "Allow select health_packages" ON public.health_packages FOR SELECT USING (true);
  END IF;
END $$;
