-- financial-anomaly-check/index.ts writes direction: "spike" | "drop" (the same vocabulary
-- src/components/accounts/FinancialAnomalyCard.tsx already expects and renders) — but
-- financial_anomalies_direction_check has only ever allowed 'above'/'below'. Stacked with the
-- KNOWN-BUG-172-class `.catch()`-is-not-a-function bug on the same insert (fixed in the same
-- pass), this meant every single anomaly detection has ALWAYS failed to persist, for two
-- independent reasons: first the synchronous crash discarded the response before the insert
-- was even attempted in earlier runs, and even with that fixed the CHECK constraint rejects
-- every row outright. Found via Phase 6 edge-function testing (a live test with a genuine
-- 90th-percentile revenue spike surfaced both failures in sequence).
--
-- Aligning the DB to the code's vocabulary, not the reverse: the frontend card already renders
-- "spike"/"drop" and no code anywhere writes or reads 'above'/'below' for this table.

BEGIN;

ALTER TABLE public.financial_anomalies DROP CONSTRAINT IF EXISTS financial_anomalies_direction_check;

ALTER TABLE public.financial_anomalies ADD CONSTRAINT financial_anomalies_direction_check
  CHECK (direction = ANY (ARRAY['spike'::text, 'drop'::text]));

COMMIT;
