-- Add instructions column to ipd_medications for dosing notes (e.g. "after meals", "at bedtime")
ALTER TABLE ipd_medications
  ADD COLUMN IF NOT EXISTS instructions text;
