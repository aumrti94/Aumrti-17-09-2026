
-- ══════════════════════════════════════════════════
-- IVF/ART Module (M38) — Tables
-- ══════════════════════════════════════════════════

-- 1. ART Couples
CREATE TABLE public.art_couples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  couple_code text UNIQUE NOT NULL,
  female_patient_id uuid REFERENCES public.patients(id) NOT NULL,
  male_patient_id uuid REFERENCES public.patients(id),
  treating_doctor uuid REFERENCES public.users(id) NOT NULL,
  indication text,
  amh_level numeric(6,2),
  afc_count integer,
  sperm_analysis_done boolean DEFAULT false,
  consent_obtained boolean DEFAULT false,
  icmr_reg_number text,
  registered_at date,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- 2. IVF Cycles
CREATE TABLE public.ivf_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  couple_id uuid REFERENCES public.art_couples(id) NOT NULL,
  cycle_number integer NOT NULL,
  cycle_type text NOT NULL,
  protocol text,
  start_date date NOT NULL,
  trigger_date date,
  opu_date date,
  et_date date,
  oocytes_retrieved integer,
  mature_oocytes integer,
  fertilized integer,
  embryos_day3 integer,
  blastocysts integer,
  embryos_frozen integer DEFAULT 0,
  embryos_transferred integer,
  beta_hcg_1 numeric(8,2),
  beta_hcg_1_date date,
  beta_hcg_2 numeric(8,2),
  beta_hcg_2_date date,
  clinical_pregnancy boolean,
  delivery_outcome text,
  status text DEFAULT 'stimulation',
  created_at timestamptz DEFAULT now()
);

-- 3. Stimulation Monitoring
CREATE TABLE public.stimulation_monitoring (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  cycle_id uuid REFERENCES public.ivf_cycles(id) NOT NULL,
  scan_date date NOT NULL,
  scan_day integer NOT NULL,
  right_follicles jsonb DEFAULT '[]',
  left_follicles jsonb DEFAULT '[]',
  endometrium_mm numeric(4,1),
  endometrium_pattern text,
  e2_level numeric(8,2),
  lh_level numeric(6,2),
  p4_level numeric(6,2),
  current_dose text,
  dose_adjustment text,
  trigger_criteria_met boolean DEFAULT false,
  notes text,
  recorded_by uuid REFERENCES public.users(id) NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- 4. Embryology Records
CREATE TABLE public.embryology_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  cycle_id uuid REFERENCES public.ivf_cycles(id) NOT NULL,
  embryo_id text NOT NULL,
  oocyte_maturity text,
  insemination_type text,
  inseminated_at timestamptz,
  fertilization_status text,
  day3_cell_count integer,
  day3_fragmentation text,
  day3_grade text,
  blast_expansion integer,
  blast_icm text,
  blast_te text,
  blast_grade text,
  disposition text DEFAULT 'fresh_transfer',
  freeze_date date,
  created_at timestamptz DEFAULT now()
);

-- 5. Embryo Bank
CREATE TABLE public.embryo_bank (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  cycle_id uuid REFERENCES public.ivf_cycles(id) NOT NULL,
  embryo_id uuid REFERENCES public.embryology_records(id) NOT NULL,
  couple_id uuid REFERENCES public.art_couples(id) NOT NULL,
  freeze_date date NOT NULL,
  freeze_method text DEFAULT 'vitrification',
  tank_number text NOT NULL,
  canister_number text NOT NULL,
  goblet_number text NOT NULL,
  straw_number text NOT NULL,
  storage_location text GENERATED ALWAYS AS (tank_number || '/' || canister_number || '/' || goblet_number || '/' || straw_number) STORED,
  thaw_date date,
  survival_status text,
  consent_expiry date,
  disposition text DEFAULT 'stored',
  created_at timestamptz DEFAULT now()
);

-- 6. Andrology Reports
CREATE TABLE public.andrology_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  patient_id uuid REFERENCES public.patients(id) NOT NULL,
  couple_id uuid REFERENCES public.art_couples(id),
  test_date date NOT NULL,
  volume_ml numeric(4,2),
  ph numeric(4,2),
  concentration_m_ml numeric(6,2),
  total_count numeric(8,2),
  total_motility_pct integer,
  progressive_motility_pct integer,
  non_progressive_pct integer,
  morphology_pct integer,
  vitality_pct integer,
  leukocytes numeric(6,2),
  dfi_percent numeric(5,2),
  icsi_indicated boolean DEFAULT false,
  report_notes text,
  reported_by uuid REFERENCES public.users(id),
  created_at timestamptz DEFAULT now()
);

