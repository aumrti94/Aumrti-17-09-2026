# 21 — CRITICAL FINDINGS

**Audit date:** 2026-08-18 · **Live DB captured:** 2026-08-18T16:42:54Z
**Target:** PostgreSQL 17.6, Supabase project `pdxvisvmnzjhsgmvygku`, schema `public`
**Method:** read-only `pg_catalog` introspection + 568-migration static parse + full application scan.

Findings are numbered in discovery order; **severity is stated per finding, not implied by
position** — C-13 was found last and is one of the most severe. Every one cites live-database
evidence or a specific file.
Where the automated classifier over-flagged, the correction is stated explicitly — see
[§ False positives](#false-positives-corrected) at the end, which is part of the finding record.

---

## C-01 · `hospital_chains` / `chain_memberships` are fully open to every authenticated user
**Severity: CRITICAL · Confidence: HIGH · Cross-tenant read + write + delete**

The only policy on each table is named `*_platform_only`, but its body imposes no restriction
whatsoever:

```
hospital_chains.hospital_chains_platform_only   [ALL] roles={authenticated}
    USING      : true
    WITH CHECK : true
chain_memberships.chain_memberships_platform_only [ALL] roles={authenticated}
    USING      : true
    WITH CHECK : true
```

`authenticated` additionally holds `SELECT, INSERT, UPDATE, DELETE, TRUNCATE` grants on both
(verified via `information_schema.role_table_grants`). `authenticated` is **not** `BYPASSRLS`, so
RLS is the only gate — and it is open. Any logged-in user of *any* hospital can read, modify, or
delete the entire chain-ownership graph, including reassigning which hospitals belong to which
chain (`chain_memberships.hospital_id`, `.chain_id`, `.role`).

The policy name asserts an intent ("platform only") that the SQL never implements — the
signature pattern of generated code where the identifier carries the requirement and the body
does not.

**Current blast radius is zero rows** (`hospital_chains` = 0, `chain_memberships` = 0), so no
data is exposed today. This is a latent breach that arms itself the moment the chain feature is
used. Neither table is referenced anywhere in the application (`.from()` scan: 0 hits).

**Evidence:** live `pg_policies`; `information_schema.role_table_grants`; `pg_roles.rolbypassrls`.
**Fix:** replace both bodies with an `is_aumrti_admin()` predicate (the function already exists
and is used correctly elsewhere), or drop the tables if the feature is abandoned.

---

## C-02 · `queue_state` exposes patient names to unauthenticated callers, across all hospitals
**Severity: CRITICAL · Confidence: HIGH · PHI disclosure**

```
queue_state."Anyone can read queue_state" [SELECT] roles={public}
    USING : true
```

`queue_state` columns include `current_patient_name`, `current_token_number`, `doctor_id`,
`department_id`, `hospital_id`. The `public` role in a policy grants to *every* role including
`anon`, and `anon` holds a `SELECT` grant on the table. An unauthenticated caller holding only
the project's publishable anon key can therefore read the currently-called patient's name for
**every hospital on the platform**, with no tenant filter.

The companion policy `Hospital staff manage queue_state` *is* correctly tenant-scoped
(`hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())`), which shows
the tenant pattern was known and simply not applied to the read path.

The waiting-room TV display is the evident intent, but that use case needs the token number, not
the patient's name, and needs one hospital, not all of them.

> Caveat on exploitability: the anon API key currently in `.env.local` is **rejected** by the
> project (see C-09), so I could not demonstrate the read end-to-end. The exposure is established
> from the policy, the grant, and the role definition, all read from the live catalog. A valid
> anon key is a prerequisite for exploitation, and anon keys are by design public artifacts
> shipped in the browser bundle.

**Evidence:** live `pg_policies`; `pg_roles`; `information_schema.role_table_grants`.

---

## C-03 · Payroll posts unbalanced journal entries to a table that does not exist
**Severity: CRITICAL · Confidence: HIGH · Financial-ledger integrity**

[`src/components/hr/PayrollTab.tsx:554`](../../src/components/hr/PayrollTab.tsx#L554) writes the
GL detail lines to `journal_entry_lines`. **No such table exists.** The live schema's line table
is `journal_line_items`.

The sequence is:

1. `journal_entries` header **inserts successfully** with `total_debit` / `total_credit` set to
   the gross payroll amount and `status: "posted"` (table exists).
2. `await supabase.from("journal_entry_lines").insert(lines)` — **fails**, and the returned error
   is never inspected.
3. `toast({ title: "Payroll journal entry posted to accounts" })` reports success to the user.

Result: the general ledger accumulates **posted journal headers claiming a balanced debit/credit
total with zero supporting lines**. The books do not balance, the failure is invisible to the
operator, and the same pattern repeats in
[`src/components/hr/OffboardingTab.tsx`](../../src/components/hr/OffboardingTab.tsx).

The companion RPC `get_next_journal_number` (called at line 496) **also does not exist** in
`pg_proc`; the code falls back to `JV-${Date.now()}`, so journal numbering silently abandons the
hospital-scoped sequence and becomes a timestamp.

**Evidence:** live `pg_class` (no `journal_entry_lines`; `journal_line_items` present);
live `pg_proc` (no `get_next_journal_number`); the two source files above.

---

## C-04 · 20 tables and 6 RPCs are referenced by the application but do not exist
**Severity: CRITICAL / HIGH · Confidence: HIGH · Application↔DB contract**

Full list in [`12_APPLICATION_DATABASE_CONTRACT.csv`](12_APPLICATION_DATABASE_CONTRACT.csv).
Most are **naming drift** — the concept exists under a different name, evidence that different
generation sessions invented different names for one entity:

| App expects | Live table that actually holds the concept |
|---|---|
| `bill_items` | `bill_line_items` |
| `journal_entry_lines` | `journal_line_items` |
| `ipd_admissions` | `admissions` |
| `patient_vitals` | `ipd_vitals` / `nursing_vitals` |
| `pharmacy_dispenses` | `pharmacy_dispensing` |
| `prescription_history` | `prescriptions` |
| `modalities` | `radiology_modalities` |
| `dicom` | `dicom_files` |
| `committee_actions` | `committee_action_items` |
| `audit_samples` | `clinical_audit_samples` |
| `lab_reports` | `lab_results` |
| `ot_cases` | `ot_schedules` |
| `ipd_charges` | `service_charges` |
| `purchase_indents` | `store_indents` / `purchase_requisitions` |

These have **no live counterpart at all** — the feature was never built in the database:
`sepsis_alerts`, `webhook_endpoints`, `credit_packs`, `financial_anomalies`,
`hospital_encounter_usage`, `allergy_records`.

Missing RPCs: `recalculate_bill_totals`, `get_next_journal_number`, `grant_credits`,
`increment_discount_used_count`, `increment_query_count`, `enum_values_app_role`.

Write-path cases are the damaging ones, because Supabase returns an error object rather than
throwing — an uninspected `await` fails silently. Confirmed silent writers: `journal_entry_lines`
(C-03), `sepsis_alerts` (C-05), `bill_items`, `purchase_indents`, `financial_anomalies`,
`webhook_endpoints`, `prescription_history`.

---

## C-05 · Sepsis early-warning writes to a non-existent table; its 4-hour de-duplication never works
**Severity: HIGH · Confidence: HIGH · Clinical safety**

[`src/lib/clinicalPredictions.ts:159,197`](../../src/lib/clinicalPredictions.ts#L159) both reads
and writes `sepsis_alerts`, which does not exist.

- The de-duplication read (`recentAlert`) always returns `null`, so the "don't re-alert within
  4 hours" guard **never suppresses anything**.
- The alert insert silently discards its error, so the sepsis alert record is never persisted.

The immediately following insert into `clinical_alerts` **does** succeed, so the clinician still
receives a NEWS2 sepsis alert — the primary safety signal is intact. The damage is (a) permanent
loss of the sepsis-specific audit trail including `news2_score` and `vitals_snapshot`, and (b)
a duplicate critical alert on *every* vitals entry at NEWS2 ≥ 3, which is a textbook alert-fatigue
generator on precisely the highest-acuity patients.

This is rated HIGH rather than CRITICAL specifically because `clinical_alerts` still fires.

---

## C-06 · Bill totals are computed in the browser, not the database
**Severity: HIGH · Confidence: HIGH · Financial integrity**

`recalculate_bill_totals` does not exist in `pg_proc`. [`src/lib/billTotals.ts`](../../src/lib/billTotals.ts)
is explicit and self-aware about this — its docstring records that the RPC "does not exist as a
Postgres function on this project (confirmed via pg_proc — every call errors and falls through)"
— and it implements a complete client-side fallback that computes `subtotal`, `gst_amount`,
`total_amount`, `patient_payable`, `balance_due`, `payment_status` and `UPDATE`s them onto `bills`.

That fallback is careful, unit-tested, and honest. The architectural problem stands regardless:
**every monetary total on every bill is computed by client-side JavaScript and written as
untrusted input.** No CHECK constraint, trigger, or generated column re-derives
`bills.total_amount` from `bill_line_items`. A caller with a valid session and the `authenticated`
role can `UPDATE bills SET total_amount = 0, payment_status = 'paid'` and RLS will permit it —
tenant isolation is enforced, arithmetic integrity is not.

This is the single most consequential instance of the pattern in § C-08.

---

## C-07 · Patient portal sessions are anon-writable with `WITH CHECK (true)`
**Severity: HIGH · Confidence: HIGH · Patient account security**

`patient_portal_sessions` carries six policies, including two overlapping anon UPDATE grants:

```
anon_update_active_sessions   [UPDATE] roles={anon}
    USING      : (last_active > (now() - '24:00:00'::interval))
    WITH CHECK : true
portal_sessions_anon_update   [UPDATE] roles={anon}
    USING      : ((otp_verified = false) OR (otp_verified IS NULL))
    WITH CHECK : true
```

Permissive policies are OR-ed. The first therefore lets an **unauthenticated** caller update *any*
portal session row active in the last 24 hours — for any patient, at any hospital — and
`WITH CHECK (true)` places no constraint on the resulting row. Because `otp_verified` is a plain
column on this table, an anon caller can flip a session to `otp_verified = true`, which is the
exact predicate the sibling read policy `portal_sessions_anon_select` trusts to release session
data.

The two policies also contradict each other: one deliberately restricts writes to *unverified*
sessions, the other ignores verification entirely. That is two generation sessions solving the
same problem with incompatible assumptions, both left installed.

---

## C-08 · 905 of 1,474 foreign keys have no supporting index — including 127 on `hospital_id`
**Severity: HIGH · Confidence: HIGH · Performance / availability**

61% of foreign keys lack an index whose leading column is the FK column.

| FK column | Unindexed count |
|---|---|
| `hospital_id` | **127** |
| `patient_id` | **96** |
| `created_by` | 48 |
| `admission_id` | 41 |
| `department_id` | 22 |

`hospital_id` is the predicate of essentially every RLS policy in the system
(`hospital_id = get_user_hospital_id()`). Every query against those 127 tables performs a
sequential scan to satisfy RLS. It is invisible at the current data volume (1,078 patients,
137 bills, 6 hospitals) and becomes the dominant cost at production scale. Unindexed FKs also
force full scans of every child table on parent `DELETE` — which matters given the `purge_hospital*`
functions that exist to delete tenants.

A further **42 index pairs are exact duplicates** (same table, identical column set), e.g.
`bills_hospital_bill_number_key` + `idx_bills_hospital_number`. These are pure write overhead.

Complete list, with a `(MISSING)` recommendation row per unindexed FK, in
[`10_INDEX_PERFORMANCE_AUDIT.csv`](10_INDEX_PERFORMANCE_AUDIT.csv).

---

## C-09 · The credentials committed to `.env.local` are rejected by the project
**Severity: HIGH · Confidence: HIGH · Operational / secret hygiene**

- `VITE_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are structurally valid JWTs for ref
  `pdxvisvmnzjhsgmvygku` with `exp` in 2036, but both are refused: `401 {"message":"Invalid API
  key"}`. The project's JWT secret was rotated, or legacy keys were disabled.
- `SUPABASE_ACCESS_TOKEN` (`sbp_…`) returns `401 Unauthorized` from the Management API.
- `SUPABASE_DB_PASSWORD` **is** valid — it is what made this audit possible.
- The pooler host hardcoded in [`run_migration.cjs`](../../run_migration.cjs) is
  `aws-0-ap-south-1.pooler.supabase.com`; the project actually answers on **`aws-1-`**. That
  script cannot currently connect.

Two consequences: the repo's own migration/scratch tooling is broken, and a live database
password sits in a working-tree file. `.env.local` is gitignored (verified), so this is not a
repository leak — but the password is valid, unrotated, and grants full `postgres`-role access.

**Recommendation:** rotate `SUPABASE_DB_PASSWORD` now that its scope is known, re-issue API keys,
and fix the pooler prefix.

---

## C-10 · `ON DELETE CASCADE` reaches statutory records that must survive
**Severity: HIGH · Confidence: MEDIUM · Regulatory retention**

18 CASCADE foreign keys sit on financial and audit tables, including:

`phi_access_audit`, `phi_backfill_log`, `phi_encryption_keys`, `ndps_register`,
`ndps_pending_dispenses`, `bill_payments`, `bill_amendments`, `journal_entries`,
`journal_line_items`, `audit_records`.

These cascade from `hospitals`. Combined with the `purge_hospital`, `purge_hospital_finalize`,
and `purge_hospital_table` functions that exist in `pg_proc`, deleting a tenant destroys:

- the **NDPS register** — India's Narcotic Drugs and Psychotropic Substances rules require
  retention of controlled-substance registers independent of any commercial relationship;
- the **PHI access audit trail** — the evidence needed to answer a DPDP breach inquiry;
- posted financial journals and payment records.

The `ndps_register` table is otherwise exemplary: `no_update_ndps` and `no_delete_ndps` use
`USING (false)` to make rows immutable at the row level. That care is undone by a cascade from
the parent.

Severity is MEDIUM-confidence because whether tenant purge is ever executed in production, and
whether an external archive exists first, is not determinable from the repository —
**INSUFFICIENT EVIDENCE** on operational practice.

---

## C-11 · Dual identity model: 46 tables point at `auth.users`, 286 point at `public.users`
**Severity: HIGH · Confidence: HIGH · Identity architecture**

- **53 FKs → `auth.users`** across 46 tables
- **338 FKs → `public.users`** across 286 tables

Two incompatible answers to "who is a user" coexist. The canonical helper resolves through
`public.users`:

```sql
get_user_hospital_id() → SELECT hospital_id FROM public.users WHERE auth_user_id = auth.uid()
```

The consequences are measurable in live data (aggregates only, no PII read):

| Check | Result |
|---|---|
| `public.users` rows | 38 |
| `auth.users` rows | 35 |
| rows with `auth_user_id IS NULL` | **10** |
| `auth.users` with no `public.users` row | **7** |
| rows where `id = auth_user_id` | **0** |

10 staff records can never resolve to a hospital, and 7 authenticated identities have no business
record — for all of them `get_user_hospital_id()` returns `NULL`, every tenant policy evaluates
false, and the account silently sees an empty application.

**The `users` "update own profile" policy is dead code:**

```
Users can update own profile [UPDATE]
    USING      : (id = auth.uid())
    WITH CHECK : (id = auth.uid())
```

`users.id` is the business key; `auth.uid()` matches `users.auth_user_id`. They are equal in
**0 of 38 rows**, so this policy can never grant anything. The helper function was migrated from
`id` to `auth_user_id`; this inline policy was left on the old model. Full analysis in
[`07_IDENTITY_ARCHITECTURE_AUDIT.md`](07_IDENTITY_ARCHITECTURE_AUDIT.md).

---

## C-12 · Two applied migrations declare tables that do not exist
**Severity: MEDIUM · Confidence: HIGH · Migration integrity**

`supabase_migrations.schema_migrations` records **567 applied versions**, matching the repo's 567
versioned files exactly — 0 missing, 0 extra. The ledger claims a clean history.

Yet `asset_register` and `depreciation_ledger`, created by
`20260901000007_add_asset_management_tables.sql` **and again** by
`20260903000001_asset_management_tables.sql` (both recorded as applied), **do not exist**
(`to_regclass` → NULL).

The two migrations are near-identical duplicates written two days apart — the same two tables,
same purpose, differing only in schema qualification and constraint detail. Both were preceded in
June by `20260611000001_merge_asset_register_into_fixed_assets.sql`, which deliberately
`DROP`ped `asset_register` and `depreciation_ledger` to consolidate them into `fixed_assets`.

So the arc is: **built → recognised as duplicate and merged away → re-created twice by two later
sessions → still absent from the live database.** Whichever mechanism produced that end state
(a failed apply later force-marked with `migration repair`, most likely), the ledger is asserting
something untrue, which makes it unsafe as a source of truth for future migrations.

Root cause is **INSUFFICIENT EVIDENCE** — the repository cannot show how the version rows were
written. Note also that `fixed_assets` and `facility_assets` both exist live, so the asset domain
still carries an unresolved duplication.

---

## C-13 · Four views bypass RLS, apply no tenant filter, and are granted to `anon`
**Severity: CRITICAL · Confidence: HIGH · Cross-tenant PHI + financial disclosure**

A PostgreSQL view runs with the privileges of its **owner** unless created with
`security_invoker = true`. All 8 views in `public` are owned by `postgres`. **Six** omit
`security_invoker`, so they read their base tables with RLS bypassed. **Four** of those six also
apply no tenant predicate of their own, and carry `SELECT` grants to `anon` and `authenticated`:

| View | Grants | App refs | Exposes (all hospitals) |
|---|---|---|---|
| `ipd_advance_balances` | `anon`, `authenticated` | **11** | `patient_id`, `admission_id`, `hospital_id`, advance/deposit balances |
| `unbilled_service_summary` | `anon`, `authenticated` | 0 | unbilled revenue by hospital and date |
| `bed_reprice_previews` | `anon`, `authenticated` | 0 | hospital names, current vs proposed pricing |
| `addon_entitlement_drift` | `anon`, `authenticated` | 2 | platform plan/add-on commercial data |

`ipd_advance_balances` is the material one. Its body is a bare aggregate over `ipd_advances`
grouped by `admission_id, hospital_id, patient_id` with **no `WHERE` clause** relating rows to the
caller:

```sql
SELECT admission_id, hospital_id, patient_id,
       sum(CASE WHEN transaction_type = ANY (ARRAY['deposit','adjustment']) THEN amount
                WHEN transaction_type = ANY (ARRAY['service_debit','refund']) THEN -amount
                ELSE 0 END) AS balance, …
FROM ipd_advances GROUP BY …
```

`ipd_advances` itself has correct tenant RLS. The view walks straight past it. Any holder of the
publishable anon key — which ships in the browser bundle by design — can enumerate patient
identifiers, admission identifiers and outstanding balances for **every hospital on the
platform**. It is referenced in 11 places, so it is live code, not a leftover.

This single object defeats the tenant isolation that the other 494 `hospital_id` policies
establish. It is the most consequential finding in this audit.

Two of the eight views (`inventory_value_by_hospital`, `quality_indicators_current`) **do** set
`security_invoker`, so the mechanism was understood — it was applied inconsistently.

**Evidence:** live `pg_class.reloptions`, `pg_get_viewdef()`,
`information_schema.role_table_grants`.
**Fix:** `ALTER VIEW … SET (security_invoker = true)` on all six, then `REVOKE SELECT … FROM anon`
on the four. The first change alone closes the hole; the second is defence in depth.

---

## False positives (corrected)

Recorded because the automated classifier flagged them and a name-based reading would sustain the
error.

- **`phi_encryption_keys`** — flagged HIGH ("policies never reference hospital"). It is in fact
  the strongest lock in the schema: `USING (false) WITH CHECK (false)` for `{anon,authenticated}`,
  i.e. total denial to API roles, reachable only by `service_role`. **Correct as built.**
- **`portal_chat_messages`** — the policy body looks tautological
  (`patient_id IN (SELECT id FROM patients WHERE id = portal_chat_messages.patient_id LIMIT 1)`).
  It is not: the subquery reads `patients`, which carries its own `hospital_id = get_user_hospital_id()`
  RLS, so the check collapses to "this patient is in my hospital". It is **effectively tenant-safe
  but fragile and opaque** — it works by side effect of another table's policy, and it does not
  validate the row's own `hospital_id` on insert. Downgraded to MEDIUM.
- **12 `UPDATE` policies with no `WITH CHECK`** (`appointments`, `patient_consents`, `ndps_register`,
  `phi_access_audit`, …) — **not** a tenant-reassignment hole. PostgreSQL reuses the `USING`
  expression as the check when `WITH CHECK` is omitted, so `USING (hospital_id =
  get_user_hospital_id())` already blocks moving a row to another tenant. **No action.**
- **The 4 tables with RLS enabled and zero policies** (`abdm_rate_limits`, `razorpay_webhook_log`,
  `signup_otp_verifications`, `webhook_dlq`) — deny-all to API roles by construction;
  `service_role` and `postgres` are `BYPASSRLS` (verified in `pg_roles`). **Deliberate and correct.**
- **11 of the 23 tables the classifier marked CRITICAL for `USING (true)`** are global reference
  or platform catalogues where cross-tenant read is the requirement: `drug_interactions`,
  `drug_allergy_cross_reactivity`, `nabh_chapter_names`, `quality_indicator_definitions`,
  `plan_features`, `subscription_plans`, `addon_skus`, `platform_incidents`,
  `platform_incident_updates`, `platform_feature_flags`, `ai_feature_classes`. **Correct as built.**
  The genuine open-read findings are `queue_state` (C-02), `discount_codes`, `admission_sequences`,
  `opd_token_sequences`, `ai_language_settings`, `tv_display_settings`, and
  `platform_ai_provider_config` — see [`18_SECURITY_DATABASE_AUDIT.md`](18_SECURITY_DATABASE_AUDIT.md).
