-- AI Clarifying Questions (OPD consultation → AI Guidance tab).
--
-- The AI Guidance tab could previously only help AFTER the doctor had done the hard part:
-- the differential needs a chief complaint, and Clinical Guidance needs a diagnosis. Nothing
-- helped the doctor get from a vague complaint to a narrow one. This column backs a third
-- card that proposes the fewest, highest-yield questions that would discriminate between the
-- differentials, and records the doctor's answers.
--
-- Stored as ONE object rather than an array of rows, so the whole card state is a single
-- atomic write with no merge logic:
--   {
--     "version": 1,                -- shape version of this object
--     "prompt_version": 1,         -- prompt_registry.version that produced the questions
--     "generated_at": "<ISO>",
--     "questions": [ { id, rank, question, why, rules_in[], rules_out[], yield, red_flag, category } ],
--     "answers": { "q1": { "answer": "yes|no|not_asked", "note": "" } },
--     "appended_to_hpi_at": "<ISO> or null"
--   }
--
-- prompt_version is what makes every stored question set traceable back to the exact prompt
-- that produced it (Dr. Nalini: system prompts must be versioned, never hardcoded without a
-- version reference). Neither of the two existing AI Guidance cards records this.
--
-- SaMD: Class B (Decision Support). The output is questions for the doctor to consider, not a
-- diagnosis — but rules_in/rules_out name diagnoses a doctor could act on, so it is not Class A.
-- Not Class C: no drug dose, no triage category, no risk score, and the doctor supplies every
-- answer themselves.
--
-- DPDP Act 2023:
--   Purpose   — clinical documentation of history-taking for THIS encounter only.
--               Never used for analytics, model training, or any secondary purpose.
--   Contents  — AI-generated question text plus the treating doctor's answers.
--               The voice-scribe transcript is deliberately NOT persisted here: it is sent to
--               the model as in-memory input and dropped (see src/contexts/VoiceScribeContext.tsx).
--               Data minimisation — we keep the answers, not the raw conversation.
--   Retention — follows the parent opd_encounters row (medical-record retention). Deleted with
--               the encounter; it has no independent lifecycle.
--   Access    — inherits opd_encounters RLS (hospital_id = get_user_hospital_id()), i.e.
--               same-hospital authenticated clinical staff only. No new policy needed.

ALTER TABLE public.opd_encounters
  ADD COLUMN IF NOT EXISTS ai_clarifying_questions JSONB;

COMMENT ON COLUMN public.opd_encounters.ai_clarifying_questions IS
  'AI-generated DDx-discriminating clarifying questions and the treating doctor''s answers for this encounter. Purpose: clinical documentation of history-taking. Retention: lifecycle of the parent encounter row. Access: opd_encounters RLS (same-hospital only). Never contains the voice-scribe transcript. SaMD Class B — decision support, doctor-reviewed. Carries prompt_version so each set traces to the prompt_registry row that produced it.';

-- NO INDEX, deliberately. This column is only ever read via SELECT * on a single encounter
-- already located by token_id or id (ConsultationWorkspace loads one encounter per token).
-- It is never filtered, joined, or searched on, so a GIN index would be pure write cost on
-- every consultation autosave with no reader to justify it. Do not "fix" this.
