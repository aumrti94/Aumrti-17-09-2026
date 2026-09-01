# 19 — AUMRTI CANONICAL DATABASE ARCHITECTURE

This is the **target** architecture. It is deliberately close to what already exists: the audit
found the existing model sound, so this document mostly *names and makes explicit* rules the
schema already follows implicitly, and corrects the places where it doesn't.

Nothing here proposes re-modelling the domain. The value is in having a written authority that the
next migration — human or generated — can be checked against, since the absence of exactly that is
what produced the drift in [`13_AI_CODE_DRIFT_FINDINGS.md`](13_AI_CODE_DRIFT_FINDINGS.md).

---

## The fifteen layers

| # | Layer | Tenancy | Representative tables |
|---|---|---|---|
| 1 | **Platform** | Global, platform-admin only | `subscription_plans`, `plan_features`, `addon_skus`, `platform_feature_flags`, `platform_incidents`, `mrr_snapshots` |
| 2 | **Identity** | Mixed | `users`, `aumrti_admins`, `role_permissions`, `auth.users` (external) |
| 3 | **Tenant** | Owns the boundary | `hospitals`, `branches`, `departments`, `hospital_settings`, `hospital_subscriptions`, `hospital_chains` |
| 4 | **Patient** | `hospital_id` | `patients`, `patient_consents`, `patient_documents`, portal tables |
| 5 | **Clinical** | `hospital_id` | `admissions`, `opd_encounters`, `prescriptions`, `clinical_alerts`, vitals, nursing, ICU, OT, emergency |
| 6 | **Diagnostics** | `hospital_id` | `lab_orders`, `lab_results`, `lab_samples`, `radiology_orders`, `radiology_reports`, `dicom_files` |
| 7 | **Pharmacy** | `hospital_id` | `pharmacy_dispensing`, `drug_batches`, `ndps_register`, `prescriptions` |
| 8 | **Operations** | `hospital_id` | inventory, procurement, housekeeping, dietetics, biomedical waste, assets |
| 9 | **Revenue / RCM** | `hospital_id` | `bills`, `bill_line_items`, `bill_payments`, `service_charges`, `journal_entries`, `journal_line_items` |
| 10 | **Insurance** | `hospital_id` | `insurance_claims`, `insurance_pre_auth`, `tpa_*`, `pmjay_claims`, `govt_scheme_claims` |
| 11 | **HR** | `hospital_id` | `staff_profiles`, `staff_attendance`, `payroll_runs`, `payslips` |
| 12 | **Compliance** | `hospital_id` | `nabh_*`, `phi_access_audit`, `audit_log`, `consent`, infection control |
| 13 | **Integration** | `hospital_id` or global | `abdm_*`, `hl7_*`, `webhook_dlq`, `api_configurations` |
| 14 | **Reporting** | `hospital_id` | snapshots, forecasts, metrics, **all views** |
| 15 | **Global reference** | None — shared | `drug_master`, `lab_test_master`, `nabh_criteria`, `icd_*`, `radiology_study_master` |

Domain assignment for all 548 tables is in
[`02_COMPLETE_TABLE_INVENTORY.csv`](02_COMPLETE_TABLE_INVENTORY.csv) (`domain` column).

---

## Rule 1 — Tenancy

**The tenant boundary is `hospitals.id`. There is exactly one.**

1. Every table in layers 4–14 **must** carry `hospital_id uuid NOT NULL REFERENCES hospitals(id)`.
   - Current state: 494 of 548 carry it; **39 are nullable**. Nullable is a defect — a NULL tenant
     makes the row invisible to everyone rather than visible to the wrong party, which fails safe
     but strands data.
2. Do **not** derive tenancy through a parent alone. Denormalising `hospital_id` onto children is
   deliberate and correct here: it lets every policy be a single-column comparison with no join,
   which is what makes RLS affordable at this table count.
3. `hospital_id` is **immutable after insert**. No row moves between tenants. Enforce with a
   trigger, not policy alone.
