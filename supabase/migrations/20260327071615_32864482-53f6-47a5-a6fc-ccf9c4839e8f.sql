
-- Drug interactions table (static safety database)
CREATE TABLE drug_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drug_a text NOT NULL,
  drug_b text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('contraindicated','major','moderate','minor')),
  mechanism text,
  clinical_effect text,
  recommendation text,
  created_at timestamptz DEFAULT now()
);

-- Drug allergy cross-reactivity table
CREATE TABLE drug_allergy_cross_reactivity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  allergen text NOT NULL,
  cross_reacts text[],
  risk_level text DEFAULT 'high',
  note text
);

-- Enable RLS (read-only for all authenticated)
ALTER TABLE drug_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE drug_allergy_cross_reactivity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read drug_interactions" ON drug_interactions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Anyone can read drug_allergy_cross_reactivity" ON drug_allergy_cross_reactivity FOR SELECT TO authenticated USING (true);

-- Seed drug interactions
INSERT INTO drug_interactions (drug_a, drug_b, severity, mechanism, clinical_effect, recommendation) VALUES
('warfarin','aspirin','contraindicated','Additive anticoagulant + antiplatelet','Severe bleeding risk, GI hemorrhage','Avoid combination. Use paracetamol for pain if needed.'),
('methotrexate','nsaids','contraindicated','NSAIDs reduce renal clearance of methotrexate','Methotrexate toxicity — bone marrow suppression','Avoid NSAIDs. Use paracetamol for pain relief.'),
('ssri','maoi','contraindicated','Serotonin syndrome mechanism','Life-threatening serotonin syndrome','Allow 14-day washout between these drugs.'),
('sildenafil','nitrates','contraindicated','Additive vasodilation','Severe hypotension, cardiovascular collapse','Absolutely contraindicated. Seek alternative.'),
('methotrexate','live_vaccines','contraindicated','Immunosuppression allows vaccine organism to proliferate','Risk of disseminated vaccine infection','Avoid live vaccines during methotrexate therapy.'),
('linezolid','ssri','contraindicated','Linezolid is a weak MAOI','Serotonin syndrome','Avoid combination or allow washout period.'),
('warfarin','ciprofloxacin','major','Ciprofloxacin inhibits warfarin metabolism via CYP1A2','Increased anticoagulation, bleeding risk','Monitor INR closely. Reduce warfarin dose by 30-50%.'),
('digoxin','amiodarone','major','Amiodarone increases digoxin plasma levels','Digoxin toxicity — nausea, arrhythmia','Reduce digoxin dose by 50%. Monitor digoxin levels.'),
('atorvastatin','clarithromycin','major','Clarithromycin inhibits CYP3A4','Rhabdomyolysis risk — muscle breakdown','Switch to azithromycin or temporarily stop statin.'),
('metformin','contrast_dye','major','Contrast causes renal impairment leading to lactic acidosis','Lactic acidosis — life-threatening','Hold metformin 48hrs before/after contrast procedures.'),
('amlodipine','simvastatin','major','Amlodipine inhibits simvastatin metabolism','Increased statin levels, myopathy risk','Limit simvastatin to 20mg or switch to atorvastatin.'),
('lithium','nsaids','major','NSAIDs reduce renal lithium excretion','Lithium toxicity — tremor, confusion, cardiac effects','Avoid NSAIDs. Use paracetamol. Monitor lithium levels.'),
('warfarin','fluconazole','major','Fluconazole inhibits CYP2C9','Significant INR increase, bleeding','Monitor INR daily. Reduce warfarin dose significantly.'),
('methotrexate','trimethoprim','major','Both are folate antagonists','Severe bone marrow suppression','Avoid combination. Choose alternative antibiotic.'),
('clopidogrel','omeprazole','major','Omeprazole inhibits CYP2C19 activation of clopidogrel','Reduced antiplatelet effect, increased cardiac events','Switch to pantoprazole as PPI choice.'),
('tacrolimus','fluconazole','major','Fluconazole inhibits tacrolimus metabolism','Tacrolimus toxicity — nephrotoxicity','Reduce tacrolimus dose. Monitor drug levels.'),
('insulin','beta_blocker','major','Beta-blockers mask hypoglycaemia symptoms','Unrecognised hypoglycaemia, dangerous in diabetics','Educate patient. Monitor glucose. Use cardioselective BB.'),
('warfarin','phenytoin','major','Phenytoin displaces warfarin from plasma proteins','Unpredictable anticoagulation','Monitor INR frequently. Adjust doses carefully.'),
('digoxin','verapamil','major','Verapamil increases digoxin levels and additive AV block','Bradycardia, heart block, digoxin toxicity','Reduce digoxin dose by 50%. Monitor HR and levels.'),
('theophylline','ciprofloxacin','major','Ciprofloxacin inhibits theophylline metabolism','Theophylline toxicity — seizures, arrhythmia','Reduce theophylline dose by 30%. Monitor levels.'),
('potassium','spironolactone','major','Additive potassium retention','Life-threatening hyperkalaemia','Avoid potassium supplements with spironolactone.'),
('paracetamol','warfarin','moderate','Paracetamol potentiates warfarin effect','Increased INR at high paracetamol doses','Limit paracetamol to 2g/day or less. Monitor INR weekly.'),
('ciprofloxacin','antacid','moderate','Antacids reduce ciprofloxacin absorption','Reduced antibiotic efficacy','Separate administration by 2 hours.'),
('metformin','alcohol','moderate','Alcohol increases lactic acidosis risk with metformin','Lactic acidosis risk, especially with binge drinking','Advise patient to avoid alcohol.'),
('amoxicillin','warfarin','moderate','Antibiotics affect gut flora and vitamin K production','Modest INR increase','Monitor INR if course exceeds 7 days.'),
('furosemide','nsaids','moderate','NSAIDs reduce renal prostaglandins, blunting diuretic effect','Reduced diuretic efficacy, oedema','Monitor fluid balance. Avoid NSAIDs if possible.'),
('atenolol','verapamil','moderate','Additive AV node depression','Bradycardia, heart block','Monitor heart rate and ECG. Avoid if HR below 60.'),
('azithromycin','amiodarone','moderate','Additive QT prolongation','QT prolongation, torsades de pointes risk','Avoid in patients with QT above 450ms. Monitor ECG.'),
('tramadol','ssri','moderate','Additive serotonergic effect','Serotonin syndrome risk (milder than MAOIs)','Use lowest effective dose. Monitor for agitation, tremor.'),
('spironolactone','ace_inhibitor','moderate','Additive potassium retention','Hyperkalaemia — cardiac arrhythmia risk','Monitor potassium levels weekly initially.'),
('rifampicin','oral_contraceptive','moderate','Rifampicin induces CYP3A4 — reduces OC efficacy','Contraceptive failure','Add barrier contraception during and 1 month after rifampicin.'),
('ciprofloxacin','theophylline','moderate','CYP1A2 inhibition','Theophylline toxicity risk','Monitor theophylline levels. Consider dose reduction.'),
('metoclopramide','levodopa','moderate','Dopamine antagonism','Reduced levodopa efficacy','Avoid metoclopramide in Parkinson patients. Use domperidone.'),
('phenytoin','folic_acid','moderate','Folic acid may reduce phenytoin levels','Reduced seizure control','Monitor phenytoin levels when starting folic acid.'),
('iron','levothyroxine','moderate','Iron reduces levothyroxine absorption','Hypothyroidism symptoms','Separate by 4 hours.'),
('calcium','levothyroxine','moderate','Calcium reduces levothyroxine absorption','Hypothyroidism symptoms','Separate by 4 hours.'),
('diclofenac','aspirin','moderate','Competitive COX-1 binding','Reduced cardioprotective effect of aspirin','Give aspirin 30min before diclofenac, or avoid combination.');

