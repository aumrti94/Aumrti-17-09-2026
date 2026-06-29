
-- F4: Acuity-Based Nursing Staffing (COP.6.c)
-- Ward acuity snapshots and staffing alerts based on NEWS2 scores

CREATE TABLE public.ward_acuity_snapshots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     uuid NOT NULL REFERENCES public.hospitals(id),
  ward_id         uuid,
  ward_name       text,
  snapshot_at     timestamptz NOT NULL DEFAULT now(),
  patient_count   integer NOT NULL DEFAULT 0,
  high_acuity     integer NOT NULL DEFAULT 0,
  medium_acuity   integer NOT NULL DEFAULT 0,
  low_acuity      integer NOT NULL DEFAULT 0,
  avg_news2       numeric(4,1),
  nurses_on_duty  integer,
  required_nurses integer,
  ratio_met       boolean,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.ward_acuity_snapshots(hospital_id, ward_id, snapshot_at DESC);
ALTER TABLE public.ward_acuity_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ward_acuity_snapshots_hospital_isolation" ON public.ward_acuity_snapshots
  FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id());

CREATE TABLE public.staffing_alerts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id  uuid NOT NULL REFERENCES public.hospitals(id),
  ward_id      uuid,
  ward_name    text,
  snapshot_id  uuid REFERENCES public.ward_acuity_snapshots(id),
  alert_type   text NOT NULL DEFAULT 'ratio_breach',
  message      text NOT NULL,
  severity     text NOT NULL DEFAULT 'warning' CHECK (severity IN ('warning','critical')),
  notified_at  timestamptz,
  resolved_at  timestamptz,
  is_deleted   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.staffing_alerts(hospital_id, created_at DESC);
ALTER TABLE public.staffing_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staffing_alerts_hospital_isolation" ON public.staffing_alerts
  FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id());
