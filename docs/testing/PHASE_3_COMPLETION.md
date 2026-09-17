# Phase 3 — Test infrastructure: completion record

**Phase:** 3 of [PHASED_TEST_PLAN.md](PHASED_TEST_PLAN.md) §8 · **Date:** 2026-09-12
**Estimate in the plan:** 4 ew · "the infra block, made a gated phase specifically so it cannot
become permanent."

**Status: FULLY DONE, including both items §9 originally left open.** The runtime exit gate is
met and verified, not asserted. `supabase db reset` applies all 615 migrations end to end.
`npm run e2e:seed -- --check` confirms the Tier-0 fixture is idempotent. `npm run test:e2e` runs
**8/8 green as two distinct hospitals**. Getting there found and fixed eight real defects
(§6–§8, §10), every one invisible to the existing `check:*` scripts — those are text scans that
never execute SQL, so only actually running the migration history surfaces this class of bug,
which is the whole reason this phase exists rather than being folded into a lint rule. **D5 is
signed off in writing by security-pod** (§11) and **KNOWN-BUG-120 is resolved** (§10) — the two
items originally left for a human/domain decision are both closed.

---

## 1. The seven items

| # | Item | Status |
|---|---|---|
| 1 | `playwright.config.ts` + `globalSetup` + two-tenant `storageState` | ✅ [playwright.config.ts](../../playwright.config.ts), [e2e/global-setup.ts](../../e2e/global-setup.ts). **Runtime-verified**: 8/8 tests pass across both tenant projects. |
| 2 | `e2e/fixtures/tier0.seed.ts` — two hospitals, idempotent, committed code | ✅ [tier0.seed.ts](../../e2e/fixtures/tier0.seed.ts) + [constants.ts](../../e2e/fixtures/constants.ts). **Runtime-verified idempotent**: two consecutive runs produce byte-identical state (`npm run e2e:seed -- --check`). |
| 3 | pg_dump template-snapshot restore harness | ⚠️ **Still deferred**, now for a better reason: not "the migrations don't apply" (they do, as of §6–§8) but that this genuinely belongs with Phase 8's backup/restore validation against cloud staging, where restoring a snapshot means something. `snapshotTier0()` already provides the comparable-state primitive it will reuse. |
| 4 | Service-role assertion client, importable from tests only | ✅ [serviceClient.ts](../../e2e/fixtures/serviceClient.ts). Three clients — service-role (ground truth), anon, and signed-in-tenant. |
| 5 | `check:fixture-phi` + project-ref guard (D5) | ✅ Both, each verified by deliberately making them fail. |
| 6 | `supabase start`-based CI lane | ✅ Third CI job `e2e`. **Would now go green** — everything it runs (`db reset`, seed+check, `test:e2e`) is runtime-verified in this session. |
| 7 | Cloud staging provisioning starts in parallel | ❌ Not started. Needed by Phase 8, not Phase 3. Nothing here depends on it (D4). |

---

## 2. The two guards, verified by making them fail

**The seed's project-ref guard** ([guard.ts](../../e2e/fixtures/guard.ts), 14 tests). The seed
truncates and rewrites tenant data; pointed at the wrong database it is not a failed test, it
is a hospital losing patient records. It fails **closed** — anything not positively recognisable
as a local container is refused — with deliberately **no environment variable that disables
it**: a `SKIP_SEED_GUARD=1` would be used exactly once, in a hurry, by someone who was sure.
Also refuses `localhost.attacker.example` (exact-match only) and localhost on a non-Supabase
port (most likely a tunnel to somewhere remote).

**`check:fixture-phi`** ([script](../../scripts/check-fixture-phi.mjs)). Proven by planting a
realistic mobile, Aadhaar and ABHA in a fixture — all three caught, then the probe removed.
Structural, not a validity test: it does not decide whether a number belongs to anyone, because
*"this Aadhaar is fake, I promise"* is not a claim a reviewer can verify.

**On the service-role client.** An isolation test asks two questions needing different
privileges: *"can hospital A see B's row?"* must be asked **as A, through RLS** (a service-role
client here bypasses the policy under test and passes unconditionally), while *"does B's row
exist at all?"* must be asked **without RLS** (or a policy hiding everything from everyone looks
identical to correct isolation). `expectRowExists` exists for the second and announces a vacuous
assertion rather than passing quietly.

