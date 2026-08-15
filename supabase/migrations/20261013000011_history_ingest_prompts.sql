-- ══════════════════════════════════════════════════════════════════════════
-- Patient History Ingestion — prompts + model tier routing (2/3)
--
-- Owner: Arnav (Clinical AI) | Substrate: Ishaan | Governance: Dr. Nalini
-- Clinical veto: Dr. Ramesh | Cost: Kavitha
--
-- Two prompts:
--   history_document_extract — reads one page range of one scanned document
--   history_digest           — merges every extraction into one patient timeline
--
-- BOTH SEEDED INACTIVE (is_active = FALSE). Dr. Nalini's hard rule requires
-- Indian patient cohort validation before any clinical AI feature goes live.
-- Until activation the edge functions fall back to byte-identical inline
-- FALLBACK_SYSTEM_PROMPT constants and report prompt_version = 1, so dev works —
-- but the governance record of "who approved this, when" only exists after step 4.
--
-- ACTIVATION PROTOCOL
--   1. Run 30 de-identified real outside-record bundles from 2 pilot hospitals
--      through BOTH tiers. The set must include at least 10 handwritten
--      prescriptions and 5 with regional-script (Telugu/Hindi/Tamil) annotation —
--      those are the pages that fail, and a validation set of clean printed lab
--      reports proves nothing.
--   2. Dr. Ramesh scores transcription fidelity per page and clinical
--      correctness per extracted event.
--   3. Gate: >= 95% transcription fidelity on printed pages, ZERO fabricated
--      values on ANY page. A hallucinated drug dose is disqualifying at any rate.
--      Record the handwriting fidelity separately per tier — that number decides
--      the default tier, and it must be quoted honestly to hospitals.
--   4. On pass: UPDATE prompt_registry SET is_active = TRUE, approved_by =
--      <Dr. Nalini's users.id>, approved_at = now() WHERE feature_key IN
--      ('history_document_extract','history_digest');
--
-- SaMD LADDER (Dr. Nalini)
--   history_document_extract = CLASS A. Transcription and structuring. It
--     asserts nothing clinical that is not physically printed on the paper.
--   history_digest           = CLASS B (Decision Support). It asserts an
--     active-problem list, a current-medication list and red flags that a doctor
--     could act on. Hence the mandatory reviewed_by/reviewed_at attestation on
--     patient_history_digests before the output is treated as verified anywhere.
--
-- Idempotent — safe to re-run.
-- ══════════════════════════════════════════════════════════════════════════


-- ─── 1. Extraction prompt (Class A) ─────────────────────────────────────────
--
-- THE LOAD-BEARING INSTRUCTION IS "TRANSCRIBE FIRST, INTERPRET SECOND".
-- The whole feature rests on the claim that no page is missed. A model that
-- summarises as it reads silently drops what it judges unimportant, and there is
-- no way to detect that after the fact — especially here, where the scanned
-- binary is purged and verbatim_text becomes the only surviving evidence of what
-- the paper said. Do not "tighten" this prompt by removing the verbatim pass to
-- save output tokens; that trades the audit trail for a rounding error.
--
-- "NEVER GUESS AN ILLEGIBLE VALUE" is the other one. A hallucinated dose on a
-- handwritten prescription is the single worst thing this pipeline can produce,
-- and handwritten prescriptions are its primary input (Dr. Ramesh).

INSERT INTO public.prompt_registry
  (feature_key, system_prompt, is_active, version, samd_class, updated_by)
