# 11 — MIGRATION DRIFT AUDIT

568 files · 43,727 SQL lines · first `20260321162749`, last `20261015000002`.

## Aggregate DDL profile

| Statement | Count |
|---|---|
| `CREATE TABLE` | 582 (548 unique names) |
| `DROP TABLE` | **3** |
| `ALTER TABLE` | 1,238 |
| `ADD COLUMN` | **851** |
| `DROP COLUMN` | **0** |
| `RENAME COLUMN` | **0** |
| `ADD CONSTRAINT` | 80 |
| `DROP CONSTRAINT` | 56 |
| `CREATE POLICY` | 617 |
| `DROP POLICY` | **330** |
| `ENABLE ROW LEVEL SECURITY` | 586 |
| `DISABLE ROW LEVEL SECURITY` | **0** |
| `CREATE INDEX` | 743 |
| `DROP INDEX` | **0** |

Two shapes stand out.

**Evolution is purely additive.** 851 `ADD COLUMN` against **zero** `DROP COLUMN` and **zero**
`RENAME COLUMN`. Nothing is ever removed or corrected in place — when a column turns out to be
wrong, another is added beside it. This is why `admissions` has accumulated 61 added columns
across 26 migrations and `hospitals` 50 across 28. It is also why the schema is wide rather than
wrong: additive drift costs storage and clarity, not integrity.

**Policies are rewritten constantly.** 330 `DROP POLICY` against 617 `CREATE POLICY` — more than
half of all policies written have been thrown away and replaced. Access control was the least
stable part of the design.

## Ledger integrity

`supabase_migrations.schema_migrations` holds **567** versions. The repository holds 567
versioned `.sql` files (568 including the unversioned `_preview_orphaned_auth_users.sql`).

| Check | Result |
|---|---|
| In repo but never applied | **0** |
| Applied but not in repo | **0** |

The ledger and the repository agree exactly. That is a genuinely good result and it removes an
entire class of suspicion — this is not a database that drifted from its migrations by manual
console edits.

Which makes the next finding the more interesting one.

---

## Patch chain 1 — `asset_register`: merged away, then resurrected twice, still absent

```
20260611000001_merge_asset_register_into_fixed_assets.sql
    DROP TABLE IF EXISTS public.depreciation_ledger CASCADE;
    DROP TABLE IF EXISTS public.asset_register CASCADE;
    → deliberate consolidation into fixed_assets
                    ↓
20260901000007_add_asset_management_tables.sql          (≈3 months later)
    CREATE TABLE IF NOT EXISTS asset_register (…)
    CREATE TABLE IF NOT EXISTS depreciation_ledger (…)
                    ↓
20260903000001_asset_management_tables.sql              (2 days later)
    CREATE TABLE IF NOT EXISTS public.asset_register (…)      ← near-identical duplicate
    CREATE TABLE IF NOT EXISTS public.depreciation_ledger (…)
                    ↓
FINAL STATE (live, verified via to_regclass):
    asset_register       DOES NOT EXIST
    depreciation_ledger  DOES NOT EXIST
    fixed_assets         EXISTS (31 columns, 0 rows, 3 app references)
    facility_assets      EXISTS  ← a third asset table
```

Three sessions, three different answers. The June session correctly identified duplication and
consolidated. Two September sessions, unaware of that decision, re-created the merged-away tables
— twice, two days apart, in files differing only in schema qualification and constraint detail.

**Is the final state correct?** The *outcome* is right — `fixed_assets` is the single asset table
and the duplicates are gone. But it is right by accident, and the ledger is lying: both September
migrations are recorded as applied while their tables do not exist. Most likely they failed and
were force-marked with `supabase migration repair`. The repository cannot prove that —
**INSUFFICIENT EVIDENCE** on the mechanism.

The residue: `fixed_assets` and `facility_assets` both exist, unreconciled.

**Risk:** any future `supabase db reset` or fresh-environment replay *will* execute those two
migrations successfully, creating `asset_register` and `depreciation_ledger` in the new
environment. Production and a rebuilt environment would then have different schemas.

---

## Patch chain 2 — RLS retrofitted three separate times

```
(many tables ship across ~200 migrations, some without RLS)
                    ↓
20260510000001_enable_rls_missing_tables.sql     ← retrofit #1
                    ↓
20260518000006_rls_missing_tables.sql            ← retrofit #2 (8 days later)
20260518000007_rls_open_access_fixes.sql         ← retrofit #3 (same day)
                    ↓
20260519000001_fix_audit_log_rls.sql
20260519000002_fix_lab_qc_entries_rls.sql
20260519000003_fix_v9_emr_rls.sql
20261008000011_fix_ipd_advances_rls.sql
20261008000034_lab_calibration_rls_fix.sql
                    ↓
FINAL STATE: RLS enabled on 548 of 548 tables (100%), 0 tables unprotected
```

The pattern is unambiguous: tables shipped, RLS was forgotten, and it was caught by audit rather
than by process — three times. The repository documents its own awareness of this; the header
comment of [`scripts/check-rls-coverage.mjs`](../../scripts/check-rls-coverage.mjs) names these
exact three migrations as the reason the guard exists.

**Is the final state correct?** For *coverage*, yes and verifiably so — 100%, zero gaps. For
*quality*, partly: retrofits applied RLS but several applied it permissively, and the surviving
`USING (true)` policies in [`21_CRITICAL_FINDINGS.md`](21_CRITICAL_FINDINGS.md) sit
disproportionately on tables that appear in these retrofit files. Coverage was fixed; correctness
was assumed.

