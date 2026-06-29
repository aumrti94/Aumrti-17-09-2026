-- ── Gap 3: Digital Informed Consent — E-Signature Columns + Default Templates ─

-- Add e-signature columns to existing patient_consents table
ALTER TABLE public.patient_consents
  ADD COLUMN IF NOT EXISTS patient_signature   text,
  ADD COLUMN IF NOT EXISTS witness_signature   text,
  ADD COLUMN IF NOT EXISTS signature_hash      text,
  ADD COLUMN IF NOT EXISTS signed_by_user_id   uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS valid_until         timestamptz,
  ADD COLUMN IF NOT EXISTS language            text DEFAULT 'English';

-- Index for quick "does this admission have signed consents?" lookup
CREATE INDEX IF NOT EXISTS idx_patient_consents_admission
  ON public.patient_consents (hospital_id, admission_id, consent_given);

-- Add chemotherapy + dialysis + pcpndt to the allowed consent_type check
-- (existing check only allows a fixed list — extend it via a new check)
ALTER TABLE public.consent_form_templates
  DROP CONSTRAINT IF EXISTS consent_form_templates_consent_type_check;

ALTER TABLE public.consent_form_templates
  ADD CONSTRAINT consent_form_templates_consent_type_check
  CHECK (consent_type IN (
    'treatment','surgical','anaesthesia','transfusion','hiv',
    'lama','dnr','implant','research','photography',
    'chemotherapy','dialysis','pcpndt'
  ));

-- ── Seed default templates for all hospitals that have none ──────────────────
INSERT INTO public.consent_form_templates
  (hospital_id, name, consent_type, content, witness_required, is_active, sort_order)
SELECT
  h.id,
  t.name,
  t.consent_type,
  t.content,
  t.witness_required,
  true,
  t.sort_order
FROM public.hospitals h
CROSS JOIN (VALUES
  (1, 'General Consent for Treatment', 'treatment', false,
   'I, the undersigned, hereby give my consent to the doctors, nurses, and other healthcare personnel at this hospital to examine me and carry out treatment that they consider necessary for my health and wellbeing. I understand that my medical information will be kept confidential within the treating team. I consent to the use of blood products if considered medically necessary. I understand the nature of my condition and the proposed treatment has been explained to me.'),
  (2, 'Consent for Surgical Procedure', 'surgical', true,
   'I hereby consent to the surgical procedure recommended by my treating surgeon. I understand that surgery involves inherent risks including anaesthesia complications, infection, bleeding, organ injury, and unforeseen complications that may require additional procedures. The surgeon has explained the nature of the procedure, expected benefits, alternative treatments, and risks to my satisfaction. I authorise the surgical team to perform such additional procedures as may be found necessary during the operation.'),
  (3, 'Consent for Anaesthesia', 'anaesthesia', true,
   'I consent to the administration of anaesthesia (general, regional, or local as appropriate) as deemed necessary by the anaesthesiologist. I understand the risks associated with anaesthesia including allergic reactions, breathing difficulties, nerve injury, and rare serious complications. I confirm that I have disclosed all my current medications, allergies, and past anaesthesia reactions to my doctor.'),
  (4, 'Consent for Blood Transfusion', 'transfusion', true,
   'I consent to the transfusion of blood and blood products as considered medically necessary by my treating doctor. I understand that blood transfusions carry rare risks including transfusion reactions, infection transmission (including HIV, Hepatitis B, Hepatitis C), and immunological reactions. The risk of these complications has been explained to me. I have been offered the option of autologous blood donation where applicable.'),
  (5, 'Consent for HIV Testing', 'hiv', false,
   'I voluntarily consent to HIV testing as recommended by my doctor. I understand that pre-test counselling has been provided. I understand my right to confidentiality of test results. I understand that results will be shared only with the treating team and as required by law. I have been informed about the implications of a positive result and available support services.'),
  (6, 'Consent for Chemotherapy', 'chemotherapy', true,
   'I consent to the administration of chemotherapy as recommended by my oncologist. I understand that chemotherapy agents are potent drugs that can cause side effects including nausea, vomiting, hair loss, bone marrow suppression, infection risk, organ toxicity, and fertility implications. The specific drugs, schedule, expected benefits, and risks have been explained to me. I understand the need for regular monitoring during treatment.'),
  (7, 'LAMA — Against Medical Advice', 'lama', true,
   'I, the undersigned, hereby request discharge from this hospital against medical advice. I acknowledge that my treating doctor has explained the risks of leaving the hospital at this time, including deterioration of my condition, complications, and in serious cases, risk to life. I release the hospital and its staff from any responsibility for consequences arising from my decision to leave against medical advice.'),
  (8, 'Consent for Photography / Videography', 'photography', false,
   'I consent to photographs, videos, or other recordings being taken of me or my condition for the purpose of medical education, research, or documentation of my treatment. I understand that my identity will be protected wherever possible. I am aware that I may withdraw this consent at any time by informing the treating team.')
) AS t(sort_order, name, consent_type, witness_required, content)
WHERE NOT EXISTS (
  SELECT 1 FROM public.consent_form_templates cf
  WHERE cf.hospital_id = h.id
);
