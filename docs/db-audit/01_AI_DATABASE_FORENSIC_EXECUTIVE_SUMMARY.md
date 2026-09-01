# 01 — AI DATABASE FORENSIC AUDIT · EXECUTIVE SUMMARY

**System:** AUMRTI — multi-tenant Hospital Information System
**Database:** PostgreSQL 17.6 · Supabase `pdxvisvmnzjhsgmvygku` (ap-south-1) · schema `public`
**Live capture:** 2026-08-18T16:42:54Z · **Audit date:** 2026-08-18
**Scope:** 548 live tables · 568 migrations (43,727 SQL lines) · 1,104 app source files · 107 edge functions

---

## Method and evidence base

Six sources were reconciled, in this order of authority:

1. **Live database** — 16 read-only `pg_catalog` / `information_schema` queries, session pinned
   `READ ONLY`. 589 relations, 8,104 columns, 2,650 constraints, 1,555 indexes, 970 policies,
   535 functions, 641 triggers, 11,743 grants captured.
2. **568 migration files** — parsed in timestamp order into a per-table DDL event history.
3. **`src/integrations/supabase/types.ts`** — the generated snapshot.
4. **Application code** — 4,127 `.from()` call sites and 69 `.rpc()` names across `src/`,
   `supabase/functions/`, `e2e/`, `scripts/`.
5. **Migration ledger** — `supabase_migrations.schema_migrations`.
6. **Tests and docs.**

No schema, data, policy, or application change was made. Every statement issued was a `SELECT`.

> **One material limitation.** The API keys in `.env.local` are rejected by the project
> (finding C-09), so nothing could be exercised *through PostgREST as `anon` or `authenticated`*.
> All access-control conclusions are derived from the policy bodies, role grants, and
> `pg_roles.rolbypassrls` as read from the live catalog — which is what Postgres actually
> enforces — but they are not accompanied by an end-to-end request demonstration.

---

## Required executive metrics

| Metric | Value |
|---|---|
| Total `CREATE TABLE` definitions in migrations | 582 |
| Total unique tables (migrations) | 548 |
| Total live tables | **548** |
| Live views | 8 |
| Duplicate `CREATE TABLE` definitions (same name, ≥2 files) | 34 |
| Potential duplicate business entities (clusters adjudicated) | 10 clusters / 43 tables |
| Tables with `hospital_id` | 494 |
| Tables without `hospital_id` | 54 |
| Tables where `hospital_id` appears unnecessary | 13 *(present but never referenced by RLS)* |
| Tables where `hospital_id` appears missing | 0 *(all non-tenant tables are reference/platform data)* |
| Tables with RLS enabled | **548 (100%)** |
| Tables without RLS | **0** |
| Tables with RLS but no policy | 4 *(deliberate deny-all — see below)* |
| Tables with potentially unsafe RLS | 12 *(7 open-read + 5 open-write, after triage)* |
| Tables referencing `auth.users` | 46 *(53 FKs)* |
| Tables referencing `public.users` | 286 *(338 FKs)* |
| Tables with missing primary key | **0** |
| Tables with missing FK (orphan-capable columns) | see `08_…csv` — 0 structural, naming-drift only |
| Suspicious FKs (CASCADE on statutory/financial data) | 18 |
| Unindexed foreign keys | **905 of 1,474 (61%)** |
| Duplicate indexes | 42 pairs |
| Potentially unused tables (live, zero app references) | 31 |
| Tables used by application but absent from DB | **20** |
| RPCs called by application but absent from DB | **6** |
| Columns declared in migrations but absent live | 36 tables affected |
| Constraint mismatches | 374 CHECK constraints vs 162 free-text `status` columns |
| Status model mismatches | 7 enum types defined; `status` is `text` on 162 of 163 tables |
| Migration patch chains identified | 30 explicitly-named + 4 reconstructed in full |
| AI-generated architectural drift findings | 27 |
| Views bypassing RLS (`security_invoker` not set) | **6 of 8** — 4 exploitable |
| **Critical findings** | **5** |
| **High findings** | **7** |
| **Medium findings** | **9** |
| **Low findings** | **7** |

Policy-level and FK-level severity tallies (one row per object, in the CSVs):

| Artefact | CRITICAL | HIGH | MEDIUM | LOW / OK |
|---|---|---|---|---|
| RLS policies (936 rows) | 26 | 14 | 154 | 742 |
| Tenant isolation (548 tables) | 23 → **12 after triage** | 8 | 6 | 511 |
| Foreign keys (1,474 rows) | — | 247 | 682 | 545 |

