-- Inventory Items
CREATE TABLE IF NOT EXISTS public.inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  item_code text,
  item_name text NOT NULL,
  category text DEFAULT 'consumable',
  uom text DEFAULT 'nos',
  hsn_code text,
  gst_percent numeric(5,2) DEFAULT 12,
  reorder_level integer DEFAULT 10,
  max_stock_level integer DEFAULT 100,
  minimum_order_qty integer DEFAULT 1,
  abc_class text,
  ved_class text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Inventory Stock
CREATE TABLE IF NOT EXISTS public.inventory_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  item_id uuid REFERENCES public.inventory_items(id) NOT NULL,
  batch_number text,
  expiry_date date,
  quantity_available integer NOT NULL DEFAULT 0,
  quantity_reserved integer DEFAULT 0,
  cost_price numeric(12,2),
  mrp numeric(12,2),
  location text,
  last_received_date date,
  UNIQUE(hospital_id, item_id, batch_number)
);

-- Vendors
CREATE TABLE IF NOT EXISTS public.vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  vendor_name text NOT NULL,
  vendor_code text,
  gstin text,
  address text,
  contact_name text,
  contact_phone text,
  contact_email text,
  category text[],
  credit_days integer DEFAULT 30,
  performance_score integer DEFAULT 100,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Purchase Orders
CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  po_number text UNIQUE NOT NULL,
  vendor_id uuid REFERENCES public.vendors(id) NOT NULL,
  po_date date DEFAULT CURRENT_DATE,
  expected_delivery date,
  status text DEFAULT 'draft',
  total_amount numeric(12,2) DEFAULT 0,
  gst_amount numeric(12,2) DEFAULT 0,
  net_amount numeric(12,2) DEFAULT 0,
  notes text,
  created_by uuid REFERENCES public.users(id),
  approved_by uuid REFERENCES public.users(id),
  created_at timestamptz DEFAULT now()
);

-- PO Items
CREATE TABLE IF NOT EXISTS public.po_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  po_id uuid REFERENCES public.purchase_orders(id) NOT NULL,
  item_id uuid REFERENCES public.inventory_items(id) NOT NULL,
  quantity_ordered integer NOT NULL,
  quantity_received integer DEFAULT 0,
  unit_rate numeric(12,2) NOT NULL,
  gst_percent numeric(5,2) DEFAULT 12,
  total_amount numeric(12,2) NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- GRN Records
CREATE TABLE IF NOT EXISTS public.grn_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  grn_number text UNIQUE NOT NULL,
  po_id uuid REFERENCES public.purchase_orders(id),
  vendor_id uuid REFERENCES public.vendors(id) NOT NULL,
  grn_date date DEFAULT CURRENT_DATE,
  invoice_number text,
  invoice_date date,
  total_amount numeric(12,2) DEFAULT 0,
  quality_check text DEFAULT 'pass',
  received_by uuid REFERENCES public.users(id),
  created_at timestamptz DEFAULT now()
);

-- GRN Items
CREATE TABLE IF NOT EXISTS public.grn_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  grn_id uuid REFERENCES public.grn_records(id) NOT NULL,
  item_id uuid REFERENCES public.inventory_items(id) NOT NULL,
  po_item_id uuid REFERENCES public.po_items(id),
  batch_number text,
  expiry_date date,
  quantity_received integer NOT NULL,
  unit_rate numeric(12,2) NOT NULL,
  total_amount numeric(12,2) NOT NULL
);

-- Department Indents
CREATE TABLE IF NOT EXISTS public.department_indents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  indent_number text UNIQUE NOT NULL,
  department_id uuid REFERENCES public.departments(id) NOT NULL,
  requested_by uuid REFERENCES public.users(id) NOT NULL,
  required_date date,
  status text DEFAULT 'pending',
  notes text,
  approved_by uuid REFERENCES public.users(id),
  approved_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Indent Items
CREATE TABLE IF NOT EXISTS public.indent_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  indent_id uuid REFERENCES public.department_indents(id) NOT NULL,
  item_id uuid REFERENCES public.inventory_items(id) NOT NULL,
  quantity_requested integer NOT NULL,
  quantity_issued integer DEFAULT 0,
  remarks text
);

-- Stock Transactions
CREATE TABLE IF NOT EXISTS public.stock_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  item_id uuid REFERENCES public.inventory_items(id) NOT NULL,
  transaction_type text NOT NULL,
  quantity integer NOT NULL,
  unit_rate numeric(12,2),
  reference_id uuid,
  reference_type text,
  department_id uuid REFERENCES public.departments(id),
  notes text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz DEFAULT now()
);