-- ══════════════════════════════════════════════════
-- Validation Triggers
-- ══════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.validate_ivf_cycle()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.cycle_type NOT IN ('ivf','icsi','fet','iui','imsi','donor_egg','donor_sperm','surrogacy') THEN
    RAISE EXCEPTION 'Invalid cycle_type: %', NEW.cycle_type;
  END IF;
  IF NEW.status NOT IN ('stimulation','trigger_given','opu_done','fertilization','et_done','luteal_support','test_due','positive','negative','cancelled') THEN
    RAISE EXCEPTION 'Invalid ivf_cycle status: %', NEW.status;
  END IF;
  IF NEW.delivery_outcome IS NOT NULL AND NEW.delivery_outcome NOT IN ('ongoing','delivered','miscarriage','ectopic','still_born','neonatal_death') THEN
    RAISE EXCEPTION 'Invalid delivery_outcome: %', NEW.delivery_outcome;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_validate_ivf_cycle
  BEFORE INSERT OR UPDATE ON public.ivf_cycles
  FOR EACH ROW EXECUTE FUNCTION public.validate_ivf_cycle();

CREATE OR REPLACE FUNCTION public.validate_embryology_record()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.oocyte_maturity IS NOT NULL AND NEW.oocyte_maturity NOT IN ('mii','mi','gv') THEN
    RAISE EXCEPTION 'Invalid oocyte_maturity: %', NEW.oocyte_maturity;
  END IF;
  IF NEW.insemination_type IS NOT NULL AND NEW.insemination_type NOT IN ('ivf','icsi','imsi') THEN
    RAISE EXCEPTION 'Invalid insemination_type: %', NEW.insemination_type;
  END IF;
  IF NEW.fertilization_status IS NOT NULL AND NEW.fertilization_status NOT IN ('2pn','1pn','3pn','0pn','abnormal') THEN
    RAISE EXCEPTION 'Invalid fertilization_status: %', NEW.fertilization_status;
  END IF;
  IF NEW.disposition NOT IN ('fresh_transfer','frozen','discarded','biopsy','donated') THEN
    RAISE EXCEPTION 'Invalid disposition: %', NEW.disposition;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_validate_embryology_record
  BEFORE INSERT OR UPDATE ON public.embryology_records
  FOR EACH ROW EXECUTE FUNCTION public.validate_embryology_record();

CREATE OR REPLACE FUNCTION public.validate_embryo_bank()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.freeze_method NOT IN ('vitrification','slow_freeze') THEN
    RAISE EXCEPTION 'Invalid freeze_method: %', NEW.freeze_method;
  END IF;
  IF NEW.survival_status IS NOT NULL AND NEW.survival_status NOT IN ('survived','degenerated') THEN
    RAISE EXCEPTION 'Invalid survival_status: %', NEW.survival_status;
  END IF;
  IF NEW.disposition NOT IN ('stored','transferred','discarded','donated','research') THEN
    RAISE EXCEPTION 'Invalid disposition: %', NEW.disposition;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_validate_embryo_bank
  BEFORE INSERT OR UPDATE ON public.embryo_bank
  FOR EACH ROW EXECUTE FUNCTION public.validate_embryo_bank();

-- ══════════════════════════════════════════════════
-- Indexes
-- ══════════════════════════════════════════════════

CREATE INDEX idx_art_couples_hospital ON public.art_couples(hospital_id);
CREATE INDEX idx_art_couples_female ON public.art_couples(female_patient_id);
CREATE INDEX idx_ivf_cycles_couple ON public.ivf_cycles(couple_id);
CREATE INDEX idx_ivf_cycles_hospital ON public.ivf_cycles(hospital_id);
CREATE INDEX idx_stimulation_cycle ON public.stimulation_monitoring(cycle_id);
CREATE INDEX idx_embryology_cycle ON public.embryology_records(cycle_id);
CREATE INDEX idx_embryo_bank_couple ON public.embryo_bank(couple_id);
CREATE INDEX idx_embryo_bank_hospital ON public.embryo_bank(hospital_id);
CREATE INDEX idx_andrology_patient ON public.andrology_reports(patient_id);
CREATE INDEX idx_andrology_hospital ON public.andrology_reports(hospital_id);

-- ══════════════════════════════════════════════════
-- RLS Policies (hospital isolation)
-- ══════════════════════════════════════════════════

ALTER TABLE public.art_couples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ivf_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stimulation_monitoring ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.embryology_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.embryo_bank ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.andrology_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hospital isolation" ON public.art_couples FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE POLICY "Hospital isolation" ON public.ivf_cycles FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE POLICY "Hospital isolation" ON public.stimulation_monitoring FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE POLICY "Hospital isolation" ON public.embryology_records FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE POLICY "Hospital isolation" ON public.embryo_bank FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE POLICY "Hospital isolation" ON public.andrology_reports FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());
