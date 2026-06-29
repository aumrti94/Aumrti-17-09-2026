
-- Equipment Master
CREATE TABLE equipment_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  equipment_name text NOT NULL,
  equipment_code text NOT NULL,
  category text NOT NULL,
  make text NOT NULL,
  model text NOT NULL,
  serial_number text,
  department_id uuid REFERENCES departments(id),
  location text,
  purchase_date date,
  purchase_cost numeric(12,2),
  asset_value numeric(12,2),
  supplier_name text,
  warranty_expiry date,
  warranty_vendor text,
  amc_vendor text,
  amc_start date,
  amc_expiry date,
  amc_cost numeric(10,2),
  amc_type text DEFAULT 'comprehensive',
  aerb_license_no text,
  aerb_expiry date,
  nabl_ref text,
  status text DEFAULT 'operational',
  is_active boolean DEFAULT true,
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(hospital_id, equipment_code)
);

CREATE OR REPLACE FUNCTION validate_equipment_master() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.category NOT IN ('diagnostic','therapeutic','monitoring','laboratory','surgical','ot_equipment','it_equipment','utility','radiation','other') THEN
    RAISE EXCEPTION 'Invalid category: %', NEW.category;
  END IF;
  IF NEW.amc_type NOT IN ('comprehensive','non_comprehensive','none') THEN
    RAISE EXCEPTION 'Invalid amc_type: %', NEW.amc_type;
  END IF;
  IF NEW.status NOT IN ('operational','under_maintenance','breakdown','calibration','condemned','disposed') THEN
    RAISE EXCEPTION 'Invalid status: %', NEW.status;
  END IF;
  RETURN NEW;
END;$$;

CREATE TRIGGER trg_validate_equipment_master BEFORE INSERT OR UPDATE ON equipment_master FOR EACH ROW EXECUTE FUNCTION validate_equipment_master();

-- PM Schedules
CREATE TABLE pm_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  equipment_id uuid REFERENCES equipment_master(id) NOT NULL,
  frequency text NOT NULL,
  last_done_at date,
  next_due_at date NOT NULL,
  checklist jsonb DEFAULT '[]',
  status text DEFAULT 'upcoming',
  done_by uuid REFERENCES users(id),
  done_at timestamptz,
  observations text,
  created_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION validate_pm_schedule() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.frequency NOT IN ('weekly','monthly','quarterly','biannual','annual') THEN
    RAISE EXCEPTION 'Invalid frequency: %', NEW.frequency;
  END IF;
  IF NEW.status NOT IN ('upcoming','overdue','done','skipped') THEN
    RAISE EXCEPTION 'Invalid pm status: %', NEW.status;
  END IF;
  RETURN NEW;
END;$$;

CREATE TRIGGER trg_validate_pm_schedule BEFORE INSERT OR UPDATE ON pm_schedules FOR EACH ROW EXECUTE FUNCTION validate_pm_schedule();

-- Breakdown Logs
CREATE TABLE breakdown_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  equipment_id uuid REFERENCES equipment_master(id) NOT NULL,
  reported_at timestamptz DEFAULT now(),
  reported_by uuid REFERENCES users(id) NOT NULL,
  description text NOT NULL,
  severity text DEFAULT 'medium',
  vendor_name text,
  vendor_called_at timestamptz,
  repair_started_at timestamptz,
  repaired_at timestamptz,
  downtime_hrs numeric(6,1),
  repair_cost numeric(10,2),
  parts_replaced text,
  root_cause text,
  status text DEFAULT 'open',
  created_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION validate_breakdown_log() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.severity NOT IN ('low','medium','high','critical') THEN
    RAISE EXCEPTION 'Invalid severity: %', NEW.severity;
  END IF;
  IF NEW.status NOT IN ('open','in_progress','resolved','escalated') THEN
    RAISE EXCEPTION 'Invalid breakdown status: %', NEW.status;
  END IF;
  RETURN NEW;
END;$$;

CREATE TRIGGER trg_validate_breakdown_log BEFORE INSERT OR UPDATE ON breakdown_logs FOR EACH ROW EXECUTE FUNCTION validate_breakdown_log();

-- Calibration Records
CREATE TABLE calibration_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  equipment_id uuid REFERENCES equipment_master(id) NOT NULL,
  calibrated_at date NOT NULL,
  calibrated_by text NOT NULL,
  next_due date NOT NULL,
  certificate_no text,
  certificate_url text,
  result text NOT NULL,
  observations text,
  created_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION validate_calibration_result() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.result NOT IN ('pass','fail','out_of_range','adjusted') THEN
    RAISE EXCEPTION 'Invalid calibration result: %', NEW.result;
  END IF;
  RETURN NEW;
