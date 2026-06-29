-- ============================================================
-- BLOOD BANK: TTI TEST WORKFLOW + ISBT 128 TRACKING
-- ============================================================

-- TTI (Transfusion Transmitted Infection) tests per blood unit
-- Mandatory under NBTC (National Blood Transfusion Council) guidelines
CREATE TABLE IF NOT EXISTS blood_unit_tti_tests (
  id              uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  hospital_id     uuid    NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  unit_id         uuid    NOT NULL REFERENCES blood_units(id) ON DELETE CASCADE,

  -- Mandatory TTI panel
  hiv_1_2         text    NOT NULL DEFAULT 'pending',  -- pending | negative | positive | invalid
  hbsag           text    NOT NULL DEFAULT 'pending',  -- Hepatitis B Surface Antigen
  hcv             text    NOT NULL DEFAULT 'pending',  -- Hepatitis C
  malaria         text    NOT NULL DEFAULT 'pending',  -- Malaria (P.falciparum / P.vivax)
  vdrl_rpr        text    NOT NULL DEFAULT 'pending',  -- Syphilis (VDRL / RPR)

  -- Optional / extended
  htlv            text,                                -- HTLV I/II (for endemic areas)
  west_nile       text,                                -- West Nile Virus

  -- Testing method
  test_method     text    NOT NULL DEFAULT 'elisa',   -- elisa | nat | rapid | serology
  tested_by       uuid    REFERENCES users(id),
  tested_at       timestamptz,

  -- Overall result derived from individual tests
  overall_result  text    NOT NULL DEFAULT 'pending', -- pending | passed | reactive | invalid
  quarantine_reason text,                              -- filled if reactive / invalid
  released_at     timestamptz,                         -- when unit cleared for issue
  released_by     uuid    REFERENCES users(id),

  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE (unit_id)
);

ALTER TABLE blood_unit_tti_tests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "blood_tti_hospital" ON blood_unit_tti_tests
  FOR ALL USING (hospital_id = get_user_hospital_id());

CREATE INDEX IF NOT EXISTS blood_tti_unit_idx     ON blood_unit_tti_tests (unit_id);
CREATE INDEX IF NOT EXISTS blood_tti_hospital_idx ON blood_unit_tti_tests (hospital_id);
CREATE INDEX IF NOT EXISTS blood_tti_result_idx   ON blood_unit_tti_tests (overall_result);

-- Antibody screening (pre-transfusion compatibility testing)
CREATE TABLE IF NOT EXISTS blood_antibody_screening (
  id              uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  hospital_id     uuid    NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  patient_id      uuid    REFERENCES patients(id) ON DELETE SET NULL,
  unit_id         uuid    REFERENCES blood_units(id) ON DELETE SET NULL,

  screen_result   text    NOT NULL DEFAULT 'negative', -- negative | positive | inconclusive
  antibody_identified text,                             -- e.g. "Anti-D", "Anti-K"
  tested_by       uuid    REFERENCES users(id),
  tested_at       timestamptz DEFAULT now(),
  notes           text,

  created_at      timestamptz DEFAULT now()
);

ALTER TABLE blood_antibody_screening ENABLE ROW LEVEL SECURITY;
CREATE POLICY "blood_antibody_hospital" ON blood_antibody_screening
  FOR ALL USING (hospital_id = get_user_hospital_id());

-- Transfusion reaction reports (haemovigilance)
CREATE TABLE IF NOT EXISTS transfusion_reactions (
  id               uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  hospital_id      uuid    NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  patient_id       uuid    REFERENCES patients(id) ON DELETE SET NULL,
  unit_id          uuid    REFERENCES blood_units(id) ON DELETE SET NULL,
  issue_id         uuid    REFERENCES blood_issues(id) ON DELETE SET NULL,

  reaction_type    text    NOT NULL, -- febrile | allergic | haemolytic | anaphylactic | taco | trali | other
  severity         text    NOT NULL DEFAULT 'mild', -- mild | moderate | severe | fatal
  onset_minutes    int,              -- minutes after transfusion start
  symptoms         text,
  action_taken     text,
  outcome          text,             -- recovered | recovered_with_sequelae | death

  reported_by      uuid    REFERENCES users(id),
  reported_at      timestamptz DEFAULT now(),

  -- Haemovigilance: notified to NBTC?
  nbtc_reported    boolean NOT NULL DEFAULT false,
  nbtc_reference   text,

  created_at       timestamptz DEFAULT now()
);

ALTER TABLE transfusion_reactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "transfusion_reactions_hospital" ON transfusion_reactions
  FOR ALL USING (hospital_id = get_user_hospital_id());

-- ISBT 128 barcode tracking per unit
-- (ISBT 128 is the international standard; unit_number maps to the ISBT-format code)
ALTER TABLE blood_units
  ADD COLUMN IF NOT EXISTS isbt_product_code    text,    -- ISBT 128 product code (e.g. E0781)
  ADD COLUMN IF NOT EXISTS isbt_donation_id     text,    -- 13-char ISBT donation identification number
  ADD COLUMN IF NOT EXISTS isbt_facility_code   text,    -- 5-char blood centre facility ID
  ADD COLUMN IF NOT EXISTS expiry_date          date,    -- unit expiry (component-dependent)
  ADD COLUMN IF NOT EXISTS tti_status           text NOT NULL DEFAULT 'pending',
    -- pending | passed | reactive
  ADD COLUMN IF NOT EXISTS volume_ml            int,     -- component volume
  ADD COLUMN IF NOT EXISTS processing_date      date;
