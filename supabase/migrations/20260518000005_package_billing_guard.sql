-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: package_billing_guard
-- Purpose  : Schema for IPD surgical package billing inclusion guard.
--            1. hospital_packages — hospital-defined IPD/surgical packages
--               (Normal Delivery, TKR, LSCS, Cataract, etc.)
--            2. package_inclusions — services/categories INCLUDED in a package
--               (cannot be billed separately).
--            3. package_extras — services explicitly billable as package extras.
--            4. admissions.package_id — links an IPD admission to its package.
-- Idempotent: Yes — IF NOT EXISTS, CREATE OR REPLACE, ADD COLUMN IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. hospital_packages ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.hospital_packages (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id   uuid        NOT NULL REFERENCES public.hospitals(id),
  package_name  text        NOT NULL,
  package_code  text        NOT NULL,
  specialty     text,
  base_price    numeric(12,2) NOT NULL DEFAULT 0,
  duration_days int         NOT NULL DEFAULT 5,
  description   text,
  is_active     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_hospital_package_code
  ON public.hospital_packages (hospital_id, package_code);

CREATE INDEX IF NOT EXISTS idx_hospital_packages_hospital
  ON public.hospital_packages (hospital_id, is_active);

ALTER TABLE public.hospital_packages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hospital_packages_select" ON public.hospital_packages;
DROP POLICY IF EXISTS "hospital_packages_all"    ON public.hospital_packages;

CREATE POLICY "hospital_packages_select" ON public.hospital_packages
  FOR SELECT TO authenticated USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "hospital_packages_all" ON public.hospital_packages
  FOR ALL TO authenticated
  USING  (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- ── 2. package_inclusions ────────────────────────────────────────────────────
-- One row per included service/category. Match is:
--   • service_id     → exact service in service_master (highest priority)
--   • service_category → any service with that item_type/category
-- At least one of the two must be non-null (enforced by CHECK).

CREATE TABLE IF NOT EXISTS public.package_inclusions (
  id               uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id      uuid  NOT NULL REFERENCES public.hospitals(id),
  package_id       uuid  NOT NULL REFERENCES public.hospital_packages(id) ON DELETE CASCADE,
  service_id       uuid  REFERENCES public.service_master(id),
  service_category text,
  display_name     text  NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT package_inclusions_has_target CHECK (
    service_id IS NOT NULL OR service_category IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_pkg_inclusions_package
  ON public.package_inclusions (package_id);
CREATE INDEX IF NOT EXISTS idx_pkg_inclusions_service
  ON public.package_inclusions (hospital_id, service_id)
  WHERE service_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pkg_inclusions_category
  ON public.package_inclusions (hospital_id, service_category)
  WHERE service_category IS NOT NULL;

ALTER TABLE public.package_inclusions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pkg_inclusions_select" ON public.package_inclusions;
DROP POLICY IF EXISTS "pkg_inclusions_all"    ON public.package_inclusions;

CREATE POLICY "pkg_inclusions_select" ON public.package_inclusions
  FOR SELECT TO authenticated USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "pkg_inclusions_all" ON public.package_inclusions
  FOR ALL TO authenticated
  USING  (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- ── 3. package_extras ────────────────────────────────────────────────────────
-- Services explicitly billable as extras on top of the package price.
-- May have an override extra_rate (null = bill at standard service_master fee).

CREATE TABLE IF NOT EXISTS public.package_extras (
  id               uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id      uuid  NOT NULL REFERENCES public.hospitals(id),
  package_id       uuid  NOT NULL REFERENCES public.hospital_packages(id) ON DELETE CASCADE,
  service_id       uuid  REFERENCES public.service_master(id),
  service_category text,
  display_name     text  NOT NULL,
  extra_rate       numeric(12,2),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT package_extras_has_target CHECK (
    service_id IS NOT NULL OR service_category IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_pkg_extras_package
  ON public.package_extras (package_id);
CREATE INDEX IF NOT EXISTS idx_pkg_extras_service
  ON public.package_extras (hospital_id, service_id)
  WHERE service_id IS NOT NULL;

ALTER TABLE public.package_extras ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pkg_extras_select" ON public.package_extras;
DROP POLICY IF EXISTS "pkg_extras_all"    ON public.package_extras;

CREATE POLICY "pkg_extras_select" ON public.package_extras
  FOR SELECT TO authenticated USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "pkg_extras_all" ON public.package_extras
  FOR ALL TO authenticated
  USING  (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- ── 4. admissions.package_id ─────────────────────────────────────────────────
ALTER TABLE public.admissions
  ADD COLUMN IF NOT EXISTS package_id uuid REFERENCES public.hospital_packages(id);

CREATE INDEX IF NOT EXISTS idx_admissions_package
  ON public.admissions (hospital_id, package_id)
  WHERE package_id IS NOT NULL;
