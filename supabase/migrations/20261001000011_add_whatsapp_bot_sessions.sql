-- Phase 5C: WhatsApp Conversational Bot session state
-- Stores per-phone conversation state for the incoming RAG bot

CREATE TABLE IF NOT EXISTS public.whatsapp_bot_sessions (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  hospital_id       uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  phone             text NOT NULL,
  patient_id        uuid REFERENCES public.patients(id),
  current_intent    text,
  context_json      jsonb DEFAULT '{}',
  last_message_at   timestamptz DEFAULT now(),
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wbs_hospital_phone ON public.whatsapp_bot_sessions (hospital_id, phone);
CREATE INDEX IF NOT EXISTS idx_wbs_last_message ON public.whatsapp_bot_sessions (last_message_at DESC);

ALTER TABLE public.whatsapp_bot_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital_isolation_wbs" ON public.whatsapp_bot_sessions
  USING (hospital_id = get_user_hospital_id());

-- WhatsApp bot message log for audit trail
CREATE TABLE IF NOT EXISTS public.whatsapp_bot_messages (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id    uuid NOT NULL REFERENCES public.whatsapp_bot_sessions(id) ON DELETE CASCADE,
  hospital_id   uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  direction     text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  message_text  text NOT NULL,
  intent        text,
  wa_message_id text,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wbm_session ON public.whatsapp_bot_messages (session_id, created_at DESC);

ALTER TABLE public.whatsapp_bot_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital_isolation_wbm" ON public.whatsapp_bot_messages
  USING (hospital_id = get_user_hospital_id());

-- Prompt for the WhatsApp bot (SaMD Class B — symptom triage requires physician review)
INSERT INTO public.prompt_registry (feature_key, system_prompt, samd_class, updated_by, version) VALUES (
  'whatsapp_bot_intent',
  'You are a helpful hospital assistant for {{hospital_name}}. You can help patients with:
1. Checking or booking appointments
2. Understanding their bills or payment status
3. Fetching lab/radiology report status
4. General information about hospital services and timings
5. Basic symptom information (NOT diagnosis — always advise seeing a doctor)

RULES:
- Never diagnose. For any symptoms beyond basic first aid, say "Please consult your doctor or visit the emergency department."
- Never share PHI with unverified users. If you need patient data, ask for UHID + date of birth to verify identity.
- Keep responses brief (under 3 sentences). Use simple Hindi or English based on the patient message language.
- For emergency symptoms (chest pain, breathlessness, severe bleeding), immediately say "CALL 112 OR GO TO EMERGENCY NOW."
- End every message with the option to speak to a human: "Reply HELP to speak with our staff."

You will receive the conversation history and a detected intent. Respond naturally based on the intent.',
  'B',
  'tara-automation',
  1
) ON CONFLICT (feature_key) DO NOTHING;
