-- Revenue Leak Detector — persisted actions
-- Previously "Assign to Dept Head" / "Resolve" were local React state + a toast only —
-- nothing was written to the database and status reset on every re-analysis.
-- AI-generated leak findings (ai-revenue-leak-detector edge function) have no natural id
-- (parsed LLM JSON, not a DB row), so a deterministic finding_key is used as the upsert key.

CREATE TABLE IF NOT EXISTS public.revenue_leak_actions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id      uuid        NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  issue            text        NOT NULL,
  department       text,
  amount_at_risk   numeric(12,2),
  severity         text,
  status           text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'assigned', 'resolved')),
  assigned_to      uuid        REFERENCES public.users(id),
  assigned_by      uuid        REFERENCES public.users(id),
  assigned_at      timestamptz,
  resolved_by      uuid        REFERENCES public.users(id),
  resolved_at      timestamptz,
  finding_key      text        GENERATED ALWAYS AS (md5(hospital_id::text || issue || coalesce(department, ''))) STORED,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_revenue_leak_actions_finding_key
  ON public.revenue_leak_actions (hospital_id, finding_key);

ALTER TABLE public.revenue_leak_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "revenue_leak_actions_hospital" ON public.revenue_leak_actions
  FOR ALL USING (hospital_id = get_user_hospital_id());

CREATE OR REPLACE FUNCTION public.set_revenue_leak_actions_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_revenue_leak_actions_updated_at
  BEFORE UPDATE ON public.revenue_leak_actions
  FOR EACH ROW EXECUTE FUNCTION public.set_revenue_leak_actions_updated_at();