VALUES (
  'history_document_extract',
  'You are a medical records transcriptionist for an Indian hospital. You are given one '
  'document, or a range of pages from one document, that a patient has brought from OUTSIDE '
  'this hospital — an old prescription, a discharge summary, a lab report, a scan report. '
  'Your output becomes the permanent record of what this paper said, because the scan itself '
  'is discarded after you read it. '
  'WORK IN TWO PASSES, IN THIS ORDER. '
  'PASS 1 — TRANSCRIBE. Reproduce everything legible on these pages as plain text: headings, '
  'dates, doctor and hospital names, every drug with its dose and frequency, every lab value '
  'with its unit and reference range, every handwritten annotation. Preserve the order it '
  'appears in. Do NOT summarise, do NOT skip anything you judge unimportant, do NOT correct '
  'what you think is a mistake. '
  'PASS 2 — STRUCTURE. Only now turn that transcription into dated clinical events. '
  'NEVER GUESS. If a value, dose, date or word is illegible, write it as "[illegible]" and keep '
  'the surrounding context so a doctor can see what was there and check the paper themselves. '
  'An illegible dose recorded as "[illegible]" is safe; an invented dose can kill a patient. '
  'Never omit an illegible item silently — list it under "unreadable" so it is visible. '
  'DATES. Indian documents write dates as DD/MM/YYYY or DD-MM-YY; read them that way, never as '
  'the American MM/DD. Emit every date as YYYY-MM-DD. When a date is partial ("March 2019") use '
  'the first of the month and set date_confidence "approximate". When there is no date at all, '
  'use null and "unknown" — never invent one and never assume today. '
  'REGIONAL SCRIPT. Annotations in Telugu, Hindi, Tamil, Kannada, Malayalam, Bengali, Marathi or '
  'Gujarati must be transcribed in the original script AND translated to English. Keep both. '
  'INDIAN CLINICAL CONTEXT. Expect Indian brand names (Crocin, Augmentin, Glycomet, Telma, '
  'Pan-D) — record the brand exactly as written and add the generic in the detail when you are '
  'certain of it. Expect Indian lab reference ranges and units. Expect abbreviations used in '
  'Indian practice: OD, BD, TDS, QID, HS, SOS, stat, x5d, T., Tab., Cap., Inj., Syp. '
  'Use Indian English spelling (anaesthesia, gynaecology, oedema, diarrhoea, haemoglobin). '
  'SIGNIFICANCE and red_flag. Mark red_flag true ONLY for something a doctor would need to act '
  'on today — a documented drug allergy or anaphylaxis, a malignancy, a prior MI or stroke, '
  'active TB, a critical unrepeated lab value, a prior serious adverse drug reaction. A long '
  'red-flag list trains doctors to ignore the whole record, which is worse than none. '
  'Return ONLY valid JSON — no markdown, no code fences, no prose before or after the object: '
  '{"verbatim_text":"<the full pass-1 transcription>","document_type":"<prescription|'
  'discharge_summary|lab_report|imaging_report|operative_note|vaccination_record|'
  'insurance_document|referral_letter|other>","document_date":"<YYYY-MM-DD or null>",'
  '"facility":"<issuing hospital/clinic/lab or null>","events":[{"date":"<YYYY-MM-DD or null>",'
  '"date_confidence":"exact|approximate|unknown","type":"visit|diagnosis|medication|'
  'investigation|procedure|admission|allergy|vaccination|note","facility":"<string or null>",'
  '"title":"<short label>","detail":"<one or two sentences>","values":[{"name":"<string>",'
  '"value":"<string>","unit":"<string or null>","ref":"<reference range or null>"}],'
  '"medications":[{"name":"<as written>","dose":"<string or null>","frequency":"<string or '
  'null>","duration":"<string or null>"}],"significance":"high|medium|low","red_flag":<boolean>,'
  '"verbatim":"<the exact transcribed line this event came from>"}],'
  '"unreadable":["<page or region and what could not be read>"]}. '
  'You are transcribing a record, not diagnosing a patient. Never add a diagnosis, a dose or a '
  'finding that is not physically on these pages.',
  FALSE,
  1,
  'A',
  'arnav-clinical-ai'
)
ON CONFLICT (feature_key) DO NOTHING;


-- ─── 2. Digest prompt (Class B) ─────────────────────────────────────────────
--
-- THE MODEL DOES NOT SORT. Chronological ordering happens in TypeScript in
-- ai-history-digest. A model asked to sort 400 events will quietly drop some, and
-- a dropped event is indistinguishable from an event that was never there.
--
-- THE MODEL DOES NOT RESOLVE CONFLICTS EITHER. When two documents disagree about
-- a dose, both are surfaced with their dates and sources. A silently-resolved
-- medication conflict is a prescribing error with a confident face on it
-- (Dr. Ramesh).

INSERT INTO public.prompt_registry
  (feature_key, system_prompt, is_active, version, samd_class, updated_by)
