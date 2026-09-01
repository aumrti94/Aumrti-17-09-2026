// ─── Configurable Dropdown Defaults ───────────────────────────────────────────
// Hardcoded system defaults for every category managed at /settings/config-values.
//
// Why this file exists: hospital_config_values is the only source of dropdown
// options, and useConfigValues() used to have no fallback — an unseeded category
// rendered an empty dropdown with no error to explain why (see the comment in
// 20261008000144_daycare_cancel_reschedule.sql). Seeding lives in SQL, so any
// environment where the migration did not land showed empty clinical dropdowns.
// These defaults sit UNDERNEATH the database: a DB row always wins, and a value
// only falls back to this file when no row exists for it.
//
// Kept in sync with supabase/migrations/20261103000001_config_value_defaults.sql —
// configValueDefaults.test.ts fails the build if the two drift.
//
// lab_test_categories / sample_types are derived from labTestCatalog.ts rather
// than restated here: that file is the generator source for the lab seed and is
// already CI-checked (npm run check:lab-catalog), so restating its vocabulary
// would create a third copy that can drift.

import { LAB_TEST_CATEGORIES, LAB_SAMPLE_TYPES } from "@/lib/labTestCatalog";

export interface ConfigValueDefault {
  value:      string;
  label:      string;
  sort_order: number;
}

// Sort orders at or above this mark are compatibility entries: values a module
// was already writing before it was wired to this system. They are kept
// selectable so nothing already saved becomes unreadable, and sorted last so the
// canonical value is the one a user reaches for first.
const COMPAT = 200;

