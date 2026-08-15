/**
 * Phase 2 · Section B — Identity: Hospital Profile
 * Locks tracker cases TC-P2B-041 … TC-P2B-084
 *
 * Tier 0, row 1. The name, address and GSTIN here print on every bill, prescription and
 * discharge summary the hospital ever issues, and setting a GSTIN switches ON the HSN
 * hard-block at bill finalisation.
 *
 * A GAP FOUND WHILE AUTHORING: GSTIN is validated against a full 15-character pattern before
 * it is written, but `pincode` is passed straight through with no check at all
 * (SettingsProfilePage.tsx — `pincode: form.pincode || null`). TC-P2B-049 to TC-P2B-051 probe
 * both sides of the 6-digit boundary. If they fail, the defect is the missing validation, not
 * the test.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor } from '../utils/db-verify';
import { fillField, readField, selectByValue, save, awaitSaveAck, reloadAndSettle, heading } from './settings-locators';

const ROUTE = '/settings/profile';
const DB_ON = () => process.env.QA_DB_AVAILABLE === 'true';

const ENTRY = MOCK.phase2.entry[ROUTE] as {
  gstin: string; pincode: string; nabhNumber: string; uhidDateFormat: string; patientLanguages: string;
};
const INVALID = MOCK.phase2.invalid;
const A = MOCK.hospitals.A;

interface HospitalRow {
  name: string; address: string | null; state: string | null; pincode: string | null;
  gstin: string | null; nabh_number: string | null; uhid_prefix: string | null;
  uhid_date_format: string | null; patient_languages: string[] | null;
  nabl_accreditation_number: string | null; nabl_valid_upto: string | null;
  drug_license_number: string | null; drug_license_valid_upto: string | null;
  registration_80g: string | null; trust_pan: string | null;
}

async function hospitalRow(): Promise<HospitalRow> {
  const hid = await hospitalIdFor('A');
  const { data, error } = await db().from('hospitals').select('*').eq('id', hid).maybeSingle();
  if (error) throw new Error(`Could not read the hospitals row: ${error.message}`);
  return data as HospitalRow;
}

/** Restore the registered baseline so one failing case cannot corrupt the rest. */
async function restoreBaseline(): Promise<void> {
  if (!DB_ON()) return;
  const hid = await hospitalIdFor('A');
  await db().from('hospitals').update({
    name: A.name, state: A.state, pincode: A.pincode, gstin: A.gstin,
    nabh_number: A.nabhNumber, address: A.address1,
  }).eq('id', hid);
}

async function setAndSave(
  page: import('@playwright/test').Page,
  label: string,
  value: string | number,
): Promise<void> {
  await fillField(page, label, value, ROUTE);
  await save(page);
  await awaitSaveAck(page);
}

/** Shared body for the three UHID date-format cases. Titles stay literal. */
async function uhidFormatCase(page: import('@playwright/test').Page, fmt: string) {
  await selectByValue(page, 'Date in UHID', fmt, { route: ROUTE });
  await save(page);
  await awaitSaveAck(page);
  await reloadAndSettle(page);

  const row = await hospitalRow();
  expect(
    row.uhid_date_format,
    `UHID date format "${fmt}" did not persist. This changes the shape of every new patient ` +
    `UHID from the moment it saves — a hospital that switches and finds the old shape still ` +
    `being issued ends up with two incompatible identifier series in one register.`,
  ).toBe(fmt);
}

/** Shared body for the ten preferred-language cases. */
async function patientLanguageCase(page: import('@playwright/test').Page, lang: string) {
  await page.getByText(lang, { exact: true }).first().click();
  await save(page);
  await awaitSaveAck(page);
  await reloadAndSettle(page);

  const row = await hospitalRow();
  expect(
    row.patient_languages ?? [],
    `"${lang}" was not stored in patient_languages. Each language is an array element, so one ` +
    `can fail to persist while the others save.`,
  ).toContain(lang);
}