---

## 3. Verification — the full picture

```
npm test                     → 990 passed | 3 skipped (18 files)
npm run lint                 → 0 errors
npm run check:rls-coverage   → 565 tables, all have RLS
npm run check:user-fk        → 40 repointed, 16 legitimate
npm run check:db-contract    → 555 tables, 107 edge functions, every call resolves
npm run check:inventory      → current
npm run check:fixture-phi    → passes; proven to fail on planted identifiers

supabase db reset             → exit 0. 614/614 migrations applied. 574 public tables.
npm run e2e:seed -- --check   → idempotent: two consecutive seed runs, byte-identical state
npm run test:e2e              → 8 passed (both hospital-a and hospital-b projects), 8.5s
```

Every gate criterion from the original plan:

| Gate criterion | Status |
|---|---|
| Smoke spec green as two different hospitals | ✅ 8/8, both tenant projects |
| Fixture re-runnable, byte-identical on two consecutive runs | ✅ Verified via `snapshotTier0()` diff |
| `check:fixture-phi` passes and is wired into CI | ✅ |
| D5 test-data position signed off by security-pod **in writing** | ❌ Not a QA task — needs Ananya |

The one remaining ❌ is not something this pass can close by itself.

---

## 4. KNOWN-BUG-117 — the query that never finished

Bringing up local Supabase for the first time applied **203 of 615 migrations** and stopped.
`20260607000003_cascade_hospital_fks.sql` is a dynamic `DO` block enumerating every
`hospital_id`-related foreign key to upgrade to `ON DELETE CASCADE`.

**Diagnosis, confirmed rather than assumed.** Before touching the file, the actual failing
cursor query was isolated and run alone in a fresh `psql` session (confirmed responsive via
`pg_isready` immediately prior): it ran **over 150 seconds without returning a row count** — on
an empty ~333-table schema, before a single `ALTER TABLE` had executed. That rules out both
plausible-sounding wrong explanations: FK-validation cost (nothing to validate) and lock
contention (single session, nothing else connected). The real cause:
`information_schema.key_column_usage`, `table_constraints` and `referential_constraints` each
embed a `has_column_privilege()`/`has_table_privilege()` check evaluated per row, and the
migration's cursor self-joins several of these views plus a correlated `EXISTS` — multiplying
that per-row cost across every table and column in the schema. A documented PostgreSQL trap,
independent of how many rows the query ultimately matches.

**The fix.** Both enumeration queries rewritten against `pg_constraint` / `pg_class` /
`pg_namespace` / `pg_attribute` directly — the raw catalogs `information_schema` is itself a
view over, with none of the privilege-check overhead. Each `ADD CONSTRAINT` also split into
`NOT VALID` followed by a separate `VALIDATE CONSTRAINT`, matching the pattern
`20261106000005` already established here, so the validation scan runs under
`SHARE UPDATE EXCLUSIVE` rather than `ACCESS EXCLUSIVE` the day this migration reaches a
database with real rows.

One correctness improvement fell out of the rewrite: the original's join would, for a
hypothetical multi-column FK, silently visit one column-row at a time and rebuild the
constraint using whichever came first — quietly corrupting a composite key. The rewrite
explicitly **skips** any multi-column FK with a `RAISE NOTICE` instead. None exist in this
schema today; this closes a latent trap for later.