-- RLS for all tables
DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'inventory_items','inventory_stock','vendors','purchase_orders',
    'po_items','grn_records','grn_items','department_indents',
    'indent_items','stock_transactions'
  ]) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = tbl AND policyname = 'Users can view own hospital ' || tbl) THEN
      EXECUTE format('CREATE POLICY "Users can view own hospital %s" ON public.%I FOR SELECT TO authenticated USING (hospital_id = get_user_hospital_id())', tbl, tbl);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = tbl AND policyname = 'Users can manage own hospital ' || tbl) THEN
      EXECUTE format('CREATE POLICY "Users can manage own hospital %s" ON public.%I FOR ALL TO authenticated USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id())', tbl, tbl);
    END IF;
  END LOOP;
END $$;

-- Seed inventory items
INSERT INTO public.inventory_items (hospital_id, item_name, category, uom, reorder_level, max_stock_level, hsn_code, gst_percent, abc_class, ved_class)
SELECT h.id, i.name, i.cat, i.uom, i.reorder::int, i.mx::int, i.hsn, i.gst::numeric,
  CASE WHEN i.cat = 'surgical' THEN 'A' WHEN i.cat IN ('consumable','medical_gas') THEN 'B' ELSE 'C' END,
  CASE WHEN i.cat = 'surgical' THEN 'V' WHEN i.cat IN ('consumable','medical_gas') THEN 'E' ELSE 'D' END
FROM public.hospitals h
CROSS JOIN (VALUES
  ('Surgical Gloves (Sterile) S','surgical','pair','50','500','4015','12'),
  ('Surgical Gloves (Sterile) M','surgical','pair','50','500','4015','12'),
  ('Surgical Gloves (Sterile) L','surgical','pair','50','500','4015','12'),
  ('Examination Gloves (Non-sterile)','consumable','box','20','200','4015','12'),
  ('Surgical Mask (3-ply)','consumable','box','30','300','6307','12'),
  ('N95 Respirator Mask','consumable','nos','50','500','6307','12'),
  ('IV Cannula 18G','surgical','nos','100','1000','9018','12'),
  ('IV Cannula 20G','surgical','nos','100','1000','9018','12'),
  ('IV Cannula 22G','surgical','nos','50','500','9018','12'),
  ('Infusion Set (Blood)','surgical','nos','50','500','9018','12'),
  ('Infusion Set (Fluid)','surgical','nos','100','1000','9018','12'),
  ('Disposable Syringe 2ml','surgical','nos','100','1000','9018','12'),
  ('Disposable Syringe 5ml','surgical','nos','100','1000','9018','12'),
  ('Disposable Syringe 10ml','surgical','nos','100','1000','9018','12'),
  ('Disposable Syringe 20ml','surgical','nos','50','500','9018','12'),
  ('Urine Collection Bag (2L)','surgical','nos','30','300','9018','12'),
  ('Foley Catheter 14Fr','surgical','nos','20','200','9018','12'),
  ('Foley Catheter 16Fr','surgical','nos','20','200','9018','12'),
  ('Ryles Tube (Nasogastric)','surgical','nos','10','100','9018','12'),
  ('Cotton Bandage 4 inch','consumable','roll','50','500','5101','12'),
  ('Crepe Bandage 4 inch','consumable','roll','30','300','6307','12'),
  ('Sterile Gauze Piece','surgical','nos','100','1000','5407','12'),
  ('Betadine Solution 500ml','consumable','bottle','20','200','3004','12'),
  ('Spirit / IPA 500ml','consumable','bottle','20','200','2207','18'),
  ('Bed Sheet (White)','linen','nos','20','200','6302','5'),
  ('Pillow Cover','linen','nos','20','200','6302','5'),
  ('Patient Gown','linen','nos','10','100','6211','5'),
  ('Oxygen Cylinder (D type)','medical_gas','nos','5','50','7311','18'),
  ('HLD Solution (Cidex)','consumable','litre','10','100','3808','18'),
  ('Bio-Medical Waste Bag Yellow','consumable','bundle','10','100','3923','18')
) AS i(name, cat, uom, reorder, mx, hsn, gst)
WHERE NOT EXISTS (SELECT 1 FROM public.inventory_items ii WHERE ii.hospital_id = h.id LIMIT 1);

-- Seed opening stock
INSERT INTO public.inventory_stock (hospital_id, item_id, quantity_available, cost_price)
SELECT ii.hospital_id, ii.id, ii.max_stock_level / 2, 
  CASE 
    WHEN ii.category = 'surgical' THEN 25.00
    WHEN ii.category = 'consumable' THEN 15.00
    WHEN ii.category = 'linen' THEN 150.00
    WHEN ii.category = 'medical_gas' THEN 800.00
    ELSE 10.00
  END
FROM public.inventory_items ii
WHERE NOT EXISTS (SELECT 1 FROM public.inventory_stock ist WHERE ist.item_id = ii.id LIMIT 1);