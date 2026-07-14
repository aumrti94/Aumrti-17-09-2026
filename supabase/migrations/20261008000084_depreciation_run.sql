-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: depreciation_run
-- Purpose  : Make fixed-asset depreciation actually accrue over time AND post to
--            the general ledger. Previously accumulated_dep was computed once at
--            asset creation and never re-run or journalised.
--
--   • run_monthly_depreciation(hospital, period) — for each active asset, compute
--     the period's depreciation (SLM or WDV), age the register, and post
--     Dr Depreciation (5050) / Cr Accumulated Depreciation (1110).
--   • depreciation_postings ledger row per (asset, period) makes it idempotent —
--     a re-run for the same month never double-posts.
--   • Monthly pg_cron loops every hospital.
--
-- Idempotent: IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. depreciation_postings ledger ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.depreciation_postings (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id   uuid          NOT NULL REFERENCES public.hospitals(id),
  asset_id      uuid          NOT NULL REFERENCES public.fixed_assets(id) ON DELETE CASCADE,
  period        date          NOT NULL,                 -- first day of the depreciated month
  dep_amount    numeric(14,2) NOT NULL,
  journal_id    uuid          REFERENCES public.journal_entries(id),
  created_at    timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT depreciation_postings_unique UNIQUE (hospital_id, asset_id, period)
);

CREATE INDEX IF NOT EXISTS idx_depreciation_postings_hospital
  ON public.depreciation_postings (hospital_id, period DESC);

ALTER TABLE public.depreciation_postings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "depreciation_postings_select" ON public.depreciation_postings;
CREATE POLICY "depreciation_postings_select" ON public.depreciation_postings
  FOR SELECT TO authenticated USING (hospital_id = public.get_user_hospital_id());