---

## What the reconciliation showed

The headline number that motivated this audit — migrations claiming 551 tables, `types.ts`
claiming 476, the app referencing 513 — **largely dissolved on contact with the live database**:

| Set | Count |
|---|---|
| Live tables | 548 |
| Unique tables created across 568 migrations | 548 |
| In migrations but not live | **2** (`asset_register`, `depreciation_ledger` — C-12) |
| Live but never created in any migration | 2 (`ai_feature_classes`, `clinical_reference_sources`) |
| Applied migrations vs repo files | **567 / 567 — exact match, no drift** |

The migration history is, mechanically, in far better shape than the raw counts suggested. The
real defects are not in *whether* objects exist; they are in **what the policies permit**, **what
the application believes about names**, and **what the database declines to enforce**.

Two gaps are real and material:

- **`types.ts` is stale** — it describes 457 tables and is missing **91 live tables**. Every
  query against those 91 is untyped, which is precisely how the 20 phantom table names in C-04
  survived code review: TypeScript could not contradict them.
- **The application↔DB contract is broken in 26 places** (20 tables + 6 RPCs), several on write
  paths whose errors are discarded.

---

## Domain assessment

**Strongest.** Pharmacy narcotics (`ndps_register` — row-level immutability via `USING (false)`,
countersignature columns, schedule tracking), PHI encryption (`phi_encryption_keys` — total
API-role denial, key versioning/rotation columns), PHI access auditing (insert-denied, update-denied,
delete-denied, admin-read-only), and the core clinical/tenant tables (`patients`, `admissions`,
`bills`, `appointments`) whose policies are correct, symmetric, and consistently written.

**Weakest.** Platform/chain management (C-01), the patient portal session model (C-07), the
finance→GL bridge (C-03, C-06), and index coverage as a whole (C-08).

**Most surprising positive.** RLS is enabled on **100% of 548 tables**, every table has a primary
key, all timestamps are `timestamptz` without exception, and only 4 of 141 `SECURITY DEFINER`
functions have a mutable `search_path`. Those are four whole classes of Supabase Security Advisor
finding that this database simply does not have. That is a materially better baseline than the
migration churn (393 `DROP POLICY`, 30 fix-named migrations) predicted.

---

## The fifteen required answers

**1. Is the current database architecture fundamentally sound?**
Yes. The tenant model is coherent and near-universally applied (494/548 tables carry `hospital_id`;
the rest are legitimately global). RLS coverage is total. Every table has a primary key. Timestamps
are uniform. The defects found are *localised* — specific policies, specific names, specific
missing indexes — not structural. Nothing found requires re-modelling the domain.

**2. How much complexity is legitimate for an HIS?**
The large majority. A hospital system spanning OPD, IPD, ICU, OT, emergency, nursing, pharmacy,
laboratory, radiology, blood bank, inventory, procurement, billing, insurance, TPA, PM-JAY, HR,
payroll, quality/NABH, infection control, biomedical waste, dietetics, dental, IVF, vaccination,
ABDM, HL7 and telemedicine will legitimately need several hundred tables. 548 is not evidence of
bloat; the domain coverage is real and the per-domain modelling is generally reasonable.

**3. How much is accidental complexity?**
Modest — roughly 5–8%. Concretely: 42 duplicate indexes, 78 redundant permissive-policy
combinations across 61 tables, 13 tables carrying an unused `hospital_id`, and ~31 tables with no
application usage.

**4. How much is AI-generated duplication?**
Small but unmistakable, and diagnostic of the generation process. Confirmed pairs:
`fixed_assets`/`facility_assets`; `med_admin_records`/`mar_records`;
`ai_provider_config`/`platform_ai_provider_config`; `discount_approvals`/`bill_discount_approvals`;
`demand_forecasts`/`bed_demand_forecasts`; plus the `asset_register` arc (C-12), where a table was
merged away in June and re-created by two separate sessions in September. The clearest fingerprint
is not duplicate tables but **duplicate names for one concept** — the 14 naming-drift pairs in C-04,
and the `app_role` enum shipping both `lab_tech` **and** `lab_technician`, both `billing_executive`
**and** `billing_staff`.

**5. Strongest domains?** Pharmacy/NDPS, PHI security and audit, core patient/clinical, tenant core.

