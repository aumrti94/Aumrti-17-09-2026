
-- F7: ESG & Sustainability Tracking (ROM.3.e, ROM.3.f)
-- Monthly environmental metrics dashboard

CREATE TABLE public.esg_monthly_metrics (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id          uuid NOT NULL REFERENCES public.hospitals(id),
  month_year           date NOT NULL,
  -- Energy
  electricity_kwh      numeric(10,2),
  solar_kwh            numeric(10,2),
  diesel_litres        numeric(10,2),
  -- Water
  water_kl             numeric(10,2),
  water_recycled_kl    numeric(10,2),
  -- Biomedical Waste (CPCB categories)
  bmw_kg_red           numeric(8,2),
  bmw_kg_yellow        numeric(8,2),
  bmw_kg_blue          numeric(8,2),
  bmw_kg_black         numeric(8,2),
  -- Carbon
  transport_km         numeric(10,2),
  carbon_offset_kg     numeric(10,2),
  -- Targets
  electricity_target   numeric(10,2),
  water_target         numeric(10,2),
  bmw_target           numeric(8,2),
  -- Narrative
  initiatives_text     text,
  entered_by           uuid REFERENCES public.users(id),
  is_deleted           boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE(hospital_id, month_year)
);
CREATE INDEX ON public.esg_monthly_metrics(hospital_id, month_year DESC);
ALTER TABLE public.esg_monthly_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "esg_monthly_metrics_hospital_isolation" ON public.esg_monthly_metrics
  FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id());
