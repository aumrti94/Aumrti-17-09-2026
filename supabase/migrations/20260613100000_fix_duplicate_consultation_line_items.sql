-- Idempotent repair: for each bill with more than one consultation line item,
-- keep the oldest row and delete all newer duplicates, then recalculate totals.
DO $$
DECLARE
  r RECORD;
BEGIN
  -- Find all bills that have more than one consultation line item
  FOR r IN
    SELECT bill_id
    FROM bill_line_items
    WHERE item_type = 'consultation'
    GROUP BY bill_id
    HAVING COUNT(*) > 1
  LOOP
    -- Delete all but the oldest consultation line for this bill
    DELETE FROM bill_line_items
    WHERE item_type = 'consultation'
      AND bill_id = r.bill_id
      AND id NOT IN (
        SELECT id
        FROM bill_line_items
        WHERE item_type = 'consultation'
          AND bill_id = r.bill_id
        ORDER BY created_at ASC
        LIMIT 1
      );

    -- Recalculate bill totals from remaining line items
    UPDATE bills b
    SET
      subtotal       = COALESCE(agg.subtotal, 0),
      gst_amount     = COALESCE(agg.gst_amount, 0),
      total_amount   = COALESCE(agg.total_amount, 0),
      patient_payable = COALESCE(agg.total_amount, 0),
      balance_due    = GREATEST(0, COALESCE(agg.total_amount, 0) - COALESCE(b.paid_amount, 0)),
      updated_at     = NOW()
    FROM (
      SELECT
        bill_id,
        SUM(taxable_amount)             AS subtotal,
        SUM(COALESCE(gst_amount, 0))    AS gst_amount,
        SUM(total_amount)               AS total_amount
      FROM bill_line_items
      WHERE bill_id = r.bill_id
      GROUP BY bill_id
    ) agg
    WHERE b.id = agg.bill_id
      AND b.id = r.bill_id;
  END LOOP;
END;
$$;
