-- ============================================================================
-- Unify Service Catalog — Phase 2 (all module-owned price rows)
-- ----------------------------------------------------------------------------
-- Phase 1 (20261008000003) added service_master.source_table/source_id and
-- mirrored ward tariffs into the catalog. Everything else stayed siloed:
--
--   Settings → Services & Fees reads each type from its OWN table —
--   lab_test_master, lab_test_groups, radiology_study_master, health_packages,
--   service_rates — while the Billing line-item picker
--   (src/components/billing/tabs/LineItemsTab.tsx) searches ONLY service_master.
--
-- Net effect today: a lab test, radiology study, health package, IPD bed-day or
-- specialized-module service configured in Settings CANNOT be found when adding
-- a line to a bill. Only consultations/procedures (native service_master rows)
-- and OT/ED fixed charges (written to service_master by the Settings page) are
-- billable that way.
--
-- This phase mirrors the remaining module tables into the catalog with the
-- correct category/item_type, via triggers so the mirror stays correct no matter
-- which module writes the price (Lab module, Radiology module, Settings, seeds).
--
-- Each module table REMAINS the source of truth for its own billing path —
-- lab_orders still price from lab_test_master, wards.rate_per_day still drives
-- IPD bed-day billing (src/lib/ipdBilling.ts). Nothing reads price FROM the
-- mirror except the catalog UI and the billing picker.
--
-- STRICTLY ADDITIVE: no existing column, row, or module price is modified.
-- Idempotent: safe to re-run.
-- ============================================================================

