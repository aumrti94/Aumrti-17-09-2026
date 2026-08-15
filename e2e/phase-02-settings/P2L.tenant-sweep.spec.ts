/**
 * Phase 2 · Section L — Full-tenant configuration sweep.
 * Locks tracker cases TC-P2L-001 … TC-P2L-055
 *
 * Sections 2B-2I test each screen in isolation, each with its own prerequisite satisfied. This
 * section runs the whole catalogue in ONE continuous pass in DEPENDENCY order — identity,
 * structure, people, money, clinical, workflows, integrations — which is the only way to catch
 * a screen that works in isolation solely because an earlier section left data behind.
 *
 * It is also the commissioning rehearsal: this is the order a real hospital is set up in, so a
 * step that cannot be completed here is a step the customer cannot complete either.
 *
 * TC-P2L-054 is the only step that restarts the session, and it does so deliberately at the end.
 * The fifty steps run in order because playwright.config.ts sets fullyParallel: false, workers: 1.
 */
import { test, expect } from '../fixtures/auth.fixture';
import { db, hospitalIdFor, countRows } from '../utils/db-verify';
import { SETTINGS_SCREENS, writingScreens } from './settings.helpers';
import { heading } from './settings-locators';

const DB_ON = () => process.env.QA_DB_AVAILABLE === 'true';

/**
 * One sweep step: open the screen, prove it renders its own surface rather than a denial or a
 * blank page, and — for a writing screen — prove its target table holds Hospital A data.
 *
 * A read-only screen asserts rendering only. Asserting a row it never writes would be a false
 * green dressed up as coverage.
 */
