-- Migration: EMR Templates and Procurement AI Foundation
-- Created by Meera

CREATE TABLE IF NOT EXISTS public.emr_template_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hospital_id UUID NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
    specialty TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    version TEXT DEFAULT '1.0',
    form_schema_json JSONB DEFAULT '{}'::jsonb,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.patient_encounter_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hospital_id UUID NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
    encounter_id UUID NOT NULL REFERENCES public.opd_encounters(id) ON DELETE CASCADE,
    template_definition_id UUID NOT NULL REFERENCES public.emr_template_definitions(id),
    status TEXT DEFAULT 'draft',
    clinician_id UUID REFERENCES public.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.patient_template_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hospital_id UUID NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
    encounter_template_id UUID NOT NULL REFERENCES public.patient_encounter_templates(id) ON DELETE CASCADE,
    response_json JSONB DEFAULT '{}'::jsonb,
    generated_narrative TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.demand_forecasts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hospital_id UUID NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
    forecast_date TIMESTAMPTZ NOT NULL,
    predicted_consumption NUMERIC(10,2) NOT NULL,
    confidence_score NUMERIC(5,2),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.procurement_recommendations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hospital_id UUID NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
    recommended_quantity NUMERIC(10,2) NOT NULL,
    reasoning TEXT,
    status TEXT DEFAULT 'pending', -- pending, accepted, rejected
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS Policies
ALTER TABLE public.emr_template_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_encounter_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_template_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.demand_forecasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Isolation policy for emr_template_definitions" ON public.emr_template_definitions
    FOR ALL USING (hospital_id = (SELECT hospital_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Isolation policy for patient_encounter_templates" ON public.patient_encounter_templates
    FOR ALL USING (hospital_id = (SELECT hospital_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Isolation policy for patient_template_responses" ON public.patient_template_responses
    FOR ALL USING (hospital_id = (SELECT hospital_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Isolation policy for demand_forecasts" ON public.demand_forecasts
    FOR ALL USING (hospital_id = (SELECT hospital_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Isolation policy for procurement_recommendations" ON public.procurement_recommendations
    FOR ALL USING (hospital_id = (SELECT hospital_id FROM users WHERE id = auth.uid()));
