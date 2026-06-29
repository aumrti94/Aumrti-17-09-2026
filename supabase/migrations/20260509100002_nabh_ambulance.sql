
-- F2: Ambulance Service Management (COP.3)
-- Dispatch tracker, daily equipment checklist, transit treatment log

CREATE TABLE public.ambulance_vehicles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id  uuid NOT NULL REFERENCES public.hospitals(id),
  vehicle_no   text NOT NULL,
  vehicle_type text NOT NULL DEFAULT 'bls' CHECK (vehicle_type IN ('bls','als','nicu_transport','mortuary')),
  driver_name  text,
  driver_phone text,
  is_active    boolean NOT NULL DEFAULT true,
  is_deleted   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ambulance_vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ambulance_vehicles_hospital_isolation" ON public.ambulance_vehicles
  FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id());

CREATE TABLE public.ambulance_dispatches (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id      uuid NOT NULL REFERENCES public.hospitals(id),
  vehicle_id       uuid REFERENCES public.ambulance_vehicles(id),
  patient_id       uuid REFERENCES public.patients(id),
  call_received_at timestamptz NOT NULL DEFAULT now(),
  dispatch_at      timestamptz,
  pickup_at        timestamptz,
  arrival_at       timestamptz,
  pickup_location  text,
  destination      text,
  complaint        text,
  crew_names       text[],
  status           text NOT NULL DEFAULT 'dispatched' CHECK (status IN ('dispatched','en_route','at_scene','transporting','completed','cancelled')),
  notes            text,
  is_deleted       boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.ambulance_dispatches(hospital_id, call_received_at DESC);
CREATE INDEX ON public.ambulance_dispatches(hospital_id, status);
ALTER TABLE public.ambulance_dispatches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ambulance_dispatches_hospital_isolation" ON public.ambulance_dispatches
  FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id());

CREATE TABLE public.ambulance_transit_treatment (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  dispatch_id uuid NOT NULL REFERENCES public.ambulance_dispatches(id),
  vital_bp    text,
  vital_pulse integer,
  vital_spo2  integer,
  vital_rr    integer,
  gcs         integer,
  treatment   text,
  drugs_given text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid REFERENCES public.users(id),
  is_deleted  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.ambulance_transit_treatment(hospital_id, dispatch_id);
ALTER TABLE public.ambulance_transit_treatment ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ambulance_transit_treatment_hospital_isolation" ON public.ambulance_transit_treatment
  FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id());

CREATE TABLE public.ambulance_equipment_checks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id    uuid NOT NULL REFERENCES public.hospitals(id),
  vehicle_id     uuid NOT NULL REFERENCES public.ambulance_vehicles(id),
  checked_by     uuid REFERENCES public.users(id),
  check_date     date NOT NULL DEFAULT CURRENT_DATE,
  checklist_json jsonb NOT NULL DEFAULT '{}',
  all_ok         boolean NOT NULL DEFAULT false,
  remarks        text,
  is_deleted     boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.ambulance_equipment_checks(hospital_id, vehicle_id, check_date DESC);
ALTER TABLE public.ambulance_equipment_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ambulance_equipment_checks_hospital_isolation" ON public.ambulance_equipment_checks
  FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id());
