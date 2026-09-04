/**
 * Phase 5 · Section H — Turnaround (TC-P5H-001)
 *
 * ENTIRELY NEW COVERAGE. Neither the lab `⏱️ TAT` tab nor the radiology `📊 TAT Dashboard` had ever
 * been opened by a test.
 *
 * WHY TURNAROUND IS NOT A REPORTING FEATURE. TAT is the number a laboratory advertises to its
 * clinicians and the one an NABH assessor asks to see, and it is DERIVED — from
 * `lab_samples.collected_at` at one end and the release at the other. A draw that does not stamp
 * its time does not produce a missing TAT; it produces a WRONG one, silently, on every report from
 * that shift. That is why this journey checks the stamp itself rather than trusting the dashboard's
 * arithmetic.
 *
 * The panel is loaded on demand (`Load Dashboard` → `Refresh`), and the radiology equivalent is
 * gated behind an AI entitlement — the journey records which of those it found rather than
 * assuming either.
 */
import { test, expect } from './p5-journey.fixture';
import { MOCK } from '../fixtures/auth.fixture';
import { db } from '../utils/db-verify';
import { testTitle } from './p5-manifest';
import { labOrdersFor, labSamples } from './lab-rad-helpers';
import {
  orderLabThroughModal, collectThroughWorkstation, receiveSample, processSample,
  openOrderInWorklist, enterResult, releaseResults,
} from './p5-stages';
import { openLabTab, LAB_TABS, tatLoadButton, tatOverdueBadge } from './lab-locators';
import { openRadiology, RADIOLOGY_TABS } from './radiology-locators';

const DB_ON = (): boolean => process.env.QA_DB_AVAILABLE === 'true';
const P5 = MOCK.phase5;

const HB = String(P5.labOrder.normalTest);
const K_TEST = String(P5.labOrder.primaryTest);

