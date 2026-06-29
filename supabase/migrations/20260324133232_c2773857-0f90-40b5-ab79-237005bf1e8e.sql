
-- Fix search_path on all validation functions
CREATE OR REPLACE FUNCTION public.validate_nabh_compliance_status()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = 'public' AS $$
BEGIN
  IF NEW.compliance_status NOT IN ('compliant','partially_compliant','non_compliant','not_applicable','not_assessed') THEN
    RAISE EXCEPTION 'Invalid compliance_status: %', NEW.compliance_status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_qi_category()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = 'public' AS $$
BEGIN
  IF NEW.category NOT IN ('clinical','operational','patient_safety','infection_control','financial','nabh') THEN
    RAISE EXCEPTION 'Invalid category: %', NEW.category;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_audit_type()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = 'public' AS $$
BEGIN
  IF NEW.audit_type NOT IN ('internal','external','nabh_surveillance','nabh_accreditation','peer','unannounced') THEN
    RAISE EXCEPTION 'Invalid audit_type: %', NEW.audit_type;
  END IF;
  IF NEW.status NOT IN ('scheduled','in_progress','completed','cancelled') THEN
    RAISE EXCEPTION 'Invalid status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_incident()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = 'public' AS $$
BEGIN
  IF NEW.incident_type NOT IN ('fall','medication_error','near_miss','adverse_event','procedure_complication','equipment_failure','infection','complaint','other') THEN
    RAISE EXCEPTION 'Invalid incident_type: %', NEW.incident_type;
  END IF;
  IF NEW.severity NOT IN ('minor','moderate','major','sentinel') THEN
    RAISE EXCEPTION 'Invalid severity: %', NEW.severity;
  END IF;
  IF NEW.status NOT IN ('open','under_review','capa_raised','closed') THEN
    RAISE EXCEPTION 'Invalid status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_capa()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = 'public' AS $$
BEGIN
  IF NEW.trigger_type NOT IN ('incident','audit_finding','complaint','near_miss','nabh_gap','other') THEN
    RAISE EXCEPTION 'Invalid trigger_type: %', NEW.trigger_type;
  END IF;
  IF NEW.status NOT IN ('open','in_progress','completed','verified','closed') THEN
    RAISE EXCEPTION 'Invalid status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;
