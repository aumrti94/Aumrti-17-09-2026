# 20 — DATABASE RESTRUCTURING PLAN

Sequenced remediation, as it stood at capture (2026-08-18). This audit itself made no changes.

> **See [`00_STATUS.md`](00_STATUS.md) before reading further.** Phase 0 below — closing the
> confidentiality holes — was executed on 2026-10-16, one day after capture, as migrations
> `20261016000001`–`20261016000014`. The line that used to read "nothing in this plan has been
> executed" was true when written and is not true now.

Every remaining item still requires human approval before implementation.

Ordering is by *risk-adjusted value*: close confidentiality holes first, then correctness, then
performance, then hygiene. Within each phase, lowest-risk change first.

**Nothing here drops, merges, splits or renames a table.** The domain model is sound; the work is
policies, constraints, indexes and identifiers.

---

## Phase 0 — Emergency (hours) · confidentiality — ✅ DONE (2026-10-16), except 0.5

Highest severity, lowest risk. All are metadata changes with no data migration.

**0.1–0.4 are done**, landed as `20261016000002` through `20261016000005` the day after this
plan was written — verified by reading each migration directly, not by trusting this note. See
[`00_STATUS.md`](00_STATUS.md). **0.5 is not done** — see its entry below.

### 0.1 Close the RLS-bypassing views — [C-13](21_CRITICAL_FINDINGS.md) — ✅ FIXED, `20261016000002_sec_views_security_invoker.sql`
```sql
ALTER VIEW public.ipd_advance_balances          SET (security_invoker = true);
ALTER VIEW public.unbilled_service_summary      SET (security_invoker = true);
ALTER VIEW public.bed_reprice_previews          SET (security_invoker = true);
ALTER VIEW public.addon_entitlement_drift       SET (security_invoker = true);
ALTER VIEW public.platform_payment_config_status SET (security_invoker = true);
ALTER VIEW public.hospital_ai_budget_status     SET (security_invoker = true);

REVOKE SELECT ON public.ipd_advance_balances, public.unbilled_service_summary,
                 public.bed_reprice_previews, public.addon_entitlement_drift FROM anon;
```
⚠️ **`ipd_advance_balances` has 11 live call sites.** Once RLS applies, callers see only their own
hospital — which is the intent, but any code relying on cross-tenant totals will change behaviour.
Verify those 11 sites first. This is the only Phase 0 item with a functional side effect.

### 0.2 Lock down chain tables — [C-01](21_CRITICAL_FINDINGS.md) — ✅ FIXED, `20261016000003_sec_chain_tables_platform_only.sql`
Replace both `*_platform_only` policy bodies with `is_aumrti_admin()`, and revoke the
`INSERT/UPDATE/DELETE/TRUNCATE` grants from `authenticated`. Both tables are empty and unreferenced
— **zero functional risk**.

### 0.3 Stop publishing patient names anonymously — [C-02](21_CRITICAL_FINDINGS.md) — ✅ FIXED, `20261016000004_sec_queue_state_tenant_scope.sql`
The migration went further than the option sketched here: `current_patient_name` was found to be
write-only (nothing reads it — verified by repo-wide grep), so it drops the anon policy, scopes
the surviving read to `hospital_id`, and retires the column's contents to `NULL` rather than
building a second sanitised view.

### 0.4 Fix patient portal session policies — [C-07](21_CRITICAL_FINDINGS.md) — ✅ FIXED, `20261016000005_sec_portal_sessions_hardening.sql`
The applied fix is stricter than sketched here: two additional over-broad anon SELECT policies
were found during implementation (`anon_select_active_sessions`, `portal_sessions_anon_select` —
one of which exposed `otp_code` and `session_token` directly) and closed in the same migration,
replaced by column-level grants restricting anon to exactly the columns the login flow touches.

