/**
 * Tier-0 fixture constants — the fixed identities every E2E spec and assertion keys off.
 *
 * WHY FIXED UUIDs. D6: anything feeding a calculation is deterministic, so expected outputs
 * are hand-derivable. That extends to identity — a spec asserts against `HOSPITAL_A` rather
 * than "whatever the seed happened to create", which is what makes
 * `expect(rows).toHaveLength(1)` meaningful across runs and machines.
 *
 * WHY TWO HOSPITALS FROM THE FIRST SPEC. §5 rule 3. Adding the second tenant later means
 * rebuilding the fixture, and every isolation assertion in Phase 4 needs a second tenant to
 * be *absent* from. One hospital cannot prove isolation of anything.
 *
 * NO PHI, AND NOTHING PHI-SHAPED. D5. Every mobile below is in the 9000000xxx placeholder
 * range and every identifier is a repeated-digit pattern that no real registry issues.
 * `npm run check:fixture-phi` fails the build if that ever stops being true.
 */

// ── Tenants ──────────────────────────────────────────────────────────────────

export const HOSPITAL_A = {
  id: "a0000000-0000-4000-8000-000000000001",
  name: "Ashwini General Hospital",
  uhidPrefix: "ASH",
} as const;

export const HOSPITAL_B = {
  id: "b0000000-0000-4000-8000-000000000002",
  name: "Brindavan Multispecialty Hospital",
  uhidPrefix: "BRN",
} as const;

export const TENANTS = [HOSPITAL_A, HOSPITAL_B] as const;
export type TenantKey = "a" | "b";

/**
 * Which tenant a given Playwright project is running as, derived from the project name —
 * `smoke.spec.ts`'s own precedent. Extracted here (Phase 7.5) after being copy-pasted
 * byte-identical into both j06 and j12's journey specs; a third copy for j13 was the point a
 * shared helper stopped being optional.
 */
export function tenantOf(projectName: string): TenantKey {
  return projectName.endsWith("-b") ? "b" : "a";
}

export const TENANT_BY_KEY: Record<TenantKey, typeof HOSPITAL_A | typeof HOSPITAL_B> = {
  a: HOSPITAL_A,
  b: HOSPITAL_B,
};

// ── Staff ────────────────────────────────────────────────────────────────────

/**
 * One active user per role the tests act as.
 *
 * The password is identical across every seeded account and is only ever valid against a
 * local container — the seed refuses to run anywhere else (see `assertLocalTarget`).
 */
export const TEST_PASSWORD = "aumrti-e2e-local-only";

/** Roles the harness signs in as. Matches the `app_role` enum. */
export const SEEDED_ROLES = [
  "hospital_admin",
  "doctor",
  "nurse",
  "receptionist",
  "billing_executive",
  "lab_tech",
  "pharmacist",
] as const;

export type SeededRole = (typeof SEEDED_ROLES)[number];

/**
 * Deterministic email per (tenant, role). `@example.test` is a reserved TLD that can never
 * resolve, so a stray password-reset or notification cannot reach a real inbox.
 */
export function staffEmail(tenant: TenantKey, role: SeededRole): string {
  return `${role}.${tenant}@example.test`;
}

/**
 * Deterministic `public.users.id` per (tenant, role).
 *
 * Distinct from the auth uid on purpose: the two diverged at migration 20260322111223 and
 * ~70 tables FK to `public.users(id)`. A fixture that conflated them would make every
 * `*_by` attribution assertion pass for the wrong reason.
 */
export function staffUserId(tenant: TenantKey, role: SeededRole): string {
  const t = tenant === "a" ? "a" : "b";
  const idx = SEEDED_ROLES.indexOf(role) + 1;
  return `${t}0000000-0000-4000-8000-1000000000${String(idx).padStart(2, "0")}`;
}

/**
 * Phase 8, NDPS dual sign-off: a SECOND hospital_admin-role user per tenant. Every counter-
 * signer/senior-pharmacist picker in the NDPS dual sign-off screens is scoped to
 * `role = "hospital_admin"` (confirmed live — `app_role` has no senior_pharmacist/chief_pharmacist
 * value, so hospital_admin is the only role above plain "pharmacist" that qualifies), and every
 * E2E spec in this suite logs in AS the one seeded hospital_admin (global-setup.ts). Testing that
 * a genuinely different, password-verified person can complete a sign-off — as opposed to the
 * primary user selecting themselves — needs a second such account with a known password, not
 * just the one already-logged-in user.
 */
