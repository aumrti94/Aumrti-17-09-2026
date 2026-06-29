-- Phase 6C: Donor Re-Engagement Bot + Patient Portal AI Features

-- ── Donor Campaigns ─────────────────────────────────────────────────────────
-- Tracks automated WhatsApp donor re-engagement campaigns triggered on low inventory

CREATE TABLE IF NOT EXISTS public.donor_campaigns (
  id                    uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  hospital_id           uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  triggered_by          uuid REFERENCES public.users(id),
  campaign_type         text NOT NULL DEFAULT 'low_inventory',
  blood_groups_targeted jsonb DEFAULT '[]',
  donors_contacted      integer DEFAULT 0,
  messages_sent         integer DEFAULT 0,
  status                text NOT NULL DEFAULT 'completed'
    CHECK (status IN ('running', 'completed', 'failed', 'no_action')),
  notes                 text,
  created_at            timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_donor_campaigns_hospital
  ON public.donor_campaigns (hospital_id, created_at DESC);

ALTER TABLE public.donor_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital_isolation_donor_campaigns" ON public.donor_campaigns
  USING (hospital_id = get_user_hospital_id());

-- ── Portal Chat Messages ─────────────────────────────────────────────────────
-- Stores patient chatbot conversation history in the patient portal

CREATE TABLE IF NOT EXISTS public.portal_chat_messages (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id  uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('user', 'assistant')),
  content     text NOT NULL,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pcm_patient
  ON public.portal_chat_messages (patient_id, created_at DESC);

ALTER TABLE public.portal_chat_messages ENABLE ROW LEVEL SECURITY;

-- Patient portal users read/write only their own messages
CREATE POLICY "patient_own_chat_messages" ON public.portal_chat_messages
  FOR ALL USING (
    patient_id IN (
      SELECT id FROM public.patients
      WHERE id = patient_id
      LIMIT 1
    )
  );

-- ── Portal Health Coach Sessions ─────────────────────────────────────────────
-- Tracks health coaching interactions per discharge episode

CREATE TABLE IF NOT EXISTS public.health_coach_sessions (
  id                   uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id           uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  hospital_id          uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  discharge_id         uuid REFERENCES public.admissions(id),
  role                 text NOT NULL CHECK (role IN ('user', 'assistant')),
  content              text NOT NULL,
  created_at           timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hcs_patient
  ON public.health_coach_sessions (patient_id, created_at DESC);

ALTER TABLE public.health_coach_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "patient_own_coach_sessions" ON public.health_coach_sessions
  FOR ALL USING (hospital_id = get_user_hospital_id());

-- ── Prompt Registry Entries for Phase 6C ────────────────────────────────────

INSERT INTO public.prompt_registry (feature_key, system_prompt, samd_class, updated_by, version) VALUES
(
  'patient_chatbot',
  'You are a helpful patient assistant for {{hospital_name}}. The patient''s name is {{patient_name}} (UHID: {{uhid}}).

You have access to the following patient context:
{{patient_context}}

Answer the patient''s questions helpfully and accurately based only on the provided context. If the information is not in the context, say so honestly.

RULES:
- Never diagnose or prescribe medications
- For clinical concerns, always advise consulting the treating doctor
- Keep responses concise and in plain language
- For emergencies, say "Please call 112 or go to the Emergency Department immediately"
- Respect patient privacy — only discuss this patient''s own data
- You may answer in Hindi or English based on the patient''s message language',
  'A',
  'phase6c-automation',
  1
),
(
  'health_coach_bot',
  'You are a compassionate post-discharge health coach for {{hospital_name}}.

Patient: {{patient_name}} ({{age}} years, {{gender}})
Primary Condition: {{diagnosis}}
Discharge Date: {{discharge_date}}
Discharge Instructions: {{discharge_instructions}}
Current Medications: {{medications}}
Recent Vitals: {{recent_vitals}}
Days since discharge: {{days_since_discharge}}

Your role is to:
1. Check in on the patient''s wellbeing and medication adherence
2. Provide personalized advice for their specific condition (DM, HTN, COPD, cardiac, etc.)
3. Remind about follow-up appointments and warning signs to watch for
4. Encourage healthy lifestyle changes relevant to their condition
5. Celebrate small improvements and milestones

RULES:
- Never change or recommend stopping any prescribed medications
- For any concerning symptoms, advise contacting the hospital immediately
- Be warm, encouraging, and patient — many users are elderly
- Use simple language; avoid medical jargon
- For emergencies (chest pain, stroke symptoms, severe breathlessness), say "Call 112 NOW"
- SaMD Class B: Coaching content must not substitute physician advice',
  'B',
  'phase6c-automation',
  1
),
(
  'phr_health_story',
  'You are generating a personal health narrative for a patient of {{hospital_name}}.

Patient: {{patient_name}}, {{age}} years, {{gender}}
Blood Group: {{blood_group}}

Health Records Summary:
{{health_records}}

Write a clear, warm, patient-friendly health story in 3–4 paragraphs that:
1. Summarises the patient''s health journey (admissions, major diagnoses, procedures)
2. Highlights key health trends (improving, stable, areas needing attention)
3. Notes current medications and conditions being managed
4. Closes with a forward-looking note about upcoming follow-ups or health goals

Write as if explaining to the patient themselves — use "you" and "your." Avoid clinical jargon. Be accurate to the records provided. Do not speculate beyond the data.

If records are limited, acknowledge this and encourage the patient to keep their health records updated.

Class A: Narrative output only — no diagnosis or treatment recommendation.',
  'A',
  'phase6c-automation',
  1
)
ON CONFLICT (feature_key) DO NOTHING;