export const CONFIG_VALUE_DEFAULTS: Record<string, ConfigValueDefault[]> = {
  // ── Clinical ───────────────────────────────────────────────────────────────
  admission_types: [
    { value: "elective",  label: "Elective",    sort_order: 10 },
    { value: "emergency", label: "Emergency",   sort_order: 20 },
    { value: "transfer",  label: "Transfer In", sort_order: 30 },
    { value: "daycare",   label: "Day Care",    sort_order: 40 },
    { value: "trauma",    label: "Trauma",      sort_order: 50 },
  ],

  // Values match the allergy_records.allergen_type CHECK constraint, widened by
  // the companion migration. Anything added here must be added there too.
  allergy_types: [
    { value: "drug",          label: "Drug",           sort_order: 10 },
    { value: "food",          label: "Food",           sort_order: 20 },
    { value: "environmental", label: "Environmental",  sort_order: 30 },
    { value: "latex",         label: "Latex",          sort_order: 40 },
    { value: "contrast",      label: "Contrast / Dye", sort_order: 50 },
    { value: "insect",        label: "Insect Sting",   sort_order: 60 },
    { value: "pollen",        label: "Pollen / Dust",  sort_order: 70 },
    { value: "animal_dander", label: "Animal Dander",  sort_order: 80 },
    { value: "other",         label: "Other",          sort_order: 99 },
  ],

  insurance_types: [
    { value: "self_pay",     label: "Self Pay",          sort_order: 10 },
    { value: "insurance",    label: "Private Insurance", sort_order: 20 },
    { value: "pmjay",        label: "PMJAY / Ayushman",  sort_order: 30 },
    { value: "cghs",         label: "CGHS",              sort_order: 40 },
    { value: "echs",         label: "ECHS",              sort_order: 50 },
    { value: "esi",          label: "ESI / ESIS",        sort_order: 60 },
    { value: "corporate",    label: "Corporate / TPA",   sort_order: 70 },
    { value: "state_scheme", label: "State Scheme",      sort_order: 80 },
    { value: "other",        label: "Other",             sort_order: 90 },
  ],

  drug_routes: [
    { value: "Oral",        label: "Oral (PO)",           sort_order: 10 },
    { value: "IV",          label: "Intravenous (IV)",    sort_order: 20 },
    { value: "IM",          label: "Intramuscular (IM)",  sort_order: 30 },
    { value: "SC",          label: "Subcutaneous (SC)",   sort_order: 40 },
    { value: "Topical",     label: "Topical",             sort_order: 50 },
    { value: "Inhaled",     label: "Inhaled",             sort_order: 60 },
    { value: "Sublingual",  label: "Sublingual (SL)",     sort_order: 70 },
    { value: "Rectal",      label: "Rectal (PR)",         sort_order: 80 },
    { value: "Nasal",       label: "Nasal",               sort_order: 90 },
    { value: "Ophthalmic",  label: "Ophthalmic",          sort_order: 100 },
    { value: "Otic",        label: "Otic (Ear)",          sort_order: 110 },
    { value: "Transdermal", label: "Transdermal",         sort_order: 120 },
    // Med Reconciliation wrote "Inhalation" before it was wired to this list.
    { value: "Inhalation",  label: "Inhalation",          sort_order: COMPAT + 10 },
  ],

  drug_frequencies: [
    { value: "OD",     label: "OD – Once Daily",         sort_order: 10 },
    { value: "BD",     label: "BD – Twice Daily",        sort_order: 20 },
    { value: "TDS",    label: "TDS – Three Times Daily", sort_order: 30 },
    { value: "QID",    label: "QID – Four Times Daily",  sort_order: 40 },
    { value: "Q4H",    label: "Q4H – Every 4 Hours",     sort_order: 50 },
    { value: "Q6H",    label: "Q6H – Every 6 Hours",     sort_order: 60 },
    { value: "Q8H",    label: "Q8H – Every 8 Hours",     sort_order: 70 },
    { value: "Q12H",   label: "Q12H – Every 12 Hours",   sort_order: 80 },
    { value: "SOS",    label: "SOS – As Needed",         sort_order: 90 },
    { value: "STAT",   label: "STAT – Immediately",      sort_order: 100 },
    { value: "HS",     label: "HS – At Bedtime",         sort_order: 110 },
    { value: "AC",     label: "AC – Before Meals",       sort_order: 120 },
    { value: "PC",     label: "PC – After Meals",        sort_order: 130 },
    // Med Reconciliation offered "Weekly" before it was wired to this list.
    { value: "Weekly", label: "Weekly",                  sort_order: COMPAT + 10 },
  ],

  dialysis_complications: [
    { value: "hypotension",       label: "Hypotension",       sort_order: 10 },
    { value: "cramps",            label: "Muscle Cramps",     sort_order: 20 },
    { value: "nausea_vomiting",   label: "Nausea / Vomiting", sort_order: 30 },
    { value: "headache",          label: "Headache",          sort_order: 40 },
    { value: "chest_pain",        label: "Chest Pain",        sort_order: 50 },
    { value: "arrhythmia",        label: "Arrhythmia",        sort_order: 60 },
    { value: "dialyzer_reaction", label: "Dialyzer Reaction", sort_order: 70 },
    { value: "air_embolism",      label: "Air Embolism",      sort_order: 80 },
    { value: "other",             label: "Other",             sort_order: 99 },
  ],

  death_manner_types: [
    { value: "natural",      label: "Natural",      sort_order: 10 },
    { value: "accident",     label: "Accidental",   sort_order: 20 },
    { value: "suicide",      label: "Suicide",      sort_order: 30 },
    { value: "homicide",     label: "Homicide",     sort_order: 40 },
    { value: "undetermined", label: "Undetermined", sort_order: 50 },
  ],

  record_requester_types: [
    { value: "patient",         label: "Patient (Self)",       sort_order: 10 },
    { value: "legal_guardian",  label: "Legal Guardian",       sort_order: 20 },
    { value: "lawyer",          label: "Advocate / Lawyer",    sort_order: 30 },
    { value: "insurance",       label: "Insurance / TPA",      sort_order: 40 },
    { value: "police",          label: "Police",               sort_order: 50 },
    { value: "court",           label: "Court Order",          sort_order: 60 },
    { value: "government",      label: "Government Authority", sort_order: 70 },
    { value: "treating_doctor", label: "Treating Doctor",      sort_order: 80 },
    { value: "employer",        label: "Employer",             sort_order: 90 },
    { value: "research",        label: "Research / Academic",  sort_order: 100 },
  ],

  home_care_services: [
    { value: "wound_dressing",    label: "Wound Dressing",           sort_order: 10 },
    { value: "iv_therapy",        label: "IV / Infusion Therapy",    sort_order: 20 },
    { value: "physiotherapy",     label: "Physiotherapy",            sort_order: 30 },
    { value: "nursing_care",      label: "General Nursing Care",     sort_order: 40 },
    { value: "doctor_visit",      label: "Doctor Home Visit",        sort_order: 50 },
    { value: "sample_collection", label: "Sample Collection",        sort_order: 60 },
    { value: "catheter_care",     label: "Catheter Care",            sort_order: 70 },
    { value: "icu_at_home",       label: "ICU at Home",              sort_order: 80 },
    { value: "newborn_care",      label: "Newborn / Neonatal Care",  sort_order: 90 },
    { value: "palliative",        label: "Palliative / End-of-Life", sort_order: 100 },
    { value: "other",             label: "Other",                    sort_order: 110 },
    // Home Care plans and the IPD handoff panel stored these display strings
    // directly before they were wired to this list.
    { value: "Wound dressing",           label: "Wound dressing",           sort_order: COMPAT + 10 },
    { value: "IV antibiotics",           label: "IV antibiotics",           sort_order: COMPAT + 20 },
    { value: "Physiotherapy",            label: "Physiotherapy",            sort_order: COMPAT + 30 },
    { value: "Vitals monitoring",        label: "Vitals monitoring",        sort_order: COMPAT + 40 },
    { value: "Medication administration",label: "Medication administration",sort_order: COMPAT + 50 },
    { value: "Catheter care",            label: "Catheter care",            sort_order: COMPAT + 60 },
    { value: "Nasogastric tube care",    label: "Nasogastric tube care",    sort_order: COMPAT + 70 },
    { value: "Oxygen therapy",           label: "Oxygen therapy",           sort_order: COMPAT + 80 },
    { value: "Blood sugar monitoring",   label: "Blood sugar monitoring",   sort_order: COMPAT + 90 },
    { value: "Palliative care",          label: "Palliative care",          sort_order: COMPAT + 100 },
  ],

  physio_modalities: [
    { value: "UST",          label: "Ultrasound Therapy (UST)",     sort_order: 10 },
    { value: "IFT",          label: "Interferential Therapy (IFT)", sort_order: 20 },
    { value: "TENS",         label: "TENS",                         sort_order: 30 },
    { value: "SWD",          label: "Short Wave Diathermy (SWD)",   sort_order: 40 },
    { value: "Laser",        label: "Low Level Laser Therapy",      sort_order: 50 },
    { value: "Hot_Pack",     label: "Hot Pack / Fomentation",       sort_order: 60 },
    { value: "Cold_Pack",    label: "Cold Pack / Ice",              sort_order: 70 },
    { value: "Wax_Bath",     label: "Wax Bath (Paraffin)",          sort_order: 80 },
    { value: "Traction",     label: "Traction",                     sort_order: 90 },
    { value: "Exercise",     label: "Therapeutic Exercise",         sort_order: 100 },
    { value: "Hydrotherapy", label: "Hydrotherapy",                 sort_order: 110 },
    { value: "Other",        label: "Other",                        sort_order: 99 },
    // The Physio page offered these before it was wired to this list. The three
    // spaced variants duplicate the underscore values above — kept so sessions
    // already recorded against them still resolve.
    { value: "Manual Therapy",   label: "Manual Therapy",   sort_order: COMPAT + 10 },
    { value: "Balance Training", label: "Balance Training", sort_order: COMPAT + 20 },
    { value: "Hot Pack",         label: "Hot Pack",         sort_order: COMPAT + 30 },
    { value: "Cold Pack",        label: "Cold Pack",        sort_order: COMPAT + 40 },
    { value: "Wax Bath",         label: "Wax Bath",         sort_order: COMPAT + 50 },
  ],

  // ── HR & Payroll ───────────────────────────────────────────────────────────
  leave_types: [
    { value: "casual",       label: "Casual Leave (CL)",              sort_order: 10 },
    { value: "sick",         label: "Sick Leave (SL)",                sort_order: 20 },
    { value: "earned",       label: "Earned / Privilege Leave",       sort_order: 30 },
    { value: "maternity",    label: "Maternity Leave",                sort_order: 40 },
    { value: "paternity",    label: "Paternity Leave",                sort_order: 50 },
    { value: "compensatory", label: "Compensatory Off",               sort_order: 60 },
    { value: "unpaid",       label: "Unpaid Leave (LWP)",             sort_order: 70 },
    { value: "study",        label: "Study / Training Leave",         sort_order: 80 },
    { value: "emergency",    label: "Emergency Leave",                sort_order: 90 },
    { value: "bereavement",  label: "Bereavement Leave",              sort_order: 100 },
    { value: "optional",     label: "Optional / Restricted Holiday",  sort_order: 110 },
  ],

  attendance_statuses: [
    { value: "present",  label: "Present",               sort_order: 10 },
    { value: "absent",   label: "Absent",                sort_order: 20 },
    { value: "half_day", label: "Half Day",              sort_order: 30 },
    { value: "late",     label: "Late Arrival",          sort_order: 40 },
    { value: "on_leave", label: "On Approved Leave",     sort_order: 50 },
    { value: "holiday",  label: "Public Holiday",        sort_order: 60 },
    { value: "wfh",      label: "Work From Home",        sort_order: 70 },
    { value: "on_duty",  label: "On Duty / Deputation",  sort_order: 80 },
  ],

  // ── Finance & Insurance ────────────────────────────────────────────────────
  tpa_companies: [
    { value: "star_health",    label: "Star Health",          sort_order: 10 },
    { value: "new_india",      label: "New India Assurance",  sort_order: 20 },
    { value: "national",       label: "National Insurance",   sort_order: 30 },
    { value: "united_india",   label: "United India",         sort_order: 40 },
    { value: "hdfc_ergo",      label: "HDFC Ergo",            sort_order: 50 },
    { value: "care_health",    label: "Care Health",          sort_order: 60 },
    { value: "bajaj_allianz",  label: "Bajaj Allianz",        sort_order: 70 },
    { value: "niva_bupa",      label: "Niva Bupa",            sort_order: 80 },
    { value: "religare",       label: "Religare Health",      sort_order: 90 },
    { value: "sbi_health",     label: "SBI Health",           sort_order: 100 },
    { value: "icici_lombard",  label: "ICICI Lombard",        sort_order: 110 },
    { value: "aditya_birla",   label: "Aditya Birla Health",  sort_order: 120 },
    { value: "manipal_cigna",  label: "ManipalCigna",         sort_order: 130 },
    { value: "iffco_tokio",    label: "Iffco Tokio",          sort_order: 140 },
    { value: "royal_sundaram", label: "Royal Sundaram",       sort_order: 150 },
    { value: "oriental",       label: "Oriental Insurance",   sort_order: 160 },
    { value: "cholamandalam",  label: "Cholamandalam MS",     sort_order: 170 },
    { value: "tata_aig",       label: "Tata AIG",             sort_order: 180 },
  ],

  government_schemes: [
    { value: "pmjay",        label: "PMJAY / Ayushman Bharat",     sort_order: 10 },
    { value: "cghs",         label: "CGHS – Central Govt.",        sort_order: 20 },
    { value: "echs",         label: "ECHS – Ex-Servicemen",        sort_order: 30 },
    { value: "esi",          label: "ESI / ESIS",                  sort_order: 40 },
    { value: "arogyasri",    label: "Arogyasri (Telangana)",       sort_order: 50 },
    { value: "mgnregs",      label: "MGNREGS Rashtriya",           sort_order: 60 },
    { value: "state_scheme", label: "State Health Scheme (Other)", sort_order: 70 },
  ],

  claim_denial_categories: [
    { value: "documentation_missing",  label: "Documentation Missing",    sort_order: 10 },
    { value: "clinical_not_justified", label: "Not Clinically Justified", sort_order: 20 },
    { value: "policy_exclusion",       label: "Policy Exclusion",         sort_order: 30 },
    { value: "duplicate_claim",        label: "Duplicate Claim",          sort_order: 40 },
    { value: "technical_error",        label: "Technical / Coding Error", sort_order: 50 },
    { value: "rate_dispute",           label: "Rate / Package Dispute",   sort_order: 60 },
    { value: "pre_auth_missing",       label: "Pre-Auth Not Obtained",    sort_order: 70 },
    { value: "other",                  label: "Other",                    sort_order: 99 },
  ],

  claim_rejection_codes: [
    { value: "not_medically_necessary", label: "Not Medically Necessary", sort_order: 10 },
    { value: "policy_exclusion",        label: "Policy Exclusion",        sort_order: 20 },
    { value: "pre_auth_not_obtained",   label: "Pre-Auth Not Obtained",   sort_order: 30 },
    { value: "incorrect_icd_code",      label: "Incorrect ICD Code",      sort_order: 40 },
    { value: "document_deficiency",     label: "Document Deficiency",     sort_order: 50 },
    { value: "duplicate_claim",         label: "Duplicate Claim",         sort_order: 60 },
    { value: "rate_mismatch",           label: "Rate / Package Mismatch", sort_order: 70 },
    { value: "other",                   label: "Other",                   sort_order: 99 },
  ],

  // ── Diagnostics ────────────────────────────────────────────────────────────
  // Derived, not restated — labTestCatalog.ts is the CI-guarded source of truth
  // for the lab vocabulary and already matches the lab_test_catalog_v2 seed.
  lab_test_categories: LAB_TEST_CATEGORIES.map((c, i) => ({
    value: c, label: c, sort_order: (i + 1) * 10,
  })),
  sample_types: LAB_SAMPLE_TYPES.map((s, i) => ({
    value: s, label: s, sort_order: (i + 1) * 10,
  })),

  // ── Operations ─────────────────────────────────────────────────────────────
  housekeeping_task_types: [
    { value: "bed_turnover",       label: "Bed Turnover",       sort_order: 10 },
    { value: "terminal_cleaning",  label: "Terminal Cleaning",  sort_order: 20 },
    { value: "routine_cleaning",   label: "Routine Cleaning",   sort_order: 30 },
    { value: "spill_management",   label: "Spill Management",   sort_order: 40 },
    { value: "isolation_protocol", label: "Isolation Protocol", sort_order: 50 },
    { value: "ot_cleaning",        label: "OT Cleaning",        sort_order: 60 },
    { value: "toilet_cleaning",    label: "Toilet Cleaning",    sort_order: 70 },
    { value: "linen_change",       label: "Linen Change",       sort_order: 80 },
    { value: "other",              label: "Other",              sort_order: 99 },
  ],

  housekeeping_area_types: [
    { value: "ward",       label: "General Ward",         sort_order: 10 },
    { value: "ot",         label: "Operation Theatre",    sort_order: 20 },
    { value: "icu",        label: "ICU / HDU",            sort_order: 30 },
    { value: "emergency",  label: "Emergency / Casualty", sort_order: 40 },
    { value: "outpatient", label: "OPD / Outpatient",     sort_order: 50 },
    { value: "toilet",     label: "Toilet / Washroom",    sort_order: 60 },
    { value: "corridor",   label: "Corridor",             sort_order: 70 },
    { value: "stairwell",  label: "Stairwell",            sort_order: 80 },
    { value: "reception",  label: "Reception / Lobby",    sort_order: 90 },
    { value: "canteen",    label: "Canteen / Pantry",     sort_order: 100 },
    { value: "pharmacy",   label: "Pharmacy",             sort_order: 110 },
    { value: "lab",        label: "Laboratory",           sort_order: 120 },
  ],

  equipment_categories: [
    { value: "diagnostic",   label: "Diagnostic",           sort_order: 10 },
    { value: "therapeutic",  label: "Therapeutic",          sort_order: 20 },
    { value: "monitoring",   label: "Patient Monitoring",   sort_order: 30 },
    { value: "laboratory",   label: "Laboratory",           sort_order: 40 },
    { value: "surgical",     label: "Surgical Instruments", sort_order: 50 },
    { value: "ot_equipment", label: "OT Equipment",         sort_order: 60 },
    { value: "it_equipment", label: "IT / Computers",       sort_order: 70 },
    { value: "utility",      label: "Utility / Electrical", sort_order: 80 },
    { value: "radiation",    label: "Radiation / Imaging",  sort_order: 90 },
    { value: "other",        label: "Other",                sort_order: 99 },
  ],

  inventory_categories: [
    { value: "surgical",    label: "Surgical Supplies",   sort_order: 10 },
    { value: "consumable",  label: "Consumables",         sort_order: 20 },
    { value: "linen",       label: "Linen",               sort_order: 30 },
    { value: "medical_gas", label: "Medical Gases",       sort_order: 40 },
    { value: "diagnostic",  label: "Diagnostic Reagents", sort_order: 50 },
    { value: "ppe",         label: "PPE",                 sort_order: 60 },
    { value: "stationery",  label: "Stationery / Forms",  sort_order: 70 },
    { value: "other",       label: "Other",               sort_order: 99 },
  ],

  // ── Structure ──────────────────────────────────────────────────────────────
  department_types: [
    { value: "clinical",       label: "Clinical",       sort_order: 10 },
    { value: "administrative", label: "Administrative", sort_order: 20 },
    { value: "support",        label: "Support",        sort_order: 30 },
    { value: "diagnostic",     label: "Diagnostic",     sort_order: 40 },
    { value: "paramedical",    label: "Paramedical",    sort_order: 50 },
  ],

  // ── Categories consumed by modules but not offered on the settings page ─────
  cancellation_reasons: [
    { value: "patient_request",       label: "Patient requested cancellation", sort_order: 1 },
    { value: "clinically_unfit",      label: "Clinically unfit for procedure", sort_order: 2 },
    { value: "doctor_unavailable",    label: "Doctor / surgeon unavailable",   sort_order: 3 },
    { value: "preauth_rejected",      label: "Insurance pre-auth rejected",    sort_order: 4 },
    { value: "financial",             label: "Financial / unable to pay",      sort_order: 5 },
    { value: "patient_no_show",       label: "Patient did not report",         sort_order: 6 },
    { value: "rescheduled_elsewhere", label: "Moved to another facility",      sort_order: 7 },
    { value: "other",                 label: "Other",                          sort_order: 8 },
  ],

  // Emergency uses its own route shorthand ("PO (oral)", "Nebulized"). Folding it
  // into drug_routes would push the OPD Rx dropdown to ~20 entries with confusing
  // near-duplicates, so it gets its own list.
  emergency_drug_routes: [
    { value: "IV",        label: "IV",        sort_order: 10 },
    { value: "IM",        label: "IM",        sort_order: 20 },
    { value: "PO (oral)", label: "PO (oral)", sort_order: 30 },
    { value: "SC",        label: "SC",        sort_order: 40 },
    { value: "SL",        label: "SL",        sort_order: 50 },
    { value: "PR",        label: "PR",        sort_order: 60 },
    { value: "Nebulized", label: "Nebulized", sort_order: 70 },
    { value: "Inhaled",   label: "Inhaled",   sort_order: 80 },
    { value: "Topical",   label: "Topical",   sort_order: 90 },
    { value: "Other",     label: "Other",     sort_order: 99 },
  ],

  // Vaccination is a genuinely different vocabulary — intradermal and intranasal
  // are not drug routes.
  vaccine_routes: [
    { value: "im",         label: "IM",         sort_order: 10 },
    { value: "sc",         label: "SC",         sort_order: 20 },
    { value: "id",         label: "ID",         sort_order: 30 },
    { value: "oral",       label: "Oral",       sort_order: 40 },
    { value: "intranasal", label: "Intranasal", sort_order: 50 },
  ],
};

/** Hardcoded defaults for a category, or [] when the category has none. */
export function getConfigDefaults(category: string): ConfigValueDefault[] {
  return CONFIG_VALUE_DEFAULTS[category] ?? [];
}
