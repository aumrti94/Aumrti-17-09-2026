-- Migration: Add Government HMIS Reporting Module Tables and Multi-tenant RLS
-- Enforces: hospital_id isolation per Aumrti HMS v9.0 architecture

-- 1. Create Tables (Idempotent)
CREATE TABLE IF NOT EXISTS public.hmis_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hospital_id UUID NOT NULL REFERENCES public.hospitals(id),
    report_type TEXT NOT NULL, -- 'monthly_hmis', 'weekly_idsp_p', 'rmncha_monthly'
    period_month INTEGER,
    period_week INTEGER,
    period_year INTEGER NOT NULL,
    status TEXT DEFAULT 'draft', -- 'draft', 'generated', 'submitted', 'accepted'
    generated_at TIMESTAMPTZ,
    submitted_at TIMESTAMPTZ,
    report_data JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure only one report of a specific type exists per period (using PG15+ NULLS NOT DISTINCT)
ALTER TABLE public.hmis_reports DROP CONSTRAINT IF EXISTS uq_hmis_report;
ALTER TABLE public.hmis_reports ADD CONSTRAINT uq_hmis_report UNIQUE NULLS NOT DISTINCT (hospital_id, report_type, period_year, period_month, period_week);

CREATE TABLE IF NOT EXISTS public.idsp_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hospital_id UUID NOT NULL REFERENCES public.hospitals(id),
    alert_date DATE NOT NULL DEFAULT CURRENT_DATE,
    disease TEXT NOT NULL,
    syndrome TEXT,
    cases_opd INTEGER DEFAULT 0,
    cases_ipd INTEGER DEFAULT 0,
    deaths INTEGER DEFAULT 0,
    week_number INTEGER NOT NULL,
    year INTEGER NOT NULL,
    is_outbreak BOOLEAN DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Enable RLS
ALTER TABLE public.hmis_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idsp_alerts ENABLE ROW LEVEL SECURITY;

-- 3. Add Multi-tenant Isolation Policies
DROP POLICY IF EXISTS "tenant_isolation_hmis_reports" ON public.hmis_reports;
CREATE POLICY "tenant_isolation_hmis_reports" ON public.hmis_reports AS PERMISSIVE FOR ALL TO authenticated USING (hospital_id = (SELECT hospital_id FROM public.users WHERE id = auth.uid())) WITH CHECK (hospital_id = (SELECT hospital_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "tenant_isolation_idsp_alerts" ON public.idsp_alerts;
CREATE POLICY "tenant_isolation_idsp_alerts" ON public.idsp_alerts AS PERMISSIVE FOR ALL TO authenticated USING (hospital_id = (SELECT hospital_id FROM public.users WHERE id = auth.uid())) WITH CHECK (hospital_id = (SELECT hospital_id FROM public.users WHERE id = auth.uid()));