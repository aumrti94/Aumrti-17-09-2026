-- Teleconsult Productization Enhancements
-- Links portal-booked video appointments to teleconsult sessions, adds visit_mode tracking

-- 1. Link teleconsult sessions to portal-booked OPD tokens
ALTER TABLE public.teleconsult_sessions
  ADD COLUMN IF NOT EXISTS opd_token_id UUID REFERENCES public.opd_tokens(id) ON DELETE SET NULL;

-- 2. Visit mode on OPD tokens (in_person | teleconsult)
ALTER TABLE public.opd_tokens
  ADD COLUMN IF NOT EXISTS visit_mode TEXT NOT NULL DEFAULT 'in_person';

-- 3. Visit mode on OPD encounters (so teleconsult encounters can be distinguished from in-person)
ALTER TABLE public.opd_encounters
  ADD COLUMN IF NOT EXISTS visit_mode TEXT NOT NULL DEFAULT 'in_person';

-- 4. Source tag on prescriptions (opd | teleconsult | pharmacy)
ALTER TABLE public.prescriptions
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'opd';

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_opd_tokens_visit_mode
  ON public.opd_tokens(hospital_id, visit_mode);

CREATE INDEX IF NOT EXISTS idx_teleconsult_sessions_opd_token
  ON public.teleconsult_sessions(opd_token_id);

CREATE INDEX IF NOT EXISTS idx_prescriptions_source
  ON public.prescriptions(hospital_id, source);