export function seniorAdminEmail(tenant: TenantKey): string {
  return `senior.admin.${tenant}@example.test`;
}

export function seniorAdminUserId(tenant: TenantKey): string {
  const t = tenant === "a" ? "a" : "b";
  return `${t}0000000-0000-4000-8000-e00000000001`;
}

// ── Patients ─────────────────────────────────────────────────────────────────

export interface SeedPatient {
  id: string;
  fullName: string;
  uhid: string;
  /** 9000000xxx placeholder range — never a real Indian mobile. */
  phone: string;
  /** Seeded into `allergy_records`, not a patients column. */
  allergy?: string;
  /** Drives the scheme-covered billing forks (nursing bundling, referral checks). */
  payerType?: string;
  patientCategory?: string;
}

/**
 * Three patients per hospital: one plain, one with a documented allergy, one scheme-covered.
 *
 * Seeded rather than created mid-test because the negative forks need them to exist before
 * the journey starts — a test that creates its own allergy row is testing its own setup.
 */
export const PATIENTS_A: SeedPatient[] = [
  {
    id: "a0000000-0000-4000-8000-200000000001",
    fullName: "Anand Kumar",
    uhid: "ASH000001",
    phone: "9000000001",
  },
  {
    id: "a0000000-0000-4000-8000-200000000002",
    fullName: "Bhavani Reddy",
    uhid: "ASH000002",
    phone: "9000000002",
    allergy: "Penicillin",
  },
  {
    id: "a0000000-0000-4000-8000-200000000003",
    fullName: "Chandra Mohan",
    uhid: "ASH000003",
    phone: "9000000003",
    payerType: "cghs",
    patientCategory: "cghs",
  },
  {
    // TPA-insured, mirroring PATIENTS_B[2] — J06 (IPD elective surgical, TPA-insured) needs a
    // patient of the same payer shape on BOTH tenants, or the journey would only exercise the
    // real insurance-claim path on one hospital and something structurally different on the
    // other. Phase 7.
    id: "a0000000-0000-4000-8000-200000000004",
    fullName: "Girish Pillai",
    uhid: "ASH000004",
    phone: "9000000004",
    payerType: "tpa",
    patientCategory: "insurance",
  },
];

export const PATIENTS_B: SeedPatient[] = [
  {
    id: "b0000000-0000-4000-8000-200000000001",
    fullName: "Deepa Nair",
    uhid: "BRN000001",
    phone: "9000000011",
  },
  {
    id: "b0000000-0000-4000-8000-200000000002",
    fullName: "Eshwar Rao",
    uhid: "BRN000002",
    phone: "9000000012",
    allergy: "Sulphonamides",
  },
  {
    id: "b0000000-0000-4000-8000-200000000003",
    fullName: "Fatima Begum",
    uhid: "BRN000003",
    phone: "9000000013",
    // `patients.patient_category` is CHECKed to general/bpl/cghs/echs/pmjay/esi/
    // insurance/medicalaid — 'tpa' is not among them (a TPA is a private-insurance
    // intermediary, so it falls under 'insurance' here). `payerType` stays 'tpa': that
    // is `payerTypes.ts`'s vocabulary, a separate column, a separate CHECK.
    payerType: "tpa",
    patientCategory: "insurance",
  },
];

/** The TPA-insured patient for a tenant — J06's admission subject. Indices differ per tenant
 * (PATIENTS_A[3], PATIENTS_B[2]), so callers use this instead of a magic index. */
export function tpaPatient(tenant: TenantKey): SeedPatient {
  const patient = PATIENTS_BY_TENANT[tenant].find((p) => p.payerType === "tpa");
  if (!patient) throw new Error(`No TPA-flagged patient seeded for tenant ${tenant}`);
  return patient;
}

/** The documented-allergy patient for a tenant — Phase 7.5's Pharmacy negative fork subject. */
export function allergyPatient(tenant: TenantKey): SeedPatient {
  const patient = PATIENTS_BY_TENANT[tenant].find((p) => !!p.allergy);
  if (!patient) throw new Error(`No allergy-flagged patient seeded for tenant ${tenant}`);
  return patient;
}

export const PATIENTS_BY_TENANT: Record<TenantKey, SeedPatient[]> = {
  a: PATIENTS_A,
  b: PATIENTS_B,
};

// ── Departments ──────────────────────────────────────────────────────────────

