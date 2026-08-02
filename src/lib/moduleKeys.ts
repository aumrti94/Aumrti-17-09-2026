/**
 * Canonical route → module-key map and the derived key list.
 *
 * This is a LEAF module: pure data, zero imports. It was extracted from
 * useSubscriptionConfig so that non-hook modules (moduleRegistry, routeRoles) can consume
 * the canonical keys without pulling in the React/context import chain — which otherwise
 * forms a cycle (HospitalContext → moduleRegistry → useSubscriptionConfig → useHospitalId
 * → HospitalContext). useSubscriptionConfig re-exports these for backward compatibility.
 */
export const ROUTE_TO_MODULE_KEY: Record<string, string> = {
  "/opd":                    "opd",
  "/ipd":                    "ipd",
  "/ipd/day-care":           "day_care",
  "/emergency":              "emergency",
  "/ot":                     "ot",
  "/nursing":                "nursing",
  "/telemedicine":           "telemedicine",
  "/packages":               "health_packages",
  "/lab":                    "lab",
  "/radiology":              "radiology",
  "/blood-bank":             "blood_bank",
  "/cssd":                   "cssd",
  "/pharmacy":               "pharmacy",
  "/pharmacy?mode=retail":   "pharmacy_retail",
  "/billing":                "billing",
  "/billing/closure":        "day_closure",
  "/insurance":              "insurance",
  "/payments":               "payments",
  "/accounts":               "accounts",
  "/assets":                 "assets",
  "/pmjay":                  "pmjay",
  "/hr":                     "hr",
  "/inventory":              "inventory",
  "/quality":                "quality",
  "/nabh/compliance":        "quality",
  "/teleconsult":            "telemedicine",
  "/dialysis":               "dialysis",
  "/oncology":               "oncology",
  "/physio":                 "physio",
  "/mortuary":               "mortuary",
  "/vaccination":            "vaccination",
  "/ambulance":              "ambulance",
  "/home-care":              "home_care",
  "/dental":                 "dental",
  "/ayush":                  "ayush",
  "/ivf":                    "ivf",
  "/specialty/anc":          "obstetric_anc",
  "/specialty/neonatal":     "neonatal",
  "/specialty/anaesthesia":  "anaesthesia",
  "/specialty/ophthalmology":"ophthalmology",
  "/specialty/partograph":   "partograph",
  "/mental-health":          "mental_health",
  "/chronic-disease":        "chronic_disease",
  "/mrd":                    "mrd",
  "/biomedical":             "biomedical",
  "/housekeeping":           "housekeeping",
  "/hmis":                   "hmis",
  "/dietetics":              "dietetics",
  "/lms":                    "lms",
  "/crm":                    "crm",
  "/abdm":                   "abdm",
  "/portal":                 "patient_portal",
  "/pro":                    "patient_relations",
  "/inbox":                  "inbox",
  "/ipc/dashboard":            "ipc",
  "/fms/dashboard":            "fms",
  "/ai/clinical-intelligence": "ai_clinical",
  "/research":                 "research",
  "/analytics":              "analytics",
  "/hod-dashboard":          "hod_dashboard",
  "/ceo-board":              "analytics",
  "/tv-display":             "tv_display",
  "/settings":               "settings",
  // ── Module-specific Settings sub-pages ──────────────────────────────────────
  // Gated by their module (same as the module itself). Longest-prefix matching means
  // these win over "/settings", while every other "/settings/*" page falls back to
  // "settings" (ALWAYS_ENABLED) and stays usable on every plan. Cards remain visible;
  // the central ModuleGate shows "Module Not Enabled" on click when the plan lacks it.
  "/settings/services":          "billing",
  "/settings/bank-accounts":     "accounts",
  "/settings/payer-masters":     "insurance",
  "/settings/lab-tests":         "lab",
  "/settings/drugs":             "pharmacy",
  "/settings/ot-checklist":      "ot",
  "/settings/radiology":         "radiology",
  "/settings/day-care-procedures":"day_care",
  "/settings/discharge-workflow":"ipd",
  "/settings/opd-workflow":      "opd",
  "/settings/razorpay":          "payments",
  "/settings/hmis-portal":       "hmis",
  "/settings/abdm":              "abdm",
  "/settings/gst":               "billing",
  "/settings/inventory":         "inventory",
  "/settings/tv-display":        "tv_display",
};

export const CANONICAL_MODULE_KEYS: string[] = [
  ...new Set(Object.values(ROUTE_TO_MODULE_KEY)),
  // Pseudo-module: the "AI Features" master switch. Not a route (never gated by
  // ModuleGate, never rendered in the normal module grid — it has no MODULE_CATEGORY),
  // but tracked here so it resolves through plan→hospital like any module and so
  // isModuleKeyAllowed treats it as a real gate. Default ON (fail-open).
  "ai_suite",
];