-- ── 2. run_monthly_depreciation ──────────────────────────────────────────────
-- Returns the number of assets depreciated in the period. SECURITY DEFINER so
-- both the cron job and an admin "Run now" RPC call can post journals.
CREATE OR REPLACE FUNCTION public.run_monthly_depreciation(
  p_hospital_id uuid,
  p_period      date DEFAULT date_trunc('month', CURRENT_DATE)::date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_period    date := date_trunc('month', p_period)::date;
  v_dep_acct  uuid;   -- 5050 Depreciation (expense)
  v_accum_acct uuid;  -- 1110 Accumulated Depreciation (contra-asset)
  v_dep_code  text := '5050';
  v_accum_code text := '1110';
  v_dep_name  text;
  v_accum_name text;
  a           record;
  v_annual    numeric(14,2);
  v_monthly   numeric(14,2);
  v_rate      numeric(10,4);
  v_dep_base  numeric(14,2);   -- remaining depreciable amount
  v_seq       bigint;
  v_entry_num text;
  v_journal   uuid;
  v_count     integer := 0;
BEGIN
  -- Resolve the two GL accounts once. If the COA isn't seeded, do nothing — never
  -- age the register without a matching journal (keeps register and GL in sync).
  SELECT id, name INTO v_dep_acct, v_dep_name
    FROM public.chart_of_accounts WHERE hospital_id = p_hospital_id AND code = v_dep_code;
  SELECT id, name INTO v_accum_acct, v_accum_name
    FROM public.chart_of_accounts WHERE hospital_id = p_hospital_id AND code = v_accum_code;
  IF v_dep_acct IS NULL OR v_accum_acct IS NULL THEN
    RAISE NOTICE 'Depreciation accounts (5050/1110) not found for hospital %, skipping.', p_hospital_id;
    RETURN 0;
  END IF;

  FOR a IN
    SELECT * FROM public.fixed_assets
    WHERE hospital_id = p_hospital_id
      AND status = 'active'
      AND purchase_date <= (v_period + INTERVAL '1 month' - INTERVAL '1 day')::date
  LOOP
    -- Skip assets already fully depreciated or already posted for this period.
    v_dep_base := GREATEST(COALESCE(a.current_book_value, a.purchase_cost)
                           - COALESCE(a.salvage_value, 0), 0);
    IF v_dep_base <= 0 THEN CONTINUE; END IF;

    IF EXISTS (
      SELECT 1 FROM public.depreciation_postings
      WHERE hospital_id = p_hospital_id AND asset_id = a.id AND period = v_period
    ) THEN CONTINUE; END IF;

    -- Compute one month of depreciation.
    IF a.depreciation_method = 'wdv' THEN
      -- Written Down Value: rate on the current book value. Use the stored rate,
      -- else fall back to a straight-line-equivalent rate (100 / useful life).
      v_rate := COALESCE(a.depreciation_rate,
                         CASE WHEN COALESCE(a.useful_life_years, 0) > 0
                              THEN 100.0 / a.useful_life_years ELSE 0 END);
      v_annual := COALESCE(a.current_book_value, a.purchase_cost) * (v_rate / 100.0);
    ELSE
      -- Straight Line: (cost − salvage) / useful life.
      v_annual := CASE WHEN COALESCE(a.useful_life_years, 0) > 0
                       THEN (a.purchase_cost - COALESCE(a.salvage_value, 0)) / a.useful_life_years
                       ELSE 0 END;
    END IF;

    v_monthly := ROUND(v_annual / 12.0, 2);
    -- Never depreciate past the salvage floor.
    v_monthly := LEAST(v_monthly, v_dep_base);
    IF v_monthly <= 0 THEN CONTINUE; END IF;

    -- Post the journal: Dr Depreciation / Cr Accumulated Depreciation.
    SELECT public.next_seq(p_hospital_id, 'journal') INTO v_seq;
    v_entry_num := 'JE-' || extract(year FROM v_period)::text || '-' || lpad(v_seq::text, 4, '0');

    INSERT INTO public.journal_entries (
      hospital_id, entry_number, entry_date, description, entry_type,
      source_module, source_id, total_debit, total_credit, is_balanced, posted_by
    ) VALUES (
      p_hospital_id, v_entry_num, (v_period + INTERVAL '1 month' - INTERVAL '1 day')::date,
      'Depreciation ' || to_char(v_period, 'Mon YYYY') || ' — ' || COALESCE(a.asset_name, a.asset_code),
      'auto_depreciation', 'fixed_assets', a.id, v_monthly, v_monthly, true, NULL
    ) RETURNING id INTO v_journal;

    INSERT INTO public.journal_line_items
      (hospital_id, journal_id, account_id, account_code, account_name, debit_amount, credit_amount, description)
    VALUES
      (p_hospital_id, v_journal, v_dep_acct,   v_dep_code,   v_dep_name,   v_monthly, 0, 'Depreciation — ' || COALESCE(a.asset_name, a.asset_code)),
      (p_hospital_id, v_journal, v_accum_acct, v_accum_code, v_accum_name, 0, v_monthly, 'Accumulated depreciation — ' || COALESCE(a.asset_name, a.asset_code));

    -- Age the register.
    UPDATE public.fixed_assets
    SET accumulated_dep    = COALESCE(accumulated_dep, 0) + v_monthly,
        current_book_value = GREATEST(COALESCE(current_book_value, purchase_cost) - v_monthly,
                                      COALESCE(salvage_value, 0)),
        status = CASE
                   WHEN GREATEST(COALESCE(current_book_value, purchase_cost) - v_monthly,
                                 COALESCE(salvage_value, 0)) <= COALESCE(salvage_value, 0)
                   THEN 'fully_depreciated' ELSE status END
    WHERE id = a.id;

    -- Idempotency ledger row.
    INSERT INTO public.depreciation_postings (hospital_id, asset_id, period, dep_amount, journal_id)
    VALUES (p_hospital_id, a.id, v_period, v_monthly, v_journal);

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.run_monthly_depreciation(uuid, date) TO authenticated;

-- ── 3. Monthly pg_cron — depreciate every hospital on the 1st at 01:00 UTC ────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'aumrti-monthly-depreciation',
      '0 1 1 * *',
      $cron_body$
        SELECT public.run_monthly_depreciation(h.id, date_trunc('month', CURRENT_DATE)::date)
        FROM public.hospitals h;
      $cron_body$
    );
    RAISE NOTICE 'Cron job aumrti-monthly-depreciation scheduled.';
  ELSE
    RAISE NOTICE 'pg_cron not available — run public.run_monthly_depreciation per hospital via scheduler or the Fixed Assets "Run depreciation" button.';
  END IF;
END;
$$;
