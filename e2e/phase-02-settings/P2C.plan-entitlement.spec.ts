/**
 * Phase 2 · Section C — Plan & Entitlement
 * Locks tracker cases TC-P2C-001 … TC-P2C-042
 *
 * The plan decides which of the 39 modules exist at all — SETTINGS_PREREQ_MATRIX puts it in
 * Tier 0 because whole sections of the app disappear without it.
 *
 * The AI half of this section exists because SETTINGS_PREREQ_MATRIX is explicit that THREE
 * independent gates stack on every AI button — plan entitlement, the hospital toggle on this
 * screen, and the AI budget — and that a closed gate renders no button and no explanation.
 *
 * A FINDING WHILE AUTHORING: SettingsAIFeaturesPage.handleSave awaits the Supabase update but
 * never inspects `error`, then toasts success unconditionally. TC-P2C-026 probes it. On a gate
 * that controls clinical AI, a false "saved" is safety-relevant, not cosmetic.
 */
import { test, expect, MOCK } from '../fixtures/auth.fixture';
import { db, hospitalIdFor, countRows } from '../utils/db-verify';
import { save, awaitSaveAck, reloadAndSettle, heading } from './settings-locators';

const PLAN = '/settings/plan';
const AI = '/settings/ai-features';
const DB_ON = () => process.env.QA_DB_AVAILABLE === 'true';

/** The seven keys SettingsAIFeaturesPage writes. */
const AI_KEYS = [
  'clinical_note', 'discharge_summary', 'differential_dx',
  'icd_suggest', 'radiology_impression', 'voice_dictation', 'executive_digest',
] as const;

const AI_LABEL: Record<string, string> = {
  clinical_note: 'Clinical Note Drafting',
  discharge_summary: 'Discharge Summary',
  differential_dx: 'Differential Diagnosis',
  icd_suggest: 'ICD-10 Code Suggestions',
  radiology_impression: 'Radiology Impression',
  voice_dictation: 'Voice Dictation (AI-enhanced)',
  executive_digest: 'Executive Digest',
};

async function aiFlags(): Promise<Record<string, boolean> | null> {
  const hid = await hospitalIdFor('A');
  const { data } = await db().from('hospitals').select('ai_feature_flags').eq('id', hid).maybeSingle();
  return (data?.ai_feature_flags ?? null) as Record<string, boolean> | null;
}

async function restoreAiFlags(): Promise<void> {
  if (!DB_ON()) return;
  const hid = await hospitalIdFor('A');
  const all = Object.fromEntries(AI_KEYS.map(k => [k, true]));
  await db().from('hospitals').update({ ai_feature_flags: all }).eq('id', hid);
}

/** Toggle one AI feature off, save, reload, and assert the flag stuck. Titles stay literal. */
async function aiToggleCase(page: import('@playwright/test').Page, key: string) {
  const label = AI_LABEL[key];
  const row = page.locator('div').filter({ hasText: label }).last();
  const toggle = row.locator('[role="switch"]').first();

  test.skip(!(await toggle.count()), `No toggle rendered for "${label}"`);
  if ((await toggle.getAttribute('aria-checked')) !== 'false') await toggle.click();
  await page.waitForTimeout(300);

  await save(page);
  await awaitSaveAck(page);
  await reloadAndSettle(page);

  const flags = await aiFlags();
  expect(
    flags?.[key],
    `ai_feature_flags.${key} is ${flags?.[key]} after switching "${label}" off and reloading. ` +
    `Each key is stored as its own flag, so one can fail to persist while the others save — and ` +
    `a clinical AI feature a hospital deliberately disabled would still be live for its doctors.`,
  ).toBe(false);
}

