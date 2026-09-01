import { defineConfig, devices } from '@playwright/test';

/**
 * Aumrti HMS end-to-end suite.
 *
 * Folder per QA phase, mirroring docs/qa/cases/. Spec filenames carry the
 * section or scenario they lock, so a failure in the report points straight at
 * a row in the tracker.
 *
 *   npx playwright test                            everything
 *   npx playwright test e2e/phase-01-foundation    one phase
 *   npx playwright test -g "TC-P1E"                one section
 *   npx playwright test --ui                       interactive
 *
 * Safety: e2e/global-setup.ts refuses database access unless the target
 * Supabase project matches QA_ALLOW_PROJECT_REF. See .env.example.
 */
export default defineConfig({
  testDir: './e2e',

  // 60s was found too tight for Phase 4's multi-step OPD flows (register -> pay -> consult ->
  // order -> complete -> reopen -> verify, each a real Supabase round trip) under a long,
  // sustained, fully-sequential (workers=1) headed run: several tests hit the overall budget
  // mid-way through a trailing fixed sleep, not because any single step was broken, but because
  // the cumulative real-network time for a long flow left too little margin. Widened rather
  // than chasing which specific test happens to be the one that tips over on a given run.
  timeout: 90_000,
  // A soft `expect(locator).toBeVisible()` assertion (e.g. waiting for a UI confirmation chip
  // to render after a real Supabase round trip) is bound by THIS timeout, separately from the
  // per-test budget above — widened for the same reason.
  expect: { timeout: 20_000 },

  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',

  // Clinical workflows share tenant state (beds, stock, bill numbers), so
  // parallel runs would interfere with each other. Correctness over speed.
  fullyParallel: false,
  workers: 1,

  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,

  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    // Deliberately NOT inside playwright-report/ — the html reporter clears that folder,
    // and results.json only survived there because of reporter registration order.
    ['json', { outputFile: 'test-results/results.json' }],
    // Writes docs/qa/results/latest.json, which build-tracker.mjs merges into the
    // workbook's Status / Actual Result / Console Error / Screenshot columns.
    ['./e2e/reporters/tracker-reporter.ts'],
    ['list'],
  ],

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:8080',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
  },

  projects: [
    {
      name: 'phase-01-foundation',
      testDir: './e2e/phase-01-foundation',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'phase-02-settings',
      testDir: './e2e/phase-02-settings',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'phase-03-patient-records',
      testDir: './e2e/phase-03-patient-records',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'phase-04-opd-journey',
      testDir: './e2e/phase-04-opd-journey',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'phase-05-lab-radiology',
      testDir: './e2e/phase-05-lab-radiology',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Phase 12 · Specialty Clinical. Currently covers Home Care (12A) and
      // Chronic Disease Management (12B) only — the rest of the phase's modules
      // are added as their specs are written. Registered ahead of phases 06-11
      // because these two modules were repaired first; the project name still
      // matches docs/qa/PHASE_MAP.md numbering.
      name: 'phase-12-specialty-clinical',
      testDir: './e2e/phase-12-specialty-clinical',
      use: { ...devices['Desktop Chrome'] },
    },
    // Phases 06-11 and 13-15 are added here as each phase's specs are written.
    // See docs/qa/PHASE_MAP.md.
    {
      name: 'tablet',
      testDir: './e2e',
      testMatch: /phase-\d{2}-[^/]+\/.*\.spec\.ts$/,
      grep: /@tablet/,
      use: { ...devices['iPad (gen 7)'] },
    },
  ],

  webServer: process.env.PLAYWRIGHT_NO_SERVER
    ? undefined
    : {
        command: 'npm run dev',
        url: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:8080',
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
