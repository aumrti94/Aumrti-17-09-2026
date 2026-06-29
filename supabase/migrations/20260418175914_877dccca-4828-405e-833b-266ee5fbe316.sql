-- Allow hospital_id to be NULL for system-wide PMJAY packages visible to all hospitals
ALTER TABLE public.pmjay_packages ALTER COLUMN hospital_id DROP NOT NULL;

-- Update RLS so system packages (hospital_id IS NULL) are visible to everyone
DROP POLICY IF EXISTS "pmjay_packages_select_system" ON public.pmjay_packages;
CREATE POLICY "pmjay_packages_select_system"
ON public.pmjay_packages
FOR SELECT
TO authenticated
USING (hospital_id IS NULL OR hospital_id = (SELECT hospital_id FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1));

-- Seed 20 common PMJAY packages as system packages (hospital_id = NULL)
INSERT INTO public.pmjay_packages (hospital_id, package_code, package_name, specialty, procedure_group, rate_inr, pre_auth_required, max_days, is_active) VALUES
(NULL, 'SE.OP.01', 'Cataract Surgery (Phacoemulsification + IOL)', 'Ophthalmology', 'Eye Surgery', 9000, true, 1, true),
(NULL, 'SR.OR.01', 'Total Knee Replacement (Unilateral)', 'Orthopaedics', 'Joint Replacement', 80000, true, 7, true),
(NULL, 'SR.CA.01', 'CABG (Coronary Artery Bypass Grafting)', 'Cardiothoracic Surgery', 'Cardiac Surgery', 150000, true, 10, true),
(NULL, 'SR.OB.04', 'Normal Delivery', 'Obstetrics', 'Delivery', 9000, false, 3, true),
(NULL, 'SR.OB.07', 'LSCS (Caesarean Section)', 'Obstetrics', 'Delivery', 9000, true, 5, true),
(NULL, 'SR.OR.02', 'Total Hip Replacement (Unilateral)', 'Orthopaedics', 'Joint Replacement', 80000, true, 7, true),
(NULL, 'SR.CA.02', 'PTCA (Angioplasty with Stent)', 'Cardiology', 'Interventional Cardiology', 150000, true, 3, true),
(NULL, 'SR.SG.07', 'Appendicectomy', 'General Surgery', 'GI Surgery', 18000, true, 3, true),
(NULL, 'SR.GE.06', 'Hernia Repair (Inguinal/Umbilical)', 'General Surgery', 'GI Surgery', 18000, true, 3, true),
(NULL, 'MD.NU.01', 'Haemodialysis (per session)', 'Nephrology', 'Dialysis', 1000, false, 1, true),
(NULL, 'MD.ON.01', 'Chemotherapy (per cycle)', 'Medical Oncology', 'Oncology', 15000, true, 1, true),
(NULL, 'SR.SG.01', 'Laparoscopic Cholecystectomy', 'General Surgery', 'GI Surgery', 18000, true, 3, true),
(NULL, 'SR.UR.01', 'TURP (Trans-Urethral Resection of Prostate)', 'Urology', 'Urological Surgery', 27000, true, 4, true),
(NULL, 'SR.EN.01', 'Tonsillectomy', 'ENT', 'ENT Surgery', 9000, true, 2, true),
(NULL, 'MD.GE.01', 'ICU Stay (per day)', 'Critical Care', 'Intensive Care', 9000, false, 1, true),
(NULL, 'SR.OB.10', 'Hysterectomy (Abdominal/Vaginal)', 'Gynaecology', 'Gynae Surgery', 27000, true, 5, true),
(NULL, 'SD.CA.01', 'Coronary Angiography', 'Cardiology', 'Diagnostic Cardiology', 9000, false, 1, true),
(NULL, 'SR.GE.03', 'ERCP (Endoscopic Retrograde Cholangiopancreatography)', 'Gastroenterology', 'GI Endoscopy', 27000, true, 2, true),
(NULL, 'SR.NS.01', 'Spinal Surgery (Laminectomy/Discectomy)', 'Neurosurgery', 'Spine Surgery', 80000, true, 7, true),
(NULL, 'SR.PS.01', 'Burns Management (Major)', 'Plastic Surgery', 'Burns Care', 40000, true, 14, true)
ON CONFLICT DO NOTHING;