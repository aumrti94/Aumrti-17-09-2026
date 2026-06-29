-- ── Gap 8: Antibiotic Stewardship Programme ──────────────────────────────────

-- Restricted antibiotic list — requires ID/microbiologist approval before use
CREATE TABLE IF NOT EXISTS public.antibiotic_restricted_list (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  drug_name       text NOT NULL,
  drug_class      text,
  restriction_level text NOT NULL DEFAULT 'restricted'
    CHECK (restriction_level IN ('restricted', 'reserve', 'watch')),
  approval_roles  text[] NOT NULL DEFAULT ARRAY['doctor'],
  requires_id_physician_approval boolean NOT NULL DEFAULT true,
  max_duration_days integer,
  alert_at_days   integer DEFAULT 5,
  oral_equivalent text,
  notes           text,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hospital_id, drug_name)
);

CREATE INDEX IF NOT EXISTS idx_restricted_list_hospital
  ON public.antibiotic_restricted_list (hospital_id, is_active);

ALTER TABLE public.antibiotic_restricted_list ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "restricted_list_hospital_iso" ON public.antibiotic_restricted_list;
CREATE POLICY "restricted_list_hospital_iso" ON public.antibiotic_restricted_list
  FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- Seed WHO AWaRe Watch/Reserve antibiotics for all hospitals that have none
INSERT INTO public.antibiotic_restricted_list
  (hospital_id, drug_name, drug_class, restriction_level, requires_id_physician_approval, max_duration_days, alert_at_days, oral_equivalent)
SELECT
  h.id,
  a.drug_name, a.drug_class, a.restriction_level,
  a.requires_approval, a.max_days, a.alert_days, a.oral_eq
FROM public.hospitals h
CROSS JOIN (VALUES
  ('Vancomycin',      'Glycopeptide',     'reserve',     true,  14, 5,  NULL),
  ('Linezolid',       'Oxazolidinone',    'reserve',     true,  14, 5,  'Linezolid Oral'),
  ('Colistin',        'Polymyxin',        'reserve',     true,  10, 3,  NULL),
  ('Meropenem',       'Carbapenem',       'reserve',     true,  10, 5,  NULL),
  ('Imipenem',        'Carbapenem',       'reserve',     true,  10, 5,  NULL),
  ('Ertapenem',       'Carbapenem',       'restricted',  true,  10, 5,  NULL),
  ('Tigecycline',     'Tetracycline',     'reserve',     true,  14, 5,  NULL),
  ('Daptomycin',      'Lipopeptide',      'reserve',     true,  14, 5,  NULL),
  ('Cefepime',        'Cephalosporin 4G', 'restricted',  false, 10, 5,  NULL),
  ('Piperacillin-Tazobactam', 'Penicillin/BLI', 'watch', false, 10, 7, 'Amoxicillin-Clavulanate'),
  ('Ceftriaxone',     'Cephalosporin 3G', 'watch',       false, 7,  5,  'Cefixime'),
  ('Ciprofloxacin IV','Fluoroquinolone',  'watch',       false, 7,  5,  'Ciprofloxacin Oral')
) AS a(drug_name, drug_class, restriction_level, requires_approval, max_days, alert_days, oral_eq)
WHERE NOT EXISTS (
  SELECT 1 FROM public.antibiotic_restricted_list rl WHERE rl.hospital_id = h.id
);


-- Add de_escalated flag and actual_duration to antibiotic_justifications
ALTER TABLE public.antibiotic_justifications
  ADD COLUMN IF NOT EXISTS de_escalated       boolean,
  ADD COLUMN IF NOT EXISTS actual_duration_days integer,
  ADD COLUMN IF NOT EXISTS iv_to_oral_switched boolean,
  ADD COLUMN IF NOT EXISTS prophylaxis_stopped_at timestamptz;