**6. Weakest domains?** Platform/chain administration, patient portal, finance→GL integration,
and indexing across all domains.

**7. Which tables should NOT be touched?**
`ndps_register`, `phi_access_audit`, `phi_encryption_keys`, `phi_backfill_log`, `audit_records` —
their restrictive policies are correct and deliberate. Also `patients`, `admissions`, `bills`,
`bill_line_items`, `bill_payments`, `users`, `hospitals`: correct as designed, and load-bearing for
477 `hospitals` FKs and 338 `users` FKs. Change their *indexes*, not their structure.

**8. Which require immediate review?**
`hospital_chains`, `chain_memberships`, `queue_state`, `patient_portal_sessions`, `discount_codes`,
`admission_sequences`, `opd_token_sequences`, `platform_ai_provider_config`, `ai_language_settings`,
`tv_display_settings`, `enterprise_leads`, `entitlement_fail_open_events`.

**9. Which appear duplicated?**
See answer 4 and [`04_TABLE_DUPLICATION_ANALYSIS.csv`](04_TABLE_DUPLICATION_ANALYSIS.csv). Note
the negative results too: `insurance_claims`/`pmjay_claims`/`govt_scheme_claims` are **valid
separation** (genuinely different payer workflows, schemas and lifecycles), as are
`drug_master`/`ayush_drug_master` and the `hospital_settings` configuration family.

**10. Questionable tenant isolation?**
12 tables after triage — 7 with cross-tenant read, 5 with unconstrained write. The other 11 of the
23 auto-flagged are correct global reference data. `portal_chat_messages` is tenant-safe only
indirectly, via another table's RLS.

**11a. Which views are dangerous?**
`ipd_advance_balances`, `unbilled_service_summary`, `bed_reprice_previews`,
`addon_entitlement_drift` — owner-run, no tenant filter, granted to `anon` (C-13). Fix by setting
`security_invoker = true`.

**11. Which RLS policies are dangerous?**
`hospital_chains_platform_only`, `chain_memberships_platform_only` (ALL, `true`/`true`);
`"Anyone can read queue_state"` (anon-readable PHI); `anon_update_active_sessions` and
`portal_sessions_anon_update` (anon UPDATE, `WITH CHECK (true)`); `discount_codes_public_read`,
`admission_sequences_select`, `opd_token_sequences_select` (cross-tenant read).

**12. Which identity relationships are inconsistent?**
The `auth.users` (46 tables) vs `public.users` (286 tables) split; 10 users with a NULL
`auth_user_id`; 7 auth identities with no business row; and the dead
`USING (id = auth.uid())` policy that matches 0 of 38 rows (C-11).

**13. Which migrations indicate AI patching?**
Three separate RLS retrofits (`20260510000001`, `20260518000006`, `20260518000007`); the
`asset_register` merge-then-resurrect arc; `bills` dropped `CASCADE` and recreated the day after
creation; `tpa_queries` creating and dropping four policies within a single file and dropping the
same status CHECK in two files. Full reconstruction in
[`11_MIGRATION_DRIFT_AUDIT.md`](11_MIGRATION_DRIFT_AUDIT.md).

**14. What is the minimum safe restructuring?**
Six `ALTER VIEW … SET (security_invoker = true)`, four policy rewrites, a handful of grant
revocations, ~130 index additions, three missing constraints, and 26 identifier corrections in
application code. No table needs to be dropped, merged, split, or renamed to make the system safe.
Sequenced in [`20_DATABASE_RESTRUCTURING_PLAN.md`](20_DATABASE_RESTRUCTURING_PLAN.md).

**15. Should Aumrti be rewritten?**
**No — and the evidence is one-sided.** A rewrite is warranted when the data model cannot express
the domain, when tenancy cannot be retrofitted, or when integrity is unrecoverable. None applies:
the tenant boundary is already explicit on 494 tables and enforced by a single, correct helper
function; RLS is already on 100% of tables; every table already has a primary key; the migration
ledger reconciles exactly against the repository. The genuinely serious findings are two open
policies, one anon-readable column, one wrong table name in the payroll path, and a large but
purely additive index backlog. Every one is a targeted fix measured in hours or days. Rewriting
would discard a working 548-table domain model — the most expensive and hardest-won asset here —
to fix defects that a focused remediation sprint resolves. **Remediate, do not rewrite.**

---

## FINAL CLASSIFICATION

