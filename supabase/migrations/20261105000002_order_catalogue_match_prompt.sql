-- AI Resolve Orders prompt — maps a prescribed investigation name onto this hospital's own
-- lab / radiology catalogue.
-- Owner: Priya (Clinical Systems) | Reviewer: Dr. Nalini (CDO)
--
-- SaMD Class A. This prompt produces no diagnosis, no dose, no triage category and no risk
-- score. It answers one question — "which row of THIS hospital's catalogue did the doctor
-- mean?" — about an investigation the doctor has already decided to order. It is closer to a
-- spelling correction than to decision support.
--
-- SEEDED ACTIVE, unlike the Class B prompts, because the three structural guards below mean
-- there is nothing for an Indian-cohort validation set to measure that the code does not
-- already enforce:
--
--   1. The model does not NAME a test. It picks from a shortlist the edge function computed
--      from the hospital's own catalogue, and ai-resolve-orders discards any answer that is
--      not in the shortlist it offered. A hallucinated test cannot become an order.
--   2. The browser re-validates every answer against its own copy of the catalogue before
--      applying it, and refuses anything that no longer resolves.
--   3. Nothing is silent. A rewritten name renders as `matched from "<what the doctor wrote>"`
--      with an undo, and the undo is remembered.
--
-- What the prompt text itself is carrying is the REFUSAL discipline: null is the safe answer,
-- and the enumerated distinctions (IgM vs IgG, fasting vs random, PA vs AP, plain vs contrast,
-- "Lipid" vs "Lipid Profile") are the pairs where a confident wrong answer would perform and
-- bill the wrong investigation on a real patient. Treat that paragraph as clinical safety
-- text, not prompt padding, and bump the version rather than trimming it.
--
-- Must stay byte-identical to FALLBACK_SYSTEM_PROMPT in
-- supabase/functions/ai-resolve-orders/index.ts — the function reports prompt_version from
-- whichever it used, and a drifting pair makes that stamp a lie.

INSERT INTO public.prompt_registry
  (feature_key, system_prompt, is_active, version, samd_class, updated_by)
VALUES (
  'order_catalogue_match',
  'You map investigation names written by doctors in an Indian hospital onto that hospital''s '
  || 'own catalogue of laboratory tests, laboratory panels and radiology studies. '
  || 'For each requested name you are given a shortlist of candidate catalogue entries. '
  || 'Choose the ONE candidate the doctor meant, or null. '
  || 'You MUST copy the chosen candidate''s name EXACTLY as it appears in its shortlist, '
  || 'character for character. Never invent a name, never correct a spelling, never merge two '
  || 'candidates. A name that is not in the shortlist will be discarded. '
  || 'Answer null whenever you are not confident. null is the SAFE answer: an unmatched test is '
  || 'shown to the doctor to order by hand, whereas a wrong match silently performs and bills the '
  || 'wrong investigation on a real patient. '
  || 'Answer null when the request is more specific than every candidate ("Lipid" is not "Lipid '
  || 'Profile"), when it is more general than every candidate ("blood sugar" does not choose '
  || 'between fasting, post-prandial and random), and when two candidates fit equally well. '
  || 'Never trade a distinguishing detail away: IgM is not IgG, fasting is not random, PA is not '
  || 'AP view, left is not right, with contrast is not plain. '
  || 'Use ordinary Indian clinical shorthand where it is unambiguous — "sugar" is blood glucose, '
  || '"sonography" is ultrasound, "films" are X-rays. '
  || 'Return ONLY valid JSON — no markdown, no code fences, no prose before or after the object: '
  || '{"resolutions":[{"input":"<the requested name, copied exactly>","canonical_name":"<exact '
  || 'candidate name or null>","confidence":0.0-1.0,"reason":"<at most 12 words>"}]}. '
  || 'Return one entry for every requested name, in the order given.',
  TRUE,
  1,
  'A',
  NULL
)
ON CONFLICT (feature_key) DO NOTHING;

-- Model choice and budget.
--
-- This is recall over a short candidate list, not reasoning, and it runs at most once per
-- distinct phrase per hospital — order_name_aliases caches every accepted answer, so the call
-- volume decays towards zero as a hospital's vocabulary is learned. Flash is the right tool
-- and the cheap one; temperature 0 because there is exactly one correct answer and creativity
-- here is indistinguishable from a wrong order.
--
-- max_tokens 700 covers twelve short resolutions. The ceiling is what stops a runaway response
-- becoming a runaway bill.
INSERT INTO public.platform_ai_provider_config
  (feature_key, provider, model_name, temperature, max_tokens, is_active)
VALUES
  ('order_catalogue_match', 'gemini', 'gemini-2.0-flash', 0, 700, TRUE)
ON CONFLICT (feature_key) DO NOTHING;
