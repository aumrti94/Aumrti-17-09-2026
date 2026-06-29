import { supabase } from "@/integrations/supabase/client";

export interface ActivePackage {
  id: string;
  package_name: string;
  package_code: string;
  specialty: string | null;
  base_price: number;
}

export interface PackageInclusion {
  id: string;
  service_id: string | null;
  service_category: string | null;
  display_name: string;
}

export interface PackageExtra {
  id: string;
  service_id: string | null;
  service_category: string | null;
  display_name: string;
  extra_rate: number | null;
}

export interface PackageContext {
  package: ActivePackage;
  inclusions: PackageInclusion[];
  extras: PackageExtra[];
}

export type ServicePackageStatus =
  | { status: "no_package" }
  | { status: "allowed" }
  | { status: "included"; label: string }
  | { status: "extra"; label: string; rate: number | null };

/**
 * Fetch the active hospital_package for an admission, with all inclusions and extras.
 * Returns null when no package is linked (self-pay or non-package admission).
 * For day care admissions, filters hospital_packages by care_type = 'day_care'.
 */
export async function fetchPackageContext(
  admissionId: string,
): Promise<PackageContext | null> {
  const { data: adm } = await (supabase as any)
    .from("admissions")
    .select("package_id, admission_type")
    .eq("id", admissionId)
    .maybeSingle();

  if (!adm?.package_id) return null;

  const careType = adm.admission_type === "daycare" ? "day_care" : "inpatient";

  const [pkgRes, inclRes, extRes] = await Promise.all([
    (supabase as any)
      .from("hospital_packages")
      .select("id, package_name, package_code, specialty, base_price")
      .eq("id", adm.package_id)
      .eq("care_type", careType)
      .maybeSingle(),
    (supabase as any)
      .from("package_inclusions")
      .select("id, service_id, service_category, display_name")
      .eq("package_id", adm.package_id),
    (supabase as any)
      .from("package_extras")
      .select("id, service_id, service_category, display_name, extra_rate")
      .eq("package_id", adm.package_id),
  ]);

  if (!pkgRes.data) return null;

  return {
    package:    pkgRes.data as ActivePackage,
    inclusions: inclRes.data || [],
    extras:     extRes.data || [],
  };
}

/**
 * Check a single service against a pre-fetched PackageContext.
 * Call fetchPackageContext() once and reuse ctx for every service check.
 */
export function checkServiceAgainstPackage(
  ctx: PackageContext | null,
  serviceId: string | null,
  serviceCategory: string | null,
): ServicePackageStatus {
  if (!ctx) return { status: "no_package" };

  // Check inclusions — service_id match takes priority over category match
  for (const inc of ctx.inclusions) {
    if (serviceId && inc.service_id === serviceId) {
      return { status: "included", label: inc.display_name };
    }
    if (serviceCategory && inc.service_category === serviceCategory) {
      return { status: "included", label: inc.display_name };
    }
  }

  // Check extras
  for (const ext of ctx.extras) {
    if (serviceId && ext.service_id === serviceId) {
      return { status: "extra", label: ext.display_name, rate: ext.extra_rate };
    }
    if (serviceCategory && ext.service_category === serviceCategory) {
      return { status: "extra", label: ext.display_name, rate: ext.extra_rate };
    }
  }

  return { status: "allowed" };
}
