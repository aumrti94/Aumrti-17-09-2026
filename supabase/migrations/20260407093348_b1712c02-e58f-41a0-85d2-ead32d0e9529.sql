-- Atomic bill number sequences table
CREATE TABLE IF NOT EXISTS bill_sequences (
  hospital_id UUID NOT NULL REFERENCES hospitals(id),
  prefix TEXT NOT NULL,
  last_number INTEGER NOT NULL DEFAULT 0,
  last_date TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (hospital_id, prefix)
);

ALTER TABLE bill_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own hospital sequences"
  ON bill_sequences FOR ALL USING (
    hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
  );

-- Atomic bill number generator RPC
CREATE OR REPLACE FUNCTION generate_bill_number(
  p_hospital_id UUID,
  p_prefix TEXT DEFAULT 'BILL'
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today TEXT := to_char(NOW() AT TIME ZONE 'Asia/Kolkata', 'YYYYMMDD');
  v_seq INTEGER;
BEGIN
  INSERT INTO bill_sequences (hospital_id, prefix, last_number, last_date)
  VALUES (p_hospital_id, p_prefix, 1, v_today)
  ON CONFLICT (hospital_id, prefix)
  DO UPDATE SET
    last_number = CASE
      WHEN bill_sequences.last_date = v_today THEN bill_sequences.last_number + 1
      ELSE 1
    END,
    last_date = v_today
  RETURNING last_number INTO v_seq;

  RETURN p_prefix || '-' || v_today || '-' || lpad(v_seq::TEXT, 4, '0');
END;
$$;