/**
 * Phase 5 — who each case's patient is. Pure functions, no database, no imports.
 *
 * This is deliberately dependency-free so that BOTH the test suite (`p5-patients.ts`, which adds
 * the Supabase provisioning) and the tracker documentation (`docs/qa/tracker/build-p5-patients.mjs`,
 * which writes the per-case patient into the CSV) can derive the same identity from the same
 * source. When the two drift, a tester reads "search PT-QA-0001" in the case steps and the
 * automation searches something else — and the manual and automated runs quietly stop testing the
 * same thing.
 *
 * Everything here is a deterministic function of the case ID, so `TC-P5C-002` is the same person
 * on every machine and in every run. Only the run tag moves.
 */

/**
 * The name pool. Indian names, mixed regions, because a QA chart that reads like a real ward list
 * is one a hospital reviewer will actually check.
 */
export const GIVEN_NAMES = [
  'Ramesh', 'Sunita', 'Arjun', 'Kavya', 'Vijay', 'Meera', 'Suresh', 'Anjali',
  'Prakash', 'Lakshmi', 'Naveen', 'Deepika', 'Ganesh', 'Sarita', 'Mahesh', 'Rekha',
  'Sanjay', 'Padma', 'Kiran', 'Shalini', 'Venkat', 'Geetha', 'Rajesh', 'Vimala',
  'Ashok', 'Nirmala', 'Harish', 'Sudha', 'Manoj', 'Radha', 'Dinesh', 'Kalpana',
  'Srinivas', 'Bhavani', 'Girish', 'Aruna', 'Pradeep', 'Jyothi', 'Ravindra', 'Usha',
];

export const SURNAMES = [
  'Kumar', 'Reddy', 'Sharma', 'Nair', 'Patel', 'Rao', 'Iyer', 'Desai',
  'Menon', 'Joshi', 'Naidu', 'Pillai', 'Verma', 'Shetty', 'Gupta', 'Chauhan',
  'Bhat', 'Kulkarni', 'Mishra', 'Prasad',
];

export interface Persona {
  given: string;
  surname: string;
  age: number;
  sex: 'male' | 'female';
  allergies: string[];
}

/**
 * Cases whose patient must have a specific clinical shape. Everything else takes the pool.
 *
 * These are not cosmetic. A PCPNDT Form F case needs a woman of childbearing age or the statutory
 * determination it is testing never fires; the delta cases need an adult whose creatinine baseline
 * is plausible. Getting this wrong makes a test pass for the wrong reason.
 */
export const PERSONA_OVERRIDES: Record<string, Partial<Persona>> = {
  // 5C — the delta check needs a plausible CKD adult carrying a 30-day-old creatinine.
  'TC-P5C-010': { given: 'Gopal', surname: 'Krishna', age: 62, sex: 'male' },
  'TC-P5C-011': { given: 'Gopal', surname: 'Krishna', age: 62, sex: 'male' },
  'TC-P5C-012': { given: 'Gopal', surname: 'Krishna', age: 62, sex: 'male' },
  'TC-P5C-013': { given: 'Gopal', surname: 'Krishna', age: 62, sex: 'male' },

  // 5G — PCPNDT Form F. An obstetric study is only lawful on a woman of childbearing age, and the
  // determination under test keys off the study, so the patient must not contradict it.
  'TC-P5G-001': { given: 'Priya', surname: 'Deshmukh', age: 27, sex: 'female' },
  'TC-P5G-002': { given: 'Anita', surname: 'Rane', age: 29, sex: 'female' },
  'TC-P5G-004': { given: 'Sneha', surname: 'Patil', age: 31, sex: 'female' },
  'TC-P5G-005': { given: 'Divya', surname: 'Kamath', age: 26, sex: 'female' },
  'TC-P5G-006': { given: 'Rupa', surname: 'Salunke', age: 30, sex: 'female' },
  'TC-P5G-007': { given: 'Nandini', surname: 'Gokhale', age: 28, sex: 'female' },
  'TC-P5G-008': { given: 'Swati', surname: 'Bhosale', age: 33, sex: 'female' },
  'TC-P5G-009': { given: 'Poonam', surname: 'Jadhav', age: 24, sex: 'female' },
  'TC-P5G-010': { given: 'Vaishali', surname: 'More', age: 32, sex: 'female' },
  'TC-P5G-011': { given: 'Manisha', surname: 'Shinde', age: 29, sex: 'female' },
  'TC-P5G-012': { given: 'Trupti', surname: 'Kadam', age: 27, sex: 'female' },
  'TC-P5G-013': { given: 'Ashwini', surname: 'Pawar', age: 30, sex: 'female' },
  // The false-positive side: a non-obstetric scan that must NOT raise a Form F.
  'TC-P5G-003': { given: 'Bhaskar', surname: 'Raut', age: 54, sex: 'male' },
  'TC-P5G-014': { given: 'Shankar', surname: 'Gaikwad', age: 58, sex: 'male' },
};

/** Stable index into a pool from a case ID — same person everywhere, no run-to-run drift. */
export function poolIndex(caseId: string, span: number): number {
  let h = 0;
  for (let i = 0; i < caseId.length; i++) h = (h * 31 + caseId.charCodeAt(i)) >>> 0;
  return h % span;
}

/** `TC-P5C-002` → `5C002`. The compact form that goes into the UHID and the display name. */
export function caseSlug(caseId: string): string {
  const m = caseId.match(/^TC-P(\d+)([A-Z])-(\d+)$/);
  if (!m) {
    throw new Error(
      `"${caseId}" is not a case ID. Phase 5 patients are keyed on the tracker case ID ` +
      `(TC-P5C-002) so the chart a failing case leaves behind can be found from the tracker row.`,
    );
  }
  const [, phase, section, digits] = m;
  return `${phase}${section}${digits.padStart(3, '0')}`;
}

export function personaFor(caseId: string): Persona {
  const override = PERSONA_OVERRIDES[caseId] ?? {};
  return {
    given: override.given ?? GIVEN_NAMES[poolIndex(caseId, GIVEN_NAMES.length)],
    surname: override.surname ?? SURNAMES[poolIndex(caseId + 's', SURNAMES.length)],
    // 24–71, deterministic. Old enough for every adult reference range in the catalogue.
    age: override.age ?? 24 + poolIndex(caseId + 'a', 48),
    sex: override.sex ?? (poolIndex(caseId + 'x', 2) === 0 ? 'male' : 'female'),
    allergies: override.allergies ?? [],
  };
}

/** `PT-QA-` + `5C002-MKQ3X1`. The prefix is passed in so this file needs no fixture import. */
export function uhidFor(caseId: string, runTag: string, prefix = 'PT-QA-'): string {
  return `${prefix}${caseSlug(caseId)}-${runTag}`;
}

/**
 * `Ramesh Kumar 5C002-MKQ3X1`.
 *
 * The run tag is in the NAME as well as the UHID on purpose. Several screens in this phase are
 * matched on the patient name alone — the collection workstation, the radiology worklist, the
 * chart view — and nothing is ever deleted, so a name carrying only the case number would match
 * this case's order from *last* run just as happily as this one's.
 */
export function nameFor(caseId: string, runTag: string): string {
  const p = personaFor(caseId);
  return `${p.given} ${p.surname} ${caseSlug(caseId)}-${runTag}`;
}

/** The phone number the provisioner writes. Deterministic, synthetic, never a real number. */
export function phoneFor(caseId: string): string {
  return `98${String(poolIndex(caseId + 'p', 100_000_000)).padStart(8, '0')}`;
}
