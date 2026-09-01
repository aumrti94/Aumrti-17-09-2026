/**
 * Phase 4 · Section Z — runtime-render smoke.
 *
 * Guards the failure mode that reached a user: a ReferenceError thrown from a component
 * module (an identifier used but never imported) is invisible to `vite build`, invisible to
 * eslint (typescript-eslint disables no-undef in favour of the compiler), and invisible to
 * `tsc -p tsconfig.json` because that config declares "files": [] and therefore compiles
 * nothing at all. Only EXECUTING the code catches it.
 *
 * WalkInModal carries the consultation-fee engine, so loading the page is not enough — the
 * modal has to mount and run its rate/episode effects.
 */
import { test, expect } from '../fixtures/auth.fixture';
import { openOpd, registerWalkInButton, walkInSearch } from './opd-locators';

const FATAL = /is not defined|is not a function|Cannot read propert/i;

test('TC-P4Z-001 The Scheduling module renders without a runtime error', async ({ page }) => {
  const errs: string[] = [];
  page.on('pageerror', e => errs.push(e.message));

  await page.goto('/schedule');
  await page.waitForTimeout(5000);

  expect(
    await page.getByText(/Error in Scheduling/i).count(),
    'The Scheduling error boundary tripped.',
  ).toBe(0);
  expect(errs.filter(m => FATAL.test(m)), 'Runtime error on /schedule').toEqual([]);
});

test('TC-P4Z-002 The walk-in modal mounts and runs its fee effects without a runtime error', async ({ page }) => {
  const errs: string[] = [];
  page.on('pageerror', e => errs.push(e.message));

  await openOpd(page);
  await registerWalkInButton(page).click();
  await expect(walkInSearch(page), 'The walk-in modal did not open.').toBeVisible();
  // Let the rate lookup, episode lookup and fee computation settle.
  await page.waitForTimeout(4000);

  const fatal = errs.filter(m => FATAL.test(m));
  expect(fatal, `Runtime error inside WalkInModal:\n${fatal.join('\n')}`).toEqual([]);
});
