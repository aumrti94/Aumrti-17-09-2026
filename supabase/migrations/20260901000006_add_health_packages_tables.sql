-- Migration: Add Health Packages / Executive Checkup Tables
-- Enforces: hospital_id isolation per Aumrti HMS v9.0 architecture

-- 1. Create Tables (Idempotent)
CREATE TABLE IF NOT EXISTS public.health_packages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hospital_id UUID NOT NULL REFERENCES public.hospitals(id),
    package_name TEXT NOT NULL,
    package_type TEXT DEFAULT 'individual', -- 'individual', 'corporate', 'senior_citizen', 'pre_marital'
    description TEXT,
    base_price NUMERIC(12,2) NOT NULL,
    stations JSONB DEFAULT '[]'::jsonb, -- e.g., ["Vitals", "Laboratory", "ECG", "Consultation"]
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.package_bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hospital_id UUID NOT NULL REFERENCES public.hospitals(id),
    patient_id UUID NOT NULL REFERENCES public.patients(id),
    package_id UUID NOT NULL REFERENCES public.health_packages(id),
    corporate_company TEXT,
    booking_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status TEXT DEFAULT 'scheduled', -- 'scheduled', 'in_progress', 'completed', 'cancelled'
    current_station TEXT,
    payment_status TEXT DEFAULT 'unpaid',
    bill_id UUID REFERENCES public.bills(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.package_station_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hospital_id UUID NOT NULL REFERENCES public.hospitals(id),
    booking_id UUID NOT NULL REFERENCES public.package_bookings(id),
    station_name TEXT NOT NULL,
    status TEXT DEFAULT 'waiting', -- 'waiting', 'in_progress', 'completed', 'skipped'
    arrival_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    start_time TIMESTAMPTZ,
    completion_time TIMESTAMPTZ,
    completed_by UUID REFERENCES auth.users(id),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Enable RLS
ALTER TABLE public.health_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_station_logs ENABLE ROW LEVEL SECURITY;

-- 3. Add Multi-tenant Isolation Policies
DO $$ 
DECLARE
    tbl text;
BEGIN
    FOR tbl IN SELECT unnest(ARRAY['health_packages', 'package_bookings', 'package_station_logs']) 
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS "tenant_isolation_%I" ON public.%I', tbl, tbl);
        EXECUTE format(
            'CREATE POLICY "tenant_isolation_%I" ON public.%I AS PERMISSIVE FOR ALL TO authenticated USING (hospital_id = (SELECT hospital_id FROM public.users WHERE id = auth.uid())) WITH CHECK (hospital_id = (SELECT hospital_id FROM public.users WHERE id = auth.uid()))',
            tbl, tbl
        );
    END LOOP;
END $$;

-- 4. Triggers to auto-update booking's current_station on log completion
CREATE OR REPLACE FUNCTION update_booking_current_station()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'completed' THEN
        -- In a real scenario, this would look up the next station in the package JSON array
        -- For now, we update the updated_at timestamp to trigger realtime subscriptions
        UPDATE public.package_bookings SET updated_at = NOW() WHERE id = NEW.booking_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;