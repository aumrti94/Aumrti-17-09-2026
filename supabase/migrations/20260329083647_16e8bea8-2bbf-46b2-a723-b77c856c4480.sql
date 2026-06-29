
-- Housekeeping Tasks
CREATE TABLE housekeeping_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  task_type text NOT NULL,
  ward_id uuid REFERENCES wards(id),
  room_number text,
  bed_id uuid REFERENCES beds(id),
  triggered_by text DEFAULT 'manual',
  trigger_ref_id uuid,
  priority text DEFAULT 'normal',
  assigned_to uuid REFERENCES users(id),
  status text DEFAULT 'pending',
  started_at timestamptz,
  completed_at timestamptz,
  tat_minutes integer,
  quality_score integer,
  checklist jsonb DEFAULT '[]',
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION validate_housekeeping_task() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.task_type NOT IN ('bed_turnover','terminal_cleaning','routine_cleaning','spill_management','isolation_protocol','ot_cleaning','toilet_cleaning','other') THEN
    RAISE EXCEPTION 'Invalid task_type: %', NEW.task_type;
  END IF;
  IF NEW.triggered_by NOT IN ('discharge','manual','schedule','spillage') THEN
    RAISE EXCEPTION 'Invalid triggered_by: %', NEW.triggered_by;
  END IF;
  IF NEW.priority NOT IN ('low','normal','high','urgent') THEN
    RAISE EXCEPTION 'Invalid priority: %', NEW.priority;
  END IF;
  IF NEW.status NOT IN ('pending','assigned','in_progress','completed','verified','cancelled') THEN
    RAISE EXCEPTION 'Invalid status: %', NEW.status;
  END IF;
  RETURN NEW;
END;$$;
CREATE TRIGGER trg_validate_housekeeping_task BEFORE INSERT OR UPDATE ON housekeeping_tasks FOR EACH ROW EXECUTE FUNCTION validate_housekeeping_task();

-- Cleaning Schedules
CREATE TABLE cleaning_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  area_name text NOT NULL,
  area_type text NOT NULL,
  ward_id uuid REFERENCES wards(id),
  frequency text NOT NULL,
  last_done_at timestamptz,
  next_due_at timestamptz,
  assigned_supervisor uuid REFERENCES users(id),
  checklist jsonb DEFAULT '[]',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION validate_cleaning_schedule() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.area_type NOT IN ('ward','ot','icu','emergency','outpatient','toilet','corridor','stairwell','reception','canteen') THEN
    RAISE EXCEPTION 'Invalid area_type: %', NEW.area_type;
  END IF;
  IF NEW.frequency NOT IN ('hourly','every_4hrs','every_shift','daily','weekly','monthly') THEN
    RAISE EXCEPTION 'Invalid frequency: %', NEW.frequency;
  END IF;
  RETURN NEW;
END;$$;
CREATE TRIGGER trg_validate_cleaning_schedule BEFORE INSERT OR UPDATE ON cleaning_schedules FOR EACH ROW EXECUTE FUNCTION validate_cleaning_schedule();

-- BMW Records
CREATE TABLE bmw_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  record_date date NOT NULL DEFAULT current_date,
  ward_id uuid REFERENCES wards(id),
  ward_name text,
  yellow_bag_kg numeric(6,2) DEFAULT 0,
  red_bag_kg numeric(6,2) DEFAULT 0,
  blue_bag_kg numeric(6,2) DEFAULT 0,
  white_bag_kg numeric(6,2) DEFAULT 0,
  black_bag_kg numeric(6,2) DEFAULT 0,
  cytotoxic_kg numeric(6,2) DEFAULT 0,
  total_kg numeric(6,2) DEFAULT 0,
  disposal_agency text,
  cpcb_manifest_no text,
  collected_by uuid REFERENCES users(id),
  verified_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now()
);

-- Linen Records
CREATE TABLE linen_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  record_date date NOT NULL DEFAULT current_date,
  linen_type text NOT NULL,
  ward_id uuid REFERENCES wards(id),
  qty_clean integer DEFAULT 0,
  qty_soiled integer DEFAULT 0,
  qty_sent_laundry integer DEFAULT 0,
  qty_received_back integer DEFAULT 0,
  qty_condemned integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION validate_linen_type() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.linen_type NOT IN ('bed_sheet','pillow_cover','blanket','patient_gown','surgical_drape','curtain','towel') THEN
    RAISE EXCEPTION 'Invalid linen_type: %', NEW.linen_type;
  END IF;
  RETURN NEW;
END;$$;
CREATE TRIGGER trg_validate_linen_type BEFORE INSERT OR UPDATE ON linen_records FOR EACH ROW EXECUTE FUNCTION validate_linen_type();

-- RLS
ALTER TABLE housekeeping_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleaning_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE bmw_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE linen_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hospital isolation" ON housekeeping_tasks FOR ALL USING (hospital_id = (SELECT get_user_hospital_id()));
CREATE POLICY "Hospital isolation" ON cleaning_schedules FOR ALL USING (hospital_id = (SELECT get_user_hospital_id()));
CREATE POLICY "Hospital isolation" ON bmw_records FOR ALL USING (hospital_id = (SELECT get_user_hospital_id()));
CREATE POLICY "Hospital isolation" ON linen_records FOR ALL USING (hospital_id = (SELECT get_user_hospital_id()));

-- Indexes
CREATE INDEX idx_hk_tasks_hospital_status ON housekeeping_tasks(hospital_id, status);
CREATE INDEX idx_hk_tasks_ward ON housekeeping_tasks(ward_id);
CREATE INDEX idx_hk_tasks_assigned ON housekeeping_tasks(assigned_to);
CREATE INDEX idx_cleaning_sched_hospital ON cleaning_schedules(hospital_id, is_active);
CREATE INDEX idx_cleaning_sched_next ON cleaning_schedules(next_due_at);
CREATE INDEX idx_bmw_hospital_date ON bmw_records(hospital_id, record_date);
CREATE INDEX idx_linen_hospital_date ON linen_records(hospital_id, record_date);
