
-- Lab Test Master
CREATE TABLE public.lab_test_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  test_name text NOT NULL,
  test_code text,
  category text NOT NULL DEFAULT 'biochemistry',
  sample_type text NOT NULL DEFAULT 'blood',
  unit text,
  normal_min numeric(10,3),
  normal_max numeric(10,3),
  critical_low numeric(10,3),
  critical_high numeric(10,3),
  method text,
  tat_minutes integer DEFAULT 60,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Lab Orders
CREATE TABLE public.lab_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  patient_id uuid REFERENCES public.patients(id) NOT NULL,
  encounter_id uuid REFERENCES public.opd_encounters(id),
  admission_id uuid REFERENCES public.admissions(id),
  ordered_by uuid REFERENCES public.users(id) NOT NULL,
  priority text NOT NULL DEFAULT 'routine',
  order_date date NOT NULL DEFAULT CURRENT_DATE,
  order_time timestamptz NOT NULL DEFAULT now(),
  clinical_notes text,
  status text NOT NULL DEFAULT 'ordered',
  created_at timestamptz DEFAULT now()
);

-- Lab Order Items
CREATE TABLE public.lab_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  lab_order_id uuid REFERENCES public.lab_orders(id) NOT NULL,
  test_id uuid REFERENCES public.lab_test_master(id) NOT NULL,
  status text NOT NULL DEFAULT 'ordered',
  sample_barcode text,
  sample_collected_at timestamptz,
  sample_collected_by uuid REFERENCES public.users(id),
  result_value text,
  result_numeric numeric(12,4),
  result_unit text,
  result_flag text,
  reference_range text,
  result_entered_at timestamptz,
  result_entered_by uuid REFERENCES public.users(id),
  validated_at timestamptz,
  validated_by uuid REFERENCES public.users(id),
  previous_value numeric(12,4),
  delta_flag boolean DEFAULT false,
  critical_acknowledged boolean DEFAULT false,
  critical_acknowledged_by uuid REFERENCES public.users(id),
  critical_acknowledged_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- Lab Samples
CREATE TABLE public.lab_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  lab_order_id uuid REFERENCES public.lab_orders(id) NOT NULL,
  barcode text UNIQUE,
  sample_type text NOT NULL,
  collected_at timestamptz,
  collected_by uuid REFERENCES public.users(id),
  received_at timestamptz,
  received_by uuid REFERENCES public.users(id),
  status text NOT NULL DEFAULT 'pending',
  rejection_reason text,
  created_at timestamptz DEFAULT now()
);

-- Add lab_order_item_id to clinical_alerts
ALTER TABLE public.clinical_alerts
  ADD COLUMN IF NOT EXISTS lab_order_item_id uuid REFERENCES public.lab_order_items(id);

-- RLS policies
CREATE POLICY "Users can view own hospital lab_test_master" ON public.lab_test_master FOR SELECT TO authenticated USING (hospital_id = get_user_hospital_id());
CREATE POLICY "Users can manage own hospital lab_test_master" ON public.lab_test_master FOR ALL TO authenticated USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());

CREATE POLICY "Users can view own hospital lab_orders" ON public.lab_orders FOR SELECT TO authenticated USING (hospital_id = get_user_hospital_id());
CREATE POLICY "Users can manage own hospital lab_orders" ON public.lab_orders FOR ALL TO authenticated USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());

CREATE POLICY "Users can view own hospital lab_order_items" ON public.lab_order_items FOR SELECT TO authenticated USING (hospital_id = get_user_hospital_id());
CREATE POLICY "Users can manage own hospital lab_order_items" ON public.lab_order_items FOR ALL TO authenticated USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());

CREATE POLICY "Users can view own hospital lab_samples" ON public.lab_samples FOR SELECT TO authenticated USING (hospital_id = get_user_hospital_id());
CREATE POLICY "Users can manage own hospital lab_samples" ON public.lab_samples FOR ALL TO authenticated USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());

-- Enable realtime for lab tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.lab_orders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.lab_order_items;
