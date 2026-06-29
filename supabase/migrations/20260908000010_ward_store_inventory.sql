-- Store Locations: named sub-stores (Central, Ward, OT, ICU, Pharmacy, Lab)
CREATE TABLE IF NOT EXISTS store_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID REFERENCES hospitals(id) NOT NULL,
  name TEXT NOT NULL,
  type TEXT CHECK (type IN ('central','ward','ot','icu','pharmacy','lab')),
  ward_id UUID REFERENCES wards(id),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_store_locations_hospital ON store_locations(hospital_id);

ALTER TABLE store_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hospital_isolation" ON store_locations
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());

-- Store Indents: ward/unit request to a supplying store
CREATE TABLE IF NOT EXISTS store_indents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID REFERENCES hospitals(id) NOT NULL,
  indent_number TEXT,
  from_store_id UUID REFERENCES store_locations(id),
  to_store_id UUID REFERENCES store_locations(id),
  requested_by UUID REFERENCES users(id),
  requested_at TIMESTAMPTZ DEFAULT now(),
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  received_by UUID REFERENCES users(id),
  received_at TIMESTAMPTZ,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','partially_issued','issued','received','rejected','cancelled')),
  remarks TEXT
);

CREATE INDEX IF NOT EXISTS idx_store_indents_hospital ON store_indents(hospital_id);
CREATE INDEX IF NOT EXISTS idx_store_indents_from_store ON store_indents(from_store_id);
CREATE INDEX IF NOT EXISTS idx_store_indents_to_store ON store_indents(to_store_id);
CREATE INDEX IF NOT EXISTS idx_store_indents_status ON store_indents(status);

ALTER TABLE store_indents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hospital_isolation" ON store_indents
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());

-- Store Indent Items: line items per indent
CREATE TABLE IF NOT EXISTS store_indent_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  indent_id UUID REFERENCES store_indents(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  item_code TEXT,
  requested_qty NUMERIC(10,2) NOT NULL,
  approved_qty NUMERIC(10,2),
  issued_qty NUMERIC(10,2),
  returned_qty NUMERIC(10,2) DEFAULT 0,
  unit TEXT,
  remarks TEXT,
  return_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_store_indent_items_indent ON store_indent_items(indent_id);

ALTER TABLE store_indent_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hospital_isolation" ON store_indent_items
  USING (
    EXISTS (
      SELECT 1 FROM store_indents si
      WHERE si.id = store_indent_items.indent_id
        AND si.hospital_id = get_user_hospital_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM store_indents si
      WHERE si.id = store_indent_items.indent_id
        AND si.hospital_id = get_user_hospital_id()
    )
  );

-- Store Stock Movements: ledger for sub-store stock movements
CREATE TABLE IF NOT EXISTS store_stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID REFERENCES hospitals(id) NOT NULL,
  store_id UUID REFERENCES store_locations(id),
  indent_id UUID REFERENCES store_indents(id),
  item_name TEXT NOT NULL,
  item_code TEXT,
  movement_type TEXT CHECK (movement_type IN ('issue','return','adjustment','receipt')),
  quantity NUMERIC(10,2) NOT NULL,
  unit TEXT,
  moved_at TIMESTAMPTZ DEFAULT now(),
  moved_by UUID REFERENCES users(id),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_store_movements_store ON store_stock_movements(store_id);
CREATE INDEX IF NOT EXISTS idx_store_movements_hospital ON store_stock_movements(hospital_id);
CREATE INDEX IF NOT EXISTS idx_store_movements_moved_at ON store_stock_movements(moved_at);

ALTER TABLE store_stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hospital_isolation" ON store_stock_movements
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());

-- Auto-generate indent numbers via sequence
CREATE SEQUENCE IF NOT EXISTS store_indent_seq START 1000;

CREATE OR REPLACE FUNCTION generate_indent_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.indent_number IS NULL THEN
    NEW.indent_number := 'IND-' || to_char(now(), 'YYYYMM') || '-' || LPAD(nextval('store_indent_seq')::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_indent_number ON store_indents;
CREATE TRIGGER trg_indent_number
  BEFORE INSERT ON store_indents
  FOR EACH ROW EXECUTE FUNCTION generate_indent_number();
