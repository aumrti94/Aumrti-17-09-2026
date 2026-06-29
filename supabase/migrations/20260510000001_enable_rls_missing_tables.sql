-- ────────────────────────────────────────────────────────────────────────────
-- Enable RLS on tables that have policies defined but ENABLE was never called,
-- and add hospital_id isolation policies for tables that have neither.
-- ────────────────────────────────────────────────────────────────────────────

-- ── GROUP 1: Tables with existing policies — just enable RLS (idempotent) ──

ALTER TABLE public.hospitals            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patients             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_test_master      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_orders           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_order_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_samples          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.neonatal_records     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.anaesthesia_records  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ophthalmology_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partograph_records   ENABLE ROW LEVEL SECURITY;

-- ── GROUP 2: Tables with no RLS enable and no policies ──────────────────────

ALTER TABLE public.drug_batches                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacy_dispensing         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacy_dispensing_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ndps_register               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_items             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grn_records                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_claims            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dialysis_machines           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dialysis_patients           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dialysis_sessions           ENABLE ROW LEVEL SECURITY;

-- ── Policies for Group 2 tables (hospital_id isolation) ─────────────────────

-- drug_batches
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'drug_batches' AND policyname = 'Hospital isolation for drug_batches') THEN
    CREATE POLICY "Hospital isolation for drug_batches" ON public.drug_batches
      FOR ALL TO authenticated
      USING (hospital_id = public.get_user_hospital_id())
      WITH CHECK (hospital_id = public.get_user_hospital_id());
  END IF;
END $$;

-- pharmacy_dispensing
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pharmacy_dispensing' AND policyname = 'Hospital isolation for pharmacy_dispensing') THEN
    CREATE POLICY "Hospital isolation for pharmacy_dispensing" ON public.pharmacy_dispensing
      FOR ALL TO authenticated
      USING (hospital_id = public.get_user_hospital_id())
      WITH CHECK (hospital_id = public.get_user_hospital_id());
  END IF;
END $$;

-- pharmacy_dispensing_items
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pharmacy_dispensing_items' AND policyname = 'Hospital isolation for pharmacy_dispensing_items') THEN
    CREATE POLICY "Hospital isolation for pharmacy_dispensing_items" ON public.pharmacy_dispensing_items
      FOR ALL TO authenticated
      USING (hospital_id = public.get_user_hospital_id())
      WITH CHECK (hospital_id = public.get_user_hospital_id());
  END IF;
END $$;

-- ndps_register
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ndps_register' AND policyname = 'Hospital isolation for ndps_register') THEN
    CREATE POLICY "Hospital isolation for ndps_register" ON public.ndps_register
      FOR ALL TO authenticated
      USING (hospital_id = public.get_user_hospital_id())
      WITH CHECK (hospital_id = public.get_user_hospital_id());
  END IF;
END $$;

-- inventory_items
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'inventory_items' AND policyname = 'Hospital isolation for inventory_items') THEN
    CREATE POLICY "Hospital isolation for inventory_items" ON public.inventory_items
      FOR ALL TO authenticated
      USING (hospital_id = public.get_user_hospital_id())
      WITH CHECK (hospital_id = public.get_user_hospital_id());
  END IF;
END $$;

-- purchase_orders
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'purchase_orders' AND policyname = 'Hospital isolation for purchase_orders') THEN
    CREATE POLICY "Hospital isolation for purchase_orders" ON public.purchase_orders
      FOR ALL TO authenticated
      USING (hospital_id = public.get_user_hospital_id())
      WITH CHECK (hospital_id = public.get_user_hospital_id());
  END IF;
END $$;

-- grn_records
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'grn_records' AND policyname = 'Hospital isolation for grn_records') THEN
    CREATE POLICY "Hospital isolation for grn_records" ON public.grn_records
      FOR ALL TO authenticated
      USING (hospital_id = public.get_user_hospital_id())
      WITH CHECK (hospital_id = public.get_user_hospital_id());
  END IF;
END $$;

-- insurance_claims
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'insurance_claims' AND policyname = 'Hospital isolation for insurance_claims') THEN
    CREATE POLICY "Hospital isolation for insurance_claims" ON public.insurance_claims
      FOR ALL TO authenticated
      USING (hospital_id = public.get_user_hospital_id())
      WITH CHECK (hospital_id = public.get_user_hospital_id());
  END IF;
END $$;

-- dialysis_machines
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'dialysis_machines' AND policyname = 'Hospital isolation for dialysis_machines') THEN
    CREATE POLICY "Hospital isolation for dialysis_machines" ON public.dialysis_machines
      FOR ALL TO authenticated
      USING (hospital_id = public.get_user_hospital_id())
      WITH CHECK (hospital_id = public.get_user_hospital_id());
  END IF;
END $$;

-- dialysis_patients
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'dialysis_patients' AND policyname = 'Hospital isolation for dialysis_patients') THEN
    CREATE POLICY "Hospital isolation for dialysis_patients" ON public.dialysis_patients
      FOR ALL TO authenticated
      USING (hospital_id = public.get_user_hospital_id())
      WITH CHECK (hospital_id = public.get_user_hospital_id());
  END IF;
END $$;

-- dialysis_sessions
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'dialysis_sessions' AND policyname = 'Hospital isolation for dialysis_sessions') THEN
    CREATE POLICY "Hospital isolation for dialysis_sessions" ON public.dialysis_sessions
      FOR ALL TO authenticated
      USING (hospital_id = public.get_user_hospital_id())
      WITH CHECK (hospital_id = public.get_user_hospital_id());
  END IF;
END $$;