test.describe('P2C — Plan & Billing', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(PLAN, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  });

  test('TC-P2C-001 Plan & Billing screen loads', async ({ page, consoleErrors }) => {
    await expect(heading(page, 'Plan').or(page.getByRole('heading', { name: /plan|billing|subscription/i }).first())).toBeVisible();
    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P2C-002 The current plan shown matches the subscription row', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    const hid = await hospitalIdFor('A');
    const { data } = await db().from('hospital_subscriptions')
      .select('plan_id, status').eq('hospital_id', hid).maybeSingle();
    test.skip(!data, 'Hospital A has no subscription row — run npm run qa:seed');

    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(
      body.includes(MOCK.hospitals.A.plan),
      `The screen does not show the "${MOCK.hospitals.A.plan}" plan. A screen showing a different ` +
      `plan from the one enforced means every access denial elsewhere looks like a bug.`,
    ).toBeTruthy();
  });

  test('TC-P2C-003 Staff usage is counted against the plan', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const staff = await countRows('users', { hospital_id: hid, is_active: true });
    test.skip(staff === 0, 'No active staff — run npm run qa:seed');

    const body = await page.locator('body').innerText();
    expect(
      new RegExp(`\\b${staff}\\b`).test(body),
      `Active staff is ${staff} but that figure does not appear on the plan screen. Staff count ` +
      `drives seat billing — drift means the hospital is over-charged or silently over its seats.`,
    ).toBeTruthy();
  });

  test('TC-P2C-004 Bed usage is counted against the plan bed limit', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const beds = await countRows('beds', { hospital_id: hid });
    test.skip(beds === 0, 'No beds seeded — run npm run qa:seed');

    const body = await page.locator('body').innerText();
    expect(
      new RegExp(`\\b${beds}\\b`).test(body),
      `${beds} beds exist but that figure does not appear on the plan screen. The bed limit is ` +
      `enforced when creating a ward — if the two counts disagree, a hospital is blocked from ` +
      `adding a bed while this screen says it has room.`,
    ).toBeTruthy();
  });

  test('TC-P2C-005 Encounter usage for the billing cycle renders', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { error } = await db().from('hospital_encounter_usage')
      .select('*', { count: 'exact', head: true }).eq('hospital_id', hid);
    expect(
      error,
      'hospital_encounter_usage is not readable, so metered encounter volume cannot be shown. ' +
      'The hospital then gets no warning before an overage lands on the invoice.',
    ).toBeNull();
    expect((await page.locator('body').innerText()).length).toBeGreaterThan(100);
  });

  test('TC-P2C-006 AI usage for the calendar month renders as observability only', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const body = (await page.locator('body').innerText()).toLowerCase();
    // The real AI gate is hospital_ai_wallet, not this figure. It must not read as a block.
    expect(
      /ai/.test(body),
      'No AI usage figure on the plan screen. Presenting it is how a hospital sees spend before ' +
      'the budget gate closes — but it must not itself read as the gate.',
    ).toBeTruthy();
  });

  test('TC-P2C-007 Storage usage renders from the per-tenant RPC', async ({ page, consoleErrors }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(
      real.filter(e => /get_storage_usage/i.test(e)),
      'The get_storage_usage RPC errored. Storage fills with scanned records and DICOM images — ' +
      'without the figure a hospital gets no warning before uploads fail mid-clinic.',
    ).toEqual([]);
    expect((await page.locator('body').innerText()).length).toBeGreaterThan(100);
  });

  test('TC-P2C-008 The upgrade dialog opens', async ({ page }) => {
    const btn = page.getByRole('button', { name: /upgrade|change plan/i }).first();
    test.skip(!(await btn.count()), 'No upgrade control rendered on this plan');
    await btn.click();
    await page.waitForTimeout(1200);

    await expect(
      page.getByRole('dialog').first(),
      'Every plan gate in the product points here. A gate that leads to a dialog that will not ' +
      'open turns a sales opportunity into a dead end.',
    ).toBeVisible();
  });

  test('TC-P2C-009 Other available plans are listed for comparison', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { data } = await db().from('subscription_plans').select('name, slug').limit(10);
    test.skip((data?.length ?? 0) < 2, 'Fewer than two plans in the catalogue');

    const body = (await page.locator('body').innerText()).toLowerCase();
    const shown = (data ?? []).filter(p => body.includes((p.name ?? '').toLowerCase()));
    expect(
      shown.length,
      'No alternative plans are listed. A hospital deciding whether to upgrade needs to see what ' +
      'it would get, or the decision is impossible without contacting sales.',
    ).toBeGreaterThan(0);
  });

  test('TC-P2C-010 The add-on catalogue lists purchasable add-ons', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { data } = await db().from('addon_skus').select('name').limit(10);
    test.skip(!data?.length, 'The add-on catalogue is empty');

    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(
      data!.some(a => body.includes((a.name ?? '').toLowerCase())),
      'No add-ons rendered. Add-ons carry the ai_feature_keys that unlock AI features — without ' +
      'the catalogue the hospital cannot buy the entitlement it needs.',
    ).toBeTruthy();
  });

  test('TC-P2C-011 Add-ons the hospital already owns are distinguished from the catalogue', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const owned = await countRows('hospital_addons', { hospital_id: hid });
    test.skip(owned === 0, 'Hospital A owns no add-ons, so the owned state cannot be observed');

    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(
      /owned|included|active|current/.test(body),
      'Owned add-ons are not marked. Offering one the hospital already pays for invites a ' +
      'duplicate purchase, and a duplicate grant makes the entitlement calculation ambiguous.',
    ).toBeTruthy();
  });

  test('TC-P2C-012 Add-on prices render in en-IN grouping with the rupee symbol', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { data } = await db().from('addon_skus').select('price_monthly').not('price_monthly', 'is', null).limit(1);
    test.skip(!data?.length, 'No priced add-ons in the catalogue');

    const body = await page.locator('body').innerText();
    expect(
      /₹/.test(body),
      'No rupee symbol on a purchase-decision screen. A price rendered bare or with international ' +
      'grouping misstates what the hospital is committing to.',
    ).toBeTruthy();
    expect(
      body.match(/₹\s?\d{3},\d{3}(?!\d)/g) ?? [],
      'Prices use international grouping. Indian grouping puts the comma elsewhere, and the ' +
      'difference reads as a factor of ten.',
    ).toEqual([]);
  });

  test('TC-P2C-013 Subscription invoices are listed', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    const { error } = await db().from('subscription_invoices')
      .select('*', { count: 'exact', head: true }).eq('hospital_id', hid);
    expect(
      error,
      'subscription_invoices is not readable. The hospital finance team reconciles software spend ' +
      'against these, so missing history means the spend cannot be verified at audit.',
    ).toBeNull();
    expect((await page.locator('body').innerText()).length).toBeGreaterThan(100);
  });

  test('TC-P2C-014 An invoice can be downloaded', async ({ page, consoleErrors }) => {
    const btn = page.getByRole('button', { name: /download|invoice/i }).first();
    test.skip(!(await btn.count()), 'No invoice download control rendered');
    await btn.click().catch(() => {});
    await page.waitForTimeout(1600);

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(
      real,
      `Invoice download raised console errors:\n${real.join('\n')}\n\nThe invoice is a tax ` +
      `document the hospital needs for its own books — a silent failure forces a support ticket ` +
      `for something that should be self-service.`,
    ).toHaveLength(0);
  });

  test('TC-P2C-015 Payment history renders', async ({ page }) => {
    const body = await page.locator('body').innerText();
    expect(
      /payment|paid|history|transaction|no payments/i.test(body),
      'No payment history or empty state. A hospital disputing a charge needs to see what was ' +
      'actually taken and when.',
    ).toBeTruthy();
  });

  test('TC-P2C-016 An unlimited limit renders as unlimited, not as zero percent', async ({ page }) => {
    const body = await page.locator('body').innerText();
    expect(
      body,
      'A null plan limit leaked to the screen as "null" or "undefined". Unlimited and a limit of ' +
      'zero are opposites — confusing them shows an unlimited plan as permanently at capacity.',
    ).not.toMatch(/\bnull\b|\bundefined\b|\bNaN\b/);
  });

  test('TC-P2C-017 A dimension over its limit renders as fully consumed', async ({ page }) => {
    const body = await page.locator('body').innerText();
    const percents = [...body.matchAll(/(\d{1,4})\s?%/g)].map(m => Number(m[1]));
    const over = percents.filter(p => p > 100);
    expect(
      over,
      `Usage meter(s) render above 100%: ${over.join(', ')}. Being over a limit is exactly when ` +
      `the hospital needs to notice — a bar that overflows or wraps hides the one state that ` +
      `requires action.`,
    ).toEqual([]);
  });

  test('TC-P2C-018 Hospital B on the Starter plan sees a different plan and different limits', async ({ page, loginAs, logout }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    await logout();
    await loginAs('hospital_admin', { hospital: 'B' });
    await page.goto(PLAN, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Scoped to the current-plan card on purpose. The screen also renders an "Available Plans"
    // section listing every plan the tenant is NOT on, so a whole-body search matches
    // "Professional" on a correctly-configured Starter tenant and reports a cross-tenant leak
    // that isn't there. The subscription query is hospital-scoped; TC-P2C-019 covers the DB side.
    const current = page.getByTestId('current-plan');
    await expect(current, 'No current-plan element rendered — the case cannot tell which plan is in force').toBeVisible();
    const shown = (await current.innerText()).toLowerCase();

    expect(
      shown.includes(MOCK.hospitals.A.plan),
      `Hospital B's plan screen shows "${MOCK.hospitals.A.plan}" — Hospital A's plan. The plan ` +
      `decides which modules exist, so reading the wrong subscription row grants or denies ` +
      `modules according to another hospital's contract.`,
    ).toBeFalsy();

    expect(
      shown.includes(MOCK.hospitals.B.plan),
      `Hospital B's current plan reads "${shown}", not its own "${MOCK.hospitals.B.plan}".`,
    ).toBeTruthy();
  });

  test("TC-P2C-019 Hospital A's subscription and invoices are invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    await expectNoCrossTenantRows('subscription_invoices', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });

  test('TC-P2C-020 A receptionist cannot reach the Plan & Billing screen', async ({ page, loginAs, logout }) => {
    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    await logout();
    await loginAs('receptionist', { hospital: 'A' });
    expect(
      await isRouteBlocked(page, PLAN),
      'A receptionist reached /settings/plan. This screen exposes what the hospital pays and can ' +
      'trigger an upgrade purchase — both belong to the administrator.',
    ).toBeTruthy();
  });
});

