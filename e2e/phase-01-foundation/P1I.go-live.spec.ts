/**
 * Phase 1 · Section I — Go-live checklist
 * Locks tracker cases TC-P1I-001 … TC-P1I-006
 *
 * TC-P1I-005 is the one that matters: the checklist must flag a missing ward
 * rate and a missing consultation fee. Those are the two silent Rs 500
 * fallbacks — a hospital going live without them under-bills every patient.
 */
import { test, expect } from '../fixtures/auth.fixture';
import { db, hospitalIdFor } from '../utils/db-verify';

const DB = () => process.env.QA_DB_AVAILABLE === 'true';

test.describe('P1I — Go-live checklist', () => {

  test('TC-P1I-001 the checklist loads for an admin', async ({ page, loginAs, consoleErrors }) => {
    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    await loginAs('hospital_admin');

    expect(await isRouteBlocked(page, '/admin/go-live'), 'Admin was blocked from go-live').toBeFalsy();
    await page.waitForTimeout(2000);

    const body = await page.locator('body').innerText();
    expect(body.trim().length, 'Go-live checklist rendered blank').toBeGreaterThan(0);

    const fatal = consoleErrors.filter(e => /Uncaught|TypeError/.test(e));
    expect(fatal, `Go-live page threw:\n${fatal.join('\n')}`).toHaveLength(0);
  });

  test('TC-P1I-004 a doctor cannot open the go-live checklist', async ({ page, loginAs }) => {
    // Declaring a hospital live is an administrative decision.
    const { isRouteBlocked } = await import('../fixtures/auth.fixture');
    await loginAs('doctor');
    expect(
      await isRouteBlocked(page, '/admin/go-live'),
      'A doctor reached the go-live checklist',
    ).toBeTruthy();
  });

  test('TC-P1I-005 the two silent-fallback prerequisites are actually satisfied', async () => {
    test.skip(!DB(), 'Database access not enabled — see .env.example');
    const hid = await hospitalIdFor('A');
    const problems: string[] = [];

    const { data: wards } = await db()
      .from('wards').select('name, rate_per_day').eq('hospital_id', hid);
    for (const w of wards ?? []) {
      if (w.rate_per_day == null || Number(w.rate_per_day) <= 0) {
        problems.push(`Ward "${w.name}" has no rate_per_day -> room charge silently becomes Rs 500/day`);
      }
    }

    const { data: fees } = await db()
      .from('service_master').select('name, rate')
      .eq('hospital_id', hid).eq('category', 'consultation');
    if (!fees?.length) {
      problems.push('No consultation fee configured -> every patient is billed the hardcoded Rs 500');
    }

    expect(
      problems,
      `A hospital going live in this state will under-bill every single patient and not ` +
      `discover it for months:\n  ${problems.join('\n  ')}`,
    ).toHaveLength(0);
  });
});
