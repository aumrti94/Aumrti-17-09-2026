
INSERT INTO govt_schemes (hospital_id, scheme_name, scheme_code, scheme_type, is_active)
SELECT h.id, p.name, p.code, p.stype, true
FROM hospitals h
CROSS JOIN (VALUES
  ('Ayushman Bharat PMJAY', 'PMJAY', 'central_govt'),
  ('CGHS', 'CGHS', 'cghs'),
  ('ECHS', 'ECHS', 'echs'),
  ('ESI', 'ESI', 'esi'),
  ('Aarogyasri (Telangana)', 'AAROGYASRI', 'state_scheme'),
  ('MJPJAY (Maharashtra)', 'MJPJAY', 'state_scheme'),
  ('CMCHIS (Tamil Nadu)', 'CMCHIS', 'state_scheme'),
  ('Karunya (Kerala)', 'KARUNYA', 'state_scheme')
) AS p(name, code, stype)
WHERE NOT EXISTS (
  SELECT 1 FROM govt_schemes gs WHERE gs.hospital_id = h.id AND gs.scheme_code = p.code
);