test.describe('P5H — Turnaround', () => {
  test(testTitle('TC-P5H-001'), async ({ page, loginAs, jrn }) => {
    test.skip(!DB_ON(), 'Database access not enabled — set QA_ALLOW_PROJECT_REF in .env.test');
    const { patient, hospitalId: hid } = jrn;
    const pid = patient.id;
    let routineOrderId = '';
    let statOrderId = '';

    await jrn.next(async () => {
      expect(patient.uhid).toBeTruthy();
    });

    await jrn.next(async () => {
      const { data } = await db().from('lab_test_master').select('test_name, tat_minutes')
        .eq('hospital_id', hid).eq('is_active', true);
      const missing = (data ?? []).filter(r => !(r as { tat_minutes: number }).tat_minutes);
      expect.soft(
        missing.length,
        `${missing.length} active test(s) carry no tat_minutes target. TAT is measured against ` +
        'that target — with none, an order can never be late, the overdue count is permanently ' +
        'zero, and the dashboard reports perfect performance regardless of reality.',
      ).toBe(0);
    });

    await jrn.next(async () => {
      await loginAs('lab_technician', { hospital: 'A' });
      await openLabTab(page, LAB_TABS.tat);
      await expect(
        page.getByText(/TAT|turnaround/i).first(),
        'The TAT tab did not open. It has never been opened by any test before this journey.' +
        jrn.note(),
      ).toBeVisible({ timeout: 20_000 });
    });

    await jrn.next(async () => {
      await tatLoadButton(page).click();
      await page.waitForTimeout(3_000);
      for (const card of [/Pending/i, /Overdue/i, /At Risk/i, /Avg TAT/i]) {
        await expect.soft(
          page.getByText(card).first(),
          `The TAT dashboard has no ${String(card)} figure. Without the breakdown a laboratory ` +
          'manager sees one number and cannot tell whether it is one badly late report or fifty ' +
          'slightly late ones — which are entirely different problems.',
        ).toBeVisible({ timeout: 12_000 });
      }
    });

    await jrn.next(async () => {
      const body = await page.locator('body').innerText().catch(() => '');
      expect.soft(
        body.length,
        'The TAT dashboard rendered nothing at all after loading.',
      ).toBeGreaterThan(0);
    });

    await jrn.next(async () => {
      await orderLabThroughModal(page, { uhid: patient.uhid, tests: [HB], priority: 'Routine' });
      const orders = await labOrdersFor(hid, pid);
      expect(orders.length, 'The routine order was not created.' + jrn.note()).toBeGreaterThan(0);
      routineOrderId = orders[0].id as string;
    });

    await jrn.next(async () => {
      await openLabTab(page, LAB_TABS.tat);
      await tatLoadButton(page).click().catch(() => { /* already loaded */ });
      await page.waitForTimeout(3_000);
    });

    await jrn.next(async () => {
      await expect.soft(
        page.getByText(patient.name).first(),
        'A pending order does not appear in the TAT list. The pending list is what a supervisor ' +
        'works from to chase the reports that are running late; an order missing from it is one ' +
        'nobody will chase.',
      ).toBeVisible({ timeout: 12_000 });
    });

    await jrn.next(async () => {
      const { data } = await db().from('lab_test_master').select('tat_minutes')
        .eq('hospital_id', hid).eq('test_name', HB).maybeSingle();
      const target = Number((data as { tat_minutes: number } | null)?.tat_minutes ?? 0);
      expect.soft(
        target,
        `The catalogue TAT target for "${HB}" is zero or absent, so nothing this dashboard shows ` +
        'can be measured against anything.',
      ).toBeGreaterThan(0);
    });

    await jrn.next(async () => {
      await collectThroughWorkstation(page, patient.uhid);
    });

    await jrn.next(async () => {
      const samples = await labSamples(routineOrderId);
      expect(
        samples[0]?.collected_at,
        'collected_at was not stamped. This single timestamp is what starts the turnaround clock — ' +
        'without it the TAT for this order is not missing, it is WRONG, and it will be averaged ' +
        'into the figure the laboratory reports to its clinicians.' + jrn.note(),
      ).toBeTruthy();
    });

    await jrn.next(async () => {
      await receiveSample(page, patient.uhid);
      await processSample(page, patient.uhid);
      await openOrderInWorklist(page, patient.uhid);
      await expect.soft(
        page.getByText(/Target:|TAT/i).first(),
        'The result workspace header shows no TAT figure, so the technician working the specimen ' +
        'cannot see how long it has left before it breaches.',
      ).toBeVisible({ timeout: 10_000 });
    });

    await jrn.next(async () => {
      await orderLabThroughModal(page, { uhid: patient.uhid, tests: [K_TEST], priority: 'STAT' });
      const orders = await labOrdersFor(hid, pid);
      statOrderId = (orders.find(o => o.priority === 'stat')?.id as string) ?? orders[0].id as string;
      const { data } = await db().from('lab_test_master').select('tat_minutes')
        .eq('hospital_id', hid).eq('test_name', K_TEST).maybeSingle();
      expect.soft(
        Number((data as { tat_minutes: number } | null)?.tat_minutes ?? 0),
        'The STAT analyte carries no TAT target of its own.',
      ).toBeGreaterThan(0);
    });

    await jrn.next(async () => {
      await openLabTab(page, LAB_TABS.tat);
      await tatLoadButton(page).click().catch(() => { /* already loaded */ });
      await page.waitForTimeout(3_000);
      await expect.soft(
        page.getByText(/^STAT$/i).first(),
        'A STAT order is not marked as STAT in the pending list. STAT is a promise about minutes; ' +
        'a supervisor scanning the list for what to escalate cannot see which ones carry it.',
      ).toBeVisible({ timeout: 12_000 });
    });

    await jrn.next(async () => {
      await openOrderInWorklist(page, patient.uhid);
      await enterResult(page, HB, String(P5.results.normalHaemoglobin))
        .catch(() => { /* the STAT order may be selected instead */ });
      await releaseResults(page).catch(() => { /* release gated */ });
    });

    await jrn.next(async () => {
      await openLabTab(page, LAB_TABS.tat);
      await tatLoadButton(page).click().catch(() => { /* already loaded */ });
      await page.waitForTimeout(3_000);
      const { data } = await db().from('lab_orders').select('status').eq('id', routineOrderId).maybeSingle();
      const released = ['completed', 'pending_validation'].includes(
        String((data as { status: string } | null)?.status ?? ''));
      expect.soft(
        released,
        'The order was not released, so whether a completed order leaves the pending TAT list ' +
        'cannot be evaluated.',
      ).toBe(true);
    });

    await jrn.next(async () => {
      await openOrderInWorklist(page, patient.uhid);
      await expect.soft(
        page.getByText(/Released|TAT:/i).first(),
        'A released order shows no final TAT figure, so the laboratory can never report what it ' +
        'actually achieved — only what is still outstanding.',
      ).toBeVisible({ timeout: 10_000 });
    });

    await jrn.next(async () => {
      const samples = await labSamples(statOrderId);
      const uncollected = samples.find(s => !s.collected_at);
      expect.soft(
        uncollected ? 'no clock' : 'clock started',
        'An order that has never been collected still reports a started turnaround clock. TAT ' +
        'measured from the ORDER rather than the DRAW makes a laboratory accountable for the time ' +
        'a patient spent walking to phlebotomy, which is neither fair nor actionable.',
      ).toBe('no clock');
    });

    await jrn.next(async () => {
      await openRadiology(page);
      const tab = page.getByRole('button', { name: RADIOLOGY_TABS.tatDashboard }).first()
        .or(page.getByRole('tab', { name: RADIOLOGY_TABS.tatDashboard }).first());
      if (await tab.isVisible().catch(() => false)) {
        await tab.click();
        await page.waitForTimeout(2_500);
      }
    });

    await jrn.next(async () => {
      // TWO LEGITIMATE OUTCOMES, AND THE JOURNEY MUST NOT PREFER ONE.
      //
      // `RadiologyTATPanel` returns null unless the `radiology_tat_predictor` AI feature is
      // entitled (`RadiologyTATPanel.tsx:169`). On a tenant without the AI suite, an absent panel
      // is the product behaving correctly. The first version asserted the panel MUST render and so
      // reported a plan gate as a defect on every tenant that has not bought the add-on.
      //
      // What is actually worth failing on is the third state: the tab is offered, the operator
      // clicks it, and they get neither a dashboard nor an explanation.
      // Entitlement is the `ai_suite` MODULE on the hospital's plan, not a per-feature row —
      // `useAIFeature` resolves it through `useSubscriptionConfig` (plan_features, then any
      // hospital_feature_overrides).
      const { data: override } = await db().from('hospital_feature_overrides')
        .select('module_key, is_enabled')
        .eq('hospital_id', hid).eq('module_key', 'ai_suite').maybeSingle();

      let entitled = (override as { is_enabled?: boolean } | null)?.is_enabled === true;
      if (!override) {
        const { data: sub } = await db().from('hospital_subscriptions')
          .select('plan_id').eq('hospital_id', hid).maybeSingle();
        const planId = (sub as { plan_id?: string } | null)?.plan_id;
        if (planId) {
          const { data: pf } = await db().from('plan_features')
            .select('is_enabled').eq('plan_id', planId).eq('module_key', 'ai_suite').maybeSingle();
          entitled = (pf as { is_enabled?: boolean } | null)?.is_enabled === true;
        }
      }

      const body = await page.locator('body').innerText().catch(() => '');
      const panelRendered = /Predicted|Turnaround|TAT/i.test(body);

      if (entitled) {
        expect.soft(
          panelRendered,
          'The radiology TAT predictor is entitled for this tenant but the panel rendered nothing. ' +
          'A hospital paying for the AI suite gets a blank tab where the turnaround forecast should be.',
        ).toBe(true);
      } else {
        expect.soft(
          panelRendered || /not available|upgrade|not enabled/i.test(body),
          'The radiology TAT tab is offered on a tenant that is NOT entitled to the predictor, and ' +
          'clicking it gives neither a dashboard nor an explanation. Either hide the tab or say ' +
          'why it is empty — a silently blank tab reads as a broken screen.',
        ).toBe(true);
      }
    });

    await jrn.next(async () => {
      const { data } = await db().from('lab_orders')
        .select('status, sample_collected_at, created_at').eq('id', routineOrderId).maybeSingle();
      const row = (data ?? {}) as { sample_collected_at?: string };
      expect.soft(
        row.sample_collected_at,
        'The completed order carries no collection stamp, so both ends of its turnaround cannot ' +
        'be reconstructed and the report it produced can never be audited for timeliness.',
      ).toBeTruthy();
    });
  });
});
