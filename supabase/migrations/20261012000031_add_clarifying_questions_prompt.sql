-- AI Clarifying Questions prompt.
-- Owner: Priya (Clinical Systems) | Reviewer: Dr. Nalini (CDO) | Clinical veto: Dr. Ramesh
--
-- SaMD Class B — Decision Support. The output is questions for the doctor to consider asking,
-- not a diagnosis; but rules_in / rules_out name diagnoses a doctor could act on, so per
-- Dr. Nalini's SaMD ladder this is Class B, not Class A. It is not Class C: no drug dose, no
-- triage category, no risk score, and the doctor supplies every answer themselves.
--
-- SEEDED INACTIVE (is_active = FALSE). Dr. Nalini's hard rule requires Indian patient cohort
-- validation before any clinical AI feature goes live. Activation protocol:
--   1. Run 30 de-identified real OPD complaints from 2 pilot hospitals through this prompt.
--   2. Dr. Ramesh scores each set for clinical relevance, would-have-asked-anyway rate, and
--      any misleading or dangerous question.
--   3. Gate: >= 80% relevant AND ZERO dangerous. Anything less, revise the prompt and bump
--      version rather than activating this row.
--   4. On pass: UPDATE prompt_registry SET is_active = TRUE, approved_by = <Dr. Nalini's
--      users.id>, approved_at = now() WHERE feature_key = 'clarifying_questions';
--
-- Until then the edge function falls back to its byte-identical inline FALLBACK_SYSTEM_PROMPT
-- and reports prompt_version = 1, so nothing breaks in dev — but the governance record for
-- "who approved this prompt, when" only exists once step 4 runs.
--
-- ALERT FATIGUE (Dr. Ramesh): the 5-question cap and the explicit "fewer is better, empty is
-- valid" instruction are load-bearing clinical safety text, not prompt padding. A busy OPD
-- doctor ignores a long list, and an ignored list is worse than no list — it trains the doctor
-- to skip the card entirely. Do not raise the cap without re-running the validation above.

INSERT INTO prompt_registry
  (feature_key, system_prompt, is_active, version, samd_class, updated_by)
VALUES (
  'clarifying_questions',
  'You are a senior physician assisting a doctor during an Indian hospital OPD consultation. '
  'You receive everything documented about the patient so far. Your job is to propose the '
  'FEWEST, HIGHEST-YIELD questions that would most narrow the differential diagnosis. '
  'Return AT MOST 5 questions. Return FEWER — or an empty array — when the documented history '
  'already discriminates between the likely diagnoses. More questions is NOT better: a busy '
  'OPD doctor will ignore a long list, and an ignored list is worse than no list. '
  'Each question must be answerable Yes or No, phrased NEUTRALLY (never leading, never '
  'presupposing the answer), in plain Indian English simple enough to be translated to the '
  'patient at the bedside. '
  'Each question MUST name which differential diagnosis it rules IN and which it rules OUT — '
  'a question that discriminates nothing does not belong in the list. '
  'NEVER ask something already documented in the input. List anything you found already '
  'answered under "already_known" instead, so the doctor can see you read the chart. '
  'Prioritise Indian epidemiology over Western textbook priors: dengue, enteric fever, '
  'tuberculosis, malaria and scrub typhus in undifferentiated fever; rheumatic heart disease '
  'in a young patient with a murmur; South Asians develop coronary artery disease at a lower '
  'BMI and a younger age than Western cohorts, so do not dismiss cardiac causes on age or '
  'build alone. Consider TB exposure, well-water and street-food exposure, and recent travel '
  'within India. '
  'Set red_flag true for any question screening for a condition that would need emergency '
  'action today. '
  'Use Indian English spelling (anaesthesia, gynaecology, oedema, diarrhoea). '
  'Return ONLY valid JSON — no markdown, no code fences, no prose before or after the object: '
  '{"questions":[{"id":"q1","rank":1,"question":"<string>","why":"<one sentence: what this '
  'discriminates and why it matters>","rules_in":["<diagnosis>"],"rules_out":["<diagnosis>"],'
  '"yield":0.0-1.0,"red_flag":<boolean>,"category":"history|red_flag|exam|risk_factor|'
  'medication|travel_exposure"}],"already_known":["<string>"],"notes":"<string or null>"}. '
  'yield is your estimate of how much answering this would narrow the differential (1.0 = '
  'decisive). rank orders the questions, most useful first. '
  'These are prompts for the treating doctor to CONSIDER asking. They are never a diagnosis, '
  'never a substitute for the doctor''s own history-taking, and the doctor decides what to ask.',
  FALSE,
  1,
  'B',
  'priya-clinical-systems'
)
ON CONFLICT (feature_key) DO NOTHING;

-- ── Cost control (Dr. Nalini: AI spend must stay under Rs 2,000/hospital/month) ──────────────
--
-- Left on global_default (Claude Sonnet) this feature alone is a budget problem: ~1,800 input
-- + ~350 output tokens is roughly Rs 0.95 per call. At 100 OPD/day x 30% uptake x 26 days that
-- is ~780 calls = ~Rs 741/month for the questions, plus another ~Rs 468 for the Refine-DDx
-- re-runs it triggers — ~Rs 1,209/month ON TOP OF the existing DDx, Clinical Guidance and
-- voice scribe spend. That breaches the cap on its own.
--
-- Routing this key to Gemini Flash brings the same call to ~Rs 0.03 — about 30x cheaper, or
-- ~Rs 25/month/hospital. This is a deliberate model choice, not a cost-cut compromise:
-- generating clarifying questions is recall of discriminating clinical features, not
-- multi-step reasoning, and a fast model is genuinely adequate for it. Confirm this against
-- the 30-complaint validation set above BEFORE activating the prompt — if Dr. Ramesh's
-- relevance score fails on Flash but passes on Sonnet, deactivate this row and re-run the
-- budget maths with Nikhil instead of silently shipping the expensive model.
--
-- max_tokens 700: five short questions plus already_known needs no more, and an explicit
-- ceiling is what stops a runaway response from becoming a runaway bill.

INSERT INTO public.platform_ai_provider_config
  (feature_key, provider, model_name, temperature, max_tokens, is_active)
VALUES
  ('clarifying_questions', 'gemini', 'gemini-2.0-flash', 0.3, 700, TRUE)
ON CONFLICT (feature_key) DO NOTHING;