### 0.5 Rotate credentials — [C-09](21_CRITICAL_FINDINGS.md) — ⚠️ NOT DONE
Rotate `SUPABASE_DB_PASSWORD` (valid, and its scope is now known), revoke the four `sbp_` personal
access tokens recoverable from git history and from a since-removed value in `.env.example`,
re-issue the API keys, and correct the pooler host in
[`run_migration.cjs`](../../run_migration.cjs) from `aws-0-` to `aws-1-`. This is the one Phase 0
item that is still open as of 2026-09-05 — see `00_STATUS.md` and the cleanup plan's Phase 0.
Unlike 0.1–0.4, it requires action in the Supabase dashboard; no migration can do it.

**Exit criteria:** no view runs as owner without a tenant filter; no `USING (true)`/`WITH CHECK (true)`
on any tenant table; no PHI column readable by `anon`.

---

## Phase 1 — Urgent (days) · correctness

### 1.1 Fix the payroll GL path — [C-03](21_CRITICAL_FINDINGS.md)
In [`PayrollTab.tsx`](../../src/components/hr/PayrollTab.tsx) and
[`OffboardingTab.tsx`](../../src/components/hr/OffboardingTab.tsx):
`journal_entry_lines` → **`journal_line_items`**, and check the returned error instead of
discarding it. Do not emit the success toast unless both inserts succeeded.

Then **reconcile the existing ledger**: find `journal_entries` rows with no
`journal_line_items` children and decide per row whether to void or reconstruct. Do this before
1.5 adds the constraint that would reject them.

Also create `get_next_journal_number(p_hospital_id uuid)` — currently missing, so journal numbering
silently degrades to `JV-${Date.now()}`.

### 1.2 Correct the remaining 25 contract violations — [C-04](21_CRITICAL_FINDINGS.md)
Apply the mapping in [`12_APPLICATION_DATABASE_CONTRACT.csv`](12_APPLICATION_DATABASE_CONTRACT.csv)
(`probable_intended_target` column). Rename-only for the 14 synonym pairs — low risk.

For the six with **no** live counterpart — `sepsis_alerts`, `webhook_endpoints`, `credit_packs`,
`financial_anomalies`, `hospital_encounter_usage`, `allergy_records` — decide per feature: build
the table or remove the dead path. `sepsis_alerts` and `allergy_records` are clinical and should be
built ([16](16_CLINICAL_DATABASE_AUDIT.md)).

Create the 5 remaining missing RPCs or remove their call sites.

### 1.3 Regenerate `types.ts` — [D-9](13_AI_CODE_DRIFT_FINDINGS.md)
Currently missing **91 live tables**. Regenerating restores type checking and would have caught
most of 1.2 at compile time. Also remove the `(supabase as any)` casts that defeat it.
**Do this immediately after 1.2**, so the corrected names are locked in by the type system.

### 1.4 Prevent duplicate payments and charge lines — [U-2](15_AI_UNDER_ENGINEERING_FINDINGS.md)
```sql
-- dedup first, then:
ALTER TABLE bill_payments ADD CONSTRAINT bill_payments_provider_ref_uq
  UNIQUE (bill_id, provider_reference);   -- add the column if absent
CREATE UNIQUE INDEX bill_line_items_no_dup
  ON bill_line_items (bill_id, service_id, service_date)
  WHERE item_type IN (/* non-repeatable types only */);
```
Scope the partial index carefully — consumables and per-unit charges legitimately repeat.

### 1.5 Enforce double-entry — [U-3](15_AI_UNDER_ENGINEERING_FINDINGS.md)
After 1.1's reconciliation: deferred constraint trigger asserting `total_debit = total_credit`,
that lines sum to the header, and that a `posted` entry has ≥1 line.

### 1.6 Bound monetary values — [U-4](15_AI_UNDER_ENGINEERING_FINDINGS.md)
`CHECK (total_amount >= 0)`, `CHECK (balance_due >= 0)`, `CHECK (paid_amount >= 0)` on `bills`.
Cheap and safe. Server-side total derivation is Phase 3.

**Exit criteria:** no application code references a non-existent object; GL balances; duplicate
payments impossible.

---

## Phase 2 — Important (1–2 weeks) · performance & integrity

