#!/usr/bin/env node
// Aumrti schema audit — CI guard against staff-attribution columns pointing at the WRONG
// users table.
//
// THE DEFECT THIS EXISTS TO PREVENT. This codebase has two distinct user identities:
// `auth.users.id` (the Supabase auth uid) and `public.users.id` (the app-side staff row).
// They were the same value until 20260322111223 dropped `users_id_fkey` and introduced
// `users.auth_user_id`; since then `public.users.id` is a free-standing UUID. The whole
// application writes `public.users.id` into attribution columns — HospitalContext resolves
// the auth uid to the users row and publishes `users.id`, and ~70 tables FK to
// `public.users(id)` accordingly.
//
// A migration batch around 20260901–20260910 declared its `*_by` columns
// `REFERENCES auth.users(id)` instead. Those tables accept writes only from accounts created
// BEFORE the decoupling (where id still equals auth_user_id) and raise a foreign-key
// violation for everyone else. That is what broke every tab of the ICU Workspace, plus
// Medication Reconciliation and Dental Lab Orders — repaired in
// 20261106000003_fix_user_fk_targets.sql.
//
// Repairing those instances does not close the CLASS: nothing stopped the next migration
// from repeating it, and ~10 further tables still carry the defect dormant (no live write
// path today, so no bug report yet). This check makes both facts visible and blocks new
// occurrences. It is a heuristic text scan of supabase/migrations/, not a live-DB check.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

// Columns that genuinely hold an AUTH uid, so auth.users is the correct target. Every one is
// written from `supabase.auth.getUser()` rather than from useHospitalContext's users.id —
// verify that before adding anything here, because this is the one place the check can be
// silently defeated.
const ALLOWLIST = new Set([
  "users.auth_user_id",                        // the auth link itself
  "user_mfa.user_id",                          // MFA enrolment is per auth identity
  "mobile_fcm_tokens.user_id",                 // push tokens are per auth session
  "notifications.user_id",                     // delivered to an auth identity
  "notification_preferences.user_id",
  "platform_incidents.created_by",             // Aumrti platform staff, not hospital staff
  "platform_incidents.resolved_by",
  "platform_incident_updates.created_by",      // IncidentsPage.tsx -> auth.getUser()
  "platform_feature_flags.created_by",
  "platform_support_tickets.created_by",       // SettingsSupportPage.tsx -> auth.getUser()
  "data_erasure_requests.requested_by",
  "data_erasure_requests.approved_by",
  "data_erasure_requests.reviewed_by",         // PlatformSettingsPage.tsx -> auth.getUser()
  "stock_reorder_triggers.created_by",         // ReorderDashboard.tsx -> auth.getUser()
  "hospital_module_entitlements.updated_by",   // HospitalDetailPage.tsx -> authUser.id
  "hospital_addons.purchased_by",
]);

// Columns already repointed to public.users(id) by a repair migration. Read straight out of
// the migration's own VALUES list so there is ONE source of truth — a hand-copied second list
// here would drift the first time someone repairs another column.
const REPAIR_FILE_RE = /fix_user_fk_targets\.sql$/;
const REPAIR_PAIR_RE = /\(\s*'(\w+)'\s*,\s*'(\w+)'\s*\)/g;

function readRepairedColumns(files) {
  const repaired = new Set();
  for (const file of files.filter((f) => REPAIR_FILE_RE.test(f))) {
    const text = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    for (const m of text.matchAll(REPAIR_PAIR_RE)) {
      repaired.add(`${m[1].toLowerCase()}.${m[2].toLowerCase()}`);
    }
  }
  return repaired;
}

// Attribution-shaped column names. Deliberately narrow: this check is about STAFF
// attribution columns, not every possible auth.users reference.
const ATTRIBUTION_SUFFIX = /_(by|doctor)$/i;

const CREATE_TABLE_RE = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:public\.)?["']?(\w+)["']?/i;
// e.g. `recorded_by   uuid REFERENCES auth.users(id),` — column name, type, then the target.
const AUTH_FK_COLUMN_RE = /^\s*["']?(\w+)["']?\s+uuid\b[^,]*?REFERENCES\s+auth\.users\s*\(/i;

const stripComments = (sql) =>
  sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");

const migrationFiles = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
const repaired = readRepairedColumns(migrationFiles);
const offenders = [];

for (const file of migrationFiles) {
  const text = stripComments(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  let currentTable = null;

  for (const line of text.split(/\r?\n/)) {
    const created = line.match(CREATE_TABLE_RE);
    if (created) {
      currentTable = created[1].toLowerCase();
      continue;
    }
    if (!currentTable) continue;

    const col = line.match(AUTH_FK_COLUMN_RE);
    if (!col) continue;

    const column = col[1].toLowerCase();
    if (!ATTRIBUTION_SUFFIX.test(column)) continue;

    const key = `${currentTable}.${column}`;
    if (ALLOWLIST.has(key) || repaired.has(key)) continue;
    offenders.push({ key, file });
  }
}

if (offenders.length > 0) {
  console.error("User FK convention check FAILED — staff-attribution columns referencing auth.users(id):");
  for (const { key, file } of offenders) console.error(`  - ${key}  (${file})`);
  console.error(`
These columns must reference public.users(id), not auth.users(id). The application writes
public.users.id (via useHospitalContext), and those two IDs have been different values since
migration 20260322111223 — so an auth.users FK fails for every account created after it.

Fix: repoint the constraint following the pattern in
supabase/migrations/20261106000003_fix_user_fk_targets.sql (remap existing values through
users.auth_user_id first, so clinical attribution survives).

If a column genuinely holds an auth uid rather than a staff reference, add it to ALLOWLIST in
scripts/check-user-fk-convention.mjs with a [CORRECT] comment explaining why.`);
  process.exit(1);
}

console.log(`User FK convention check passed — ${repaired.size} columns repointed to public.users(id), ${ALLOWLIST.size} legitimately referencing auth.users.`);
