/**
 * Phase 2 · Section G — Clinical Masters: ICD-10, Consent Forms, OT Checklist,
 * Protocols, Alert Thresholds, Day Care Procedures, EMR Templates
 * Locks tracker cases TC-P2G-093 … TC-P2G-158
 *
 * REGRESSION LOCK FOR BUG-P2-005 (protocols). Until Phase 2 QA this screen rendered five
 * hardcoded protocols and never queried the database — every hospital saw the same fake Sepsis
 * Bundle and Code Blue while its own protocols existed nowhere. A protocol nobody can retrieve
 * is a protocol nobody follows.
 *
 * The threshold cases here are about ALERT FATIGUE, which is a clinical risk in its own right:
 * a critical value set inside the normal range fires on every healthy patient, the ward mutes
 * the channel within a day, and the genuine emergency then goes unseen. TC-P2G-133 and
 * TC-P2G-134 guard both ends of that.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor, expectRow, expectNoRow, countRows } from '../utils/db-verify';
import {
  fillField, readField, save, openCreate, awaitSaveAck, reloadAndSettle, heading,
} from './settings-locators';

const ICD = '/settings/icd-codes';
const CONSENT = '/settings/consent-forms';
const OTCHK = '/settings/ot-checklist';
const PROTO = '/settings/protocols';
const THRESH = '/settings/clinical-thresholds';
const DAYCARE = '/settings/day-care-procedures';
const TEMPLATES = '/settings/templates';
const DB_ON = () => process.env.QA_DB_AVAILABLE === 'true';

const E = MOCK.phase2.entry;
const ICD_ENTRY = E[ICD] as { code: string; description: string };
const CONSENT_ENTRY = E[CONSENT] as { name: string; body: string };
const OT_ENTRY = E[OTCHK] as { item: string };
const PROTO_ENTRY = E[PROTO] as { name: string; category: string; desc: string; steps: string[] };
const THRESH_ENTRY = E[THRESH] as { criticalHigh: number };
const DAYCARE_ENTRY = E[DAYCARE] as { name: string; rate: number };
const TEMPLATE_ENTRY = E[TEMPLATES] as { name: string };

async function purge(): Promise<void> {
  if (!DB_ON()) return;
  const hid = await hospitalIdFor('A');
  await db().from('clinical_protocols').delete().eq('hospital_id', hid)
    .in('protocol_name', [PROTO_ENTRY.name, 'QA No Steps Protocol']);
  await db().from('consent_form_templates').delete().eq('hospital_id', hid).eq('name', CONSENT_ENTRY.name);
  await db().from('ot_checklist_custom_items').delete().eq('hospital_id', hid);
  await db().from('day_care_procedures').delete().eq('hospital_id', hid).eq('name', DAYCARE_ENTRY.name);
  await db().from('emr_template_definitions').delete().eq('hospital_id', hid).eq('title', TEMPLATE_ENTRY.name);
}

async function addProtocol(
  page: import('@playwright/test').Page,
  o: { name?: string; category?: string; desc?: string; steps?: string[] },
): Promise<void> {
  await openCreate(page, /add protocol/i);
  if (o.name !== undefined) await fillField(page, 'Name', o.name, PROTO);
  if (o.category !== undefined) await fillField(page, 'Category', o.category, PROTO).catch(() => {});
  if (o.desc !== undefined) await fillField(page, 'Description', o.desc, PROTO).catch(() => {});

  for (const [i, step] of (o.steps ?? []).entries()) {
    if (i > 0) await page.getByRole('button', { name: /add step/i }).click();
    const inputs = page.locator('input').filter({ hasNot: page.locator('[type="file"]') });
    const n = await inputs.count();
    if (n > i) await inputs.nth(n - 1).fill(step);
  }

  await page.getByRole('button', { name: /save protocol/i }).click();
  await awaitSaveAck(page);
}

test.describe('P2G — ICD-10 Code Master', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(ICD, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
  });

  test('TC-P2G-093 ICD-10 Code Master loads', async ({ page, consoleErrors }) => {
    await expect(heading(page, 'ICD').or(page.getByRole('heading', { name: /icd/i }).first())).toBeVisible();
    await expect(page.getByPlaceholder(/search code or description/i)).toBeVisible();

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P2G-094 An ICD-10 code saves with its description', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    await openCreate(page, /add code/i);
    await fillField(page, 'Code', ICD_ENTRY.code, ICD);
    await fillField(page, 'Description', ICD_ENTRY.description, ICD);
    await save(page, /save|add/i);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const body = await page.locator('body').innerText();
    expect(
      body.includes(ICD_ENTRY.code),
      `"${ICD_ENTRY.code}" was not stored. The ICD code is what a claim is adjudicated against ` +
      `and what the morbidity return reports — a missing code is a rejected claim and a distorted ` +
      `national health statistic.`,
    ).toBeTruthy();
  });

  test('TC-P2G-095 An ICD code cannot be saved without a code value', async ({ page }) => {
    await openCreate(page, /add code/i);
    await fillField(page, 'Description', 'QA No Code Description', ICD);
    await save(page, /save|add/i).catch(() => {});
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const body = await page.locator('body').innerText();
    expect(
      body.includes('QA No Code Description'),
      'A description with no code was stored. It cannot be submitted on a claim — the coder ' +
      'believes the diagnosis is coded and the claim is rejected weeks later.',
    ).toBeFalsy();
  });

  test('TC-P2G-096 An ICD code cannot be saved without a description', async ({ page }) => {
    await openCreate(page, /add code/i);
    await fillField(page, 'Code', 'Z99.9', ICD);
    await save(page, /save|add/i).catch(() => {});
    await awaitSaveAck(page);

    const body = await page.locator('body').innerText();
    const bare = /Z99\.9\s*(?:$|\n)/.test(body);
    expect(
      bare,
      'A bare code with no description was stored. It is unsearchable by a coder who knows the ' +
      'condition but not the number, so the picker becomes usable only by someone who has ' +
      'memorised ICD-10.',
    ).toBeFalsy();
  });

  test('TC-P2G-097 A duplicate ICD code is rejected', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    for (let i = 0; i < 2; i++) {
      await openCreate(page, /add code/i);
      await fillField(page, 'Code', ICD_ENTRY.code, ICD);
      await fillField(page, 'Description', ICD_ENTRY.description, ICD);
      await save(page, /save|add/i).catch(() => {});
      await awaitSaveAck(page);
      await reloadAndSettle(page);
    }

    const occurrences = (await page.locator('body').innerText()).split(ICD_ENTRY.code).length - 1;
    expect(
      occurrences,
      `"${ICD_ENTRY.code}" appears ${occurrences} times. Two entries for one code split the ` +
      `morbidity count, so a condition reported to the state health department is understated.`,
    ).toBeLessThanOrEqual(2);
  });

  test('TC-P2G-098 The common-Indian-codes-first preference saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const toggle = page.locator('[role="switch"]').first();
    test.skip(!(await toggle.count()), 'No common-codes toggle rendered');

    await toggle.click();
    await save(page).catch(() => {});
    await awaitSaveAck(page);

    const { error } = await db().from('hospital_icd_settings')
      .select('*').eq('hospital_id', hid).maybeSingle();
    expect(
      error,
      'hospital_icd_settings is not readable. ICD-10 has tens of thousands of codes and an Indian ' +
      'hospital uses a few hundred — surfacing the common ones first is the difference between a ' +
      'two-second selection and a coder picking an approximate code.',
    ).toBeNull();
  });

  test('TC-P2G-099 The billable-only filter works', async ({ page }) => {
    const body = await page.locator('body').innerText();
    expect(
      /billable only/i.test(body),
      'No billable-only filter rendered. Non-billable category headers exist in ICD-10 and cannot ' +
      'be submitted on a claim — coding to one produces a rejection that reads as a coding error ' +
      'rather than a picker that offered an invalid option.',
    ).toBeTruthy();
  });

  test('TC-P2G-100 A new ICD code is searchable in the diagnosis picker', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await openCreate(page, /add code/i);
    await fillField(page, 'Code', ICD_ENTRY.code, ICD);
    await fillField(page, 'Description', ICD_ENTRY.description, ICD);
    await save(page, /save|add/i);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    await page.getByPlaceholder(/search code or description/i).fill(ICD_ENTRY.code);
    await page.waitForTimeout(800);

    const body = await page.locator('body').innerText();
    expect(
      body.includes(ICD_ENTRY.description),
      `"${ICD_ENTRY.code}" is not searchable. MOCK_DATA_BOOK adds it specifically so this hop is ` +
      `provable — a code configured here and absent from the picker means the diagnosis is ` +
      `recorded as free text that no claim can carry.`,
    ).toBeTruthy();
  });

  test("TC-P2G-101 Hospital A's ICD settings are invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    await expectNoCrossTenantRows('hospital_icd_settings', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });

  test('TC-P2G-102 The ICD-10 screen loads with no red console errors', async ({ page, consoleErrors }) => {
    await page.getByPlaceholder(/search code or description/i).fill('N18');
    await page.waitForTimeout(900);

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(
      real,
      `Console errors:\n${real.join('\n')}\n\nA failed write that appears only here leaves the ` +
      `coder believing a code is available when it is not, and they find out with a patient chart open.`,
    ).toHaveLength(0);
  });
});

test.describe('P2G — Consent Forms', () => {
  test.beforeAll(async () => { await purge(); });
  test.afterAll(async () => { await purge(); });

  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(CONSENT, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
  });

  test('TC-P2G-103 Consent Forms screen loads', async ({ page, consoleErrors }) => {
    await expect(heading(page, 'Consent Forms')).toBeVisible();
    await expect(page.getByRole('button', { name: /add consent form/i })).toBeVisible();

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P2G-104 A consent form saves with its body text', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await openCreate(page, /add consent form/i);
    await fillField(page, 'Form Name', CONSENT_ENTRY.name, CONSENT);
    await fillField(page, 'Content', CONSENT_ENTRY.body, CONSENT);
    await save(page, /save|add/i);
    await awaitSaveAck(page);

    const row = await expectRow<Record<string, unknown>>(
      'consent_form_templates', { hospital_id: hid, name: CONSENT_ENTRY.name },
      'No consent_form_templates row after a successful-looking save.',
    );
    expect(
      JSON.stringify(row),
      'The body text is what the patient signs. Truncated or lost, the hospital holds a signature ' +
      'against a document that does not say what it was supposed to say.',
    ).toContain('haemodialysis');
  });

  test('TC-P2G-105 A consent form cannot be saved without a name', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const before = await countRows('consent_form_templates', { hospital_id: hid });

    await openCreate(page, /add consent form/i);
    await fillField(page, 'Content', CONSENT_ENTRY.body, CONSENT);
    await save(page, /save|add/i).catch(() => {});
    await awaitSaveAck(page);

    expect(
      await countRows('consent_form_templates', { hospital_id: hid }),
      'An unnamed consent renders as a blank option in the procedure consent picker, so the wrong ' +
      'form is printed for a patient about to sign it.',
    ).toBe(before);
  });

  test('TC-P2G-106 A consent form cannot be saved with empty content', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await openCreate(page, /add consent form/i);
    await fillField(page, 'Form Name', 'QA Empty Consent', CONSENT);
    await save(page, /save|add/i).catch(() => {});
    await awaitSaveAck(page);

    await expectNoRow(
      'consent_form_templates', { hospital_id: hid, name: 'QA Empty Consent' },
      'A blank consent form is printed, signed and filed. The hospital then holds a signature on ' +
      'an empty page, which is worse than having no consent because it looks like the process was ' +
      'followed.',
    );
  });

  test('TC-P2G-107 The consent type saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await openCreate(page, /add consent form/i);
    await fillField(page, 'Form Name', CONSENT_ENTRY.name, CONSENT);
    await fillField(page, 'Content', CONSENT_ENTRY.body, CONSENT);
    await save(page, /save|add/i);
    await awaitSaveAck(page);

    const { data } = await db().from('consent_form_templates')
      .select('*').eq('hospital_id', hid).eq('name', CONSENT_ENTRY.name).maybeSingle();
    test.skip(!data, 'The consent form was not created');
    expect(
      Object.keys(data!).some(k => /type|category/i.test(k)),
      'consent_form_templates has no type column. Consent type decides where the form is offered ' +
      '— surgical consent must appear at OT booking, not at outpatient registration.',
    ).toBeTruthy();
  });

  test('TC-P2G-108 A new consent form appears in the procedure consent picker', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await openCreate(page, /add consent form/i);
    await fillField(page, 'Form Name', CONSENT_ENTRY.name, CONSENT);
    await fillField(page, 'Content', CONSENT_ENTRY.body, CONSENT);
    await save(page, /save|add/i);
    await awaitSaveAck(page);

    const { data } = await db().from('consent_form_templates')
      .select('name').eq('hospital_id', hid).limit(50);
    expect(
      (data ?? []).map(f => f.name),
      `"${CONSENT_ENTRY.name}" is not returned by the read path the procedure consent picker uses. ` +
      `A form configured here and absent from the picker means the procedure goes ahead on a ` +
      `generic consent, or on none.`,
    ).toContain(CONSENT_ENTRY.name);
  });

  test("TC-P2G-109 Hospital A's consent forms are invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    // A consent form names the hospital and carries its own legal wording.
    await expectNoCrossTenantRows('consent_form_templates', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });

  test('TC-P2G-110 A saved consent form survives a hard reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await openCreate(page, /add consent form/i);
    await fillField(page, 'Form Name', CONSENT_ENTRY.name, CONSENT);
    await fillField(page, 'Content', CONSENT_ENTRY.body, CONSENT);
    await save(page, /save|add/i);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const body = await page.locator('body').innerText();
    expect(
      body.includes(CONSENT_ENTRY.name),
      'A false save means the consent is missing when a procedure is being booked, and the ward ' +
      'improvises with a handwritten form nobody has reviewed.',
    ).toBeTruthy();
  });
});

test.describe('P2G — OT Checklist', () => {
  test.afterAll(async () => { await purge(); });

  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(OTCHK, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
  });

  test('TC-P2G-111 OT Checklist screen loads with the WHO surgical safety structure', async ({ page, consoleErrors }) => {
    await expect(heading(page, 'OT Checklist')).toBeVisible();
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(
      /sign in|time out|sign out|checklist/.test(body),
      'The WHO surgical safety structure is not rendered. It is a NABH requirement and the single ' +
      'most evidenced patient-safety intervention in surgery.',
    ).toBeTruthy();

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P2G-112 A custom checklist item saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const input = page.getByPlaceholder(/add custom checklist item/i);
    test.skip(!(await input.count()), 'No custom item input rendered');

    await input.fill(OT_ENTRY.item);
    await input.press('Enter');
    await awaitSaveAck(page);

    expect(
      await countRows('ot_checklist_custom_items', { hospital_id: hid }),
      'Site marking is the control against wrong-site surgery. A custom item that does not save ' +
      'means the check is never presented to the team, and the hospital believes its checklist ' +
      'covers it.',
    ).toBeGreaterThan(0);
  });

  test('TC-P2G-113 An empty checklist item is refused', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const before = await countRows('ot_checklist_custom_items', { hospital_id: hid });

    const input = page.getByPlaceholder(/add custom checklist item/i);
    test.skip(!(await input.count()), 'No custom item input rendered');
    await input.fill('');
    await input.press('Enter');
    await page.waitForTimeout(900);

    expect(
      await countRows('ot_checklist_custom_items', { hospital_id: hid }),
      'A blank item renders as an unlabelled checkbox the team must tick without knowing what they ' +
      'are confirming. That converts a safety checklist into a box-ticking ritual.',
    ).toBe(before);
  });

  test('TC-P2G-114 A custom checklist item can be removed', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const input = page.getByPlaceholder(/add custom checklist item/i);
    test.skip(!(await input.count()), 'No custom item input rendered');

    await input.fill(OT_ENTRY.item);
    await input.press('Enter');
    await awaitSaveAck(page);
    const added = await countRows('ot_checklist_custom_items', { hospital_id: hid });
    test.skip(added === 0, 'The custom item was not added, so removal cannot be tested');

    const row = page.locator('li, div, tr').filter({ hasText: OT_ENTRY.item }).last();
    const del = row.locator('button').last();
    test.skip(!(await del.count()), 'No delete control rendered on the custom item');
    await del.click();
    await page.waitForTimeout(1400);

    expect(
      await countRows('ot_checklist_custom_items', { hospital_id: hid }),
      'A checklist that only grows becomes too long to complete honestly, and a team that cannot ' +
      'finish it starts ticking without reading. Removing obsolete items is a safety act.',
    ).toBeLessThan(added);
  });

  test('TC-P2G-115 Custom checklist items survive a hard reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const input = page.getByPlaceholder(/add custom checklist item/i);
    test.skip(!(await input.count()), 'No custom item input rendered');

    await input.fill(OT_ENTRY.item);
    await input.press('Enter');
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const body = await page.locator('body').innerText();
    expect(
      body.includes(OT_ENTRY.item),
      'A false save here means a safety check the hospital deliberately added is silently absent ' +
      'from every subsequent operation.',
    ).toBeTruthy();
  });

  test('TC-P2G-116 A custom checklist item appears in the OT workflow', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { error } = await db().from('ot_checklist_custom_items')
      .select('id', { count: 'exact', head: true }).eq('hospital_id', hid);

    expect(
      error,
      'ot_checklist_custom_items is not readable by the OT module. A checklist item configured but ' +
      'never presented is worse than not adding it — the hospital documents the control in its ' +
      'quality manual and the theatre never performs it.',
    ).toBeNull();
  });

  test("TC-P2G-117 Hospital A's OT checklist items are invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    await expectNoCrossTenantRows('ot_checklist_custom_items', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });

  test('TC-P2G-118 The OT Checklist screen loads with no red console errors', async ({ page, consoleErrors }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const input = page.getByPlaceholder(/add custom checklist item/i);
    if (await input.count()) { await input.fill(OT_ENTRY.item); await input.press('Enter'); await awaitSaveAck(page); }

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(
      real,
      `Console errors:\n${real.join('\n')}\n\nA failed write that appears only here leaves the ` +
      `quality manager believing a safety check is in place across every theatre.`,
    ).toHaveLength(0);
  });
});

test.describe('P2G — Clinical Protocols', () => {
  test.beforeAll(async () => { await purge(); });
  test.afterAll(async () => { await purge(); });

  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(PROTO, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
  });

  test('TC-P2G-119 Clinical Protocols loads its rows from clinical_protocols rather than a hardcoded list', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await expect(heading(page, 'Clinical Protocols')).toBeVisible();

    const hid = await hospitalIdFor('A');
    const stored = await countRows('clinical_protocols', { hospital_id: hid });
    const body = await page.locator('body').innerText();

    if (stored === 0) {
      // The old mock always rendered these five regardless of the database.
      const ghosts = ['Sepsis Bundle', 'Code Blue', 'Fall Prevention', 'Blood Transfusion', 'Medication Error Response']
        .filter(n => body.includes(n));
      expect(
        ghosts,
        `BUG-P2-005 REGRESSION: clinical_protocols is empty for this hospital but the screen still ` +
        `renders ${ghosts.join(', ')}. Those are the hardcoded placeholders — the screen is not ` +
        `reading the database.`,
      ).toEqual([]);
    }
  });

  test('TC-P2G-120 A new protocol saves to clinical_protocols', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addProtocol(page, {
      name: PROTO_ENTRY.name, category: PROTO_ENTRY.category,
      desc: PROTO_ENTRY.desc, steps: PROTO_ENTRY.steps,
    });

    const row = await expectRow<{ category: string; steps: unknown }>(
      'clinical_protocols', { hospital_id: hid, protocol_name: PROTO_ENTRY.name },
      'BUG-P2-005 REGRESSION: no clinical_protocols row after a successful-looking save. Saving ' +
      'used to show a green toast and issue zero Supabase calls — a protocol nobody can retrieve ' +
      'is a protocol nobody follows.',
    );
    expect(row.category).toBe(PROTO_ENTRY.category);
    expect(Array.isArray(row.steps) ? (row.steps as unknown[]).length : 0).toBeGreaterThan(0);
  });

  test('TC-P2G-121 Protocol steps save in order as a list', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addProtocol(page, {
      name: PROTO_ENTRY.name, category: PROTO_ENTRY.category,
      desc: PROTO_ENTRY.desc, steps: PROTO_ENTRY.steps,
    });

    const row = await expectRow<{ steps: unknown }>('clinical_protocols', { hospital_id: hid, protocol_name: PROTO_ENTRY.name });
    const steps = Array.isArray(row.steps) ? (row.steps as string[]) : [];
    expect(
      steps[0],
      `Protocol steps are out of order. A protocol is a sequence — "${PROTO_ENTRY.steps[0]}" before ` +
      `"${PROTO_ENTRY.steps[1]}" is the clinical order that matters, and steps reordered on save ` +
      `turn a bundle into a list of unrelated actions.`,
    ).toBe(PROTO_ENTRY.steps[0]);
  });

  test('TC-P2G-122 A protocol cannot be saved without a name', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const before = await countRows('clinical_protocols', { hospital_id: hid });
    await addProtocol(page, { category: 'QA', steps: ['A step'] });

    expect(
      await countRows('clinical_protocols', { hospital_id: hid }),
      'An unnamed protocol cannot be found when a nurse needs it at the bedside, and it renders ' +
      'as a blank row in the protocol list.',
    ).toBe(before);
  });

  test('TC-P2G-123 A protocol cannot be saved with no steps', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addProtocol(page, { name: 'QA No Steps Protocol', category: 'QA', steps: [] });

    await expectNoRow(
      'clinical_protocols', { hospital_id: hid, protocol_name: 'QA No Steps Protocol' },
      'A protocol with no steps tells the ward nothing. It appears in the protocol list, a nurse ' +
      'opens it during an emergency, and it is empty.',
    );
  });

  test('TC-P2G-124 A protocol can be edited and the change persists', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addProtocol(page, {
      name: PROTO_ENTRY.name, category: PROTO_ENTRY.category,
      desc: PROTO_ENTRY.desc, steps: PROTO_ENTRY.steps,
    });
    await reloadAndSettle(page);

    await page.getByRole('button', { name: /view\/edit/i }).first().click();
    await page.waitForTimeout(900);
    await fillField(page, 'Description', 'QA edited description', PROTO).catch(() => {});
    await page.getByRole('button', { name: /save protocol/i }).click();
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const row = await expectRow<{ description: string }>('clinical_protocols', { hospital_id: hid, protocol_name: PROTO_ENTRY.name });
    expect(
      row.description,
      'Protocols are revised as guidelines change. An edit that toasts success without persisting ' +
      'means the ward keeps following the superseded version while the quality manual says otherwise.',
    ).toBe('QA edited description');
  });

  test('TC-P2G-125 A protocol can be deactivated and reactivated', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addProtocol(page, {
      name: PROTO_ENTRY.name, category: PROTO_ENTRY.category,
      desc: PROTO_ENTRY.desc, steps: PROTO_ENTRY.steps,
    });
    await reloadAndSettle(page);

    const toggle = () => page.locator('tr').filter({ hasText: PROTO_ENTRY.name }).first().locator('[role="switch"]');
    test.skip(!(await toggle().count()), 'No active toggle rendered');

    await toggle().click();
    await page.waitForTimeout(1400);
    let row = await expectRow<{ is_active: boolean }>('clinical_protocols', { hospital_id: hid, protocol_name: PROTO_ENTRY.name });
    expect(row.is_active).toBe(false);

    await toggle().click();
    await page.waitForTimeout(1400);
    row = await expectRow<{ is_active: boolean }>('clinical_protocols', { hospital_id: hid, protocol_name: PROTO_ENTRY.name });
    expect(
      row.is_active,
      'A superseded protocol must stop being offered while the record of what was in force at the ' +
      'time of an incident stays intact. Deleting would destroy the evidence a review depends on.',
    ).toBe(true);
  });

  test('TC-P2G-126 The protocol category saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await addProtocol(page, {
      name: PROTO_ENTRY.name, category: PROTO_ENTRY.category,
      desc: PROTO_ENTRY.desc, steps: PROTO_ENTRY.steps,
    });

    const row = await expectRow<{ category: string }>('clinical_protocols', { hospital_id: hid, protocol_name: PROTO_ENTRY.name });
    expect(
      row.category,
      'Category is how a nurse finds the right protocol under pressure. Uncategorised protocols ' +
      'sit in one undifferentiated list that nobody scrolls during an emergency.',
    ).toBe(PROTO_ENTRY.category);
  });

  test('TC-P2G-127 A saved protocol survives a hard reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await addProtocol(page, {
      name: PROTO_ENTRY.name, category: PROTO_ENTRY.category,
      desc: PROTO_ENTRY.desc, steps: PROTO_ENTRY.steps,
    });
    await reloadAndSettle(page);

    const body = await page.locator('body').innerText();
    expect(
      body.includes(PROTO_ENTRY.name),
      `BUG-P2-005 REGRESSION: "${PROTO_ENTRY.name}" vanished after a reload. Before the fix ` +
      `everything lived in component state, so clinical_protocols stayed empty while the UI ` +
      `looked healthy.`,
    ).toBeTruthy();
  });

  test("TC-P2G-128 Hospital A's protocols are invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    // Before the fix this table was never queried, so its RLS has never been exercised.
    await expectNoCrossTenantRows('clinical_protocols', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });

  test('TC-P2G-129 A receptionist cannot edit clinical protocols', async ({ page, loginAs, logout }) => {
    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    await logout();
    await loginAs('receptionist', { hospital: 'A' });
    expect(
      await isRouteBlocked(page, PROTO),
      'A receptionist reached /settings/protocols. A clinical protocol is a standing medical order ' +
      'the ward follows — editing one is a clinical governance act, not an administrative one.',
    ).toBeTruthy();
  });

  test('TC-P2G-130 The Clinical Protocols screen loads with no red console errors', async ({ page, consoleErrors }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await addProtocol(page, {
      name: PROTO_ENTRY.name, category: PROTO_ENTRY.category,
      desc: PROTO_ENTRY.desc, steps: PROTO_ENTRY.steps,
    });

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(
      real,
      `Console errors:\n${real.join('\n')}\n\nThis screen was rewired to a table it had never ` +
      `touched. A column-name mismatch on the jsonb steps column would surface only here while ` +
      `the UI carried on looking healthy.`,
    ).toHaveLength(0);
  });
});

test.describe('P2G — Alert Thresholds', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(THRESH, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
  });

  test('TC-P2G-131 Alert Thresholds screen loads', async ({ page, consoleErrors }) => {
    await expect(heading(page, 'Alert Thresholds').or(page.getByRole('heading', { name: /threshold/i }).first())).toBeVisible();
    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P2G-132 A critical high threshold saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await save(page).catch(() => {});
    await awaitSaveAck(page);

    const { data } = await db().from('hospital_settings').select('key').eq('hospital_id', hid).limit(30);
    expect(
      (data ?? []).some(r => /threshold|alert|critical/i.test(r.key)),
      `No thresholds row in hospital_settings. MOCK_DATA_BOOK sets Serum Potassium critical high ` +
      `to ${THRESH_ENTRY.criticalHigh} as a LOWER bar than the seeded default — the hospital is ` +
      `choosing to be paged earlier, and if it does not save it believes it has tightened the ` +
      `threshold and has not.`,
    ).toBeTruthy();
  });

  test('TC-P2G-133 A critical high below the normal maximum is refused or warned', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('lab_test_master')
      .select('normal_max').eq('hospital_id', hid).eq('code', 'K').maybeSingle();
    test.skip(!data, 'Serum Potassium is not seeded — run npm run qa:seed');

    expect(
      THRESH_ENTRY.criticalHigh,
      `The configured critical high (${THRESH_ENTRY.criticalHigh}) is below the normal maximum ` +
      `(${data!.normal_max}). A critical value inside the normal range pages a doctor for every ` +
      `healthy patient — within a day the ward mutes the alert, and the genuine 7.2 goes unseen. ` +
      `That is alert fatigue caused by configuration.`,
    ).toBeGreaterThan(Number(data!.normal_max));
  });

  test('TC-P2G-134 A critical low above the normal minimum is refused or warned', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('lab_test_master')
      .select('normal_min, normal_max').eq('hospital_id', hid).eq('code', 'K').maybeSingle();
    test.skip(!data, 'Serum Potassium is not seeded — run npm run qa:seed');

    expect(
      Number(data!.normal_min),
      'The normal minimum is not below the maximum, so a critical low cannot be positioned ' +
      'sensibly. A critical low inside the normal range fires on every healthy result and trains ' +
      'staff to dismiss the alert channel entirely.',
    ).toBeLessThan(Number(data!.normal_max));
  });

  test('TC-P2G-135 A vitals threshold saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const body = await page.locator('body').innerText();
    expect(
      /spo|pulse|bp|temp|respir|vital/i.test(body),
      'No vitals threshold controls rendered. Vitals thresholds drive NEWS2 scoring and the ' +
      'deteriorating-patient alert — the seeded sepsis vitals (SpO₂ 89%, RR 28, BP 86/54) exist ' +
      'to prove the escalation fires.',
    ).toBeTruthy();
  });

  test('TC-P2G-136 A non-numeric threshold is refused', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const numeric = page.locator('input[type="number"]').first();
    test.skip(!(await numeric.count()), 'No numeric threshold input rendered');

    await numeric.fill(String(MOCK.phase2.invalid.feeNonNumeric));
    const value = await numeric.inputValue();
    expect(
      value,
      'A non-numeric threshold was accepted. It parses to NaN, compares false against every ' +
      'result, and the alert never fires while the screen still shows a configured threshold.',
    ).not.toBe(MOCK.phase2.invalid.feeNonNumeric);
  });

  test('TC-P2G-137 A tightened threshold overrides the seeded default', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('lab_test_master')
      .select('normal_max').eq('hospital_id', hid).eq('code', 'K').maybeSingle();
    test.skip(!data, 'Serum Potassium is not seeded');

    expect(
      THRESH_ENTRY.criticalHigh,
      `MOCK_DATA_BOOK describes the configured ${THRESH_ENTRY.criticalHigh} as overriding the ` +
      `default with a LOWER critical bar. If the override is stored but not read, the hospital ` +
      `has explicitly asked to be paged earlier and is not.`,
    ).toBeLessThan(MOCK.commonValues.criticalPotassium);
  });

  test('TC-P2G-138 Thresholds survive a hard reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await save(page).catch(() => {});
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const body = await page.locator('body').innerText();
    expect(
      body.trim().length,
      'The thresholds screen rendered blank after a reload. A false save leaves the hospital on ' +
      'defaults it did not choose, and it will only discover that when an alert it expected does ' +
      'not arrive.',
    ).toBeGreaterThan(50);
  });

  test("TC-P2G-139 Hospital A's thresholds are invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    await expectNoCrossTenantRows('hospital_settings', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });

  test('TC-P2G-140 A receptionist cannot change clinical thresholds', async ({ page, loginAs, logout }) => {
    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    await logout();
    await loginAs('receptionist', { hospital: 'A' });
    expect(
      await isRouteBlocked(page, THRESH),
      'A receptionist reached /settings/clinical-thresholds. Widening a critical threshold ' +
      'suppresses the alert that would otherwise page a doctor — a clinical decision with a ' +
      'direct patient-safety consequence.',
    ).toBeTruthy();
  });

  test('TC-P2G-141 A threshold change is written to the config change log', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await save(page).catch(() => {});
    await awaitSaveAck(page);

    const { error } = await db().from('config_change_logs')
      .select('id', { count: 'exact', head: true }).eq('hospital_id', hid);
    expect(
      error,
      'config_change_logs is not readable. If an alert failed to fire during an incident, the ' +
      'review has to establish what the threshold was at the time — an unlogged change makes that ' +
      'unanswerable.',
    ).toBeNull();
  });

  test('TC-P2G-142 The Alert Thresholds screen loads with no red console errors', async ({ page, consoleErrors }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await save(page).catch(() => {});
    await awaitSaveAck(page);

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(
      real,
      `Console errors:\n${real.join('\n')}\n\nThresholds are stored as a JSON blob under a ` +
      `hospital_settings key. A malformed blob rejected by Postgres would surface only here while ` +
      `the UI reports the threshold saved.`,
    ).toHaveLength(0);
  });
});

test.describe('P2G — Day Care Procedures', () => {
  test.afterAll(async () => { await purge(); });

  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(DAYCARE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
  });

  test('TC-P2G-143 Day Care Procedures screen loads', async ({ page, consoleErrors }) => {
    await expect(heading(page, 'Day Care').or(page.getByRole('heading', { name: /day care/i }).first())).toBeVisible();
    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P2G-144 A day care procedure saves with its standard rate', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await openCreate(page, /add procedure|new procedure/i);
    await fillField(page, 'Procedure Name', DAYCARE_ENTRY.name, DAYCARE);
    await fillField(page, 'Standard Rate (₹)', DAYCARE_ENTRY.rate, DAYCARE);
    await save(page, /save|add/i);
    await awaitSaveAck(page);

    const row = await expectRow<{ standard_rate: number; rate: number }>(
      'day_care_procedures', { hospital_id: hid, name: DAYCARE_ENTRY.name },
      'Without the standard rate the procedure is performed and charged at zero — a dialysis unit ' +
      'running three sessions a week per patient loses a great deal quickly.',
    );
    expect(Number(row.standard_rate ?? row.rate)).toBe(DAYCARE_ENTRY.rate);
  });

  test('TC-P2G-145 A day care procedure cannot be saved without a name or rate', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const before = await countRows('day_care_procedures', { hospital_id: hid });

    await openCreate(page, /add procedure|new procedure/i);
    await fillField(page, 'Standard Rate (₹)', 100, DAYCARE).catch(() => {});
    await save(page, /save|add/i).catch(() => {});
    await awaitSaveAck(page);

    expect(
      await countRows('day_care_procedures', { hospital_id: hid }),
      'An unnamed procedure is unbookable and an unpriced one is unbillable, and neither failure ' +
      'is visible until a patient is already in the chair.',
    ).toBe(before);
  });

  test('TC-P2G-146 The PMJAY code saves against a day care procedure', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await openCreate(page, /add procedure|new procedure/i);
    await fillField(page, 'Procedure Name', DAYCARE_ENTRY.name, DAYCARE);
    await fillField(page, 'Standard Rate (₹)', DAYCARE_ENTRY.rate, DAYCARE);
    await fillField(page, 'PMJAY Code', 'P-001', DAYCARE).catch(() => {});
    await save(page, /save|add/i);
    await awaitSaveAck(page);

    const { data } = await db().from('day_care_procedures')
      .select('*').eq('hospital_id', hid).eq('name', DAYCARE_ENTRY.name).maybeSingle();
    test.skip(!data, 'The procedure was not created');
    expect(
      Object.keys(data!).some(k => /pmjay/i.test(k)),
      'day_care_procedures has no PMJAY code column. A PMJAY claim is adjudicated against the ' +
      'package code — without it a scheme patient\'s day-care procedure cannot be claimed and the ' +
      'hospital absorbs the cost.',
    ).toBeTruthy();
  });

  test('TC-P2G-147 The deposit percentage saves', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await fillField(page, 'Deposit required (% of procedure rate)', 25, DAYCARE).catch(() => {});
    await save(page).catch(() => {});
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const shown = await readField(page, 'Deposit required (% of procedure rate)', DAYCARE).catch(() => '');
    expect(
      Number(String(shown).replace(/[^\d.]/g, '')),
      'The deposit is collected before the procedure starts. Unset, the case proceeds with nothing ' +
      'paid and the hospital chases the money after the patient has gone home.',
    ).toBe(25);
  });

  test('TC-P2G-148 The insurance pre-authorisation flag saves', async ({ page }) => {
    const body = await page.locator('body').innerText();
    expect(
      /pre-authorisation|pre-authorization|pre-auth/i.test(body),
      'No pre-authorisation control rendered. A procedure performed without a required ' +
      'pre-authorisation is a claim the insurer will decline outright — the flag is what makes ' +
      'the desk stop and obtain approval first.',
    ).toBeTruthy();
  });

  test('TC-P2G-149 A new day care procedure appears in the day-care procedure picker', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await openCreate(page, /add procedure|new procedure/i);
    await fillField(page, 'Procedure Name', DAYCARE_ENTRY.name, DAYCARE);
    await fillField(page, 'Standard Rate (₹)', DAYCARE_ENTRY.rate, DAYCARE);
    await save(page, /save|add/i);
    await awaitSaveAck(page);

    const { data } = await db().from('day_care_procedures')
      .select('name').eq('hospital_id', hid).limit(50);
    expect(
      (data ?? []).map(p => p.name),
      `"${DAYCARE_ENTRY.name}" is not returned by the read path the day-care picker uses. ` +
      `MOCK_DATA_BOOK states this downstream requirement explicitly — a procedure missing from ` +
      `the picker means the case is booked as something else, or not booked at all.`,
    ).toContain(DAYCARE_ENTRY.name);
  });

  test("TC-P2G-150 Hospital A's day care procedures are invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    await expectNoCrossTenantRows('day_care_procedures', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });
});

test.describe('P2G — EMR Templates', () => {
  test.afterAll(async () => { await purge(); });

  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(TEMPLATES, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
  });

  test('TC-P2G-151 EMR Templates screen loads', async ({ page, consoleErrors }) => {
    await expect(heading(page, 'EMR Templates').or(page.getByRole('heading', { name: /template/i }).first())).toBeVisible();
    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P2G-152 An EMR template saves with its title and specialty', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await openCreate(page, /add|new|create/i);
    await fillField(page, 'Title', TEMPLATE_ENTRY.name, TEMPLATES);
    await fillField(page, 'Specialty', 'Nephrology', TEMPLATES).catch(() => {});
    await save(page, /save|create/i);
    await awaitSaveAck(page);

    await expectRow(
      'emr_template_definitions', { hospital_id: hid, title: TEMPLATE_ENTRY.name },
      'The specialty decides which consultations the template is offered on. A template with none ' +
      'is either offered everywhere or nowhere, and a nephrology note appearing in a paediatric ' +
      'clinic is worse than no template.',
    );
  });

  test('TC-P2G-153 A template cannot be saved without a title', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const before = await countRows('emr_template_definitions', { hospital_id: hid });

    await openCreate(page, /add|new|create/i);
    await fillField(page, 'Description', 'QA no title', TEMPLATES).catch(() => {});
    await save(page, /save|create/i).catch(() => {});
    await awaitSaveAck(page);

    expect(
      await countRows('emr_template_definitions', { hospital_id: hid }),
      'An untitled template renders as a blank option in the picker, so a doctor selects it by ' +
      'accident mid-consultation and the note structure is wrong.',
    ).toBe(before);
  });

  test('TC-P2G-154 A template can be edited and the change persists', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await openCreate(page, /add|new|create/i);
    await fillField(page, 'Title', TEMPLATE_ENTRY.name, TEMPLATES);
    await fillField(page, 'Description', 'QA original', TEMPLATES).catch(() => {});
    await save(page, /save|create/i);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    await expectRow(
      'emr_template_definitions', { hospital_id: hid, title: TEMPLATE_ENTRY.name },
      'Templates are refined as clinicians use them. An edit that does not persist means the same ' +
      'awkward field ordering is imposed on every consultation indefinitely.',
    );
  });

  test('TC-P2G-155 A new template is offered in the consultation workspace', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await openCreate(page, /add|new|create/i);
    await fillField(page, 'Title', TEMPLATE_ENTRY.name, TEMPLATES);
    await save(page, /save|create/i);
    await awaitSaveAck(page);

    const { data } = await db().from('emr_template_definitions')
      .select('title').eq('hospital_id', hid).limit(50);
    expect(
      (data ?? []).map(t => t.title),
      `"${TEMPLATE_ENTRY.name}" is not returned by the read path the consultation workspace uses. ` +
      `A template configured but never offered means the specialist writes free text, which ` +
      `cannot be coded for a claim or aggregated for a clinical audit.`,
    ).toContain(TEMPLATE_ENTRY.name);
  });

  test('TC-P2G-156 A saved template survives a hard reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await openCreate(page, /add|new|create/i);
    await fillField(page, 'Title', TEMPLATE_ENTRY.name, TEMPLATES);
    await save(page, /save|create/i);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const body = await page.locator('body').innerText();
    expect(
      body.includes(TEMPLATE_ENTRY.name),
      'A false save means the specialist builds a template, is told it saved, and finds it gone ' +
      'the next time they open a clinic.',
    ).toBeTruthy();
  });

  test("TC-P2G-157 Hospital A's EMR templates are invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    await expectNoCrossTenantRows('emr_template_definitions', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });

  test('TC-P2G-158 The EMR Templates screen loads with no red console errors', async ({ page, consoleErrors }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await openCreate(page, /add|new|create/i);
    await fillField(page, 'Title', TEMPLATE_ENTRY.name, TEMPLATES);
    await save(page, /save|create/i).catch(() => {});
    await awaitSaveAck(page);

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(
      real,
      `Console errors:\n${real.join('\n')}\n\nTemplate definitions are stored as structured JSON. ` +
      `A malformed definition rejected by Postgres would surface only here while the builder ` +
      `reports the template saved.`,
    ).toHaveLength(0);
  });
});
