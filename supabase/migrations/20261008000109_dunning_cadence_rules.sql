-- ============================================================
-- Admin-configurable dunning cadence (Sprint 4)
-- ============================================================
-- dunning-processor's cadence was hardcoded in the function source — an
-- engineer had to touch a deploy to change it, not admin self-service. This
-- moves it into a table dunning-processor now reads instead. Seeded with
-- the exact rows the old hardcoded CADENCE map represented, so behavior is
-- byte-for-byte identical until an admin actually edits something.
--
-- Scoped to dunning cadence only, per the backlog's own note ("start with
-- dunning cadence — smaller surface than auto_posting_rules, same pattern
-- to prove out") — auto_posting_rules self-service UI is the same pattern,
-- deliberately left as a fast-follow, not built here.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.dunning_cadence_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day_offset      integer NOT NULL,
  attempt_number  integer NOT NULL,
  channel         text NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp')),
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dunning_cadence_rules_day ON public.dunning_cadence_rules (day_offset) WHERE is_active;

ALTER TABLE public.dunning_cadence_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dunning_cadence_rules_admin_all" ON public.dunning_cadence_rules;
CREATE POLICY "dunning_cadence_rules_admin_all" ON public.dunning_cadence_rules
  FOR ALL TO authenticated USING (public.is_aumrti_admin()) WITH CHECK (public.is_aumrti_admin());

-- Seed with the cadence dunning-processor's old hardcoded CADENCE map
-- represented, only if the table is empty (first migration run).
INSERT INTO public.dunning_cadence_rules (day_offset, attempt_number, channel)
SELECT * FROM (VALUES
  (1, 1, 'email'),
  (2, 2, 'email'),
  (2, 2, 'whatsapp'),
  (4, 3, 'email'),
  (4, 3, 'sms'),
  (6, 4, 'email')
) AS seed(day_offset, attempt_number, channel)
WHERE NOT EXISTS (SELECT 1 FROM public.dunning_cadence_rules);
