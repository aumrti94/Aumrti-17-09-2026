/**
 * Playwright global setup — the production guard.
 *
 * This runs before any spec. Its job is to make it impossible to run the suite
 * against a real hospital's data by accident.
 */
import type { FullConfig } from '@playwright/test';
import { TEST_ENV, checkDbGuard, projectRefOf } from './utils/env';
import { MOCK } from './fixtures/mock-data';

const c = {
  b: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  g: (s: string) => `\x1b[32m${s}\x1b[0m`,
  r: (s: string) => `\x1b[31m${s}\x1b[0m`,
  y: (s: string) => `\x1b[33m${s}\x1b[0m`,
};

/**
 * Pay Vite's cold-compile cost here rather than inside the first test.
 *
 * The dev server answers the port as soon as it is listening, but the first request for the
 * app still triggers on-demand transform of the whole entry graph. That regularly exceeds the
 * 30s navigationTimeout, which is why the first navigation of a run (and only the first) timed
 * out while the next thirty tests passed. Warming up here keeps the suite deterministic
 * instead of papering over it with a retry.
 */
async function warmUpDevServer(baseURL: string): Promise<void> {
  const deadline = Date.now() + 120_000;
  let lastError = '';

  while (Date.now() < deadline) {
    try {
      const res = await fetch(baseURL, { signal: AbortSignal.timeout(30_000) });
      if (res.ok) {
        await res.text(); // wait for the full transformed response, not just headers
        console.log(`  ${c.g('✓')} dev server warm (${baseURL})`);
        return;
      }
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise(r => setTimeout(r, 2_000));
  }

  // Not fatal — the run should still be allowed to proceed and fail informatively.
  console.log(`  ${c.y('!')} dev server did not warm up: ${lastError}`);
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  console.log(`\n${c.b('Aumrti HMS — Playwright')}\n`);
  console.log(`  App under test   ${TEST_ENV.baseURL}`);
  console.log(`  Supabase project ${projectRefOf(TEST_ENV.supabaseUrl) || c.r('(not set)')}`);

  await warmUpDevServer(TEST_ENV.baseURL);

  const guard = checkDbGuard();

  if (!guard.ok) {
    // Not fatal: purely UI specs (login form validation, 404 handling) are
    // still worth running. Anything needing the database will skip itself.
    console.log(`\n  ${c.y('Database access is DISABLED for this run.')}`);
    console.log(`  ${c.dim(guard.reason ?? '')}`);
    console.log(`  ${c.dim('Specs that verify database rows will be skipped.')}\n`);
    process.env.QA_DB_AVAILABLE = 'false';
    return;
  }

  console.log(`  ${c.g('✓')} project ref matches QA_ALLOW_PROJECT_REF`);
  console.log(`  ${c.g('✓')} writes restricted to: ${MOCK.guard.hospitalNamePrefixes.map(p => `"${p}*"`).join(', ')}`);

  if (!TEST_ENV.seedingConfirmed) {
    console.log(`  ${c.y('!')} QA_SEEDING_CONFIRMED is not "true" — mutating specs will skip.`);
  }

  process.env.QA_DB_AVAILABLE = 'true';
  console.log('');
}