### 2.1 Index the foreign keys — [U-1](15_AI_UNDER_ENGINEERING_FINDINGS.md)
~130 indexes, prioritised: **127 `hospital_id`** first (they carry every RLS predicate), then 96
`patient_id`, then the rest.
```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_<table>_hospital_id ON <table> (hospital_id);
```
`CONCURRENTLY` means no write lock. Purely additive, fully reversible. Generate the statement list
from the `(MISSING)` rows in [`10_INDEX_PERFORMANCE_AUDIT.csv`](10_INDEX_PERFORMANCE_AUDIT.csv).

### 2.2 Drop 42 duplicate indexes — [O-4](14_AI_OVER_ENGINEERING_FINDINGS.md)
Always drop the hand-written member, never the constraint-backed one.

### 2.3 Make RLS predicates InitPlan-hoistable — [S-9](18_SECURITY_DATABASE_AUDIT.md)
Rewrite 134 policies from `get_user_hospital_id()` to `(SELECT get_user_hospital_id())`. Mechanical,
no semantic change, large effect on scan cost. Combine with consolidating the 78 permissive stacks
([O-5](14_AI_OVER_ENGINEERING_FINDINGS.md)).

### 2.4 Protect statutory records — [C-10](21_CRITICAL_FINDINGS.md)
Change `ON DELETE CASCADE` → `RESTRICT` on the 18 FKs reaching `ndps_register`, `phi_access_audit`,
`phi_backfill_log`, `journal_entries`, `journal_line_items`, `bill_payments`, `bill_amendments`,
`audit_records`. Add an explicit archival step to `purge_hospital`.

### 2.5 Pin `search_path` on 4 functions — [S-7](18_SECURITY_DATABASE_AUDIT.md)
`cleanup_expired_trusted_devices`, `get_active_phi_key_version`, `next_seq`, `purge_old_phi_audit`.
Match the pattern the other 137 already use.

### 2.6 Close the remaining cross-tenant reads — [S-5](18_SECURITY_DATABASE_AUDIT.md)
Tenant-scope the `USING (true)` SELECT policies on `discount_codes`, `admission_sequences`,
`opd_token_sequences`, `ai_language_settings`, `tv_display_settings`,
`platform_ai_provider_config`. **Leave the 11 genuine reference tables alone.**

---

## Phase 3 — Structural (1–2 months) · consolidate

### 3.1 Move bill totals into the database — [C-06](21_CRITICAL_FINDINGS.md)
Implement `recalculate_bill_totals(p_bill_id uuid)` server-side, matching
[`computeBillTotals`](../../src/lib/billTotals.ts) exactly — including the net-of-discount
convention its comment documents. The client fallback then becomes genuinely a fallback. Keep the
existing unit tests as the specification.

### 3.2 Clinical safety data and constraints — [16](16_CLINICAL_DATABASE_AUDIT.md)
Seed `drug_interactions` (currently **0 rows**); build a patient allergy table; wire
`high_alert_double_checks`; add physiological-range CHECKs to `ipd_vitals` / `nursing_vitals` while
both are still empty.

### 3.3 Enforce tenant immutability and cross-tenant child integrity
Trigger preventing `hospital_id` from changing after insert; trigger preventing a child from
referencing a parent in another hospital ([Rule 4](19_CANONICAL_DATABASE_ARCHITECTURE.md)).

### 3.4 Resolve the confirmed duplicates — [D-2](13_AI_CODE_DRIFT_FINDINGS.md)
`med_admin_records` / `mar_records` (both empty, both unreferenced — pick one);
`fixed_assets` / `facility_assets`; `ai_provider_config` / `platform_ai_provider_config`;
`discount_approvals` / `bill_discount_approvals`; `demand_forecasts` / `bed_demand_forecasts`.
Confirm each with the feature owner before acting.

### 3.5 Standardise status vocabularies — [U-8](15_AI_UNDER_ENGINEERING_FINDINGS.md)
CHECK constraints on status columns of transactional tables. Prefer CHECKs over enum conversion —
same benefit, far lower risk.