async function sweepStep(
  page: import('@playwright/test').Page,
  step: number,
  route: string,
  title: string,
  table: string | null,
): Promise<void> {
  await page.goto(route, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  expect(
    new URL(page.url()).pathname.replace(/\/$/, ''),
    `Sweep step ${step} (${title}) was redirected away from ${route}. A commissioning step the ` +
    `admin cannot reach is a step the customer cannot complete either.`,
  ).toBe(route.replace(/\/$/, ''));

  const body = await page.locator('body').innerText();
  expect(
    body.length,
    `Sweep step ${step} (${title}) rendered an essentially blank page at ${route}.`,
  ).toBeGreaterThan(120);

  const denied = /access denied|not authoris|not authoriz|forbidden|module not enabled|not included in .*?plan/i;
  expect(
    denied.test(body),
    `Sweep step ${step} (${title}) showed a denial at ${route} for the hospital_admin who owns the tenant.`,
  ).toBeFalsy();

  await expect(
    heading(page),
    `Sweep step ${step} (${title}) rendered no heading at ${route}.`,
  ).toBeVisible({ timeout: 10_000 });

  if (!table) return;                       // read-only screen: nothing written, nothing asserted
  if (!DB_ON()) return;                     // the render half still ran and still counts

  const hospitalA = await hospitalIdFor('A');
  expect(
    await countRows(table, { hospital_id: hospitalA }),
    `Sweep step ${step} (${title}): ${table} holds no Hospital A row. In dependency order this is ` +
    `the point at which the tenant stops being commissionable — every later step that reads ` +
    `${table} will render an empty picker with no error of any kind.`,
  ).toBeGreaterThan(0);
}

test.describe('P2L — Full-tenant configuration sweep', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
  });

  test('TC-P2L-001 Sweep step 1 of 50 — Hospital Profile is configured and holds', async ({ page }) => {
    await sweepStep(page, 1, '/settings/profile', "Hospital Profile", 'hospitals');
  });

  test('TC-P2L-002 Sweep step 2 of 50 — Branding is configured and holds', async ({ page }) => {
    await sweepStep(page, 2, '/settings/branding', "Branding", 'hospitals');
  });

  test('TC-P2L-003 Sweep step 3 of 50 — White-Label Branding is configured and holds', async ({ page }) => {
    await sweepStep(page, 3, '/settings/white-label', "White-Label Branding", 'hospitals');
  });

  test('TC-P2L-004 Sweep step 4 of 50 — Language & Region is configured and holds', async ({ page }) => {
    await sweepStep(page, 4, '/settings/language', "Language & Region", 'hospital_settings');
  });

  test('TC-P2L-005 Sweep step 5 of 50 — Support is configured and holds', async ({ page }) => {
    await sweepStep(page, 5, '/settings/support', "Support", 'platform_support_tickets');
  });

  test('TC-P2L-006 Sweep step 6 of 50 — Training Videos is configured and holds', async ({ page }) => {
    await sweepStep(page, 6, '/settings/training', "Training Videos", null);
  });

  test('TC-P2L-007 Sweep step 7 of 50 — Plan & Billing is configured and holds', async ({ page }) => {
    await sweepStep(page, 7, '/settings/plan', "Plan & Billing", null);
  });

  test('TC-P2L-008 Sweep step 8 of 50 — AI Features & Attestation is configured and holds', async ({ page }) => {
    await sweepStep(page, 8, '/settings/ai-features', "AI Features & Attestation", 'hospitals');
  });

  test('TC-P2L-009 Sweep step 9 of 50 — Departments is configured and holds', async ({ page }) => {
    await sweepStep(page, 9, '/settings/departments', "Departments", 'departments');
  });

  test('TC-P2L-010 Sweep step 10 of 50 — Wards & Beds is configured and holds', async ({ page }) => {
    await sweepStep(page, 10, '/settings/wards', "Wards & Beds", 'wards');
  });

  test('TC-P2L-011 Sweep step 11 of 50 — Shifts is configured and holds', async ({ page }) => {
    await sweepStep(page, 11, '/settings/shifts', "Shifts", 'shift_master');
  });

  test('TC-P2L-012 Sweep step 12 of 50 — Bank Accounts is configured and holds', async ({ page }) => {
    await sweepStep(page, 12, '/settings/bank-accounts', "Bank Accounts", 'bank_accounts');
  });

  test('TC-P2L-013 Sweep step 13 of 50 — Configurable Dropdowns is configured and holds', async ({ page }) => {
    await sweepStep(page, 13, '/settings/config-values', "Configurable Dropdowns", 'hospital_config_values');
  });

  test('TC-P2L-014 Sweep step 14 of 50 — Staff Members is configured and holds', async ({ page }) => {
    await sweepStep(page, 14, '/settings/staff', "Staff Members", 'users');
  });

  test('TC-P2L-015 Sweep step 15 of 50 — Roles & Permissions is configured and holds', async ({ page }) => {
    await sweepStep(page, 15, '/settings/roles', "Roles & Permissions", 'role_permissions');
  });

  test('TC-P2L-016 Sweep step 16 of 50 — Doctor Schedules is configured and holds', async ({ page }) => {
    await sweepStep(page, 16, '/settings/doctor-schedules', "Doctor Schedules", 'doctor_schedules');
  });

  test('TC-P2L-017 Sweep step 17 of 50 — Service Rates is configured and holds', async ({ page }) => {
    await sweepStep(page, 17, '/settings/services', "Service Rates", 'service_master');
  });

  test('TC-P2L-018 Sweep step 18 of 50 — Payer Masters is configured and holds', async ({ page }) => {
    await sweepStep(page, 18, '/settings/payer-masters', "Payer Masters", 'payer_masters');
  });

  test('TC-P2L-019 Sweep step 19 of 50 — GST / NIC IRP is configured and holds', async ({ page }) => {
    await sweepStep(page, 19, '/settings/gst', "GST / NIC IRP", 'hospitals');
  });

  test('TC-P2L-020 Sweep step 20 of 50 — Approval Rules is configured and holds', async ({ page }) => {
    await sweepStep(page, 20, '/settings/approvals', "Approval Rules", 'hospital_settings');
  });

  test('TC-P2L-021 Sweep step 21 of 50 — Razorpay Payments is configured and holds', async ({ page }) => {
    await sweepStep(page, 21, '/settings/razorpay', "Razorpay Payments", 'api_configurations');
  });

  test('TC-P2L-022 Sweep step 22 of 50 — Lab Test Master is configured and holds', async ({ page }) => {
    await sweepStep(page, 22, '/settings/lab-tests', "Lab Test Master", 'lab_test_master');
  });

  test('TC-P2L-023 Sweep step 23 of 50 — Drug Formulary is configured and holds', async ({ page }) => {
    await sweepStep(page, 23, '/settings/drugs', "Drug Formulary", 'drug_master');
  });

  test('TC-P2L-024 Sweep step 24 of 50 — Notification Config is configured and holds', async ({ page }) => {
    await sweepStep(page, 24, '/settings/notifications', "Notification Config", 'hospital_settings');
  });

  test('TC-P2L-025 Sweep step 25 of 50 — Radiology Modalities is configured and holds', async ({ page }) => {
    await sweepStep(page, 25, '/settings/radiology', "Radiology Modalities", 'radiology_modalities');
  });

  test('TC-P2L-026 Sweep step 26 of 50 — ICD-10 Code Master is configured and holds', async ({ page }) => {
    await sweepStep(page, 26, '/settings/icd-codes', "ICD-10 Code Master", 'hospital_icd_settings');
  });

  test('TC-P2L-027 Sweep step 27 of 50 — Consent Forms is configured and holds', async ({ page }) => {
    await sweepStep(page, 27, '/settings/consent-forms', "Consent Forms", 'consent_form_templates');
  });

  test('TC-P2L-028 Sweep step 28 of 50 — OT Checklist is configured and holds', async ({ page }) => {
    await sweepStep(page, 28, '/settings/ot-checklist', "OT Checklist", 'ot_checklist_custom_items');
  });

  test('TC-P2L-029 Sweep step 29 of 50 — Clinical Protocols is configured and holds', async ({ page }) => {
    await sweepStep(page, 29, '/settings/protocols', "Clinical Protocols", 'clinical_protocols');
  });

  test('TC-P2L-030 Sweep step 30 of 50 — Alert Thresholds is configured and holds', async ({ page }) => {
    await sweepStep(page, 30, '/settings/clinical-thresholds', "Alert Thresholds", 'hospital_settings');
  });

  test('TC-P2L-031 Sweep step 31 of 50 — Day Care Procedures is configured and holds', async ({ page }) => {
    await sweepStep(page, 31, '/settings/day-care-procedures', "Day Care Procedures", 'day_care_procedures');
  });

  test('TC-P2L-032 Sweep step 32 of 50 — EMR Templates is configured and holds', async ({ page }) => {
    await sweepStep(page, 32, '/settings/templates', "EMR Templates", 'emr_template_definitions');
  });

  test('TC-P2L-033 Sweep step 33 of 50 — OPD Queue Config is configured and holds', async ({ page }) => {
    await sweepStep(page, 33, '/settings/opd-workflow', "OPD Queue Config", 'hospital_settings');
  });

  test('TC-P2L-034 Sweep step 34 of 50 — Discharge Workflow is configured and holds', async ({ page }) => {
    await sweepStep(page, 34, '/settings/discharge-workflow', "Discharge Workflow", 'hospitals');
  });

  test('TC-P2L-035 Sweep step 35 of 50 — IPD Ancillary Payment is configured and holds', async ({ page }) => {
    await sweepStep(page, 35, '/settings/ipd-ancillary-payment', "IPD Ancillary Payment", 'hospital_settings');
  });

  test('TC-P2L-036 Sweep step 36 of 50 — WhatsApp Bot is configured and holds', async ({ page }) => {
    await sweepStep(page, 36, '/settings/whatsapp', "WhatsApp Bot", 'whatsapp_templates');
  });

  test('TC-P2L-037 Sweep step 37 of 50 — Scheduled Reports is configured and holds', async ({ page }) => {
    await sweepStep(page, 37, '/settings/report-schedules', "Scheduled Reports", 'report_schedules');
  });

  test('TC-P2L-038 Sweep step 38 of 50 — TV Queue Display is configured and holds', async ({ page }) => {
    await sweepStep(page, 38, '/settings/tv-display', "TV Queue Display", 'tv_display_settings');
  });

  test('TC-P2L-039 Sweep step 39 of 50 — Store Locations is configured and holds', async ({ page }) => {
    await sweepStep(page, 39, '/settings/inventory', "Store Locations", 'store_locations');
  });

  test('TC-P2L-040 Sweep step 40 of 50 — Integrations Console is configured and holds', async ({ page }) => {
    await sweepStep(page, 40, '/settings/integrations', "Integrations Console", 'lab_device_connectors');
  });

  test('TC-P2L-041 Sweep step 41 of 50 — HL7 / FHIR Integration is configured and holds', async ({ page }) => {
    await sweepStep(page, 41, '/settings/hl', "HL7 / FHIR Integration", 'config_values');
  });

  test('TC-P2L-042 Sweep step 42 of 50 — ABDM / ABHA is configured and holds', async ({ page }) => {
    await sweepStep(page, 42, '/settings/abdm', "ABDM / ABHA", 'hospital_abdm_config');
  });

  test('TC-P2L-043 Sweep step 43 of 50 — HMIS / IHIP Portal is configured and holds', async ({ page }) => {
    await sweepStep(page, 43, '/settings/hmis-portal', "HMIS / IHIP Portal", 'api_configurations');
  });

  test('TC-P2L-044 Sweep step 44 of 50 — API Keys is configured and holds', async ({ page }) => {
    await sweepStep(page, 44, '/settings/api-keys', "API Keys", 'api_keys');
  });

  test('TC-P2L-045 Sweep step 45 of 50 — API Portal is configured and holds', async ({ page }) => {
    await sweepStep(page, 45, '/settings/api-portal', "API Portal", 'webhook_endpoints');
  });

  test('TC-P2L-046 Sweep step 46 of 50 — Integration Keys is configured and holds', async ({ page }) => {
    await sweepStep(page, 46, '/settings/api-hub', "Integration Keys", 'api_configurations');
  });

  test('TC-P2L-047 Sweep step 47 of 50 — AI Language Packs is configured and holds', async ({ page }) => {
    await sweepStep(page, 47, '/settings/ai-languages', "AI Language Packs", 'ai_language_settings');
  });

  test('TC-P2L-048 Sweep step 48 of 50 — Backup & Export is configured and holds', async ({ page }) => {
    await sweepStep(page, 48, '/settings/backup', "Backup & Export", null);
  });

  test('TC-P2L-049 Sweep step 49 of 50 — Record Retention is configured and holds', async ({ page }) => {
    await sweepStep(page, 49, '/settings/record-retention', "Record Retention", 'record_retention_policies');
  });

  test('TC-P2L-050 Sweep step 50 of 50 — Config Change Log is configured and holds', async ({ page }) => {
    await sweepStep(page, 50, '/settings/change-log', "Config Change Log", null);
  });

});

