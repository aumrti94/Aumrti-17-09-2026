/**
 * Playwright global teardown.
 *
 * Deliberately does NOT delete the QA data. After a failing run you want to
 * open the app and look at exactly the state the test left behind — that is
 * usually how you find out what actually went wrong.
 *
 * To reset between phases, re-run: node scripts/qa-seed.mjs
 */
export default async function globalTeardown(): Promise<void> {
  console.log('\n  QA data left in place for inspection.');
  console.log('  Reset with: node scripts/qa-seed.mjs\n');
}