The CI guard is a genuinely good outcome — the failure mode is now structurally prevented.

---

## Patch chain 3 — `bills` dropped `CASCADE` and rebuilt the day after creation

```
20260322092601  CREATE TABLE bills (…)
                    ↓ (next day)
20260323042425  DROP TABLE IF EXISTS bills CASCADE;
                CREATE TABLE bills (…)
                    ↓
20260520000002_fix_bills_bill_type_check.sql
                ALTER TABLE bills DROP CONSTRAINT bills_bill_type_check
                    ↓
20260913000000_aumrti_admin_cross_tenant_rls.sql
                CREATE POLICY aumrti_admin_read_all_bills … then DROP POLICY (same file)
                    ↓
FINAL STATE: bills — 137 rows across 5 hospitals, 24 migration events over 13 files
```

`DROP TABLE … CASCADE` on the central financial table silently drops every dependent object —
foreign keys from child tables, views, policies. On day two of the project the blast radius was
nil. The pattern is worth flagging because it recurs as a habit, not because this instance caused
damage.

`bills` is one of only two tables in the entire history with more than one `CREATE TABLE`.

---

## Patch chain 4 — `tpa_queries` policy thrash

```
20260529_insurance_upgrade.sql
    DROP CONSTRAINT tpa_queries_status_check
    DROP CONSTRAINT tpa_queries_status_chk        ← two names for one constraint
    CREATE POLICY tpa_queries_hospital_{select,insert,update,delete}
    DROP   POLICY tpa_queries_hospital_{select,insert,update,delete}   ← same file
                    ↓
20260615000001_fix_tpa_queries_missing_cols.sql
    DROP CONSTRAINT tpa_queries_status_check
    DROP CONSTRAINT tpa_queries_status_chk        ← dropped again
                    ↓
20260904000026_p2_gaps.sql
    CREATE TABLE tpa_queries (…)                  ← created here, months after being altered
    CREATE POLICY hospital_isolation … DROP POLICY hospital_isolation
                    ↓
FINAL STATE: 43 events across 4 files; 5 policies created and 5 dropped
```

Two tells. Dropping `tpa_queries_status_check` **and** `tpa_queries_status_chk` — defensively
guessing the constraint name because the session did not know which convention an earlier session
had used. And `ALTER`ing a table months before the `CREATE TABLE` that appears in the ledger,
which only works because every statement is `IF EXISTS` / `IF NOT EXISTS` guarded.

That guarding is why 568 migrations apply cleanly despite contradicting each other. It also means
the migrations are not a reliable description of the schema — only the live catalog is.

---

## Migrations named as repairs

30 of 568 (5.3%) announce themselves as fixes:

```
enable_rls_missing_tables · rls_missing_tables · rls_open_access_fixes
fix_audit_log_rls · fix_lab_qc_entries_rls · fix_v9_emr_rls
fix_journal_sequence_sync · fix_bills_bill_type_check · billing_leakage_fix
fix_missing_tables · cleanup_orphaned_data · cleanup_orphaned_direct
fix_missing_columns · merge_asset_register_into_fixed_assets
fix_vaccine_master_rls_and_schema · fix_duplicate_consultation_line_items
create_missing_storage_buckets · fix_tpa_queries_missing_cols
fix_hospital_subscriptions_status_check · missing_columns
fix_discharge_status · fix_ipd_advances_rls · ot_stub_ui_fixes
lab_calibration_rls_fix · bill_line_items_item_type_constraint_fix … (+5)
```

`fix_duplicate_consultation_line_items` and `billing_leakage_fix` are notable: both are
**data** repairs for revenue defects that reached production, not schema corrections.

---

## Column-level drift

36 tables have columns declared in migrations that do not exist live, or columns live that no
migration declares. Given 0 `DROP COLUMN` statements, the first direction is the significant one
— it means a migration's column additions did not fully take effect, consistent with the
`asset_register` pattern.

Detail per table in [`02_COMPLETE_TABLE_INVENTORY.csv`](02_COMPLETE_TABLE_INVENTORY.csv)
(`migration_files` / `migration_events` columns).

## Highest-churn tables

| Table | Events | Files | `ADD COLUMN` | Policy +/− |
|---|---|---|---|---|
| `admissions` | 77 | 26 | 61 | 1 / 1 |
| `insurance_claims` | 61 | 11 | 48 | 1 / 1 |
| `hospitals` | 59 | 28 | 50 | 2 / 2 |
| `insurance_pre_auth` | 52 | 10 | 41 | 2 / 2 |
| `lab_orders` | 47 | 14 | 21 | 4 / 4 |
| `tpa_queries` | 43 | 4 | 13 | 5 / 5 |
| `storage.objects` | 36 | 5 | 0 | **29 / 7** |
| `patients` | 35 | 14 | 25 | 0 / 0 |

`patients` is the encouraging row: 25 columns added across 14 migrations with **zero policy
churn** — the access model for the most sensitive table was correct from the start and never
needed rewriting. `storage.objects` is the opposite: 29 policies created and 7 dropped, the least
stable access model in the system.

## Assessment

The migration history shows a system built fast by many independent sessions, held together by
`IF EXISTS` guards, and corrected reactively by audit rather than proactively by process. The
important qualifier: **the corrections mostly worked.** RLS reached 100%. The duplicate asset
tables are gone. The ledger reconciles exactly. The residual defects are the ones no audit went
looking for — policy *correctness* rather than policy *presence*.
