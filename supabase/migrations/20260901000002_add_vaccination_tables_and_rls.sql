-- Migration: Add Vaccination / Immunization Module Tables and Multi-tenant RLS
-- Enforces: hospital_id isolation per Aumrti HMS v9.0 architecture

-- 1. Create Tables (Idempotent)
CREATE TABLE IF NOT EXISTS public.vaccine_master (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hospital_id UUID NOT NULL REFERENCES public.hospitals(id),
    vaccine_name TEXT NOT NULL,
    vaccine_code TEXT NOT NULL,
    nis_schedule BOOLEAN DEFAULT FALSE,
    week_of_life INTEGER,
    doses INTEGER DEFAULT 1,
    site TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.vaccination_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hospital_id UUID NOT NULL REFERENCES public.hospitals(id),
    patient_id UUID NOT NULL REFERENCES public.patients(id),
    vaccine_id UUID NOT NULL REFERENCES public.vaccine_master(id),
    dose_number INTEGER NOT NULL DEFAULT 1,
    administered_at DATE NOT NULL DEFAULT CURRENT_DATE,
    administered_by UUID REFERENCES auth.users(id),
    batch_number TEXT,
    expiry_date DATE,
    site TEXT,
    vvm_status TEXT,
    aefi_reported BOOLEAN DEFAULT FALSE,
    aefi_description TEXT,
    aefi_severity TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.vaccination_due (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hospital_id UUID NOT NULL REFERENCES public.hospitals(id),
    patient_id UUID NOT NULL REFERENCES public.patients(id),
    vaccine_id UUID NOT NULL REFERENCES public.vaccine_master(id),
    dose_number INTEGER NOT NULL DEFAULT 1,
    due_date DATE NOT NULL,
    status TEXT DEFAULT 'due',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.vaccine_stock (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hospital_id UUID NOT NULL REFERENCES public.hospitals(id),
    vaccine_id UUID NOT NULL REFERENCES public.vaccine_master(id),
    stock_type TEXT DEFAULT 'purchased',
    batch_number TEXT NOT NULL,
    manufacturer TEXT,
    received_date DATE NOT NULL DEFAULT CURRENT_DATE,
    expiry_date DATE NOT NULL,
    quantity_received INTEGER NOT NULL DEFAULT 0,
    quantity_used INTEGER NOT NULL DEFAULT 0,
    quantity_wasted INTEGER NOT NULL DEFAULT 0,
    quantity_balance INTEGER GENERATED ALWAYS AS (quantity_received - quantity_used - quantity_wasted) STORED,
    storage_location TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.vaccine_camps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hospital_id UUID NOT NULL REFERENCES public.hospitals(id),
    camp_name TEXT NOT NULL,
    camp_date DATE NOT NULL,
    location TEXT NOT NULL,
    target_population TEXT,
    target_count INTEGER,
    actual_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'planned',
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.cold_chain_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hospital_id UUID NOT NULL REFERENCES public.hospitals(id),
    unit_name TEXT NOT NULL,
    temperature_c NUMERIC(5,2) NOT NULL,
    alert_triggered BOOLEAN DEFAULT FALSE,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    recorded_by UUID REFERENCES auth.users(id)
);

-- 2. Enable RLS
ALTER TABLE public.vaccine_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vaccination_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vaccination_due ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vaccine_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vaccine_camps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cold_chain_log ENABLE ROW LEVEL SECURITY;

-- 3. Add Multi-tenant Isolation Policies
DO $$ 
DECLARE
    tbl text;
BEGIN
    FOR tbl IN SELECT unnest(ARRAY[
        'vaccine_master', 
        'vaccination_records', 
        'vaccination_due', 
        'vaccine_stock', 
        'vaccine_camps', 
        'cold_chain_log'
    ]) 
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS "tenant_isolation_%I" ON public.%I', tbl, tbl);
        EXECUTE format(
            'CREATE POLICY "tenant_isolation_%I" ON public.%I AS PERMISSIVE FOR ALL TO authenticated USING (hospital_id = (SELECT hospital_id FROM public.users WHERE id = auth.uid())) WITH CHECK (hospital_id = (SELECT hospital_id FROM public.users WHERE id = auth.uid()))',
            tbl, tbl
        );
    END LOOP;
END $$;