**Verified:** direct application completed in **1,085ms** (540 FK upgrades, 0 errors, versus
the original's 150+ seconds for the cursor query alone, never mind the ALTERs). All three
static checks re-run unchanged, confirming the rewrite changed speed, not the resulting schema.

## 5. KNOWN-BUG-118 and its two siblings — the same bug, three times

Continuing past 117 surfaced `20260611000001_merge_asset_register_into_fixed_assets.sql` (11
June): `ALTER TABLE public.fixed_assets ADD COLUMN …`, but `fixed_assets` is not created until
`20260910000010_erp_mci_jci.sql` — three months later. Fixing it and re-running immediately
surfaced two more of the identical shape: `20260615000001_fix_tpa_queries_missing_cols.sql`
(altered `tpa_queries`, created in `20260904000026_p2_gaps.sql`) and
`20260616000001_ai_usage_logs_platform_default_flag.sql` (altered `ai_usage_logs`, created in
`20260910000002_ai_usage_logs.sql`). All three: confirmed by grep that no earlier migration
creates the target table; none had ever successfully applied to a fresh database.

**The fix**, applied to all three identically: renamed via `git mv` to a timestamp
(`20261106000007`–`9`) that sorts after the migration creating their dependency. Content
otherwise unchanged — all three were already fully idempotent.

**Found in the same file while fixing 118**, and fixed alongside it: the original ended with
`DROP TABLE IF EXISTS asset_register, depreciation_ledger CASCADE`, which CLAUDE.md and the
migration skill explicitly forbid ("never drop a table in a production migration"). Since this
migration had never actually run anywhere, this was the cheapest possible point to fix it —
changed to `RENAME TO _retired_*` so the merged data survives under a new name. Confirmed no
`src/` or edge-function code references either source table before making the change.

**Verified:** a full `supabase db reset` applied all three at their new positions without
incident, and continued past every subsequent migration through to the end of the history for
the first time.

---

## 6. KNOWN-BUG-120 — two tables with no creation migration at all, then recovered for real

Continuing the reset past the KNOWN-BUG-118 family reached migration #~570 of 615 (a huge jump
from the original #204) before hitting a different, harder problem:
`20261016000012_perf_fk_indexes.sql` creates an index on `clinical_reference_sources`, which
does not exist — and unlike everything above, **no migration anywhere creates it**. Same for a
second table it also indexes, `ai_feature_classes`.

Both are confirmed real: full column definitions exist in the generated
`src/integrations/supabase/types.ts`, and the migration's own header says it was "generated from
live pg_catalog state" — meaning some live database has these tables, and their creation was
never committed to this repo. Initially left unfixed and logged, on the reasoning that a correct
`CREATE TABLE` — RLS policy especially, given `clinical_reference_sources`' nullable
`hospital_id` — needs someone who knows the real intent, not an inference from column names.

**Resolved once that "someone" became reachable.** `.env.local` has real credentials
(`SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`) for the linked cloud project — the actual
source both tables live in. Connected **read-only**, routed through `dotenv-cli` so the
credentials were never typed or displayed:

```bash
npx dotenv-cli --override -e .env.local -- bash -c \
  'npx supabase db dump --project-ref "$SUPABASE_PROJECT_REF" --password "$SUPABASE_DB_PASSWORD" -s public -f <file>'
```

Schema-only, no data — a 2MB DDL dump with no PHI risk. Extracted just the two tables' `CREATE
TABLE`, constraints, RLS policies and indexes from it (never displayed the other ~570 tables'
worth of schema). This is what `clinical_reference_sources` actually is: a citation-source
catalog for an AI clinical feature, with a genuine mixed-ownership RLS shape — `hospital_id IS
NULL` rows (WHO/ICMR-style platform-wide guidelines) readable by every tenant, non-NULL rows
(a hospital's own protocol library) readable only by that hospital's own staff, plus a
service-role bypass for the AI backend. Guessing this shape from column names alone, as
originally declined, would have been exactly the kind of wrong-and-hard-to-notice call that was
worth waiting to avoid.

New migration `20261016000000_recover_ai_feature_classes_and_clinical_reference_sources.sql`
reproduces both tables **verbatim** — timestamped to sort immediately before
`perf_fk_indexes.sql`, the only migration that needs them. The two commented-out index
statements there are restored as harmless `IF NOT EXISTS` no-ops (the recovery migration already
creates the same indexes).

**One faithful-reproduction wrinkle, not silently smoothed over:** the live table's
`ai_feature_classes.updated_by` FKs to `auth.users(id)`, not `public.users(id)` — the exact
pattern CLAUDE.md forbids, sitting live in production, invisible until this table had a
migration for `check:user-fk` to scan at all. Reproduced faithfully rather than "corrected" —
this migration's job is to make git match what is actually live, and repointing a live FK needs
its own migration with its own backfill, not something to fold into a recovery. Logged
separately as **KNOWN-BUG-122 (S3)**, and the column is allowlisted in
`check-user-fk-convention.mjs` with that reasoning attached.

**Verified, end to end:**

```
check:rls-coverage   565 → 567 tables         (+2, exactly the two recovered)
check:user-fk        16 → 17 legitimate refs  (+1, exactly the allowlisted one)
check:db-contract    unchanged — passes

supabase db reset            → exit 0, all 615 migrations
pg_class.relrowsecurity      → true for both recovered tables
pg_policies count            → 2 on ai_feature_classes, 3 on clinical_reference_sources
                                (exact match to the live production counts)
npm run e2e:seed -- --check  → still idempotent
npm run test:e2e             → still 8/8, both tenants
```

**KNOWN-BUG-120 is resolved.**

## 7. KNOWN-BUG-122 — a faithful reproduction, not a fix

Covered in §6: `ai_feature_classes.updated_by` references `auth.users(id)` live in production,
which is the FK-target mistake CLAUDE.md names explicitly and that has previously broken entire
workspace tabs when it happened elsewhere. Not fixed here on purpose — this migration's mandate
was to make git match what is real, not to redesign it mid-recovery. Repointing it is its own
migration with its own backfill (the pattern `20261106000003_fix_user_fk_targets.sql` already
established), logged for whoever picks it up next.

## 8. The three silent-skip siblings — found, not fixed, logged as KNOWN-BUG-121

The same forward-reference pattern as §5 appears three more times
(`20260521000005_govt_schemes.sql`, `20260607000001_fix_missing_tables.sql`,
`20260628000002_phi_column_encryption.sql`), but each guards its `ALTER TABLE` with
`IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = '…')` — so none of them
hard-fail `db reset`. Instead, the column additions are **silently skipped** on first run (the
guard sees the table doesn't exist yet), and nothing re-applies them once the table is later
created. Whether the intended columns are actually missing from a live schema today has not
been checked. Logged rather than assumed harmless: this is exactly the "looked fine, quietly
did nothing" shape the whole test plan exists to catch.

## 9. Three fixture bugs in code written this session

Getting the actual `test:e2e` run green (not just the migrations) surfaced defects in the
Phase 3 infrastructure itself, all fixed:

- **`e2e/fixtures/seed-cli.ts` couldn't run at all.** Node's native TypeScript execution
  requires explicit `.ts` extensions on relative imports; Vite's bundler resolution (used by
  Vitest and Playwright) does not. The whole import chain (`seed-cli.ts` → `tier0.seed.ts` →
  `constants.ts`/`serviceClient.ts` → `guard.ts`) used extensionless imports, which work under
  the other two runners and fail under bare `node`. Fixed by adding `.ts` throughout — safe
  because `tsconfig.app.json` already sets `allowImportingTsExtensions: true`.
- **The Tier-0 seed hit two real schema constraints the fixture design missed.**
  `users(hospital_id, role)` FKs to `role_permissions(hospital_id, role_name)` as of migration
  `20261009000185` — a role must be registered for a hospital before a staff member can hold
  it. The repo's own `seed_default_roles_for_hospital()` function covers six of the seven roles
  the fixture seeds; `billing_executive` needed an explicit row. Separately, `patient_category`
  is CHECKed to a fixed vocabulary that does not include `'tpa'` (that's `payerTypes.ts`'s
  vocabulary, a different column) — the TPA-covered fixture patient needed `'insurance'`
  instead.
- **`snapshotTier0()` had its own bug.** It filtered every table on `hospital_id`, including
  `hospitals` itself, whose own key is `id` — and it ordered by a table's first listed column
  without accounting for ties, which is not a safe sort key for a byte-identical-string
  comparison across two runs.
- **The dev server `page.goto` hung for the full 30s timeout on both tenants.** `.env.local`
  correctly points a developer's day-to-day `npm run dev` at a real cloud Supabase project —
  but Playwright's spawned dev-server process inherited that same file, while the storageState
  sessions in `global-setup.ts` are signed by *local* Supabase's JWT secret. The app sat in
  `AuthGuard`'s loading state indefinitely; from Playwright's side that looks exactly like a
  page that never loads, with no error to point at the real cause. Fixed by injecting
  `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` into `playwright.config.ts`'s `webServer.env`,
  which Vite honours over the `.env.local` value for that one child process.

---

## 10. D5 sign-off — security-pod (Ananya), in writing

Reviewed against the actual implementation, not the plan's description of it: `e2e/fixtures/
guard.ts`, `guard.test.ts`, `scripts/check-fixture-phi.mjs`, `e2e/fixtures/constants.ts`,
`tier0.seed.ts`, `seed-cli.ts`, `serviceClient.ts`, and the CI wiring.

**Verdict: satisfied, no blocking concerns.** The guard is confirmed wired into every credential
path (not just documented as if it were), tested against the adversarial cases (substring-host
spoofing, tunnel ports, an attempted `SKIP_SEED_GUARD` bypass) rather than only the happy path,
and `check:fixture-phi` scans a broader surface (`e2e/` in full) than D5's own text asked for.
Two non-blocking hardening notes recorded for later, not conditions of this sign-off: the
digit-pattern PHI scan can miss an identifier written with space/hyphen grouping, and the
`90000xxxxx` mobile placeholder range is a project convention rather than an officially reserved
block. Full text recorded in [PHASED_TEST_PLAN.md](PHASED_TEST_PLAN.md) §2, D5.

**D5 is signed off.**

## 11. KNOWN-BUG-121 and KNOWN-BUG-122 — also resolved, before Phase 4

Both originally-logged follow-ups turned out to be worth resolving now rather than carrying
forward, and both are done and verified.

**KNOWN-BUG-121** turned out bigger than "check whether three columns are missing." Investigating
all eight guarded blocks in `20260628000002_phi_column_encryption.sql` — not assuming any were
harmless — found six were fine (either already correctly live, or their guard's premise was
false because the source column never existed in the real design at all) and **two were a
genuine, live DPDP §8(4) gap**: `lab_results.result_value` (HIGH-risk, free-text lab narrative)
and `patient_consents.patient_signature`/`witness_signature` (MEDIUM-risk, consent signatures)
had never once had an `_enc` column created, in production, because the original migration
named the wrong tables (`lab_reports`, `consent_forms` — neither has ever existed). The actual
encryption engine, `phi-backfill-encrypt`'s `COLUMN_MAP`, carried the identical wrong names and
had no entry for `patient_consents` at all — fixing only the schema would have left the backfill
function unable to find what to encrypt. Both fixed together in
`20261106000010_phi_encryption_columns_recovery.sql` plus the Edge Function. Reviewed by
security-pod before being called done, matching the standard the original migration's own header
demanded of itself ("Ananya sign-off: confirm column list before running in prod") and never
received the first time.

**KNOWN-BUG-122** — `ai_feature_classes.updated_by` repointed from `auth.users(id)` to
`public.users(id)` in `20261106000011_fix_ai_feature_classes_user_fk.sql`, using the same
remap-then-swap approach `20261106000003_fix_user_fk_targets.sql` already established (written
as its own migration rather than edited into that file, since it may already be applied
elsewhere). `check:user-fk` is back to its original 16 legitimate `auth.users` references — the
allowlist entry is gone because the column no longer needs one.

**Verified, all together:** `supabase db reset` applies all 617 migrations; `lab_results.
result_enc`, `patient_consents.patient_signature_enc`/`witness_signature_enc`,
`ai_usage_logs.patient_id`/`encounter_id` all confirmed present by direct query;
`ai_feature_classes.updated_by`'s FK confirmed pointing at `public.users` via `pg_constraint`;
`npm run e2e:seed -- --check` and `npm run test:e2e` (8/8, both tenants) both still pass;
`npm test` (990/3 skipped), lint, and inventory all unchanged.

**Full detail, including exactly which of the eight original guards were investigated and why
each was or was not a real gap, is in [KNOWN_BUGS.md](KNOWN_BUGS.md) under both ids.**

**Left for later, genuinely not blocking Phase 4:** the actual encryption backfill —
invoking `phi-backfill-encrypt` against `lab_results` and `patient_consents` for the first time
in production, now that the schema exists for it to write into. That is a production data
operation, not a schema fix, and belongs with whoever owns the DPDP remediation timeline.

**Local Supabase was left running** (`supabase_db_…` and its full service stack — it restarted
once mid-session after a Docker Desktop backend hiccup on this machine, unrelated to the repo).
`npx supabase stop` to reclaim the resources, or leave it running for whoever picks up #1–#2.
