
DO $seed$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.hospitals WHERE id = '6ff211e5-46d3-4a95-8714-5b8dbaf5fc2d') THEN
    RETURN;
  END IF;
  INSERT INTO dialysis_machines (hospital_id, machine_name, machine_type, model, status, is_active)
  SELECT
    '6ff211e5-46d3-4a95-8714-5b8dbaf5fc2d',
    name, type, mdl, 'available', true
  FROM (VALUES
    ('Machine 1 (Clean)', 'clean', 'Fresenius 5008S'),
    ('Machine 2 (Clean)', 'clean', 'Fresenius 5008S'),
    ('Machine 3 (Clean)', 'clean', 'Nipro Surdial X'),
    ('Machine 4 (HBV)', 'hbv', 'Fresenius 4008S'),
    ('Machine 5 (HBV)', 'hbv', 'Fresenius 4008S'),
    ('Machine 6 (HCV)', 'hcv', 'Nipro Surdial X'),
    ('Machine 7 (HIV)', 'hiv', 'B.Braun Dialog+'),
    ('Machine 8 (Clean)', 'clean', 'B.Braun Dialog+')
  ) AS t(name, type, mdl)
  WHERE NOT EXISTS (SELECT 1 FROM dialysis_machines WHERE hospital_id = '6ff211e5-46d3-4a95-8714-5b8dbaf5fc2d');
END $seed$;
