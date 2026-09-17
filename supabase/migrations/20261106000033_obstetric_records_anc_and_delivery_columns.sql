-- Phase 8B (docs/testing/PHASE_8_STATUS.md §2-3, KNOWN_BUG-226/227/228) — ANC save fix + the
-- delivery-recording screen that has never existed.
--
-- WHY (ANC). ObstetricANCPage.tsx's save spreads its ~45-field form as top-level insert keys
-- (`...form`), and only ~5 happened to match real columns — every save has always failed. The
-- page already half-intended a jsonb catch-all (`anc_full_data: form` was already in the insert
-- payload, just alongside the broken spread) — this migration adds the columns the fixed save
-- actually needs: `anc_full_data` for the free-form visit detail, `high_risk_status`/
-- `risk_factors` for the computed risk flags, `signoff_status` for the draft/signed workflow
-- (HODDashboardPage.tsx already reads both `signoff_status='draft'` and `high_risk_status=true`
-- counts — it was already querying columns that didn't exist either).
--
-- WHY (delivery). `record_type` already allows 'delivery' (never used — nothing in src/ ever
-- inserts it) and a dead, disconnected table (`partograph_records`) already has the exact outcome
-- enum a delivery record needs. Rather than resurrecting a second table, this extends the live,
-- already-read-from `obstetric_records` with the columns Form 8 (MaternityRegisterTab.tsx) and
-- the HMIS monthly report already assumed exist: `admission_id` (also fixes MaternityRegisterTab's
-- broken `obstetric_records_admission_id_fkey` embed — the table had no such FK at all),
-- `delivery_date`, `outcome`, plus `delivery_conducted_by` (per the `_by`-column rule —
-- public.users, never auth.users) and `complications`.

ALTER TABLE public.obstetric_records
  ADD COLUMN IF NOT EXISTS anc_full_data jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS high_risk_status boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS risk_factors text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS signoff_status text DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS admission_id uuid REFERENCES public.admissions(id),
  ADD COLUMN IF NOT EXISTS delivery_date timestamptz,
  ADD COLUMN IF NOT EXISTS outcome text,
  ADD COLUMN IF NOT EXISTS delivery_conducted_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS complications text;

CREATE OR REPLACE FUNCTION public.validate_obstetric_record()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.record_type NOT IN ('anc','delivery','postnatal') THEN
    RAISE EXCEPTION 'Invalid record_type: %', NEW.record_type;
  END IF;
  IF NEW.bishop_dilation IS NOT NULL AND (NEW.bishop_dilation < 0 OR NEW.bishop_dilation > 3) THEN
    RAISE EXCEPTION 'bishop_dilation must be 0-3';
  END IF;
  IF NEW.bishop_effacement IS NOT NULL AND (NEW.bishop_effacement < 0 OR NEW.bishop_effacement > 3) THEN
    RAISE EXCEPTION 'bishop_effacement must be 0-3';
  END IF;
  IF NEW.bishop_station IS NOT NULL AND (NEW.bishop_station < 0 OR NEW.bishop_station > 3) THEN
    RAISE EXCEPTION 'bishop_station must be 0-3';
  END IF;
  IF NEW.bishop_consistency IS NOT NULL AND (NEW.bishop_consistency < 0 OR NEW.bishop_consistency > 2) THEN
    RAISE EXCEPTION 'bishop_consistency must be 0-2';
  END IF;
  IF NEW.bishop_position IS NOT NULL AND (NEW.bishop_position < 0 OR NEW.bishop_position > 2) THEN
    RAISE EXCEPTION 'bishop_position must be 0-2';
  END IF;
  IF NEW.signoff_status IS NOT NULL AND NEW.signoff_status NOT IN ('draft','signed') THEN
    RAISE EXCEPTION 'Invalid signoff_status: %', NEW.signoff_status;
  END IF;
  IF NEW.outcome IS NOT NULL AND NEW.outcome NOT IN ('svd','lscs','forceps','vacuum','still_born') THEN
    RAISE EXCEPTION 'Invalid outcome: %', NEW.outcome;
  END IF;
  RETURN NEW;
END;
$$;
-- trg_validate_obstetric_record already points at this function (20260328143309) — no re-attach needed.