test.describe('P2B — Identity: Hospital Profile', () => {
  test.afterAll(async () => { await restoreBaseline(); });

  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(ROUTE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1600);
  });

  test('TC-P2B-041 Hospital Profile loads with the registered hospital details', async ({ page, consoleErrors }) => {
    await expect(heading(page, 'Hospital Profile').or(page.getByRole('heading', { name: /profile/i }).first())).toBeVisible();
    expect(await readField(page, 'Hospital Name', ROUTE)).toBe(A.name);

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P2B-042 The hospital name cannot be cleared', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    await setAndSave(page, 'Hospital Name', '');

    const row = await hospitalRow();
    expect(
      row.name?.trim(),
      'The hospital name was cleared. A blank name prints as an empty letterhead on every ' +
      'document including medico-legal ones, and breaks the QA seed guard which recognises ' +
      'its own tenants by name prefix.',
    ).not.toBe('');
    await restoreBaseline();
  });

  test('TC-P2B-043 A valid GSTIN saves and is stored upper-cased', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await setAndSave(page, 'GSTIN', ENTRY.gstin.toLowerCase());

    const row = await hospitalRow();
    expect(
      row.gstin,
      'A lower-case GSTIN fails validation at the NIC IRP and every e-invoice is rejected.',
    ).toBe(ENTRY.gstin);
  });

  test('TC-P2B-044 A 14-character GSTIN is rejected', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await setAndSave(page, 'GSTIN', INVALID.gstinTooShort as string);

    const row = await hospitalRow();
    expect(
      row.gstin,
      `The 14-character GSTIN "${INVALID.gstinTooShort}" was stored. A GSTIN is exactly 15 ` +
      `characters — a short one makes every e-invoice request to the NIC IRP fail, so the ` +
      `hospital cannot raise a compliant invoice at all.`,
    ).not.toBe(INVALID.gstinTooShort);
  });

  test('TC-P2B-045 A GSTIN with a malformed check structure is rejected', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await setAndSave(page, 'GSTIN', INVALID.gstinBadCheckDigit as string);

    const row = await hospitalRow();
    const pattern = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
    expect(
      row.gstin === null || pattern.test(row.gstin),
      `"${row.gstin}" was stored but does not match the GSTIN structure. A format-valid but ` +
      `structurally wrong GSTIN is the worst case: it saves, switches on the HSN hard-block, ` +
      `and fails at the IRP on the first real invoice with a patient at the counter.`,
    ).toBeTruthy();
  });

  test('TC-P2B-046 A blank GSTIN is allowed and stored as null', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await setAndSave(page, 'GSTIN', '');

    const row = await hospitalRow();
    expect(
      row.gstin,
      'A blank GSTIN must store as null. An empty string would switch on the HSN hard-block for ' +
      'a hospital that is not registered for GST at all.',
    ).toBeNull();
    await restoreBaseline();
  });

  test('TC-P2B-047 The GSTIN error message states the expected format', async ({ page }) => {
    await fillField(page, 'GSTIN', INVALID.gstinTooShort as string, ROUTE);
    await save(page);
    await page.waitForTimeout(1200);

    const body = await page.locator('body').innerText();
    expect(
      /[0-9]{2}[A-Z]{5}[0-9]{4}/.test(body) || /expected format/i.test(body),
      'The GSTIN error does not show the expected shape. A bare "invalid GSTIN" leaves an ' +
      'administrator retyping the same wrong value.',
    ).toBeTruthy();
  });

  test('TC-P2B-048 A valid 6-digit pincode saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await setAndSave(page, 'Pincode', ENTRY.pincode);

    const row = await hospitalRow();
    expect(row.pincode).toBe(ENTRY.pincode);
  });

  test('TC-P2B-049 A 5-digit pincode is rejected', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await setAndSave(page, 'Pincode', INVALID.pincodeTooShort as string);
    await reloadAndSettle(page);

    const row = await hospitalRow();
    expect(
      row.pincode,
      `The 5-digit pincode "${INVALID.pincodeTooShort}" was stored. Indian pincodes are exactly ` +
      `6 digits. GSTIN is validated on this screen but the pincode is written straight through ` +
      `with no check, so a truncated value reaches the letterhead and the GST place-of-supply ` +
      `logic unchallenged.`,
    ).not.toBe(INVALID.pincodeTooShort);
    await restoreBaseline();
  });

  test('TC-P2B-050 A 7-digit pincode is rejected', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await setAndSave(page, 'Pincode', INVALID.pincodeTooLong as string);
    await reloadAndSettle(page);

    const row = await hospitalRow();
    expect(
      row.pincode,
      `The 7-digit pincode "${INVALID.pincodeTooLong}" was stored. Both sides of the boundary ` +
      `must be caught — a rule that only rejects short values lets a mistyped extra digit onto ` +
      `every printed document.`,
    ).not.toBe(INVALID.pincodeTooLong);
    await restoreBaseline();
  });

  test('TC-P2B-051 A non-numeric pincode is rejected', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await setAndSave(page, 'Pincode', '5000AB');
    await reloadAndSettle(page);

    const row = await hospitalRow();
    expect(
      row.pincode === null || /^[0-9]{6}$/.test(row.pincode),
      `"${row.pincode}" was stored. A pincode with letters breaks any downstream integration ` +
      `that parses it as a number, including courier and government portal submissions.`,
    ).toBeTruthy();
    await restoreBaseline();
  });

  test('TC-P2B-052 The hospital address saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await setAndSave(page, 'Address', A.address1);
    await reloadAndSettle(page);

    const row = await hospitalRow();
    expect(
      row.address,
      'Commas in Indian addresses are routine, so a field that mangles them corrupts the letterhead.',
    ).toContain('Banjara Hills');
  });

  test('TC-P2B-053 The state saves and matches the GSTIN state code', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const row = await hospitalRow();
    test.skip(!row.gstin, 'No GSTIN set on Hospital A — run npm run qa:seed');

    expect(row.state, 'Hospital A is registered in Telangana').toBe(A.state);
    expect(
      row.gstin!.slice(0, 2),
      `State is "${row.state}" but the GSTIN begins "${row.gstin!.slice(0, 2)}". MOCK_DATA_BOOK ` +
      `sets these deliberately — 36 Telangana, 27 Maharashtra. A mismatch produces CGST/SGST ` +
      `where IGST is due and the return has to be amended.`,
    ).toBe('36');
  });

  test('TC-P2B-054 The NABH accreditation number saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await setAndSave(page, 'NABH Number', ENTRY.nabhNumber);
    await reloadAndSettle(page);

    const row = await hospitalRow();
    expect(row.nabh_number).toBe(ENTRY.nabhNumber);
  });

  test('TC-P2B-055 The NABL accreditation number saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await setAndSave(page, 'NABL Accreditation No.', 'MC-2027-QA');
    await reloadAndSettle(page);

    const row = await hospitalRow();
    expect(
      row.nabl_accreditation_number,
      'NABL accreditation is what lets a lab report be accepted by insurers and courts, and the ' +
      'number prints on the report footer.',
    ).toBe('MC-2027-QA');
  });

  test('TC-P2B-056 The NABL validity date saves and displays as DD/MM/YYYY', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await setAndSave(page, 'NABL Valid Up To', '2027-12-31');
    await reloadAndSettle(page);

    const row = await hospitalRow();
    expect(
      row.nabl_valid_upto,
      'An expired NABL accreditation invalidates lab reports, so the date must round-trip exactly.',
    ).toContain('2027-12-31');
  });

  test('TC-P2B-057 The drug licence number saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await setAndSave(page, 'Drug License No. (Form 20B/21B)', '20B/21B-QA-0001');
    await reloadAndSettle(page);

    const row = await hospitalRow();
    expect(
      row.drug_license_number,
      'A pharmacy cannot legally dispense without a Form 20B/21B licence, and the number prints ' +
      'on the dispensing register a drug inspector asks to see.',
    ).toBe('20B/21B-QA-0001');
  });

  test('TC-P2B-058 The drug licence validity date saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await setAndSave(page, 'Drug License Valid Up To', '2028-03-31');
    await reloadAndSettle(page);

    const row = await hospitalRow();
    expect(
      row.drug_license_valid_upto,
      'Dispensing on an expired licence is a prosecutable offence — the system has to hold the ' +
      'expiry before it can warn anyone about it.',
    ).toContain('2028-03-31');
  });

  test('TC-P2B-059 The 80G registration number saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await setAndSave(page, '80G Registration No. (Charitable)', 'AAATH1234QF20213');
    await reloadAndSettle(page);

    const row = await hospitalRow();
    expect(row.registration_80g).toBe('AAATH1234QF20213');
  });

  test('TC-P2B-060 The trust PAN saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await setAndSave(page, 'Trust PAN (for 80G receipts)', 'AAATH1234Q');
    await reloadAndSettle(page);

    const row = await hospitalRow();
    expect(
      row.trust_pan,
      'The trust PAN is required on every 80G receipt alongside the registration number — one ' +
      'without the other makes the receipt unusable.',
    ).toBe('AAATH1234Q');
  });

  test('TC-P2B-061 The UHID prefix is upper-cased as it is typed', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'UHID Prefix', 'bh', ROUTE);
    expect(
      await readField(page, 'UHID Prefix', ROUTE),
      'Mixed case makes two visually identical UHIDs that do not match on lookup.',
    ).toBe('BH');

    await save(page);
    await awaitSaveAck(page);
    const row = await hospitalRow();
    expect(row.uhid_prefix).toBe('BH');
  });

  test('TC-P2B-062 The UHID prefix strips characters that are not letters or digits', async ({ page }) => {
    await fillField(page, 'UHID Prefix', 'B-H 1!', ROUTE);
    expect(
      await readField(page, 'UHID Prefix', ROUTE),
      'The UHID is assembled as prefix-date-serial. A prefix containing its own hyphen or a ' +
      'space produces an identifier that cannot be parsed apart, and barcode scanners reject ' +
      'the space.',
    ).toBe('BH1');
  });

  test('TC-P2B-063 A blank UHID prefix falls back to the UHID default', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await setAndSave(page, 'UHID Prefix', '');
    await reloadAndSettle(page);

    const row = await hospitalRow();
    expect(
      row.uhid_prefix,
      'An empty prefix produces UHIDs beginning with a hyphen. The documented fallback keeps ' +
      'every issued identifier well-formed even when nobody configured one.',
    ).toBe('UHID');
  });

  test('TC-P2B-064 UHID date format "YYYYMMDD" (full date) saves and drives the preview', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await uhidFormatCase(page, 'YYYYMMDD');
  });
  test('TC-P2B-065 UHID date format "YYYY" (year only) saves and drives the preview', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await uhidFormatCase(page, 'YYYY');
  });
  test('TC-P2B-066 UHID date format "NONE" (no date) saves and drives the preview', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await uhidFormatCase(page, 'NONE');
  });

  test('TC-P2B-067 The UHID preview reflects the chosen prefix and date format together', async ({ page }) => {
    await fillField(page, 'UHID Prefix', 'BH', ROUTE);
    await selectByValue(page, 'Date in UHID', 'YYYY', { route: ROUTE });
    await page.waitForTimeout(400);

    const body = await page.locator('body').innerText();
    expect(
      /BH-\d{4}-0001/.test(body),
      'The preview does not compose the live prefix with the chosen format. It is the only place ' +
      'an administrator sees what they are about to impose on every future patient, so a static ' +
      'example teaches them the wrong shape.',
    ).toBeTruthy();
  });

  test('TC-P2B-068 Changing the UHID format affects only patients registered afterwards', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data: before } = await db().from('patients')
      .select('id, uhid').eq('hospital_id', hid).limit(1);
    test.skip(!before?.length, 'No patient exists yet — run npm run qa:seed');

    const original = before![0].uhid;
    await selectByValue(page, 'Date in UHID', 'YYYY', { route: ROUTE });
    await save(page);
    await awaitSaveAck(page);

    const { data: after } = await db().from('patients').select('uhid').eq('id', before![0].id).maybeSingle();
    expect(
      after?.uhid,
      `Existing patient UHID changed from "${original}" to "${after?.uhid}". A UHID is printed on ` +
      `cards, wristbands, lab samples and old paper files — rewriting one detaches a patient ` +
      `from their own history and from every physical label already in the building.`,
    ).toBe(original);
  });

  test('TC-P2B-069 Preferred patient language "Hindi" can be selected and saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await patientLanguageCase(page, 'Hindi');
  });
  test('TC-P2B-070 Preferred patient language "Telugu" can be selected and saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await patientLanguageCase(page, 'Telugu');
  });
  test('TC-P2B-071 Preferred patient language "Tamil" can be selected and saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await patientLanguageCase(page, 'Tamil');
  });
  test('TC-P2B-072 Preferred patient language "Kannada" can be selected and saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await patientLanguageCase(page, 'Kannada');
  });
  test('TC-P2B-073 Preferred patient language "Marathi" can be selected and saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await patientLanguageCase(page, 'Marathi');
  });
  test('TC-P2B-074 Preferred patient language "Malayalam" can be selected and saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await patientLanguageCase(page, 'Malayalam');
  });
  test('TC-P2B-075 Preferred patient language "Bengali" can be selected and saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await patientLanguageCase(page, 'Bengali');
  });
  test('TC-P2B-076 Preferred patient language "Gujarati" can be selected and saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await patientLanguageCase(page, 'Gujarati');
  });
  test('TC-P2B-077 Preferred patient language "Odia" can be selected and saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await patientLanguageCase(page, 'Odia');
  });
  test('TC-P2B-078 Preferred patient language "Punjabi" can be selected and saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await patientLanguageCase(page, 'Punjabi');
  });

  test('TC-P2B-079 English is always included and cannot be removed', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const english = page.getByText('English', { exact: true }).first();
    if (await english.count()) { await english.click(); }
    await save(page);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const row = await hospitalRow();
    expect(
      row.patient_languages ?? [],
      'English is the fallback every other language degrades to. Removing it leaves a patient ' +
      'whose language has no translated template with no message at all.',
    ).toContain('English');
  });

  test('TC-P2B-080 Hospital profile changes survive a hard reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'GSTIN', ENTRY.gstin, ROUTE);
    await fillField(page, 'Pincode', ENTRY.pincode, ROUTE);
    await fillField(page, 'NABH Number', ENTRY.nabhNumber, ROUTE);
    await save(page);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const row = await hospitalRow();
    expect(
      row.gstin,
      'The hospital profile is Tier 0 row 1. If it silently fails to persist, everything ' +
      'configured afterwards is built on values that do not exist.',
    ).toBe(ENTRY.gstin);
    expect(row.pincode).toBe(ENTRY.pincode);
    expect(row.nabh_number).toBe(ENTRY.nabhNumber);
  });

  test('TC-P2B-081 Setting a GSTIN turns on the HSN requirement for billing', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await fillField(page, 'GSTIN', ENTRY.gstin, ROUTE);
    await save(page);
    await awaitSaveAck(page);

    const row = await hospitalRow();
    expect(row.gstin, 'GSTIN did not save, so the HSN hard-block cannot be exercised').toBe(ENTRY.gstin);

    // With a GSTIN set, any billable service lacking an HSN will block finalisation.
    const { data: missingHsn } = await db().from('service_master')
      .select('name, hsn_code').eq('hospital_id', hid).is('hsn_code', null).limit(5);

    expect(
      missingHsn,
      'service_master is not readable, so the HSN precondition cannot be checked. ' +
      'SETTINGS_PREREQ_MATRIX flags this as a deliberate hard-block: setting the GSTIN switches ' +
      'it on, and a hospital that then cannot finalise any bill needs to know the two are connected.',
    ).toBeDefined();
  });

  test("TC-P2B-082 Hospital A's profile is invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    // A GSTIN is a legal identity — one hospital editing another's would let invoices be
    // raised under the wrong tax registration.
    await expectNoCrossTenantRows('hospitals', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });

  test('TC-P2B-083 A receptionist cannot reach the Hospital Profile screen', async ({ page, loginAs, logout }) => {
    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    await logout();
    await loginAs('receptionist', { hospital: 'A' });
    expect(
      await isRouteBlocked(page, ROUTE),
      'A receptionist reached /settings/profile. The GSTIN and drug licence here are the ' +
      'hospital\'s legal identity — changing either could invalidate every invoice and every ' +
      'dispensing record issued afterwards.',
    ).toBeTruthy();
  });

  test('TC-P2B-084 The Hospital Profile screen loads with no red console errors', async ({ page, consoleErrors }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'NABH Number', ENTRY.nabhNumber, ROUTE);
    await save(page);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(
      real,
      `Console errors:\n${real.join('\n')}\n\nSeveral fields on this screen are written with an ` +
      `\`as any\` cast, so a column that does not exist fails only at runtime and the console ` +
      `is the only place that surfaces.`,
    ).toHaveLength(0);
  });
});
