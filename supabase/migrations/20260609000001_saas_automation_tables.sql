-- ============================================================
-- SaaS Automation Tables: subscription_invoices, subscription_events, enterprise_leads
-- + Storage bucket for invoices
-- + Usage-limit RPCs: check_bed_capacity, check_staff_capacity
-- ============================================================

-- ── 1. Subscription Invoices ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.subscription_invoices (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id           uuid        NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  invoice_number        text        NOT NULL UNIQUE,
  razorpay_payment_id   text,
  razorpay_subscription_id text,
  amount_inr            numeric(12,2) NOT NULL,
  plan_name             text        NOT NULL,
  billing_period_start  date,
  billing_period_end    date,
  pdf_storage_path      text,       -- supabase storage path, null until PDF generated
  status                text        NOT NULL DEFAULT 'paid'
                          CHECK (status IN ('paid', 'failed', 'refunded')),
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sub_invoices_hospital ON public.subscription_invoices(hospital_id);
CREATE INDEX IF NOT EXISTS idx_sub_invoices_created  ON public.subscription_invoices(created_at DESC);

ALTER TABLE public.subscription_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital_own_invoices_select" ON public.subscription_invoices
  FOR SELECT USING (hospital_id = get_user_hospital_id() OR is_aumrti_admin());

CREATE POLICY "service_role_invoices_all" ON public.subscription_invoices
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 2. Subscription Events (audit log) ───────────────────────
CREATE TABLE IF NOT EXISTS public.subscription_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     uuid        NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  event_type      text        NOT NULL,
  old_status      text,
  new_status      text,
  old_plan_id     uuid,
  new_plan_id     uuid,
  razorpay_event  text,
  metadata        jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sub_events_hospital ON public.subscription_events(hospital_id);
CREATE INDEX IF NOT EXISTS idx_sub_events_created  ON public.subscription_events(created_at DESC);

ALTER TABLE public.subscription_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital_own_events_select" ON public.subscription_events
  FOR SELECT USING (hospital_id = get_user_hospital_id() OR is_aumrti_admin());

CREATE POLICY "service_role_events_all" ON public.subscription_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 3. Enterprise Leads ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.enterprise_leads (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_name   text        NOT NULL,
  contact_name    text        NOT NULL,
  email           text        NOT NULL,
  phone           text,
  beds_range      text,       -- e.g. '251_500', '500_plus'
  state           text,
  message         text,
  hospital_id     uuid        REFERENCES public.hospitals(id) ON DELETE SET NULL,
  status          text        NOT NULL DEFAULT 'new'
                    CHECK (status IN ('new', 'contacted', 'demo_scheduled', 'converted', 'lost')),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.enterprise_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_leads_all" ON public.enterprise_leads
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "aumrti_admin_leads_all" ON public.enterprise_leads
  FOR ALL USING (is_aumrti_admin());

-- Allow pre-signup (anon) and logged-in hospital users to insert leads.
-- GRANT must come before the RLS policy — Postgres checks privileges first.
GRANT INSERT ON public.enterprise_leads TO anon;
GRANT INSERT ON public.enterprise_leads TO authenticated;

CREATE POLICY "anon_leads_insert" ON public.enterprise_leads
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "authenticated_leads_insert" ON public.enterprise_leads
  FOR INSERT TO authenticated WITH CHECK (true);

-- ── 4. Storage bucket for PDF invoices ───────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('subscription-invoices', 'subscription-invoices', false, 5242880, ARRAY['application/pdf', 'text/html'])
ON CONFLICT (id) DO NOTHING;

-- Only service_role and hospital owner can read their own invoices
CREATE POLICY "hospital_read_own_invoices" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'subscription-invoices'
    AND (
      (storage.foldername(name))[1] = (get_user_hospital_id())::text
      OR is_aumrti_admin()
    )
  );

CREATE POLICY "service_role_invoice_storage" ON storage.objects
  FOR ALL TO service_role USING (bucket_id = 'subscription-invoices');

-- ── 5. Sequence for invoice numbers ──────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.invoice_number_seq START 1000;

-- ── 6. Usage Limit RPCs ───────────────────────────────────────

-- check_bed_capacity: returns {allowed, current, max, plan_slug}
-- max=0 means unlimited (Enterprise)
CREATE OR REPLACE FUNCTION public.check_bed_capacity(p_hospital_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_beds  int;
  v_current   int;
  v_plan_slug text;
BEGIN
  -- Get the plan's max_beds (NULL or 0 = unlimited)
  SELECT sp.max_beds, sp.slug
    INTO v_max_beds, v_plan_slug
    FROM hospital_subscriptions hs
    JOIN subscription_plans sp ON sp.id = hs.plan_id
   WHERE hs.hospital_id = p_hospital_id
     AND hs.status IN ('trial', 'active')
   LIMIT 1;

  -- Count active beds for this hospital
  SELECT COUNT(*) INTO v_current
    FROM beds
   WHERE hospital_id = p_hospital_id
     AND is_active = true;

  -- No subscription or unlimited plan
  IF v_max_beds IS NULL OR v_max_beds = 0 THEN
    RETURN json_build_object('allowed', true, 'current', v_current, 'max', null, 'plan_slug', v_plan_slug);
  END IF;

  RETURN json_build_object(
    'allowed',    v_current < v_max_beds,
    'current',    v_current,
    'max',        v_max_beds,
    'plan_slug',  v_plan_slug
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_bed_capacity(uuid) TO authenticated;

-- check_staff_capacity: returns {allowed, current, max, plan_slug}
CREATE OR REPLACE FUNCTION public.check_staff_capacity(p_hospital_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_staff int;
  v_current   int;
  v_plan_slug text;
BEGIN
  SELECT sp.max_staff, sp.slug
    INTO v_max_staff, v_plan_slug
    FROM hospital_subscriptions hs
    JOIN subscription_plans sp ON sp.id = hs.plan_id
   WHERE hs.hospital_id = p_hospital_id
     AND hs.status IN ('trial', 'active')
   LIMIT 1;

  SELECT COUNT(*) INTO v_current
    FROM users
   WHERE hospital_id = p_hospital_id
     AND is_active = true;

  IF v_max_staff IS NULL OR v_max_staff = 0 THEN
    RETURN json_build_object('allowed', true, 'current', v_current, 'max', null, 'plan_slug', v_plan_slug);
  END IF;

  RETURN json_build_object(
    'allowed',    v_current < v_max_staff,
    'current',    v_current,
    'max',        v_max_staff,
    'plan_slug',  v_plan_slug
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_staff_capacity(uuid) TO authenticated;

-- ── 7. next_invoice_number helper ────────────────────────────
-- Called by generate-invoice edge function
CREATE OR REPLACE FUNCTION public.next_invoice_number(p_hospital_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year  text := to_char(now(), 'YYYY');
  v_month text := to_char(now(), 'MM');
  v_seq   bigint;
  v_short text;
BEGIN
  v_seq := nextval('public.invoice_number_seq');
  -- Short hospital code: first 4 chars of hospital id (hex)
  v_short := upper(left(replace(p_hospital_id::text, '-', ''), 4));
  RETURN 'INV-' || v_year || '-' || v_month || '-' || v_short || '-' || lpad(v_seq::text, 4, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_invoice_number(uuid) TO service_role;