export interface SeedDepartment {
  id: string;
  name: string;
  type: "clinical" | "administrative" | "support";
}

export function departments(tenant: TenantKey): SeedDepartment[] {
  const t = tenant === "a" ? "a" : "b";
  return [
    { id: `${t}0000000-0000-4000-8000-300000000001`, name: "General Medicine", type: "clinical" },
    { id: `${t}0000000-0000-4000-8000-300000000002`, name: "General Surgery", type: "clinical" },
    { id: `${t}0000000-0000-4000-8000-300000000003`, name: "Billing", type: "administrative" },
  ];
}

// ── Services and GST ─────────────────────────────────────────────────────────

export interface SeedService {
  id: string;
  name: string;
  category: string;
  itemType: string;
  fee: number;
  gstApplicable: boolean;
  gstPercent: number;
  // Consultation-only, read by src/lib/consultationFee.ts's SELECT_RATE — optional because
  // every other seeded service (lab/pharmacy/room/OT) has no follow-up concept at all.
  // Phase 7.5, J13 (OPD follow-up): with these left unset, `resolveConsultationRate`'s
  // `followUpFee` stays null and `computeConsultationFee` skips the follow-up branch
  // entirely, charging the full fee even on a genuine follow-up visit — confirmed live by
  // reading consultationFee.ts directly. A follow-up journey needs a real configured rate or
  // it cannot demonstrate the discount it's meant to test.
  followUpFee?: number;
  followUpValidityDays?: number;
  followUpMaxVisits?: number;
}

/**
 * Fixed rates so journey totals are hand-derivable (D6), and deliberately spanning BOTH GST
 * branches — `gstRules` has an exempt path and a taxable path, and a fixture with only one
 * lets half of every billing assertion pass without exercising the rule.
 *
 * Worked example a journey can assert against:
 *   Consultation  ₹500   @ 0%   → ₹500
 *   CBC           ₹300   @ 0%   → ₹300
 *   Paracetamol   ₹100   @ 12%  → ₹112
 *                                ------
 *                                 ₹912
 */
export function services(tenant: TenantKey): SeedService[] {
  const t = tenant === "a" ? "a" : "b";
  return [
    {
      id: `${t}0000000-0000-4000-8000-400000000001`,
      name: "General Consultation",
      category: "consultation",
      itemType: "consultation",
      fee: 500,
      gstApplicable: false,
      gstPercent: 0,
      followUpFee: 200,
      followUpValidityDays: 7,
      followUpMaxVisits: 3,
    },
    {
      id: `${t}0000000-0000-4000-8000-400000000002`,
      name: "Complete Blood Count",
      category: "lab",
      itemType: "lab",
      fee: 300,
      gstApplicable: false,
      gstPercent: 0,
    },
    {
      id: `${t}0000000-0000-4000-8000-400000000003`,
      name: "Paracetamol 650mg",
      category: "pharmacy",
      itemType: "pharmacy",
      fee: 100,
      gstApplicable: true,
      gstPercent: 12,
    },
    {
      // Above the ₹5,000/day statutory threshold, so the room-rent GST branch is reachable.
      id: `${t}0000000-0000-4000-8000-400000000004`,
      name: "Deluxe Room (per day)",
      category: "room_charge",
      itemType: "room_charge",
      fee: 6000,
      gstApplicable: true,
      gstPercent: 5,
    },
  ];
}

/**
 * Surgery/OT-billable line, added for J06 (IPD elective surgical). Distinct from the four
 * above: those cover OPD/general IPD billing, none of them price an OT case.
 */
export function otService(tenant: TenantKey): SeedService {
  const t = tenant === "a" ? "a" : "b";
  return {
    id: `${t}0000000-0000-4000-8000-400000000005`,
    name: "Appendicectomy — OT Charges",
    category: "surgery",
    itemType: "ot",
    fee: 15000,
    gstApplicable: false,
    gstPercent: 0,
  };
}

/**
 * `lab_test_master` — Phase 7, J12 (OPD cash walk-in). A SEPARATE table from `service_master`
 * (confirmed by reading `RxOrdersTab.tsx`/`NewLabOrderModal.tsx` directly): the doctor's
 * test-name typeahead and the lab-order-creation modal both query THIS table, not
 * `service_master` — so seeding only `services()`'s "Complete Blood Count" row (used for IPD's
 * OT/pharmacy pricing elsewhere) leaves the OPD lab-ordering screens with nothing to pick.
 * Same test name as `services()`'s CBC entry, deliberately, so both tables describe the same
 * real-world test rather than two differently-priced "CBC"s. `is_active` must be set explicitly
 * true — a 2026-10-09 migration changed the column's own default to inactive.
 */