4. Layers 1 and 15 carry no `hospital_id`. They are global by design, and cross-tenant read of
   them is correct — the `USING (true)` policies on `drug_interactions`, `nabh_chapter_names`,
   `subscription_plans` and similar are **right**, not findings.
5. Every `hospital_id` column **must** have an index leading with it.
   - Current state: **127 do not** ([U-1](15_AI_UNDER_ENGINEERING_FINDINGS.md)).

## Rule 2 — Identity

**`public.users` is the canonical business identity. `auth.users` is only a credential store.**

1. All actor columns (`created_by`, `updated_by`, `approved_by`, `recorded_by`, …) reference
   `public.users(id)`.
   - Current state: 338 FKs comply; **53 point at `auth.users`** and are the drift.
2. `public.users.auth_user_id` is the sole link to `auth.users`. Application and policy code
   resolves identity **only** through `get_user_hospital_id()` / `has_role()`, never by comparing
   `auth.uid()` to a business key.
   - The dead policy `USING (id = auth.uid())` on `users` violates this and matches 0 of 38 rows
     ([I-2](07_IDENTITY_ARCHITECTURE_AUDIT.md)).
3. One hospital per user. Cross-tenant access is exclusively `aumrti_admins` +
   `is_aumrti_admin()`.
4. Role checks use `has_role()`. A policy that says "admin" in its name **must** call it —
   [D-7](13_AI_CODE_DRIFT_FINDINGS.md) documents three that don't.

## Rule 3 — Access control

1. RLS enabled on every table. **Currently 548/548 — hold this line.** `scripts/check-rls-coverage.mjs`
   already guards it in CI.
2. Standard tenant policy, written to be InitPlan-hoistable:
   ```sql
   USING      (hospital_id = (SELECT get_user_hospital_id()) OR (SELECT is_aumrti_admin()))
   WITH CHECK (hospital_id = (SELECT get_user_hospital_id()))
   ```
   The `(SELECT …)` wrapper matters: without it the function is re-evaluated per row
   ([S-9](18_SECURITY_DATABASE_AUDIT.md), 134 policies affected).
3. Prefer **one** policy per `(table, command, role)`. Permissive stacking widens access silently
   and hides contradictions ([O-5](14_AI_OVER_ENGINEERING_FINDINGS.md)).
4. `WITH CHECK (true)` is prohibited on any tenant table.
5. Service-only tables: RLS on, **zero** policies. `service_role` is `BYPASSRLS`. Already used
   correctly on `webhook_dlq`, `razorpay_webhook_log`, `abdm_rate_limits`,
   `signup_otp_verifications`.
6. **Every view must be created with `security_invoker = true`.** A view without it runs as
   `postgres` and bypasses all RLS on its base tables — the cause of the most severe finding in
   this audit ([C-13](21_CRITICAL_FINDINGS.md)). No exceptions.
7. Grant to `anon` only where the data is genuinely public. Default is `authenticated` only.

## Rule 4 — Parent–child

1. Child rows carry their own `hospital_id`, redundantly with the parent (see Rule 1.2).
2. A trigger must prevent a child referencing a parent in a different hospital. **No table
   currently enforces this** — RLS blocks reading such a row but does not prevent creating it.
3. `ON DELETE` policy by layer:
   - Clinical/operational children: `CASCADE` acceptable.
   - **Financial, audit and statutory records: `RESTRICT`.** `ndps_register`, `phi_access_audit`,
     `phi_backfill_log`, `journal_entries`, `journal_line_items`, `bill_payments`,
     `bill_amendments`, `audit_records` must survive tenant deletion and be archived explicitly.
     Currently 18 such FKs are `CASCADE` ([C-10](21_CRITICAL_FINDINGS.md)).
4. Every FK has an index.

## Rule 5 — Reference data

1. Global masters (layer 15) have no `hospital_id`, are readable by all authenticated users, and
   are writable only by `is_aumrti_admin()`.
2. Hospital overrides live in a separate table keyed `(hospital_id, master_id)` — the pattern
   `hospital_pricing_overrides` already uses. Never fork a master per hospital.
