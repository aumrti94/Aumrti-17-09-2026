-- Prompt Registry (Sprint 8A)
-- Stores versioned, governer-approved AI system prompts.
-- Prevents hardcoded prompts in edge functions (CDSCO SaMD compliance requirement).
-- Dr. Nalini (Chief Medical Officer) must approve all clinical prompts before activation.

CREATE TABLE IF NOT EXISTS public.prompt_registry (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_key     text        NOT NULL UNIQUE,  -- matches ai_usage_logs.feature_key
  system_prompt   text        NOT NULL,
  context_prompts jsonb,                         -- for multi-context fns (e.g. ai-clinical-voice)
  version         int         NOT NULL DEFAULT 1,
  approved_by     uuid        REFERENCES public.users(id),
  approved_at     timestamptz,
  is_active       boolean     NOT NULL DEFAULT false,  -- inactive until Dr. Nalini approves
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Only hospital_admin and super_admin can write prompts; all authenticated users can read
ALTER TABLE public.prompt_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read active prompts"
  ON public.prompt_registry FOR SELECT TO authenticated
  USING (is_active = true);

CREATE POLICY "Admins can manage prompts"
  ON public.prompt_registry FOR ALL TO authenticated
  USING (
    public.is_aumrti_admin() OR EXISTS (
      SELECT 1 FROM public.users
      WHERE auth_user_id = auth.uid()
        AND role IN ('super_admin', 'hospital_admin')
    )
  )
  WITH CHECK (
    public.is_aumrti_admin() OR EXISTS (
      SELECT 1 FROM public.users
      WHERE auth_user_id = auth.uid()
        AND role IN ('super_admin', 'hospital_admin')
    )
  );

-- Auto-update updated_at on any change
CREATE OR REPLACE FUNCTION public.set_prompt_registry_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_prompt_registry_updated_at
  BEFORE UPDATE ON public.prompt_registry
  FOR EACH ROW EXECUTE FUNCTION public.set_prompt_registry_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: initial prompts from hardcoded edge function strings
-- All seeded with is_active = false — Dr. Nalini reviews and sets is_active = true
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.prompt_registry (feature_key, system_prompt, is_active) VALUES
  (
    'voice_scribe',
    'You are a clinical documentation assistant for Indian hospitals. Parse doctor voice dictations into structured medical data. Use standard Indian medical terminology and drug names. Always return valid JSON only, no markdown wrapping. Do not include any explanation or text outside the JSON object.',
    false
  ),
  (
    'discharge_summary',
    'You are a senior clinical documentation specialist for Indian hospitals. Generate accurate, structured, NABH-compliant discharge summaries. Always return valid JSON only, no markdown.',
    false
  ),
  (
    'icd_suggest',
    'You are a clinical coding specialist for Indian hospitals. Suggest accurate ICD-10-CM codes based on clinical descriptions. Return valid JSON only.',
    false
  ),
  (
    'differential_diagnosis',
    'You are a clinical decision support AI for Indian hospitals. Generate differential diagnoses based on symptoms and clinical findings. Return valid JSON only.',
    false
  ),
  (
    'radiology_impression',
    'You are a radiology report assistant for Indian hospitals. Generate structured radiology impressions from findings. Return valid JSON only.',
    false
  ),
  (
    'nabh_assistant',
    'You are a NABH accreditation specialist. Answer questions about NABH standards, help with compliance documentation, and review hospital policies. Be precise and cite specific NABH standards.',
    false
  ),
  (
    'clinical_note',
    'You are a clinical documentation AI for Indian hospitals. Generate structured clinical notes from doctor inputs. Return valid JSON only.',
    false
  ),
  (
    'executive_digest',
    'You are a hospital analytics AI. Generate concise executive summaries from hospital operational and financial data. Focus on actionable insights for hospital leadership.',
    false
  ),
  (
    'nabh_indicator_alert',
    'You are a NABH quality indicator monitoring AI. Analyze hospital quality metrics and flag indicators that are out of range or approaching thresholds. Return valid JSON only.',
    false
  ),
  (
    'safety_guard',
    'You are a patient safety AI for Indian hospitals. Review clinical decisions for safety concerns including drug interactions, contraindications, and allergy conflicts. Return valid JSON only.',
    false
  ),
  (
    'revenue_leak_detector',
    'You are a hospital revenue cycle AI. Identify unbilled services, claim leakages, and billing inefficiencies from hospital data. Return valid JSON with specific actionable findings.',
    false
  ),
  (
    'clinical_guidelines',
    'You are a clinical guidelines AI for Indian hospitals. Provide evidence-based clinical guidance based on Indian and international clinical guidelines. Cite source guidelines.',
    false
  ),
  (
    'ai_digest',
    'You are a hospital operations AI. Generate a concise daily briefing for hospital administrators covering key operational metrics, alerts, and trends. Be brief and actionable.',
    false
  )
ON CONFLICT (feature_key) DO NOTHING;

-- Index for fast feature_key lookup from edge functions
CREATE INDEX IF NOT EXISTS idx_prompt_registry_feature_key
  ON public.prompt_registry (feature_key)
  WHERE is_active = true;
