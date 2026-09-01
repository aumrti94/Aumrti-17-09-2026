/**
 * Typed accessor for the canonical QA dataset.
 *
 * The data itself lives in mock-data.json so that scripts/qa-seed.mjs (plain
 * Node) and the Playwright suite (TypeScript) read byte-identical values — the
 * whole point being that a manual test and its automated twin exercise exactly
 * the same records.
 *
 * NEVER hardcode test data inside a spec file. Add it to mock-data.json and
 * document it in docs/qa/MOCK_DATA_BOOK.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export interface Hospital {
  key: 'A' | 'B';
  name: string; type: string; state: string; bedCount: string; phone: string;
  adminName: string; adminEmail: string; designation: string;
  address1: string; address2: string; pincode: string; city: string;
  gstin: string; nabhAccredited: boolean; nabhNumber: string; website: string;
  plan: 'starter' | 'professional' | 'enterprise';
}

export interface Staff {
  email: string; name: string; role: string;
  department: string | null; landing: string;
}

export interface Patient {
  uhid: string; name: string; age: number; sex: 'male' | 'female' | 'other';
  phone: string; payer: string; hospital: 'A' | 'B';
  feature: string; scenarios: string[]; allergies?: string[];
}

export interface Ward {
  name: string; category: string; bedPrefix: string;
  bedCount: number; ratePerDay: number; note: string;
}

export interface LabTest {
  name: string; code: string; category: string; sampleType: string; fee: number; unit: string;
  normalMin: number | null; normalMax: number | null;
  /**
   * PHASE 5 — `lab_test_master.critical_low` / `critical_high`.
   *
   * `LabResultWorkspace.calcFlag()` derives `CL`/`CH` from THESE two columns alone, and only a
   * `CH`/`CL` flag raises the `clinical_alerts` critical row and blocks release. Seeding a test
   * with a normal range but no critical range means a critical potassium reads as a plain `H`
   * and no alert ever fires — the seeder omitted them until Phase 5 (finding L3), which is why
   * they are typed as required rather than optional.
   */
  criticalLow: number | null; criticalHigh: number | null;
  /**
   * Sex-specific reference intervals — `lab_test_master.male_normal_*` /
   * `female_normal_*`. Populated only for the analytes where the interval genuinely
   * differs (Hb, RBC, PCV, creatinine, uric acid, ESR, GGT, iron, ferritin, CPK,
   * prolactin); `null` everywhere else, where `normalMin/Max` is the whole story.
   *
   * These columns existed since 20260910000001 but nothing READ them until
   * `src/lib/labReferenceRange.ts` — a male at 12.5 g/dL is anaemic and used to read
   * Normal against the merged 12.0-17.5 band.
   */
  maleNormalMin: number | null; maleNormalMax: number | null;
  femaleNormalMin: number | null; femaleNormalMax: number | null;
  /** `lab_test_master.method` — printed on the report; NABL expects it. */
  method: string | null;
  /** `lab_test_master.autoverify_eligible` — defaults to FALSE in the database (finding L7). */
  autoverifyEligible: boolean;
  tatMinutes: number;
}

