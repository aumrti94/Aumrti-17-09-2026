DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'wards' AND column_name = 'rate_per_day'
  ) THEN
    UPDATE bill_line_items bli
    SET unit_rate = w.rate_per_day,
        taxable_amount = w.rate_per_day * bli.quantity,
        total_amount = (w.rate_per_day * bli.quantity) +
                       ROUND((w.rate_per_day * bli.quantity) * (COALESCE(bli.gst_percent, 0) / 100.0), 2)
    FROM bills b, admissions a, wards w
    WHERE bli.bill_id = b.id
      AND b.admission_id = a.id
      AND a.ward_id = w.id
      AND bli.item_type = 'room_charge'
      AND b.bill_status = 'draft'
      AND w.rate_per_day > 0
      AND bli.unit_rate = 500;
  END IF;
END $$;
