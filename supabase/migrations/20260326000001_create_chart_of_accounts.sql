-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: create_chart_of_accounts
-- Purpose  : Create the base table for double-entry accounting (chart of accounts).
--            This migration MUST run before 20260327104518 which ALTERs this table
--            to add account_subtype, is_control, opening_balance, description.
-- Idempotent: CREATE TABLE IF NOT EXISTS; RLS DROP IF EXISTS before CREATE.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.chart_of_accounts (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id  uuid        NOT NULL REFERENCES public.hospitals(id),
  code         text        NOT NULL,
  name         text        NOT NULL,
  account_type text        NOT NULL,
  is_system    boolean     NOT NULL DEFAULT false,
  is_active    boolean     NOT NULL DEFAULT true,
  parent_id    uuid        REFERENCES public.chart_of_accounts(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chart_of_accounts_hospital_id_code_key UNIQUE (hospital_id, code)
);

ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chart_of_accounts_select" ON public.chart_of_accounts;
DROP POLICY IF EXISTS "chart_of_accounts_all"    ON public.chart_of_accounts;

CREATE POLICY "chart_of_accounts_select" ON public.chart_of_accounts
  FOR SELECT TO authenticated
  USING (hospital_id = public.get_user_hospital_id());

CREATE POLICY "chart_of_accounts_all" ON public.chart_of_accounts
  FOR ALL TO authenticated
  USING  (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());