3. `drug_master` / `ayush_drug_master` remain separate: different regulatory schemas (allopathic
   vs AYUSH), **valid separation, not duplication**.

## Rule 6 — Naming (the rule whose absence caused the drift)

1. One concept, one name, system-wide. The 14 synonym pairs in
   [D-1](13_AI_CODE_DRIFT_FINDINGS.md) are the cost of not having had this rule.
2. Canonical suffixes: `_items` for child line tables (**not** `_lines`); `_master` for global
   reference; `_log` for append-only; `_settings` for per-hospital configuration.
   - Under this rule `journal_line_items` is canonical and `journal_entry_lines` was never valid.
3. Table names are plural; columns are `snake_case`; FK columns are `<singular_target>_id`.
4. Regenerate `src/integrations/supabase/types.ts` on every schema change. It is currently missing
   **91 live tables**, which is what let the wrong names survive review
   ([D-9](13_AI_CODE_DRIFT_FINDINGS.md)).

## Rule 7 — Data integrity

1. Every table: `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`. **Currently 548/548 — hold.**
2. Timestamps are `timestamptz`, always. **Currently 100% — hold.** `created_at` on every table;
   `updated_at` on every mutable table (currently 96/548).
3. Status columns carry a CHECK constraint enumerating valid values. Currently 162 of 163 are
   unconstrained `text`.
4. Monetary columns: `numeric(15,2)`, `NOT NULL DEFAULT 0`, with `CHECK (>= 0)` where a negative
   is meaningless. Totals are derived **in the database**, never accepted from a client
   ([U-4](15_AI_UNDER_ENGINEERING_FINDINGS.md)).
5. Natural keys get UNIQUE constraints — always tenant-scoped: `UNIQUE (hospital_id, <key>)`. The
   pattern is already right on `patients(hospital_id, uhid)`, `bills(hospital_id, bill_number)`,
   `journal_entries(hospital_id, entry_number)`. It is **missing** on `bill_payments` and
   `bill_line_items` ([U-2](15_AI_UNDER_ENGINEERING_FINDINGS.md)).
6. Clinical measurements carry physiological-range CHECKs.

## Rule 8 — Enforcement placement

A rule belongs in the **database** when violating it corrupts data or breaches confidentiality;
in the **backend** when it needs an external service; in the **frontend** only for convenience.

| Rule class | Correct home |
|---|---|
| Tenant isolation | Database (RLS) — never application |
| Financial arithmetic | Database (trigger/generated column) |
| Uniqueness / idempotency | Database (UNIQUE) |
| Statutory immutability | Database (`USING (false)` + trigger) — `ndps_register` is the model |
| Clinical contraindications | Database reference data + backend check |
| Field-level UX validation | Frontend |

The current system inverts this for interactions, allergies, high-alert double-checks, sepsis
de-duplication and bill totals ([U-9](15_AI_UNDER_ENGINEERING_FINDINGS.md)).

---

## Conformance today

| Rule | Status |
|---|---|
| RLS on every table | ✅ 548/548 |
| Primary key on every table | ✅ 548/548 |
| `timestamptz` everywhere | ✅ 100% |
| `SECURITY DEFINER` pins `search_path` | ⚠️ 137/141 |
| Tenant column present | ⚠️ 494/548 (39 nullable, 13 unused) |
| FK indexed | ❌ 569/1,474 |
| Views use `security_invoker` | ❌ 2/8 |
| Actor FKs → `public.users` | ⚠️ 338/391 |
| One name per concept | ❌ 14 known violations |
| Status columns constrained | ❌ 1/163 typed |
| Financial uniqueness | ❌ missing on 2 core tables |
| Statutory records `RESTRICT` | ❌ 18 `CASCADE` |

Six rules are already fully or nearly met — including the three hardest to retrofit (RLS coverage,
primary keys, timestamp typing). The failures are concentrated in indexing, view configuration and
constraint coverage: all **additive** changes that do not require re-modelling anything.

That is the central conclusion of this audit. The architecture is right; the enforcement is
incomplete.