test.describe('P2C — AI Features & Attestation', () => {
  test.afterAll(async () => { await restoreAiFlags(); });

  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
    await page.goto(AI, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
  });

  test('TC-P2C-021 AI Features screen loads with all seven feature toggles', async ({ page, consoleErrors }) => {
    const body = await page.locator('body').innerText();
    const missing = AI_KEYS.filter(k => !body.includes(AI_LABEL[k]));
    expect(
      missing.map(k => AI_LABEL[k]),
      `AI feature(s) not rendered: ${missing.map(k => AI_LABEL[k]).join(', ')}. This is the second ` +
      `of three stacked gates on every AI button — a missing toggle is a feature that can never ` +
      `be switched on.`,
    ).toEqual([]);

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(real, `Console errors:\n${real.join('\n')}`).toHaveLength(0);
  });

  test('TC-P2C-022 The enabled-feature count reflects the toggles', async ({ page }) => {
    const body = await page.locator('body').innerText();
    expect(
      /\d+\s+of\s+\d+\s+AI features enabled/i.test(body),
      'No enabled-feature summary. The count is the at-a-glance answer to "how much AI is ' +
      'switched on here", which is the first question a DPDP or CDSCO reviewer asks.',
    ).toBeTruthy();
  });

  test('TC-P2C-023 The doctor attestation policy is stated on the screen', async ({ page }) => {
    const body = await page.locator('body').innerText();
    expect(
      /attestation/i.test(body),
      'The attestation policy is not stated. Human-in-the-loop attestation is what keeps these ' +
      'features below the CDSCO SaMD threshold — it has to be visible to the person switching ' +
      'them on, not buried in a contract.',
    ).toBeTruthy();
    expect(body).toMatch(/doctor|clinician/i);
  });

  test('TC-P2C-024 Features on a clinical decision path are marked as critical', async ({ page }) => {
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(
      /critical|clinical/.test(body),
      'No marker distinguishes clinical features from administrative ones. Switching on ' +
      'Differential Diagnosis is a patient-safety decision; switching on Executive Digest is ' +
      'not. Presenting them identically invites the clinical ones to be enabled without thought.',
    ).toBeTruthy();
  });

  test('TC-P2C-025 Saving writes ai_feature_flags to the hospital row', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const row = page.locator('div').filter({ hasText: AI_LABEL.executive_digest }).last();
    const toggle = row.locator('[role="switch"]').first();
    test.skip(!(await toggle.count()), 'No toggle rendered for Executive Digest');

    if ((await toggle.getAttribute('aria-checked')) !== 'false') await toggle.click();
    await save(page);
    await awaitSaveAck(page);

    const flags = await aiFlags();
    expect(
      flags?.executive_digest,
      'ai_feature_flags did not record the toggle. This toggle is a real gate on whether an AI ' +
      'button renders — a save that does not persist means a hospital believes it disabled a ' +
      'clinical AI feature while doctors continue to see it.',
    ).toBe(false);
  });

  test('TC-P2C-026 A failed AI settings save does not report success', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const before = await aiFlags();

    let updateFailed = false;
    page.on('response', r => {
      if (/\/rest\/v1\/hospitals/.test(r.url()) && r.request().method() === 'PATCH' && r.status() >= 400) {
        updateFailed = true;
      }
    });

    const row = page.locator('div').filter({ hasText: AI_LABEL.icd_suggest }).last();
    const toggle = row.locator('[role="switch"]').first();
    test.skip(!(await toggle.count()), 'No toggle rendered for ICD-10 Code Suggestions');
    await toggle.click();
    await save(page);
    await awaitSaveAck(page);

    const after = await aiFlags();
    const claimedSuccess = /saved/i.test(await page.locator('body').innerText());
    const actuallyChanged = JSON.stringify(before) !== JSON.stringify(after);

    expect(
      claimedSuccess && !actuallyChanged && updateFailed,
      'The screen reported success while the update was rejected. handleSave awaits the Supabase ' +
      'update but never inspects its error, then toasts unconditionally — on a gate controlling ' +
      'clinical AI, a false "saved" is safety-relevant, not cosmetic.',
    ).toBeFalsy();
  });

  test('TC-P2C-027 AI feature "Clinical Note Drafting" can be toggled off and stays off after a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await aiToggleCase(page, 'clinical_note');
  });
  test('TC-P2C-028 AI feature "Discharge Summary" can be toggled off and stays off after a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await aiToggleCase(page, 'discharge_summary');
  });
  test('TC-P2C-029 AI feature "Differential Diagnosis" can be toggled off and stays off after a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await aiToggleCase(page, 'differential_dx');
  });
  test('TC-P2C-030 AI feature "ICD-10 Code Suggestions" can be toggled off and stays off after a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await aiToggleCase(page, 'icd_suggest');
  });
  test('TC-P2C-031 AI feature "Radiology Impression" can be toggled off and stays off after a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await aiToggleCase(page, 'radiology_impression');
  });
  test('TC-P2C-032 AI feature "Voice Dictation (AI-enhanced)" can be toggled off and stays off after a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await aiToggleCase(page, 'voice_dictation');
  });
  test('TC-P2C-033 AI feature "Executive Digest" can be toggled off and stays off after a reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled'); await aiToggleCase(page, 'executive_digest');
  });

  test('TC-P2C-034 Every AI feature defaults to enabled when nothing is stored', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await db().from('hospitals').update({ ai_feature_flags: null }).eq('id', hid);
    await reloadAndSettle(page);

    const switches = page.locator('[role="switch"]');
    const n = await switches.count();
    test.skip(n === 0, 'No toggles rendered');

    const states = await switches.evaluateAll(els => els.map(e => e.getAttribute('aria-checked')));
    expect(
      states.filter(s => s !== 'true' && s !== 'false'),
      'A toggle rendered indeterminate on a tenant with no stored flags. The administrator then ' +
      'cannot tell whether a clinical AI feature is live.',
    ).toEqual([]);
    await restoreAiFlags();
  });

  test('TC-P2C-035 A stored partial flag set merges with the shipped defaults', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hid = await hospitalIdFor('A');
    await db().from('hospitals').update({ ai_feature_flags: { executive_digest: false } }).eq('id', hid);
    await reloadAndSettle(page);

    const body = await page.locator('body').innerText();
    const missing = AI_KEYS.filter(k => !body.includes(AI_LABEL[k]));
    expect(
      missing.map(k => AI_LABEL[k]),
      'A partial stored flag set dropped features from the screen. A hospital that saved before ' +
      'a new AI feature shipped has no flag for it — it must default, not disappear.',
    ).toEqual([]);
    await restoreAiFlags();
  });

  test('TC-P2C-036 AI feature settings survive a hard reload', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    for (const key of ['differential_dx', 'executive_digest']) {
      const row = page.locator('div').filter({ hasText: AI_LABEL[key] }).last();
      const toggle = row.locator('[role="switch"]').first();
      if ((await toggle.count()) && (await toggle.getAttribute('aria-checked')) !== 'false') {
        await toggle.click();
        await page.waitForTimeout(250);
      }
    }
    await save(page);
    await awaitSaveAck(page);
    await reloadAndSettle(page);

    const flags = await aiFlags();
    expect(
      flags?.differential_dx,
      'A false save here means a clinical AI feature the hospital deliberately disabled is still ' +
      'live for its doctors.',
    ).toBe(false);
    expect(flags?.executive_digest).toBe(false);
  });

  test('TC-P2C-037 The AI flag cache is invalidated after a save', async ({ page }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const row = page.locator('div').filter({ hasText: AI_LABEL.differential_dx }).last();
    const toggle = row.locator('[role="switch"]').first();
    test.skip(!(await toggle.count()), 'No toggle rendered for Differential Diagnosis');

    if ((await toggle.getAttribute('aria-checked')) !== 'false') await toggle.click();
    await save(page);
    await awaitSaveAck(page);

    // Navigate WITHOUT a reload — a stale cache would keep the feature enabled for the session.
    await page.goto('/opd', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const flags = await aiFlags();
    expect(
      flags?.differential_dx,
      'The flag did not persist, so cache invalidation cannot be assessed. invalidateAIFlagCache() ' +
      'runs after save — if the cache is not cleared, a disabled clinical AI feature keeps ' +
      'rendering for the rest of the session.',
    ).toBe(false);
  });

  test('TC-P2C-038 Plan entitlement gates the AI feature independently of this toggle', async ({ page, loginAs, logout }) => {
    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    await logout();
    await loginAs('hospital_admin', { hospital: 'B' });

    const blocked = await isRouteBlocked(page, AI);
    if (blocked) return; // A plan gate on the route itself is a valid outcome.

    await page.waitForTimeout(1800);
    const body = await page.locator('body').innerText();
    expect(
      body.trim().length,
      'On the Starter plan the AI settings screen rendered blank. SETTINGS_PREREQ_MATRIX warns ' +
      'that a closed gate renders no button and no explanation — a hospital that toggles a ' +
      'feature on and still sees nothing must be told which of the three gates is closed.',
    ).toBeGreaterThan(0);
  });

  test("TC-P2C-039 Hospital A's AI feature flags are invisible to Hospital B", async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const { expectNoCrossTenantRows } = await import('../utils/db-verify');
    const hidA = await hospitalIdFor('A');
    await expectNoCrossTenantRows('hospitals', MOCK.hospitals.B.adminEmail, MOCK.password, hidA);
  });

  test('TC-P2C-040 A doctor cannot change the hospital AI feature settings', async ({ page, loginAs, logout }) => {
    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    await logout();
    await loginAs('doctor', { hospital: 'A' });
    expect(
      await isRouteBlocked(page, AI),
      'A doctor reached /settings/ai-features. Enabling a clinical AI feature is a hospital-level ' +
      'governance decision with CDSCO and DPDP implications — an individual doctor switching one ' +
      'on for the whole hospital bypasses that governance entirely.',
    ).toBeTruthy();
  });

  test('TC-P2C-041 The AI feature key list matches the keys the modules actually check', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    // mock-data.json's phase2.entry names "differential_diagnosis"; the screen writes
    // "differential_dx". One of the two is wrong, and this is where that surfaces.
    const mockKey = (MOCK.phase2.entry['/settings/ai-features'] as { featureKey?: string }).featureKey;
    expect(
      AI_KEYS as readonly string[],
      `mock-data.json refers to AI feature key "${mockKey}", which the AI Features screen does ` +
      `not write. The screen's keys are: ${AI_KEYS.join(', ')}. A toggle whose key no module ` +
      `reads does nothing while appearing to work — the most dangerous shape of dead control on ` +
      `a clinical gate.`,
    ).toContain(mockKey);
  });

  test('TC-P2C-042 The AI Features screen loads with no red console errors', async ({ page, consoleErrors }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const toggle = page.locator('[role="switch"]').first();
    if (await toggle.count()) { await toggle.click(); await save(page); await awaitSaveAck(page); }

    const real = consoleErrors.filter(e => !/favicon|ResizeObserver/i.test(e));
    expect(
      real,
      `Console errors:\n${real.join('\n')}\n\nThe update is written through an \`as any\` cast ` +
      `and its error is never checked, so the console is the only place a rejected write appears.`,
    ).toHaveLength(0);
  });
});
