-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: budget_actuals
-- Purpose  : Populate budget_lines.actual_amount from the general ledger so the
--            generated `variance` column (budgeted − actual) is meaningful.
--            Previously actual_amount stayed at its DEFAULT 0 forever — nothing
--            ever wrote it, so every budget showed 100% "savings".
--
--   • refresh_budget_actuals(hospital, fiscal_year) — for each budget line, sum
--     the matching account_code's net movement over the line's period.
--   • Nightly pg_cron refreshes the current fiscal year for every hospital.
--
-- fiscal_year is 'YYYY-YY' (Indian FY: 1 Apr YYYY → 31 Mar YYYY+1).
-- budget_lines.period_month is a calendar month 1-12 (NULL = whole-year line).
-- Idempotent: CREATE OR REPLACE; the UPDATE is naturally re-runnable.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.refresh_budget_actuals(
  p_hospital_id uuid,
  p_fiscal_year text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_start_year int := split_part(p_fiscal_year, '-', 1)::int;
  v_fy_start   date := make_date(v_start_year, 4, 1);
  v_fy_end     date := make_date(v_start_year + 1, 3, 31);
  b            record;
  v_from       date;
  v_to         date;
  v_actual     numeric(14,2);
  v_updated    int := 0;
BEGIN
  FOR b IN
    SELECT * FROM public.budget_lines
    WHERE hospital_id = p_hospital_id AND fiscal_year = p_fiscal_year
  LOOP
    IF b.period_month IS NULL THEN
      v_from := v_fy_start;
      v_to   := v_fy_end;
    ELSE
      -- Apr–Dec belong to the FY start year; Jan–Mar to the next calendar year.
      IF b.period_month >= 4 THEN
        v_from := make_date(v_start_year, b.period_month, 1);
      ELSE
        v_from := make_date(v_start_year + 1, b.period_month, 1);
      END IF;
      v_to := (v_from + INTERVAL '1 month' - INTERVAL '1 day')::date;
    END IF;

    -- Net movement in the account's natural direction: expenses/assets are
    -- debit-normal, revenue/liability/equity are credit-normal.
    SELECT COALESCE(SUM(
             CASE WHEN coa.account_type IN ('expense', 'asset')
                  THEN li.debit_amount - li.credit_amount
                  ELSE li.credit_amount - li.debit_amount END), 0)
      INTO v_actual
    FROM public.journal_line_items li
    JOIN public.journal_entries je ON je.id = li.journal_id
    LEFT JOIN public.chart_of_accounts coa
      ON coa.hospital_id = li.hospital_id AND coa.code = li.account_code
    WHERE li.hospital_id  = p_hospital_id
      AND li.account_code = b.account_code
      AND je.entry_date BETWEEN v_from AND v_to;

    UPDATE public.budget_lines SET actual_amount = v_actual WHERE id = b.id;
    v_updated := v_updated + 1;
  END LOOP;

  RETURN v_updated;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_budget_actuals(uuid, text) TO authenticated;

-- ── Nightly pg_cron — refresh current FY actuals for every hospital ───────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'aumrti-nightly-budget-actuals',
      '15 1 * * *',
      $cron_body$
        SELECT public.refresh_budget_actuals(
          h.id,
          CASE WHEN extract(month FROM CURRENT_DATE) >= 4
               THEN extract(year FROM CURRENT_DATE)::int::text
                    || '-' || lpad(((extract(year FROM CURRENT_DATE)::int + 1) % 100)::text, 2, '0')
               ELSE (extract(year FROM CURRENT_DATE)::int - 1)::text
                    || '-' || lpad((extract(year FROM CURRENT_DATE)::int % 100)::text, 2, '0')
          END
        )
        FROM public.hospitals h;
      $cron_body$
    );
    RAISE NOTICE 'Cron job aumrti-nightly-budget-actuals scheduled.';
  ELSE
    RAISE NOTICE 'pg_cron not available — call public.refresh_budget_actuals per hospital via scheduler or the Budget "Refresh actuals" button.';
  END IF;
END;
$$;