export interface SeedLabTest {
  id: string;
  testName: string;
  category: string;
  fee: number;
  // Phase 7.5, Lab spine: `LabResultWorkspace.tsx` renders a NUMERIC input only when
  // `normal_min`/`normal_max` is set on `lab_test_master` — left unset, this test would
  // render as a qualitative Positive/Negative/Detected select instead (confirmed live), which
  // can never be flagged critical. `critical_low`/`critical_high` are what
  // `src/lib/labReferenceRange.ts`'s `flagResult()` compares an entered value against to
  // raise the CH/CL flag the critical-value negative fork needs. Values are illustrative
  // (haemoglobin-shaped, g/dL) — fixture data, not a real reference range.
  normalMin?: number;
  normalMax?: number;
  criticalLow?: number;
  criticalHigh?: number;
}

export function labTestMaster(tenant: TenantKey): SeedLabTest {
  const t = tenant === "a" ? "a" : "b";
  return {
    id: `${t}0000000-0000-4000-8000-a00000000001`,
    testName: "Complete Blood Count",
    // Case-sensitive against `hospital_config_values` ('lab_test_categories') — confirmed live,
    // a lowercase "haematology" is rejected by a DB trigger even though it reads as the same
    // word; the seeded default option is capitalized "Haematology".
    category: "Haematology",
    fee: 300,
    normalMin: 12,
    normalMax: 16,
    criticalLow: 6,
    criticalHigh: 20,
  };
}

/**
 * One modality + one priced study — Phase 7.5, Radiology spine. `modality_type: "other"`
 * deliberately dodges two complications a real modality would introduce that this spine
 * isn't testing: PCPNDT Form F (`requiresPcpndtFormF` — usg + an obstetric-sounding name)
 * and the pregnancy-status/radiation-dose fields `RadiologyReportingWorkspace.tsx` renders
 * for ionising modalities (`["xray","ct","fluoroscopy"].includes(modality_type) ||
 * !modality_type` — "other" is the one real, schema-valid modality_type that hits neither).
 */
export interface SeedRadiologyStudy {
  modalityId: string;
  modalityName: string;
  studyId: string;
  studyName: string;
  fee: number;
}

export function radiologyStudy(tenant: TenantKey): SeedRadiologyStudy {
  const t = tenant === "a" ? "a" : "b";
  return {
    modalityId: `${t}0000000-0000-4000-8000-d00000000001`,
    modalityName: "General Imaging",
    studyId: `${t}0000000-0000-4000-8000-d00000000002`,
    studyName: "General Diagnostic Study",
    fee: 750,
  };
}

/**
 * `drug_master` + `drug_batches` — Phase 7.5, Pharmacy spine. Confirmed by reading
 * `DrugMasterSearchInput.tsx` directly: prescribing's drug typeahead queries `drug_master`
 * (`is_active = true`), a table entirely separate from `service_master`'s "Paracetamol 650mg"
 * pricing row — the same "two catalogues for one real-world item" shape `lab_test_master`
 * already needed. A drug with no `drug_batches` row dispenses nothing (zero stock), so both are
 * required together.
 *
 * THREE drugs, deliberately, to cover the two DIFFERENT allergy-gate severities
 * `checkDrugSafety` (src/lib/drugSafetyCheck.ts) produces — confirmed live, not assumed, while
 * building Phase 7.5's Pharmacy spine — for PATIENTS_A[1]/PATIENTS_B[1]'s documented
 * "Penicillin" allergy:
 *   - Paracetamol 650mg — safe, the happy-path drug.
 *   - Amoxicillin 500mg — a CROSS-REACTIVITY conflict (`drug_allergy_cross_reactivity`'s
 *     seeded `risk_level: "high"`, which `SEVERITY_RANK` maps to "major", not
 *     "contraindicated"). Renders as "⚠️ MAJOR DRUG INTERACTION" with a plain, unaudited
 *     "Add Anyway" — confirmed live, this is NOT a hard block. Also an antibiotic by name
 *     (`isAntibioticByName`), so it exercises the Antibiotic Stewardship gate first — the
 *     regression subject for KNOWN-BUG-212 (see KNOWN_BUGS.md): that gate's own "just
 *     justified" hand-off used to re-open itself forever, so NO antibiotic could ever
 *     actually be prescribed through this screen.
 *   - Penicillin V 250mg — a DIRECT allergy match (the drug's own resolved alias equals the
 *     allergen itself), which `checkDrugSafety` hardcodes to `severity: "contraindicated"`
 *     regardless of any reference table's risk_level. THIS is the real hard block with the
 *     genuinely audited override ("Override with clinical justification..." → a `clinical_alerts`
 *     row with patient_id + created_by + reason) — the plan's "documented allergy blocks X;
 *     override is audited" fork. Not recognised by `isAntibioticByName` (bare "penicillin" is
 *     absent from `ANTIBIOTIC_KEYWORDS` — a separate, minor completeness gap noted but not
 *     fixed here), so it reaches the safety check directly, no stewardship modal first.
 */
