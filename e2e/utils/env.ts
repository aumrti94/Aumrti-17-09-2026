/**
 * Test environment resolution + the production guard.
 *
 * Everything that could touch the database goes through here first.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOCK } from '../fixtures/mock-data';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function loadEnvFile(file: string): Record<string, string> {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const fileEnv = { ...loadEnvFile('.env.local'), ...loadEnvFile('.env.test') };
const env = { ...fileEnv, ...process.env } as Record<string, string>;

export const TEST_ENV = {
  baseURL: env.PLAYWRIGHT_BASE_URL || 'http://localhost:8080',
  supabaseUrl: env.SUPABASE_TEST_URL || env.VITE_SUPABASE_URL || '',
  anonKey: env.SUPABASE_TEST_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || '',
  serviceKey: env.SUPABASE_SERVICE_ROLE_KEY || '',
  /**
   * Set QA_ALLOW_PROJECT_REF to the project ref you have designated for QA.
   * Without it we cannot tell a QA project from production, so any spec that
   * needs database access will refuse to run rather than guess.
   */
  allowedProjectRef: env.QA_ALLOW_PROJECT_REF || '',
  /** Explicit opt-in required before any test writes to the database. */
  seedingConfirmed: env.QA_SEEDING_CONFIRMED === 'true',
};

export function projectRefOf(url: string): string {
  return url.match(/https?:\/\/([a-z0-9]+)\.supabase\./i)?.[1] ?? '';
}

export interface GuardResult { ok: boolean; reason?: string; }

/**
 * Read-only tests only need an app to point at. Anything that writes must
 * additionally prove it is aimed at a QA project the user has designated.
 */
export function checkDbGuard(): GuardResult {
  if (!TEST_ENV.supabaseUrl) {
    return { ok: false, reason: 'No Supabase URL. Set SUPABASE_TEST_URL in .env.test' };
  }
  if (!TEST_ENV.allowedProjectRef) {
    return {
      ok: false,
      reason:
        'QA_ALLOW_PROJECT_REF is not set, so this run cannot prove it is pointed at a QA ' +
        'project rather than production. Set it in .env.test to the project ref you have ' +
        'designated for QA. See .env.example.',
    };
  }
  const ref = projectRefOf(TEST_ENV.supabaseUrl);
  if (ref !== TEST_ENV.allowedProjectRef) {
    return {
      ok: false,
      reason:
        `Refusing to run: target project "${ref}" does not match QA_ALLOW_PROJECT_REF ` +
        `"${TEST_ENV.allowedProjectRef}".`,
    };
  }
  return { ok: true };
}

/** Additional gate for anything that mutates data. */
export function checkWriteGuard(): GuardResult {
  const base = checkDbGuard();
  if (!base.ok) return base;
  if (!TEST_ENV.seedingConfirmed) {
    return {
      ok: false,
      reason:
        'QA_SEEDING_CONFIRMED is not "true". Writing tests are disabled until you ' +
        'explicitly opt in, so a stray run can never mutate real data.',
    };
  }
  return { ok: true };
}

/** Belt-and-braces: never write to a hospital that is not one of the QA tenants. */
export function assertQaHospitalName(name: string | null | undefined, context: string): void {
  const isQa = !!name && MOCK.guard.hospitalNamePrefixes.some(p => name.startsWith(p));
  if (!isQa) {
    throw new Error(
      `[QA GUARD] Refusing to operate on hospital "${name}" while ${context}. ` +
      `Only ${MOCK.guard.hospitalNamePrefixes.map(p => `"${p}*"`).join(' or ')} are permitted.`,
    );
  }
}