-- Seed allergy cross-reactivity
INSERT INTO drug_allergy_cross_reactivity (allergen, cross_reacts, risk_level, note) VALUES
('penicillin', ARRAY['amoxicillin','ampicillin','cloxacillin','flucloxacillin','co-amoxiclav','piperacillin','amoxyclav'], 'high', '5-10% cross-reactivity with cephalosporins'),
('sulphonamide', ARRAY['trimethoprim-sulfamethoxazole','sulfasalazine','sulfadiazine','cotrimoxazole'], 'high', 'Cross-reactivity among sulfonamide antibiotics'),
('nsaid', ARRAY['aspirin','ibuprofen','diclofenac','naproxen','indomethacin','ketorolac','piroxicam','mefenamic acid'], 'moderate', 'Cross-reactivity in aspirin-sensitive patients'),
('codeine', ARRAY['tramadol','morphine','oxycodone','fentanyl','pethidine'], 'high', 'Opioid allergy class'),
('cephalosporin', ARRAY['cefixime','ceftriaxone','cefuroxime','cephalexin','cefpodoxime','cefotaxime'], 'high', '1-2% cross-reactivity with penicillins'),
('fluoroquinolone', ARRAY['ciprofloxacin','levofloxacin','ofloxacin','moxifloxacin','norfloxacin'], 'moderate', 'Cross-reactivity within fluoroquinolone class'),
('aminoglycoside', ARRAY['gentamicin','amikacin','tobramycin','streptomycin','neomycin'], 'moderate', 'Cross-reactivity within aminoglycoside class'),
('iodine', ARRAY['povidone-iodine','contrast_dye','amiodarone'], 'moderate', 'Iodine-containing drugs and contrast media'),
('egg', ARRAY['propofol'], 'moderate', 'Propofol contains egg lecithin'),
('latex', ARRAY['banana','avocado','kiwi','chestnut'], 'low', 'Latex-fruit syndrome');
