-- A bed vacated by a mid-stay TRANSFER needs the same turnover cleaning a discharge
-- triggers — the patient has left the bed either way. validate_housekeeping_task()'s
-- triggered_by check only allowed 'discharge','manual','schedule','spillage', so a
-- transfer-originated bed_turnover task would have been rejected outright. Widen it.
CREATE OR REPLACE FUNCTION validate_housekeeping_task() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.task_type NOT IN ('bed_turnover','terminal_cleaning','routine_cleaning','spill_management','isolation_protocol','ot_cleaning','toilet_cleaning','other') THEN
    RAISE EXCEPTION 'Invalid task_type: %', NEW.task_type;
  END IF;
  IF NEW.triggered_by NOT IN ('discharge','transfer','manual','schedule','spillage') THEN
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
