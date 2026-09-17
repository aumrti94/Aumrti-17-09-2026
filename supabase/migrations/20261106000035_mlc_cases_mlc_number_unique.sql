-- Phase 8B — KNOWN-BUG-235. `mlc_cases.mlc_number` (20260908000002_mlc_cases.sql) never had a
-- uniqueness constraint, global or per-hospital — unlike `mlc_records.mlc_number`, which does
-- (repointed to per-hospital by 20261008000159_per_hospital_document_numbers.sql, which never
-- covered mlc_cases at all). Combined with MLCDetailsModal.tsx's own collision-prone
-- COUNT(*)+1 number generator (fixed alongside this, same commit), two concurrent MLC
-- registrations at the same hospital could silently mint the same MLC number with nothing in
-- the schema to catch it. Naming matches the `<table>_hospital_<col>_key` convention
-- 20261008000159 established for every other per-hospital document-number column.

ALTER TABLE public.mlc_cases
  ADD CONSTRAINT mlc_cases_hospital_mlc_number_key UNIQUE (hospital_id, mlc_number);