> ### C — PARTIALLY SOUND · TARGETED DATABASE RESTRUCTURING REQUIRED

**Why C and not B.** Findings C-01 through C-04 and C-13 are not cleanup. A view grants `anon`
access to patient identifiers and financial balances across every hospital, bypassing RLS
entirely; two tables are writable and deletable by any authenticated user; patient names are
readable without authentication; the payroll path posts unbalanced journal entries and reports
success; 26 application↔database contract violations sit on live code paths, several silently
discarding write errors. Those are correctness and confidentiality defects in a healthcare system
handling PHI and money, and they need scheduled remediation, not opportunistic tidying.

**Why C and not D.** D would require the architecture itself to be unsafe. It is not. RLS is
enabled on every one of 548 tables; the tenant predicate is correct and consistently applied on
494 of them; primary keys are universal; `SECURITY DEFINER` hygiene is 137/141 clean; timestamp
typing is 100% uniform; the migration ledger has zero drift. The dangerous surface is **12 tables
out of 548 — about 2%** — and every one is fixed by rewriting a policy body, not by restructuring
data. The blast radius of the worst finding (C-01) is currently **zero rows**.

The database is a sound structure with a small number of sharp edges, several of which are sharp
enough to cut. Fix the twelve, index the foreign keys, correct the twenty-six identifiers, and
this is a healthy multi-tenant clinical database.

---

## Deliverables

| # | File |
|---|---|
| 01 | this document |
| 02 | [`02_COMPLETE_TABLE_INVENTORY.csv`](02_COMPLETE_TABLE_INVENTORY.csv) — all 548 tables |
| 03 | [`03_TABLE_BY_TABLE_AI_FORENSIC_AUDIT.csv`](03_TABLE_BY_TABLE_AI_FORENSIC_AUDIT.csv) — verdict per table |
| 04 | [`04_TABLE_DUPLICATION_ANALYSIS.csv`](04_TABLE_DUPLICATION_ANALYSIS.csv) |
| 05 | [`05_TENANT_ISOLATION_AUDIT.csv`](05_TENANT_ISOLATION_AUDIT.csv) |
| 06 | [`06_RLS_FORENSIC_AUDIT.csv`](06_RLS_FORENSIC_AUDIT.csv) — all 936 policy rows |
| 07 | [`07_IDENTITY_ARCHITECTURE_AUDIT.md`](07_IDENTITY_ARCHITECTURE_AUDIT.md) |
| 08 | [`08_FOREIGN_KEY_AUDIT.csv`](08_FOREIGN_KEY_AUDIT.csv) — all 1,474 FKs |
| 09 | [`09_CONSTRAINT_AUDIT.csv`](09_CONSTRAINT_AUDIT.csv) |
| 10 | [`10_INDEX_PERFORMANCE_AUDIT.csv`](10_INDEX_PERFORMANCE_AUDIT.csv) |
| 11 | [`11_MIGRATION_DRIFT_AUDIT.md`](11_MIGRATION_DRIFT_AUDIT.md) |
| 12 | [`12_APPLICATION_DATABASE_CONTRACT.csv`](12_APPLICATION_DATABASE_CONTRACT.csv) |
| 13 | [`13_AI_CODE_DRIFT_FINDINGS.md`](13_AI_CODE_DRIFT_FINDINGS.md) |
| 14 | [`14_AI_OVER_ENGINEERING_FINDINGS.md`](14_AI_OVER_ENGINEERING_FINDINGS.md) |
| 15 | [`15_AI_UNDER_ENGINEERING_FINDINGS.md`](15_AI_UNDER_ENGINEERING_FINDINGS.md) |
| 16 | [`16_CLINICAL_DATABASE_AUDIT.md`](16_CLINICAL_DATABASE_AUDIT.md) |
| 17 | [`17_RCM_DATABASE_AUDIT.md`](17_RCM_DATABASE_AUDIT.md) |
| 18 | [`18_SECURITY_DATABASE_AUDIT.md`](18_SECURITY_DATABASE_AUDIT.md) |
| 19 | [`19_CANONICAL_DATABASE_ARCHITECTURE.md`](19_CANONICAL_DATABASE_ARCHITECTURE.md) |
| 20 | [`20_DATABASE_RESTRUCTURING_PLAN.md`](20_DATABASE_RESTRUCTURING_PLAN.md) |
| 21 | [`21_CRITICAL_FINDINGS.md`](21_CRITICAL_FINDINGS.md) |
