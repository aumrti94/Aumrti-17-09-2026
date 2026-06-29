-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: rls_missing_tables
-- Purpose  : Enable RLS + add hospital-isolation policies on 17 tables that
--            were missing them. DPDP Act 2023 compliance.
-- Idempotent: DROP POLICY IF EXISTS before CREATE POLICY; ENABLE ROW LEVEL
--             SECURITY is a no-op on tables that already have it enabled.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── department_indents ────────────────────────────────────────────────────────
ALTER TABLE public.department_indents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "department_indents_select" ON public.department_indents;
DROP POLICY IF EXISTS "department_indents_all"    ON public.department_indents;
CREATE POLICY "department_indents_select" ON public.department_indents
  FOR SELECT TO authenticated USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "department_indents_all" ON public.department_indents
  FOR ALL TO authenticated
  USING  (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- ── dialyzer_reuse ────────────────────────────────────────────────────────────
ALTER TABLE public.dialyzer_reuse ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dialyzer_reuse_select" ON public.dialyzer_reuse;
DROP POLICY IF EXISTS "dialyzer_reuse_all"    ON public.dialyzer_reuse;
CREATE POLICY "dialyzer_reuse_select" ON public.dialyzer_reuse
  FOR SELECT TO authenticated USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "dialyzer_reuse_all" ON public.dialyzer_reuse
  FOR ALL TO authenticated
  USING  (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- ── duty_roster ───────────────────────────────────────────────────────────────
ALTER TABLE public.duty_roster ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "duty_roster_select" ON public.duty_roster;
DROP POLICY IF EXISTS "duty_roster_all"    ON public.duty_roster;
CREATE POLICY "duty_roster_select" ON public.duty_roster
  FOR SELECT TO authenticated USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "duty_roster_all" ON public.duty_roster
  FOR ALL TO authenticated
  USING  (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- ── grn_ai_log ────────────────────────────────────────────────────────────────
ALTER TABLE public.grn_ai_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "grn_ai_log_select" ON public.grn_ai_log;
DROP POLICY IF EXISTS "grn_ai_log_all"    ON public.grn_ai_log;
CREATE POLICY "grn_ai_log_select" ON public.grn_ai_log
  FOR SELECT TO authenticated USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "grn_ai_log_all" ON public.grn_ai_log
  FOR ALL TO authenticated
  USING  (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- ── grn_items ─────────────────────────────────────────────────────────────────
ALTER TABLE public.grn_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "grn_items_select" ON public.grn_items;
DROP POLICY IF EXISTS "grn_items_all"    ON public.grn_items;
CREATE POLICY "grn_items_select" ON public.grn_items
  FOR SELECT TO authenticated USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "grn_items_all" ON public.grn_items
  FOR ALL TO authenticated
  USING  (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- ── indent_items ──────────────────────────────────────────────────────────────
ALTER TABLE public.indent_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "indent_items_select" ON public.indent_items;
DROP POLICY IF EXISTS "indent_items_all"    ON public.indent_items;
CREATE POLICY "indent_items_select" ON public.indent_items
  FOR SELECT TO authenticated USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "indent_items_all" ON public.indent_items
  FOR ALL TO authenticated
  USING  (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- ── insurance_pre_auth (HIGH RISK) ────────────────────────────────────────────
ALTER TABLE public.insurance_pre_auth ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "insurance_pre_auth_select" ON public.insurance_pre_auth;
DROP POLICY IF EXISTS "insurance_pre_auth_all"    ON public.insurance_pre_auth;
CREATE POLICY "insurance_pre_auth_select" ON public.insurance_pre_auth
  FOR SELECT TO authenticated USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "insurance_pre_auth_all" ON public.insurance_pre_auth
  FOR ALL TO authenticated
  USING  (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- ── inventory_stock ───────────────────────────────────────────────────────────
ALTER TABLE public.inventory_stock ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "inventory_stock_select" ON public.inventory_stock;
DROP POLICY IF EXISTS "inventory_stock_all"    ON public.inventory_stock;
CREATE POLICY "inventory_stock_select" ON public.inventory_stock
  FOR SELECT TO authenticated USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "inventory_stock_all" ON public.inventory_stock
  FOR ALL TO authenticated
  USING  (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- ── leave_balance ─────────────────────────────────────────────────────────────
ALTER TABLE public.leave_balance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "leave_balance_select" ON public.leave_balance;
DROP POLICY IF EXISTS "leave_balance_all"    ON public.leave_balance;
CREATE POLICY "leave_balance_select" ON public.leave_balance
  FOR SELECT TO authenticated USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "leave_balance_all" ON public.leave_balance
  FOR ALL TO authenticated
  USING  (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- ── leave_requests ────────────────────────────────────────────────────────────
ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "leave_requests_select" ON public.leave_requests;
DROP POLICY IF EXISTS "leave_requests_all"    ON public.leave_requests;
CREATE POLICY "leave_requests_select" ON public.leave_requests
  FOR SELECT TO authenticated USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "leave_requests_all" ON public.leave_requests
  FOR ALL TO authenticated
  USING  (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- ── obstetric_records (HIGH RISK — PHI) ──────────────────────────────────────
ALTER TABLE public.obstetric_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "obstetric_records_select" ON public.obstetric_records;
DROP POLICY IF EXISTS "obstetric_records_all"    ON public.obstetric_records;
CREATE POLICY "obstetric_records_select" ON public.obstetric_records
  FOR SELECT TO authenticated USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "obstetric_records_all" ON public.obstetric_records
  FOR ALL TO authenticated
  USING  (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- ── pharmacy_stock_alerts ─────────────────────────────────────────────────────
ALTER TABLE public.pharmacy_stock_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pharmacy_stock_alerts_select" ON public.pharmacy_stock_alerts;
DROP POLICY IF EXISTS "pharmacy_stock_alerts_all"    ON public.pharmacy_stock_alerts;
CREATE POLICY "pharmacy_stock_alerts_select" ON public.pharmacy_stock_alerts
  FOR SELECT TO authenticated USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "pharmacy_stock_alerts_all" ON public.pharmacy_stock_alerts
  FOR ALL TO authenticated
  USING  (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- ── po_items ──────────────────────────────────────────────────────────────────
ALTER TABLE public.po_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "po_items_select" ON public.po_items;
DROP POLICY IF EXISTS "po_items_all"    ON public.po_items;
CREATE POLICY "po_items_select" ON public.po_items
  FOR SELECT TO authenticated USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "po_items_all" ON public.po_items
  FOR ALL TO authenticated
  USING  (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- ── shift_master ──────────────────────────────────────────────────────────────
ALTER TABLE public.shift_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "shift_master_select" ON public.shift_master;
DROP POLICY IF EXISTS "shift_master_all"    ON public.shift_master;
CREATE POLICY "shift_master_select" ON public.shift_master
  FOR SELECT TO authenticated USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "shift_master_all" ON public.shift_master
  FOR ALL TO authenticated
  USING  (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- ── stock_transactions ────────────────────────────────────────────────────────
ALTER TABLE public.stock_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "stock_transactions_select" ON public.stock_transactions;
DROP POLICY IF EXISTS "stock_transactions_all"    ON public.stock_transactions;
CREATE POLICY "stock_transactions_select" ON public.stock_transactions
  FOR SELECT TO authenticated USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "stock_transactions_all" ON public.stock_transactions
  FOR ALL TO authenticated
  USING  (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- ── tpa_config (HIGH RISK) ────────────────────────────────────────────────────
ALTER TABLE public.tpa_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tpa_config_select" ON public.tpa_config;
DROP POLICY IF EXISTS "tpa_config_all"    ON public.tpa_config;
CREATE POLICY "tpa_config_select" ON public.tpa_config
  FOR SELECT TO authenticated USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "tpa_config_all" ON public.tpa_config
  FOR ALL TO authenticated
  USING  (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- ── vendors ───────────────────────────────────────────────────────────────────
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "vendors_select" ON public.vendors;
DROP POLICY IF EXISTS "vendors_all"    ON public.vendors;
CREATE POLICY "vendors_select" ON public.vendors
  FOR SELECT TO authenticated USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "vendors_all" ON public.vendors
  FOR ALL TO authenticated
  USING  (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());
