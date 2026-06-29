import { supabase } from "@/integrations/supabase/client";

/**
 * Resolve a hospital-specific default rate for a billing item from
 * the `service_rates` table. Falls back to the supplied default if
 * the hospital has not configured a rate for that code yet.
 *
 * Used by modules that need to bill a fixed-fee item (anaesthesia,
 * surgery, dialysis, ward charges, etc.) without hardcoding amounts.
 */
export async function getRate(
  hospitalId: string,
  itemCode: string,
  fallback: number = 0
): Promise<number> {
  if (!hospitalId || !itemCode) return fallback;
  const { data, error } = await (supabase as any)
    .from("service_rates")
    .select("default_rate")
    .eq("hospital_id", hospitalId)
    .eq("item_code", itemCode)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) return fallback;
  const rate = Number(data.default_rate);
  return Number.isFinite(rate) ? rate : fallback;
}

/** Same as getRate but returns rate + GST so callers can compute taxes. */
export async function getRateWithGst(
  hospitalId: string,
  itemCode: string,
  fallbackRate: number = 0,
  fallbackGst: number = 0
): Promise<{ rate: number; gst: number }> {
  if (!hospitalId || !itemCode) return { rate: fallbackRate, gst: fallbackGst };
  const { data, error } = await (supabase as any)
    .from("service_rates")
    .select("default_rate, gst_rate")
    .eq("hospital_id", hospitalId)
    .eq("item_code", itemCode)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) return { rate: fallbackRate, gst: fallbackGst };
  return {
    rate: Number(data.default_rate) || fallbackRate,
    gst: Number(data.gst_rate) || fallbackGst,
  };
}

/** Common item codes used across modules. Keep in sync with the seed list in SettingsServicesPage. */
export const SERVICE_RATE_CODES = {
  CONSULTATION: "consultation",
  ANAESTHESIA_FEE: "anaesthesia_fee",
  SURGERY_FEE: "surgery_fee",
  DIALYSIS_SESSION: "dialysis_session",
  ICU_PER_DAY: "icu_per_day",
  WARD_PER_DAY: "ward_per_day",
  // Specialized-module default rates (Phase 2 — close ₹0 billing leakage)
  PHYSIOTHERAPY_SESSION: "physiotherapy_session",
  AMBULANCE_TRIP: "ambulance_trip",
  HOME_CARE_VISIT: "home_care_visit",
  MENTAL_HEALTH_SESSION: "mental_health_session",
  MORTUARY_CHARGE: "mortuary_charge",
  DIETETICS_CONSULT: "dietetics_consult",
  AYUSH_CONSULT: "ayush_consult",
  CHEMO_PER_MG: "chemo_per_mg",
  BLOOD_UNIT: "blood_unit",
  VACCINATION_ADMIN: "vaccination_admin",
  DENTAL_CONSULT: "dental_consult",
  IVF_CYCLE: "ivf_cycle",
} as const;

/**
 * Maps a serviceModule (autoChargeService) or item_type (postCharge) to its
 * `service_rates` default item_code, so ONE configured rate makes the whole
 * module bill correctly instead of ₹0. Used as a last-resort fallback only.
 */
export const MODULE_RATE_CODE: Record<string, string> = {
  dialysis:       SERVICE_RATE_CODES.DIALYSIS_SESSION,
  physiotherapy:  SERVICE_RATE_CODES.PHYSIOTHERAPY_SESSION,
  physio:         SERVICE_RATE_CODES.PHYSIOTHERAPY_SESSION,
  ambulance:      SERVICE_RATE_CODES.AMBULANCE_TRIP,
  home_care:      SERVICE_RATE_CODES.HOME_CARE_VISIT,
  mental_health:  SERVICE_RATE_CODES.MENTAL_HEALTH_SESSION,
  mortuary:       SERVICE_RATE_CODES.MORTUARY_CHARGE,
  dietetics:      SERVICE_RATE_CODES.DIETETICS_CONSULT,
  ayush:          SERVICE_RATE_CODES.AYUSH_CONSULT,
  oncology:       SERVICE_RATE_CODES.CHEMO_PER_MG,
  blood_bank:     SERVICE_RATE_CODES.BLOOD_UNIT,
  vaccination:    SERVICE_RATE_CODES.VACCINATION_ADMIN,
  dental:         SERVICE_RATE_CODES.DENTAL_CONSULT,
  ivf:            SERVICE_RATE_CODES.IVF_CYCLE,
};

/**
 * Resolve a module's configured default rate from `service_rates`.
 * Returns the fallback when the module has no code or no configured rate.
 */
export async function getModuleDefaultRate(
  hospitalId: string,
  moduleKey: string,
  fallback = 0,
): Promise<{ rate: number; gst: number }> {
  const code = MODULE_RATE_CODE[moduleKey];
  if (!code) return { rate: fallback, gst: 0 };
  return getRateWithGst(hospitalId, code, fallback, 0);
}
