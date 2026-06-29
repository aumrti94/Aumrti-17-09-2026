-- Payment Links
CREATE TABLE public.payment_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  bill_id uuid REFERENCES public.bills(id) NOT NULL,
  patient_id uuid REFERENCES public.patients(id) NOT NULL,
  link_token text UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
  amount numeric(10,2) NOT NULL,
  razorpay_link_id text,
  razorpay_link_url text,
  short_url text,
  status text DEFAULT 'active',
  expires_at timestamptz DEFAULT (now() + interval '7 days'),
  paid_at timestamptz,
  sent_via text[],
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz DEFAULT now()
);

-- EMI Plans
CREATE TABLE public.emi_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  bill_id uuid REFERENCES public.bills(id) NOT NULL,
  patient_id uuid REFERENCES public.patients(id) NOT NULL,
  total_amount numeric(10,2) NOT NULL,
  installments integer NOT NULL,
  frequency text NOT NULL,
  first_payment_date date NOT NULL,
  installment_amount numeric(10,2) NOT NULL,
  amount_collected numeric(10,2) DEFAULT 0,
  status text DEFAULT 'active',
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz DEFAULT now()
);

-- EMI Installments
CREATE TABLE public.emi_installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  plan_id uuid REFERENCES public.emi_plans(id) NOT NULL,
  installment_number integer NOT NULL,
  due_date date NOT NULL,
  amount numeric(10,2) NOT NULL,
  status text DEFAULT 'pending',
  paid_at timestamptz,
  payment_id uuid REFERENCES public.bill_payments(id),
  reminder_sent_count integer DEFAULT 0,
  last_reminder_at timestamptz
);

-- Collection Campaigns
CREATE TABLE public.collection_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  campaign_name text NOT NULL,
  filter_criteria jsonb NOT NULL DEFAULT '{}',
  message_template text NOT NULL DEFAULT '',
  total_bills integer DEFAULT 0,
  sent_count integer DEFAULT 0,
  paid_count integer DEFAULT 0,
  amount_recovered numeric(12,2) DEFAULT 0,
  status text DEFAULT 'draft',
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz DEFAULT now()
);

-- Validation triggers
CREATE OR REPLACE FUNCTION public.validate_payment_link_status()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status NOT IN ('active','paid','expired','cancelled') THEN
    RAISE EXCEPTION 'Invalid payment_link status: %', NEW.status;
  END IF;
  RETURN NEW;
END;$$;

CREATE TRIGGER trg_validate_payment_link
  BEFORE INSERT OR UPDATE ON public.payment_links
  FOR EACH ROW EXECUTE FUNCTION public.validate_payment_link_status();

CREATE OR REPLACE FUNCTION public.validate_emi_plan()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.frequency NOT IN ('weekly','fortnightly','monthly') THEN
    RAISE EXCEPTION 'Invalid frequency: %', NEW.frequency;
  END IF;
  IF NEW.status NOT IN ('active','completed','defaulted','cancelled') THEN
    RAISE EXCEPTION 'Invalid emi_plan status: %', NEW.status;
  END IF;
  RETURN NEW;
END;$$;

CREATE TRIGGER trg_validate_emi_plan
  BEFORE INSERT OR UPDATE ON public.emi_plans
  FOR EACH ROW EXECUTE FUNCTION public.validate_emi_plan();

CREATE OR REPLACE FUNCTION public.validate_emi_installment()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status NOT IN ('pending','paid','overdue','waived') THEN
    RAISE EXCEPTION 'Invalid installment status: %', NEW.status;
  END IF;
  RETURN NEW;
END;$$;

CREATE TRIGGER trg_validate_emi_installment
  BEFORE INSERT OR UPDATE ON public.emi_installments
  FOR EACH ROW EXECUTE FUNCTION public.validate_emi_installment();

CREATE OR REPLACE FUNCTION public.validate_collection_campaign()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status NOT IN ('draft','running','completed') THEN
    RAISE EXCEPTION 'Invalid campaign status: %', NEW.status;
  END IF;
  RETURN NEW;
END;$$;

CREATE TRIGGER trg_validate_collection_campaign
  BEFORE INSERT OR UPDATE ON public.collection_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.validate_collection_campaign();

-- RLS
ALTER TABLE public.payment_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emi_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emi_installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hospital isolation" ON public.payment_links FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE POLICY "Hospital isolation" ON public.emi_plans FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE POLICY "Hospital isolation" ON public.emi_installments FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE POLICY "Hospital isolation" ON public.collection_campaigns FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- Indexes
CREATE INDEX idx_payment_links_bill ON public.payment_links(bill_id);
CREATE INDEX idx_payment_links_status ON public.payment_links(status) WHERE status = 'active';
CREATE INDEX idx_emi_plans_bill ON public.emi_plans(bill_id);
CREATE INDEX idx_emi_plans_status ON public.emi_plans(status) WHERE status = 'active';
CREATE INDEX idx_emi_installments_plan ON public.emi_installments(plan_id);
CREATE INDEX idx_emi_installments_due ON public.emi_installments(due_date) WHERE status = 'pending';