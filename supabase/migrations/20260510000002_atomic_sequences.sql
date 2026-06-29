-- Atomic per-hospital sequence counters
-- Replaces count-based UHID, journal entry, and accession number generation
-- which is prone to duplicates under concurrent requests.

CREATE TABLE IF NOT EXISTS hospital_sequences (
  hospital_id uuid REFERENCES hospitals(id) ON DELETE CASCADE,
  seq_type    text    NOT NULL,  -- 'uhid', 'journal', 'accession'
  last_val    bigint  NOT NULL DEFAULT 0,
  PRIMARY KEY (hospital_id, seq_type)
);

ALTER TABLE hospital_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hospital sequences — service role only"
  ON hospital_sequences FOR ALL
  USING (false) WITH CHECK (false);

-- next_seq: atomic increment, safe under concurrent callers
CREATE OR REPLACE FUNCTION public.next_seq(p_hospital_id uuid, p_type text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v bigint;
BEGIN
  INSERT INTO public.hospital_sequences (hospital_id, seq_type, last_val)
    VALUES (p_hospital_id, p_type, 1)
    ON CONFLICT (hospital_id, seq_type)
    DO UPDATE SET last_val = hospital_sequences.last_val + 1
    RETURNING last_val INTO v;
  RETURN v;
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_seq(uuid, text) TO authenticated;
