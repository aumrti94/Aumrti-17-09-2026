-- Migration: Add Dental Module Tables and Multi-tenant RLS Policies
-- Enforces: hospital_id isolation per Aumrti HMS v9.0 architecture

-- 1. Create Tables (Idempotent)
CREATE TABLE IF NOT EXISTS public.dental_charts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hospital_id UUID NOT NULL REFERENCES public.hospitals(id),
    patient_id UUID NOT NULL REFERENCES public.patients(id),
    created_by UUID REFERENCES auth.users(id),
    chart_date DATE NOT NULL DEFAULT CURRENT_DATE,
    chart_data JSONB DEFAULT '{}'::jsonb,
    oral_hygiene TEXT,
    calculus TEXT,
    soft_tissue_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.periodontal_charts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hospital_id UUID NOT NULL REFERENCES public.hospitals(id),
    patient_id UUID NOT NULL REFERENCES public.patients(id),
    created_by UUID REFERENCES auth.users(id),
    chart_date DATE NOT NULL DEFAULT CURRENT_DATE,
    perio_data JSONB DEFAULT '{}'::jsonb,
    bleeding_index NUMERIC(5,2),
    diagnosis TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.dental_treatment_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hospital_id UUID NOT NULL REFERENCES public.hospitals(id),
    patient_id UUID NOT NULL REFERENCES public.patients(id),
    created_by UUID REFERENCES auth.users(id),
    chart_id UUID REFERENCES public.dental_charts(id),
    plan_items JSONB DEFAULT '[]'::jsonb,
    total_cost NUMERIC(12,2) DEFAULT 0,
    patient_consent BOOLEAN DEFAULT FALSE,
    consent_date DATE,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.dental_lab_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hospital_id UUID NOT NULL REFERENCES public.hospitals(id),
    patient_id UUID NOT NULL REFERENCES public.patients(id),
    ordered_by UUID REFERENCES auth.users(id),
    work_type TEXT NOT NULL,
    tooth_numbers TEXT,
    lab_name TEXT,
    material TEXT,
    shade TEXT,
    expected_date DATE,
    cost NUMERIC(12,2),
    notes TEXT,
    order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status TEXT DEFAULT 'ordered',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Enable RLS
ALTER TABLE public.dental_charts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.periodontal_charts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dental_treatment_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dental_lab_orders ENABLE ROW LEVEL SECURITY;

-- 3. Add Multi-tenant Isolation Policies
DO $$ 
DECLARE
    tbl text;
BEGIN
    FOR tbl IN SELECT unnest(ARRAY['dental_charts', 'periodontal_charts', 'dental_treatment_plans', 'dental_lab_orders']) 
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS "tenant_isolation_%I" ON public.%I', tbl, tbl);
        EXECUTE format(
            'CREATE POLICY "tenant_isolation_%I" ON public.%I AS PERMISSIVE FOR ALL TO authenticated USING (hospital_id = (SELECT hospital_id FROM public.users WHERE id = auth.uid())) WITH CHECK (hospital_id = (SELECT hospital_id FROM public.users WHERE id = auth.uid()))',
            tbl, tbl
        );
    END LOOP;
END $$;