-- ── 1. Shared upsert used by every mirror trigger ───────────────────────────
-- Keyed on the Phase 1 partial unique index (hospital_id, source_table,
-- source_id) WHERE source_id IS NOT NULL, so a source row can never produce
-- two catalog rows.
CREATE OR REPLACE FUNCTION public.upsert_service_catalog_mirror(
  p_hospital_id uuid,
  p_source_table text,
  p_source_id uuid,
  p_name text,
  p_category text,
  p_item_type text,
  p_fee numeric,
  p_is_active boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_hospital_id IS NULL OR p_source_id IS NULL OR p_name IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO service_master (
    hospital_id, name, category, fee, item_type, source_table, source_id, is_active
  ) VALUES (
    p_hospital_id, p_name, p_category, COALESCE(p_fee, 0), p_item_type,
    p_source_table, p_source_id, COALESCE(p_is_active, true)
  )
  ON CONFLICT (hospital_id, source_table, source_id) WHERE source_id IS NOT NULL
  DO UPDATE SET
    name      = EXCLUDED.name,
    category  = EXCLUDED.category,
    fee       = EXCLUDED.fee,
    item_type = EXCLUDED.item_type,
    is_active = EXCLUDED.is_active;
END;
$$;

-- Deactivate rather than delete a mirror whose source row is gone:
-- bill_line_items.service_id references service_master, so a hard delete could
-- fail and, in turn, block the module from deleting its own row.
CREATE OR REPLACE FUNCTION public.deactivate_service_catalog_mirror(
  p_hospital_id uuid,
  p_source_table text,
  p_source_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE service_master SET is_active = false
  WHERE hospital_id = p_hospital_id
    AND source_table = p_source_table
    AND source_id = p_source_id;
END;
$$;

-- ── 2. Per-table trigger functions ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sync_lab_test_to_catalog()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM deactivate_service_catalog_mirror(OLD.hospital_id, 'lab_test_master', OLD.id);
    RETURN OLD;
  END IF;
  PERFORM upsert_service_catalog_mirror(
    NEW.hospital_id, 'lab_test_master', NEW.id,
    NEW.test_name, 'lab', 'lab', NEW.fee, COALESCE(NEW.is_active, true)
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_lab_group_to_catalog()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM deactivate_service_catalog_mirror(OLD.hospital_id, 'lab_test_groups', OLD.id);
    RETURN OLD;
  END IF;
  PERFORM upsert_service_catalog_mirror(
    NEW.hospital_id, 'lab_test_groups', NEW.id,
    NEW.group_name || ' (Panel)', 'lab', 'lab', NEW.fee, COALESCE(NEW.is_active, true)
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_radiology_study_to_catalog()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM deactivate_service_catalog_mirror(OLD.hospital_id, 'radiology_study_master', OLD.id);
    RETURN OLD;
  END IF;
  PERFORM upsert_service_catalog_mirror(
    NEW.hospital_id, 'radiology_study_master', NEW.id,
    NEW.study_name, 'radiology', 'radiology', NEW.fee, COALESCE(NEW.is_active, true)
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_health_package_to_catalog()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM deactivate_service_catalog_mirror(OLD.hospital_id, 'health_packages', OLD.id);
    RETURN OLD;
  END IF;
  PERFORM upsert_service_catalog_mirror(
    NEW.hospital_id, 'health_packages', NEW.id,
    NEW.package_name, 'package', 'package', NEW.price, COALESCE(NEW.is_active, true)
  );
  RETURN NEW;
END;
$$;

-- service_rates holds several unrelated things. Only the Settings → Specialized
-- Services rows (item_type = 'specialized') are catalog services. Payer-specific
-- rows (payer_id NOT NULL) are negotiated tariffs, not catalog entries, and the
-- 'Default Rates' seeds are fallbacks that already duplicate OT/consultation
-- rows living natively in service_master — mirroring either would put duplicates
-- in the billing picker.
CREATE OR REPLACE FUNCTION public.sync_service_rate_to_catalog()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM deactivate_service_catalog_mirror(OLD.hospital_id, 'service_rates', OLD.id);
    RETURN OLD;
  END IF;

  IF NEW.item_type IS DISTINCT FROM 'specialized' OR NEW.payer_id IS NOT NULL THEN
    -- Covers a row that previously qualified and no longer does.
    PERFORM deactivate_service_catalog_mirror(NEW.hospital_id, 'service_rates', NEW.id);
    RETURN NEW;
  END IF;

  PERFORM upsert_service_catalog_mirror(
    NEW.hospital_id, 'service_rates', NEW.id,
    NEW.item_name, 'specialized', NEW.item_code, NEW.default_rate,
    COALESCE(NEW.is_active, true)
  );
  RETURN NEW;
END;
$$;

-- Bed-day GST is rate- and category-dependent (Notification 12/2017 + CBIC ICU
-- clarification), and the billing picker derives GST from item_type alone via
-- getDefaultGSTRate (src/lib/gstRules.ts). Phase 1's 'bed_charge' is not a type
-- that function knows, so it fell through to the picker's legacy coercion and
-- taxed every room charge at 18%. Emit the two types gstRules DOES model:
--   room_charge      → 0%, or 5% above ₹5,000/day
--   room_charge_icu  → 0% regardless of rate (ICU/NICU/PICU carve-out; HDU is
--                      deliberately excluded, matching ICU_EQUIVALENT_BED_CATEGORIES)
CREATE OR REPLACE FUNCTION public.ward_catalog_item_type(p_type text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN lower(COALESCE(p_type, '')) IN ('icu', 'nicu', 'picu')
              THEN 'room_charge_icu' ELSE 'room_charge' END;
$$;

-- Phase 1 mirrored wards from the client only (mirrorWardToCatalog), so a ward
-- created or repriced anywhere else never reached the catalog. Cover it here too.
CREATE OR REPLACE FUNCTION public.sync_ward_to_catalog()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM deactivate_service_catalog_mirror(OLD.hospital_id, 'wards', OLD.id);
    RETURN OLD;
  END IF;
  PERFORM upsert_service_catalog_mirror(
    NEW.hospital_id, 'wards', NEW.id,
    NEW.name || ' (per day)', 'bed', ward_catalog_item_type(NEW.type::text),
    NEW.rate_per_day, COALESCE(NEW.is_active, true)
  );
  RETURN NEW;
END;
$$;

-- ── 3. Triggers ─────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_sync_lab_test_to_catalog ON public.lab_test_master;
CREATE TRIGGER trg_sync_lab_test_to_catalog
  AFTER INSERT OR UPDATE OR DELETE ON public.lab_test_master
  FOR EACH ROW EXECUTE FUNCTION public.sync_lab_test_to_catalog();

DROP TRIGGER IF EXISTS trg_sync_lab_group_to_catalog ON public.lab_test_groups;
CREATE TRIGGER trg_sync_lab_group_to_catalog
  AFTER INSERT OR UPDATE OR DELETE ON public.lab_test_groups
  FOR EACH ROW EXECUTE FUNCTION public.sync_lab_group_to_catalog();

DROP TRIGGER IF EXISTS trg_sync_radiology_study_to_catalog ON public.radiology_study_master;
CREATE TRIGGER trg_sync_radiology_study_to_catalog
  AFTER INSERT OR UPDATE OR DELETE ON public.radiology_study_master
  FOR EACH ROW EXECUTE FUNCTION public.sync_radiology_study_to_catalog();

DROP TRIGGER IF EXISTS trg_sync_health_package_to_catalog ON public.health_packages;
CREATE TRIGGER trg_sync_health_package_to_catalog
  AFTER INSERT OR UPDATE OR DELETE ON public.health_packages
  FOR EACH ROW EXECUTE FUNCTION public.sync_health_package_to_catalog();

DROP TRIGGER IF EXISTS trg_sync_service_rate_to_catalog ON public.service_rates;
CREATE TRIGGER trg_sync_service_rate_to_catalog
  AFTER INSERT OR UPDATE OR DELETE ON public.service_rates
  FOR EACH ROW EXECUTE FUNCTION public.sync_service_rate_to_catalog();

DROP TRIGGER IF EXISTS trg_sync_ward_to_catalog ON public.wards;
CREATE TRIGGER trg_sync_ward_to_catalog
  AFTER INSERT OR UPDATE OR DELETE ON public.wards
  FOR EACH ROW EXECUTE FUNCTION public.sync_ward_to_catalog();

-- ── 4. Backfill everything that already exists ──────────────────────────────
-- Re-uses the same upsert as the triggers, so re-running only refreshes.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT hospital_id, id, test_name, fee, is_active FROM lab_test_master LOOP
    PERFORM upsert_service_catalog_mirror(r.hospital_id, 'lab_test_master', r.id,
      r.test_name, 'lab', 'lab', r.fee, COALESCE(r.is_active, true));
  END LOOP;

  FOR r IN SELECT hospital_id, id, group_name, fee, is_active FROM lab_test_groups LOOP
    PERFORM upsert_service_catalog_mirror(r.hospital_id, 'lab_test_groups', r.id,
      r.group_name || ' (Panel)', 'lab', 'lab', r.fee, COALESCE(r.is_active, true));
  END LOOP;

  FOR r IN SELECT hospital_id, id, study_name, fee, is_active FROM radiology_study_master LOOP
    PERFORM upsert_service_catalog_mirror(r.hospital_id, 'radiology_study_master', r.id,
      r.study_name, 'radiology', 'radiology', r.fee, COALESCE(r.is_active, true));
  END LOOP;

  FOR r IN SELECT hospital_id, id, package_name, price, is_active FROM health_packages LOOP
    PERFORM upsert_service_catalog_mirror(r.hospital_id, 'health_packages', r.id,
      r.package_name, 'package', 'package', r.price, COALESCE(r.is_active, true));
  END LOOP;

  FOR r IN SELECT hospital_id, id, item_name, item_code, default_rate, is_active
           FROM service_rates WHERE item_type = 'specialized' AND payer_id IS NULL LOOP
    PERFORM upsert_service_catalog_mirror(r.hospital_id, 'service_rates', r.id,
      r.item_name, 'specialized', r.item_code, r.default_rate, COALESCE(r.is_active, true));
  END LOOP;

  -- Also repairs Phase 1's existing ward mirrors, which carry item_type
  -- 'bed_charge' and are therefore billed at 18% by the picker today.
  FOR r IN SELECT hospital_id, id, name, type, rate_per_day, is_active FROM wards LOOP
    PERFORM upsert_service_catalog_mirror(r.hospital_id, 'wards', r.id,
      r.name || ' (per day)', 'bed', ward_catalog_item_type(r.type::text),
      r.rate_per_day, COALESCE(r.is_active, true));
  END LOOP;
END $$;
