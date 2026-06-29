DO $seed$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.hospitals WHERE id = '8f3d08b3-8835-42a7-920e-fdf5a78260bc') THEN
    RETURN;
  END IF;
  INSERT INTO radiology_modalities (hospital_id, name, modality_type, is_active, fee)
  VALUES
    ('8f3d08b3-8835-42a7-920e-fdf5a78260bc', 'CT Scan', 'ct', true, 2500),
    ('8f3d08b3-8835-42a7-920e-fdf5a78260bc', 'MRI', 'mri', true, 5000),
    ('8f3d08b3-8835-42a7-920e-fdf5a78260bc', 'DEXA Scan', 'dexa', true, 1500),
    ('8f3d08b3-8835-42a7-920e-fdf5a78260bc', 'Mammography', 'mammography', true, 2000),
    ('8f3d08b3-8835-42a7-920e-fdf5a78260bc', 'Fluoroscopy', 'fluoroscopy', true, 3000)
  ON CONFLICT DO NOTHING;
END $seed$;