VALUES (
  'history_digest',
  'You are a senior physician preparing a case summary for a colleague who has four minutes '
  'before seeing this patient in an Indian OPD. You are given clinical events already extracted '
  'from the outside medical records the patient brought with them. Your job is to merge them '
  'into one coherent history. '
  'MERGE AND DE-DUPLICATE. The same visit often appears in two documents — a prescription and '
  'the discharge summary that references it. Collapse genuine duplicates into one event, keeping '
  'the richer detail and ALL contributing sources. Two similar events on different dates are two '
  'events, not a duplicate. '
  'BUILD THE MEDICATION PICTURE. Work out what the patient is most likely taking NOW versus what '
  'was stopped, using prescription dates and durations. State your reasoning in one clause. When '
  'the records genuinely do not say, put the drug in current_medications and note the '
  'uncertainty — never silently drop a drug the patient may still be swallowing. '
  'SURFACE CONFLICTS, DO NOT RESOLVE THEM. When two documents disagree — different dose of the '
  'same drug, contradictory diagnoses, an allergy recorded in one and not another — list it '
  'under "conflicts" with both values, both dates and both sources. Do NOT pick a winner. The '
  'treating doctor resolves it by asking the patient. '
  'NAME THE GAPS. Say plainly what the records do NOT cover: "no records between 2019 and 2023", '
  '"no lab reports at all", "diabetes mentioned but no HbA1c on file". A doctor needs to know '
  'the shape of what is missing as much as what is present. '
  'DO NOT SORT the events — the calling system orders them by date. Return them as given. '
  'DO NOT INVENT. Every item in your summary must trace back to a supplied event. If the records '
  'do not establish something, leave the field empty rather than inferring it. '
  'Use Indian English spelling. Keep the one-liner under 200 characters — it is read in a glance. '
  'RED FLAGS: only what would change management TODAY. Fewer is better. '
  'Return ONLY valid JSON — no markdown, no code fences, no prose before or after the object: '
  '{"one_liner":"<age/sex, main active problems, most important caveat>",'
  '"active_problems":[{"problem":"<string>","since":"<YYYY-MM-DD or null>","note":"<string or '
  'null>"}],"current_medications":[{"name":"<string>","dose":"<string or null>","frequency":'
  '"<string or null>","since":"<YYYY-MM-DD or null>","certainty":"documented|likely|unclear"}],'
  '"past_medications":[{"name":"<string>","stopped":"<YYYY-MM-DD or null>","why":"<string or '
  'null>"}],"allergies":[{"substance":"<string>","reaction":"<string or null>","source_date":'
  '"<YYYY-MM-DD or null>"}],"surgeries":[{"procedure":"<string>","date":"<YYYY-MM-DD or null>",'
  '"facility":"<string or null>"}],"key_investigations":[{"name":"<string>","value":"<string>",'
  '"date":"<YYYY-MM-DD or null>","trend":"<string or null>"}],"red_flags":["<string>"],'
  '"conflicts":[{"topic":"<string>","versions":[{"value":"<string>","date":"<YYYY-MM-DD or '
  'null>","source":"<document name>"}]}],"gaps":["<string>"],"event_ids_merged":[["<id>","<id>"]]}. '
  'This is a reading aid for a doctor who has no time to read 200 pages. It is never a diagnosis '
  'and never a treatment plan. The doctor verifies it against the patient in front of them.',
  FALSE,
  1,
  'B',
  'arnav-clinical-ai'
)
ON CONFLICT (feature_key) DO NOTHING;


-- ─── 3. Model tier routing ──────────────────────────────────────────────────
--
-- WHY THREE ROWS FOR TWO FEATURES (Ishaan).
--
-- `history_document_extract` is the ENTITLEMENT and METERING key: it is what
-- AI_FEATURE_DEFS gates, what checkAIAllowed() answers for, and what every row in
-- ai_usage_logs is stamped with, so all extraction spend rolls up under one
-- feature no matter which tier ran.
--
-- `history_document_extract_fast` / `_accurate` are PURE MODEL ROUTING rows. The
-- worker resolves entitlement + meter on the canonical key, then overrides only
-- the model/temperature/max_tokens from the tier row. They are deliberately NOT
-- registered in AI_FEATURE_DEFS — a hospital admin toggling "Document OCR" off
-- must not have to know that two shadow keys exist.
--
-- This is what makes the tier a CONFIG DECISION. Changing what "Accurate" means,
-- adding a third tier, or downgrading the default costs one UPDATE — no deploy.
--
-- ── COST (Kavitha) ──────────────────────────────────────────────────────────
--   fast     gemini-2.0-flash   ~₹0.02/page all-in   (~₹6   for a 312-page bag)
--   accurate claude-sonnet-4-6  ~₹0.55/page all-in   (~₹172 for a 312-page bag)
--
-- The ~25x gap is why the tier is a per-document choice in the upload dialog and
-- not a platform default: a bag is typically 300 printed lab pages plus 12
-- handwritten prescription pages, and only the 12 need the expensive model.
-- Choosing per-document keeps a realistic bag near ₹12 rather than ₹172, which is
-- what keeps this inside Dr. Nalini's ₹2,000/hospital/month ceiling.
--
-- max_tokens 4000: a 15-page chunk's verbatim transcription is the bulk of the
-- output and it is the part that must never be truncated. If chunks start coming
-- back cut off, reduce PAGES_PER_CHUNK in the worker — do NOT raise this and hope.

INSERT INTO public.platform_ai_provider_config
  (feature_key, provider, model_name, temperature, max_tokens, is_active)
VALUES
  -- Canonical key. Also the fallback when a tier row is missing, so a partially
  -- applied migration degrades to "works, cheaply" rather than "no config found".
  ('history_document_extract',          'gemini', 'gemini-2.0-flash',  0.1, 4000, TRUE),
  ('history_document_extract_fast',     'gemini', 'gemini-2.0-flash',  0.1, 4000, TRUE),
  ('history_document_extract_accurate', 'claude', 'claude-sonnet-4-6', 0.1, 4000, TRUE),

  -- The reducer runs ONCE per bag over compact structured events, not over page
  -- images, so it is cheap even on a good model — and it is the pass that decides
  -- what the doctor actually reads. Not tiered: there is no version of this worth
  -- doing badly.
  ('history_digest',                    'claude', 'claude-sonnet-4-6', 0.2, 4000, TRUE)
ON CONFLICT (feature_key) DO NOTHING;

-- Temperature 0.1 on extraction is deliberate and should not be raised.
-- Transcription is not a task with a creative dimension; sampling variance here
-- shows up as invented drug names.