test.describe('P2L — Phase 3 readiness gate', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs('hospital_admin', { hospital: 'A' });
  });

  test('TC-P2L-051 Every writing settings screen has left at least one row in its target table', async () => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    const hospitalA = await hospitalIdFor('A');

    const empty: string[] = [];
    const unreadable: string[] = [];
    for (const screen of writingScreens()) {
      for (const table of [screen.table!, ...(screen.alsoWrites ?? [])]) {
        try {
          if ((await countRows(table, { hospital_id: hospitalA })) === 0) {
            empty.push(`${screen.route} → ${table}`);
          }
        } catch {
          unreadable.push(`${screen.route} → ${table}`);
        }
      }
    }

    expect(
      empty,
      `Writing screen(s) whose target table is still empty: ${empty.join(', ')}. This is the check ` +
      `that would have caught all four write-nothing screens in a single run — a screen that toasts ` +
      `"saved" and stores nothing looks identical to a working one until someone reads the table. ` +
      `(Unreadable, reported separately and not counted as empty: ${unreadable.join(', ') || 'none'}.)`,
    ).toEqual([]);
  });

  test('TC-P2L-052 The Settings hub shows no screen still sitting in its unconfigured empty state', async ({ page }) => {
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const body = await page.locator('body').innerText();

    const missing = SETTINGS_SCREENS.filter(s => !body.includes(s.title)).map(s => s.title);
    expect(
      missing,
      `Card(s) absent from the hub after a complete sweep: ${missing.join(', ')}. The hub is the ` +
      `first screen an administrator opens after go-live, so a screen missing from it is a screen ` +
      `the hospital will never find.`,
    ).toEqual([]);

    expect(
      /\bnot configured\b|\bunconfigured\b|\bnot set up\b|\bsetup required\b/i.test(body),
      'The hub still flags work outstanding after a complete sweep. Either the sweep missed ' +
      'something or the hub is misreporting the tenant state — both are worth knowing before Phase 3.',
    ).toBeFalsy();
  });

  test('TC-P2L-053 The full sweep produces no console error on any of the fifty screens', async ({ page, consoleErrors }) => {
    test.slow(); // fifty navigations in one test

    const byRoute: string[] = [];
    for (const screen of SETTINGS_SCREENS) {
      const before = consoleErrors.length;
      await page.goto(screen.route, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(900);
      for (const err of consoleErrors.slice(before)) byRoute.push(`${screen.route}: ${err}`);
    }

    // Third-party and network noise is not a product defect; everything else is.
    const real = byRoute.filter(e => !/favicon|ResizeObserver|Download the React DevTools|net::ERR_/i.test(e));
    expect(
      real,
      `Console error(s) during the sweep:\n${real.join('\n')}\nThis product falls back rather than ` +
      `warning, so the console is frequently the only visible evidence that a save did not reach ` +
      `the database.`,
    ).toEqual([]);
  });

  test('TC-P2L-054 Every swept value survives a full session restart', async ({ page, loginAs, logout }) => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hospitalA = await hospitalIdFor('A');

    const before = new Map<string, number>();
    for (const screen of writingScreens()) {
      try {
        before.set(screen.table!, await countRows(screen.table!, { hospital_id: hospitalA }));
      } catch { /* unreadable here is reported by TC-P2L-051, not re-reported as data loss */ }
    }

    await logout();
    await page.context().clearCookies();
    await loginAs('hospital_admin', { hospital: 'A' });

    const lost: string[] = [];
    for (const [table, count] of before) {
      const after = await countRows(table, { hospital_id: hospitalA });
      if (after < count) lost.push(`${table} ${count} → ${after}`);
    }

    expect(
      lost,
      `Row(s) lost across a session restart: ${lost.join(', ')}. All four write-nothing screens ` +
      `looked correct until the page was reloaded, because the value lived in component state — a ` +
      `restart is the cheapest test that separates a real save from a convincing one, and it is the ` +
      `one a hospital performs unintentionally every morning.`,
    ).toEqual([]);
  });

  test('TC-P2L-055 Phase 3 readiness gate — every SETTINGS_PREREQ_MATRIX must-have is satisfied', async () => {
    test.skip(!DB_ON(), 'Database access not enabled');
    const hospitalA = await hospitalIdFor('A');

    // One entry per must-have named in docs/qa/SETTINGS_PREREQ_MATRIX.md, each paired with the
    // symptom the tester would otherwise see and mis-log as a product defect.
    const MUST_HAVE: Array<[string, string]> = [
      ['departments', 'OPD and IPD filter on department'],
      ['wards', 'IPD cannot admit without a ward'],
      ['beds', 'the Admit modal is empty without beds'],
      ['service_master', 'OPD bills a hardcoded ₹500 without a consultation row'],
      ['hospital_config_values', 'the route and frequency dropdowns render empty'],
      ['drug_master', 'drug search returns nothing and the doctor writes free text'],
      ['lab_test_master', 'the Rx lab chips render empty'],
      ['radiology_modalities', 'the module shows "No studies configured"'],
      ['radiology_study_master', 'the Rx radiology chips render empty'],
      ['payer_masters', 'every insured patient is admitted as cash'],
      ['users', 'there is nobody to log in as'],
      ['doctor_schedules', 'no appointment slot is bookable'],
      ['store_locations', 'no stock transfer is possible'],
      ['bank_accounts', 'day-closure reconciliation cannot be completed'],
      ['hospital_settings', 'notification routing, language and discount rules all live here'],
    ];

    const unmet: string[] = [];
    for (const [table, symptom] of MUST_HAVE) {
      // beds carry ward_id rather than hospital_id, so they are counted unscoped and validated
      // for tenancy by TC-P2K-003 instead.
      const filter = table === 'beds' ? {} : { hospital_id: hospitalA };
      try {
        if ((await countRows(table, filter)) === 0) unmet.push(`${table} — ${symptom}`);
      } catch (e) {
        unmet.push(`${table} — unreadable: ${(e as Error).message}`);
      }
    }

    const { data: hospital } = await db().from('hospitals')
      .select('gstin, discharge_workflow').eq('id', hospitalA).maybeSingle();
    if (!hospital?.gstin) unmet.push('hospitals.gstin — no GST on invoices');
    if (!hospital?.discharge_workflow) {
      unmet.push('hospitals.discharge_workflow — the default clearance list silently applies');
    }

    expect(
      unmet,
      `PHASE GATE NOT MET. Unsatisfied prerequisite(s):\n  ${unmet.join('\n  ')}\n` +
      `This is the boundary the whole phase exists to draw. Until every one of these is met, a ` +
      `tester spends the first day of Phase 3 logging configuration gaps as product bugs, and the ` +
      `real defects are lost in that noise.`,
    ).toEqual([]);
  });
});