export interface SeedDrug {
  id: string;
  drugName: string;
  genericName?: string;
  isNdps?: boolean;
}

export function drugs(tenant: TenantKey): SeedDrug[] {
  const t = tenant === "a" ? "a" : "b";
  return [
    { id: `${t}0000000-0000-4000-8000-b00000000001`, drugName: "Paracetamol 650mg", genericName: "Paracetamol" },
    { id: `${t}0000000-0000-4000-8000-b00000000002`, drugName: "Amoxicillin 500mg", genericName: "Amoxicillin" },
    { id: `${t}0000000-0000-4000-8000-b00000000003`, drugName: "Penicillin V 250mg", genericName: "Penicillin" },
    // Hospital B's allergy patient (PATIENTS_B[1], Eshwar Rao) carries "Sulphonamides", not
    // "Penicillin" — confirmed live: Amoxicillin/Penicillin V add CLEANLY for him, no conflict
    // at all, since the two allergen families share no cross-reactivity. Deliberately NOT
    // fixed by changing the pre-existing patient fixture (PATIENTS_B predates Phase 7.5 and
    // other tests may already depend on this exact value) — instead, both allergen families
    // are seeded for BOTH tenants, and the spec itself picks the pair matching whichever
    // allergy the tenant's own patient actually has. Cotrimoxazole is the real drug the
    // product's own seeded reference data (migration 20260327071615) lists as
    // cross-reactive with "sulphonamide" at "high" risk (→ MAJOR, same as Amoxicillin/
    // Penicillin's relationship). "Sulphonamide" itself is not a standalone prescribable
    // product in practice (real sulfa drugs are always named specifically — sulfadiazine,
    // sulfamethoxazole) — this entry is a deliberate synthetic stand-in purely to exercise the
    // DIRECT-match/contraindicated code path, the same role "Penicillin V" fills for real.
    { id: `${t}0000000-0000-4000-8000-b00000000004`, drugName: "Cotrimoxazole 480mg", genericName: "Cotrimoxazole" },
    { id: `${t}0000000-0000-4000-8000-b00000000005`, drugName: "Sulphonamide 500mg", genericName: "Sulphonamide" },
    // Phase 8, NDPS dual sign-off. A real NDPS Act Schedule-X drug name, used here as fixture
    // data — `is_ndps: true` is what every dispensing/POS/return screen actually keys off
    // (drug_master.drug_schedule/schedule_type are a separate, only-Settings-UI-facing pair
    // of columns, confirmed by reading SettingsDrugsPage.tsx directly).
    { id: `${t}0000000-0000-4000-8000-b00000000006`, drugName: "Morphine Sulphate 10mg", genericName: "Morphine", isNdps: true },
  ];
}

/** One in-date, in-stock batch per seeded drug — required or the drug has zero stock to dispense. */
export function drugBatches(tenant: TenantKey): { id: string; drugId: string; batchNumber: string }[] {
  const t = tenant === "a" ? "a" : "b";
  return drugs(tenant).map((d, i) => ({
    id: `${t}0000000-0000-4000-8000-b0000000010${i + 1}`,
    drugId: d.id,
    batchNumber: `E2E-BATCH-${i + 1}`,
  }));
}

/** Modules the harness enables so the control plane never blocks the feature under test. */
export const ENABLED_MODULE_KEYS = [
  "opd",
  "ipd",
  "billing",
  "lab",
  "radiology",
  "pharmacy",
  "insurance",
  "settings",
] as const;

