-- Migration: Add IVF / ART Module Tables and Multi-tenant RLS Policies
-- Enforces: hospital_id isolation per Aumrti HMS v9.0 architecture

-- 1. Create Tables (Idempotent)
CREATE TABLE IF NOT EXISTS public.art_couples (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hospital_id UUID NOT NULL REFERENCES public.hospitals(id),
    couple_code TEXT NOT NULL,
    female_patient_id UUID NOT NULL REFERENCES public.patients(id),
    male_patient_id UUID REFERENCES public.patients(id),
    treating_doctor UUID REFERENCES auth.users(id),
    indication TEXT,
    amh_level NUMERIC(5,2),
    afc_count INTEGER,
    consent_obtained BOOLEAN DEFAULT FALSE,
    icmr_reg_number TEXT,
    registered_at DATE NOT NULL DEFAULT CURRENT_DATE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.ivf_cycles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hospital_id UUID NOT NULL REFERENCES public.hospitals(id),
    couple_id UUID NOT NULL REFERENCES public.art_couples(id),
    cycle_number INTEGER NOT NULL DEFAULT 1,
    cycle_type TEXT NOT NULL,
    protocol TEXT,
    start_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status TEXT DEFAULT 'stimulation',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.stimulation_monitoring (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hospital_id UUID NOT NULL REFERENCES public.hospitals(id),
    cycle_id UUID NOT NULL REFERENCES public.ivf_cycles(id),
    scan_date DATE NOT NULL,
    scan_day INTEGER NOT NULL,
    right_follicles JSONB DEFAULT '[]'::jsonb,
    left_follicles JSONB DEFAULT '[]'::jsonb,
    endometrium_mm NUMERIC(5,2),
    endometrium_pattern TEXT,
    e2_level NUMERIC(10,2),
    lh_level NUMERIC(10,2),
    p4_level NUMERIC(10,2),
    current_dose TEXT,
    dose_adjustment TEXT,
    trigger_criteria_met BOOLEAN DEFAULT FALSE,
    notes TEXT,
    recorded_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.andrology_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hospital_id UUID NOT NULL REFERENCES public.hospitals(id),
    patient_id UUID NOT NULL REFERENCES public.patients(id),
    test_date DATE NOT NULL DEFAULT CURRENT_DATE,
    volume_ml NUMERIC(5,2),
    ph NUMERIC(5,2),
    concentration_m_ml NUMERIC(10,2),
    total_count NUMERIC(10,2),
    total_motility_pct INTEGER,
    progressive_motility_pct INTEGER,
    morphology_pct INTEGER,
    vitality_pct INTEGER,
    dfi_percent NUMERIC(5,2),
    icsi_indicated BOOLEAN DEFAULT FALSE,
    report_notes TEXT,
    reported_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.embryology_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hospital_id UUID NOT NULL REFERENCES public.hospitals(id),
    cycle_id UUID NOT NULL REFERENCES public.ivf_cycles(id),
    embryo_number TEXT NOT NULL,
    day0_oocyte TEXT,
    day1_fert TEXT,
    day3_cleavage TEXT,
    day5_blastocyst TEXT,
    status TEXT DEFAULT 'active',
    recorded_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.embryo_bank (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hospital_id UUID NOT NULL REFERENCES public.hospitals(id),
    couple_id UUID NOT NULL REFERENCES public.art_couples(id),
    embryology_record_id UUID REFERENCES public.embryology_records(id),
    storage_location TEXT,
    freeze_date DATE NOT NULL,
    freeze_method TEXT,
    consent_expiry DATE,
    disposition TEXT DEFAULT 'stored',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Enable RLS
ALTER TABLE public.art_couples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ivf_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stimulation_monitoring ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.andrology_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.embryology_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.embryo_bank ENABLE ROW LEVEL SECURITY;

-- 3. Add Multi-tenant Isolation Policies
DO $$ 
DECLARE
    tbl text;
BEGIN
    FOR tbl IN SELECT unnest(ARRAY['art_couples', 'ivf_cycles', 'stimulation_monitoring', 'andrology_reports', 'embryology_records', 'embryo_bank']) 
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS "tenant_isolation_%I" ON public.%I', tbl, tbl);
        EXECUTE format(
            'CREATE POLICY "tenant_isolation_%I" ON public.%I AS PERMISSIVE FOR ALL TO authenticated USING (hospital_id = (SELECT hospital_id FROM public.users WHERE id = auth.uid())) WITH CHECK (hospital_id = (SELECT hospital_id FROM public.users WHERE id = auth.uid()))',
            tbl, tbl
        );
    END LOOP;
END $$;