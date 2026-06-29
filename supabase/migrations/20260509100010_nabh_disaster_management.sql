
-- F10: Disaster & Epidemic Management (COP.4)
-- Drill logs + epidemic protocol activation switch

CREATE TABLE public.disaster_drills (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id      uuid NOT NULL REFERENCES public.hospitals(id),
  drill_date       date NOT NULL,
  drill_type       text NOT NULL CHECK (drill_type IN ('fire','mass_casualty','earthquake','chemical','flood','epidemic','code_pink','code_black')),
  coordinator      uuid REFERENCES public.users(id),
  participants     integer,
  duration_min     integer,
  gaps_identified  text,
  actions_taken    text,
  next_drill_date  date,
  approved_by      uuid REFERENCES public.users(id),
  status           text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','completed','debrief_pending')),
  is_deleted       boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.disaster_drills(hospital_id, drill_date DESC);
ALTER TABLE public.disaster_drills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "disaster_drills_hospital_isolation" ON public.disaster_drills
  FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id());

CREATE TABLE public.epidemic_protocols (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id    uuid NOT NULL REFERENCES public.hospitals(id),
  protocol_name  text NOT NULL,
  is_active      boolean NOT NULL DEFAULT false,
  activated_at   timestamptz,
  activated_by   uuid REFERENCES public.users(id),
  deactivated_at timestamptz,
  triage_mode    text DEFAULT 'standard' CHECK (triage_mode IN ('standard','mass_casualty','epidemic')),
  isolation_beds integer DEFAULT 0,
  ppe_level      text DEFAULT 'standard' CHECK (ppe_level IN ('standard','enhanced','full')),
  visitor_policy text,
  notes          text,
  is_deleted     boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.epidemic_protocols(hospital_id, is_active);
ALTER TABLE public.epidemic_protocols ENABLE ROW LEVEL SECURITY;
CREATE POLICY "epidemic_protocols_hospital_isolation" ON public.epidemic_protocols
  FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id());