// ── Wards, beds, OT rooms (Phase 7, J06) ────────────────────────────────────
//
// Numbering note: the 500000000x/600000000x/700000000x/800000000x/900000000x blocks below are
// this file's own category sequence (following 100=staff/200=patients/300=departments/
// 400=services). `isolation.spec.ts` separately uses the identical-looking numeric blocks for
// its OWN standalone ids (bills/bill_line_items/clinical_alerts/insurance_claims/
// nabh_evidence_log) — by its own comment, "single-purpose to this spec, not added to
// constants.ts". No actual collision (different tables, independent primary-key spaces), but
// grep for one of these ids and you WILL find it meaning two unrelated things depending on
// which file. Flagging so nobody assumes these blocks are a single, globally unique registry.

export interface SeedWard {
  id: string;
  name: string;
  type: string; // ward_type enum
  ratePerDay: number;
}

export interface SeedBed {
  id: string;
  wardId: string;
  bedNumber: string;
}

export interface SeedOTRoom {
  id: string;
  name: string;
  type: string; // ot_rooms_type_check: major|minor|emergency|day_care|endoscopy
}

/** One surgical ward with two beds — one stays free for negative-fork specs later. */
export function wards(tenant: TenantKey): SeedWard[] {
  const t = tenant === "a" ? "a" : "b";
  return [
    { id: `${t}0000000-0000-4000-8000-500000000001`, name: "Surgical Ward", type: "surgical", ratePerDay: 2000 },
  ];
}

export function beds(tenant: TenantKey): SeedBed[] {
  const t = tenant === "a" ? "a" : "b";
  const wardId = wards(tenant)[0].id;
  return [
    { id: `${t}0000000-0000-4000-8000-600000000001`, wardId, bedNumber: "SW-01" },
    { id: `${t}0000000-0000-4000-8000-600000000002`, wardId, bedNumber: "SW-02" },
  ];
}

export function otRooms(tenant: TenantKey): SeedOTRoom[] {
  const t = tenant === "a" ? "a" : "b";
  return [
    { id: `${t}0000000-0000-4000-8000-700000000001`, name: "OT-1", type: "major" },
  ];
}

// ── TPA config (Phase 7, J06) ────────────────────────────────────────────────

export interface SeedTpa {
  id: string;
  tpaName: string;
  tpaCode: string;
}

/**
 * One TPA per hospital. `PATIENTS_B[2]` (Fatima Begum) is already `payerType: "tpa"` —
 * reused as J06's insured patient rather than adding a fourth patient. Hospital A gets a TPA
 * too so J06 is runnable as either tenant (D7/Phase 7 exit gate), even though today's Tier-0
 * only has an explicitly TPA-flagged patient seeded for hospital B.
 */
export function tpaConfig(tenant: TenantKey): SeedTpa {
  const t = tenant === "a" ? "a" : "b";
  return { id: `${t}0000000-0000-4000-8000-800000000001`, tpaName: "Star Health TPA", tpaCode: "STAR" };
}

export interface SeedPayerMaster {
  id: string;
  payerType: string; // payer_masters_payer_type_check
  payerName: string;
}

/**
 * `payer_masters` is a DIFFERENT table from `tpa_config` — confirmed by reading
 * AdmitPatientModal.tsx directly: the admission wizard's "Billing Payer" name dropdown queries
 * `payer_masters`, while the claim/pre-auth screens elsewhere key off `tpa_config`. Same TPA
 * name deliberately kept identical across both rows so a journey reads as one payer, not two.
 */
export function payerMaster(tenant: TenantKey): SeedPayerMaster {
  const t = tenant === "a" ? "a" : "b";
  return { id: `${t}0000000-0000-4000-8000-900000000001`, payerType: "tpa", payerName: tpaConfig(tenant).tpaName };
}

/**
 * Category digit "c" (single digits 1-9 are all already spoken for by the categories above;
 * "a"/"b" are reserved as tenant letters, not category digits, hence skipping straight to "c").
 * Grants the seeded doctor an active surgical privilege — without one, OTCaseWorkspace's
 * `gateAction()` routes "Confirm Case"/"Start Case" through a privilege-override modal
 * requiring a typed reason instead of proceeding directly, which is a real, separate workflow
 * this journey segment is not about testing.
 */
export function surgicalPrivilegeId(tenant: TenantKey): string {
  const t = tenant === "a" ? "a" : "b";
  return `${t}0000000-0000-4000-8000-c00000000001`;
}