### 3.6 Reconcile identity drift — [I-1](07_IDENTITY_ARCHITECTURE_AUDIT.md)
Standardise the duplicate `app_role` values (`lab_tech`/`lab_technician`,
`billing_executive`/`billing_staff`); fix the dead `USING (id = auth.uid())` policy; add a role
check to `"Admins can manage users"`; add the identity reconciliation report for the 17
unlinked identities.

### 3.7 Narrow `admissions` — [O-2](14_AI_OVER_ENGINEERING_FINDINGS.md)
81 columns, 4 rows. Extract discharge, insurance and transfer satellites **now**, while the table
is small. Lowest-cost moment this will ever have. Optional.

---

## Phase 4 — Prevention (ongoing)

The defects in this audit share one root cause: **no authority over naming and enforcement that
independent sessions could consult.** Without this phase the drift recurs.

1. Adopt [`19_CANONICAL_DATABASE_ARCHITECTURE.md`](19_CANONICAL_DATABASE_ARCHITECTURE.md) as the
   written standard, and require new migrations to cite the rule they satisfy.
2. **Fix the existing guard's blind spot first** ([S-10](18_SECURITY_DATABASE_AUDIT.md)):
   `check-rls-coverage.mjs` only matches `public.`-qualified `CREATE TABLE`, so it sees 396 of 548
   tables and reports "passed" while ~152 tables go unchecked. Make the prefix optional (its
   `ENABLE_RLS_RE` already does this) and assert the discovered count against the live catalog.
3. Extend `scripts/check-rls-coverage.mjs` — which already works and already prevented recurrence
   of one whole defect class — with CI guards for:
   - every new view sets `security_invoker` (would have caught C-13);
   - no policy contains `USING (true)` / `WITH CHECK (true)` on a table with `hospital_id`;
   - every FK has an index;
   - every table has `hospital_id NOT NULL` unless allowlisted as layer 1/15;
   - no `.from('…')` string in application code lacks a matching live table (would have caught
     C-03, C-04, C-05 — the highest-value guard on this list).
4. Regenerate `types.ts` in CI on every migration; fail if it differs from committed.
5. Re-run this audit's introspection quarterly; diff against this baseline.

---

## Effort and risk

| Phase | Effort | Risk | Blast radius if wrong |
|---|---|---|---|
| 0 — Emergency | 1 day | **Very low** | 11 call sites (0.1) |
| 1 — Urgent | 3–5 days | Low–medium | GL reconciliation needs care |
| 2 — Important | 1–2 weeks | **Very low** | Additive only |
| 3 — Structural | 1–2 months | Medium | Requires product decisions |
| 4 — Prevention | Ongoing | None | — |

**Phase 0 and Phase 2 together resolve every CRITICAL and most HIGH findings, and consist almost
entirely of additive or metadata-only changes.** That is the striking result: the highest-severity
problems in this database are also among the cheapest and safest to fix.

## What must not be done

- **Do not rewrite.** See [answer 15](01_AI_DATABASE_FORENSIC_EXECUTIVE_SUMMARY.md).
- **Do not drop tables because they are empty.** 432 of 548 are empty; that reflects an early-stage
  deployment, not dead schema ([O-1](14_AI_OVER_ENGINEERING_FINDINGS.md)).
- **Do not drop indexes on zero-scan statistics.** Insufficient traffic
  ([O-7](14_AI_OVER_ENGINEERING_FINDINGS.md)).
- **Do not merge the claims tables.** `insurance_claims` / `pmjay_claims` / `govt_scheme_claims` /
  `hcx_claims` are valid separation ([17](17_RCM_DATABASE_AUDIT.md)).
- **Do not "fix" the reference-data `USING (true)` policies.** 11 of them are correct.
- **Do not touch** `ndps_register`, `phi_access_audit`, `phi_encryption_keys`, `phi_backfill_log`
  — their restrictive policies are exemplary and deliberate.