export interface MockData {
  guard: {
    hospitalNamePrefixes: string[];
    uhidPrefix: string;
    /** The two real inboxes that own the QA tenants. */
    emailOwners: string[];
    /** Plus-addressing prefixes used for the non-admin staff of each tenant. */
    emailPrefixes: string[];
    batchPrefix: string;
    note: string;
  };
  password: string;
  hospitals: Record<'A' | 'B', Hospital>;
  staff: Record<'A' | 'B', Staff[]>;
  appRoleEnum: string[];
  departments: Array<{ name: string; code: string; type: string }>;
  wards: Ward[];
  doctorFees: Array<{
    doctor: string; department: string; consultation: number;
    followUp: number; validityDays: number; emergency: number; ipdVisit: number;
  }>;
  services: Array<{
    name: string; code: string; category: string; rate: number;
    gstApplicable: boolean; gstPercent: number; hsn: string;
  }>;
  healthPackages: Array<{ name: string; rate: number; includes: string[] }>;
  drugs: Array<{
    brand: string; generic: string; form: string; strength: string;
    schedule: string; mrp: number; gst: number;
  }>;
  drugBatches: Array<{
    drug: string; batch: string; qty: number; expiry: string;
    status: string; purpose: string;
  }>;
  defaultBatch: { qty: number; expiry: string; status: string };
  labTests: LabTest[];
  labTestGroups: Array<{
    name: string; code: string; category: string; fee: number; tatMinutes: number;
    members: string[];
    /** Sum of the members' individual fees. Generated, so the "group price beats the
     *  parts" assertion can never drift from the catalogue it is asserting about. */
    membersSum: number;
    note: string;
  }>;
  radiologyModalities: Array<{ name: string; type: string }>;
  radiologyStudies: Array<{
    name: string; modality: string; fee: number; sortOrder: number; note: string;
    /** PCPNDT — `radiology_study_master.requires_form_f`. Absent means false. */
    requiresFormF?: boolean;
  }>;
  payers: Array<{
    name: string; type: string; roomCeiling: number | null;
    coPayPercent: number; deductible: number;
  }>;
  configValues: Record<string, string[]>;
  shifts: Array<{ name: string; start: string; end: string }>;
  settings: {
    discountApprovalRules: Array<{ upToPercent: number; requires: string[] }>;
    ipdAncillaryPayment: 'pre_paid' | 'post_paid';
  };
  patients: Patient[];
  phase2: {
    _note: string;
    entry: Record<string, { _kind: 'create' | 'update' | 'toggle' | 'filter' } & Record<string, unknown>>;
    dropdowns: Record<string, string[]> & { _note: string };
    edit: Record<string, unknown>;
    invalid: Record<string, unknown>;
    crossTenantProbe: { name: string; code: string };
    labTestGroup: { name: string; fee: number; members: string[]; membersSum: number };
  };
  phase3: {
    _note: string;
    registration: Record<string, unknown>;
    duplicate: Record<string, unknown>;
    emergency: Record<string, unknown>;
    newborn: Record<string, unknown>;
    abha: Record<string, unknown>;
    kiosk: Record<string, unknown>;
    portal: Record<string, unknown>;
    edit: Record<string, unknown>;
    documents: Record<string, unknown>;
  };
  phase4: {
    _note: string;
    walkIn: Record<string, string>;
    invalid: Record<string, string>;
    consultation: Record<string, string>;
    prescription: Record<string, Record<string, string>>;
    drugSafety: Record<string, unknown>;
    orders: Record<string, unknown>;
    payer: Record<string, string>;
    money: Record<string, string | number>;
    followUp: Record<string, string | number>;
    mlc: Record<string, string>;
    teleconsult: Record<string, string>;
    referral: Record<string, string>;
    sameDay: Record<string, string>;
    crossTenant: Record<string, string>;
  };
  phase5: {
    _note: string;
    labOrder: Record<string, string | number>;
    results: Record<string, string>;
    sample: Record<string, string>;
    amendment: Record<string, string>;
    dualValidation: Record<string, string>;
    externalReferral: Record<string, string | number>;
    radiology: Record<string, string>;
    pcpndt: Record<string, string | number>;
    aiImpression: Record<string, string>;
    ipdAncillary: Record<string, string>;
    money: Record<string, string>;
    crossTenant: Record<string, string>;
  };
  commonValues: {
    standardAdvance: number; standardConsultation: number;
    discountBelowThreshold: number; discountAboveThreshold: number;
    discountDualApproval: number; criticalPotassium: number;
    deltaCreatinineBefore: number; deltaCreatinineAfter: number;
    standardVitals: Record<string, string | number>;
    sepsisVitals: Record<string, string | number>;
  };
}

export const MOCK: MockData = JSON.parse(
  fs.readFileSync(path.join(here, 'mock-data.json'), 'utf8'),
);

/* Convenience accessors — keep specs readable ------------------------ */

export const HOSPITAL_A = MOCK.hospitals.A;
export const HOSPITAL_B = MOCK.hospitals.B;
export const PASSWORD = MOCK.password;

/** Look up a staff login by role. Pass an index when a hospital has several. */
export function staffByRole(hospital: 'A' | 'B', role: string, index = 0): Staff {
  const matches = MOCK.staff[hospital].filter(s => s.role === role);
  const found = matches[index];
  if (!found) {
    throw new Error(
      `No staff with role "${role}" (index ${index}) for Hospital ${hospital}. ` +
      `Available: ${MOCK.staff[hospital].map(s => s.role).join(', ')}`,
    );
  }
  return found;
}

/** Look up a seeded patient by UHID, e.g. patient('PT-QA-0011'). */
export function patient(uhid: string): Patient {
  const found = MOCK.patients.find(p => p.uhid === uhid);
  if (!found) throw new Error(`No mock patient with UHID "${uhid}" in mock-data.json`);
  return found;
}

/** Every patient tagged for a given scenario, e.g. forScenario('P4-S11'). */
export function forScenario(scenario: string): Patient[] {
  return MOCK.patients.filter(p => p.scenarios.includes(scenario));
}

/** True when a hospital name belongs to the QA tenants. Used by every guard. */
export function isQaHospitalName(name: string | null | undefined): boolean {
  if (!name) return false;
  return MOCK.guard.hospitalNamePrefixes.some(p => name.startsWith(p));
}