END;$$;

CREATE TRIGGER trg_validate_calibration_result BEFORE INSERT OR UPDATE ON calibration_records FOR EACH ROW EXECUTE FUNCTION validate_calibration_result();

-- AMC Contracts
CREATE TABLE amc_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  equipment_id uuid REFERENCES equipment_master(id) NOT NULL,
  vendor_name text NOT NULL,
  contract_number text,
  start_date date NOT NULL,
  end_date date NOT NULL,
  annual_cost numeric(10,2) NOT NULL,
  coverage_type text DEFAULT 'comprehensive',
  contact_person text,
  contact_phone text,
  terms text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE equipment_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE pm_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE breakdown_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE calibration_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE amc_contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hospital isolation" ON equipment_master FOR ALL USING (hospital_id = (SELECT get_user_hospital_id()));
CREATE POLICY "Hospital isolation" ON pm_schedules FOR ALL USING (hospital_id = (SELECT get_user_hospital_id()));
CREATE POLICY "Hospital isolation" ON breakdown_logs FOR ALL USING (hospital_id = (SELECT get_user_hospital_id()));
CREATE POLICY "Hospital isolation" ON calibration_records FOR ALL USING (hospital_id = (SELECT get_user_hospital_id()));
CREATE POLICY "Hospital isolation" ON amc_contracts FOR ALL USING (hospital_id = (SELECT get_user_hospital_id()));

-- Indexes
CREATE INDEX idx_equipment_hospital ON equipment_master(hospital_id);
CREATE INDEX idx_equipment_status ON equipment_master(hospital_id, status);
CREATE INDEX idx_equipment_dept ON equipment_master(department_id);
CREATE INDEX idx_pm_next_due ON pm_schedules(hospital_id, next_due_at);
CREATE INDEX idx_pm_equipment ON pm_schedules(equipment_id);
CREATE INDEX idx_breakdown_equipment ON breakdown_logs(equipment_id);
CREATE INDEX idx_breakdown_status ON breakdown_logs(hospital_id, status);
CREATE INDEX idx_calibration_next ON calibration_records(hospital_id, next_due);
CREATE INDEX idx_amc_expiry ON amc_contracts(hospital_id, end_date);

-- Seed 15 common equipment
INSERT INTO equipment_master (hospital_id, equipment_name, equipment_code, category, make, model, status)
SELECT h.id, e.name, e.code, e.cat, e.make, e.model, 'operational'
FROM hospitals h
CROSS JOIN (VALUES
  ('Portable X-Ray Unit','EQ-001','radiation','Siemens','MOBILETT Mira'),
  ('Ultrasound Machine','EQ-002','diagnostic','GE Healthcare','LOGIQ E10'),
  ('ECG Machine (12-lead)','EQ-003','diagnostic','BPL Medical','Cardiart 9108'),
  ('Pulse Oximeter','EQ-004','monitoring','Nellcor','PM10N'),
  ('Multi-Parameter Monitor','EQ-005','monitoring','Philips','IntelliVue MX40'),
  ('Infusion Pump','EQ-006','therapeutic','B.Braun','Perfusor Space'),
  ('Ventilator (ICU)','EQ-007','therapeutic','Draeger','Savina 300'),
  ('Defibrillator','EQ-008','therapeutic','Zoll','R Series'),
  ('Autoclave (134C)','EQ-009','surgical','Tuttnauer','3870EL'),
  ('Laparoscopy Set','EQ-010','surgical','Karl Storz','TELE PACK X LED'),
  ('Anaesthesia Workstation','EQ-011','ot_equipment','Draeger','Perseus A500'),
  ('OT Light (LED)','EQ-012','ot_equipment','Trumpf Medical','TruLight 5000'),
  ('Hematology Analyzer','EQ-013','laboratory','Sysmex','XN-1000'),
  ('Biochemistry Analyzer','EQ-014','laboratory','Mindray','BS-240'),
  ('Digital X-Ray System','EQ-015','radiation','Carestream','DRX-1C')
) AS e(name, code, cat, make, model)
WHERE NOT EXISTS (SELECT 1 FROM equipment_master em WHERE em.hospital_id = h.id);
