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

  timeout: 60_000,
  expect: { timeout: 15_000 },

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
    ['json', { outputFile: 'playwright-report/results.json' }],
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
    // Phases 02-15 are added here as each phase's specs are written.
    // See docs/qa/PHASE_MAP.md.
    {
      name: 'tablet',
      testDir: './e2e/phase-01-foundation',
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
