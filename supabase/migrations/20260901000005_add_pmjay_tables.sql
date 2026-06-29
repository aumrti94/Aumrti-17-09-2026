-- Migration: Add PMJAY / Govt Scheme Auto Pre-Authorization Tables
-- Enforces: hospital_id isolation per Aumrti HMS v9.0 architecture

-- 1. Create Tables (Idempotent)
CREATE TABLE IF NOT EXISTS public.pmjay_packages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hospital_id UUID REFERENCES public.hospitals(id), -- NULL means system-wide NHA catalog
    package_code TEXT NOT NULL,
    package_name TEXT NOT NULL,
    specialty TEXT,
    base_rate NUMERIC(12,2) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.pmjay_preauth_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hospital_id UUID NOT NULL REFERENCES public.hospitals(id),
    patient_id UUID NOT NULL REFERENCES public.patients(id),
    pmjay_id TEXT NOT NULL,
    icd_10_code TEXT,
    hbp_package_code TEXT,
    hbp_package_name TEXT,
    package_amount NUMERIC(12,2),
    ai_confidence_score NUMERIC(5,2),
    status TEXT DEFAULT 'draft', -- draft, submitted, approved, rejected, queried
    nha_urn TEXT,
    clinical_notes TEXT,
    requested_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Enable RLS
ALTER TABLE public.pmjay_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pmjay_preauth_requests ENABLE ROW LEVEL SECURITY;

-- 3. Add Multi-tenant Isolation Policies
DROP POLICY IF EXISTS "tenant_isolation_pmjay_packages" ON public.pmjay_packages;
CREATE POLICY "tenant_isolation_pmjay_packages" ON public.pmjay_packages AS PERMISSIVE FOR ALL TO authenticated USING (hospital_id IS NULL OR hospital_id = (SELECT hospital_id FROM public.users WHERE id = auth.uid())) WITH CHECK (hospital_id IS NULL OR hospital_id = (SELECT hospital_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "tenant_isolation_pmjay_preauth" ON public.pmjay_preauth_requests;
CREATE POLICY "tenant_isolation_pmjay_preauth" ON public.pmjay_preauth_requests AS PERMISSIVE FOR ALL TO authenticated USING (hospital_id = (SELECT hospital_id FROM public.users WHERE id = auth.uid())) WITH CHECK (hospital_id = (SELECT hospital_id FROM public.users WHERE id = auth.uid()));