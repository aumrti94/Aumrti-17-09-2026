# 13 — AI-GENERATED CODE DRIFT FINDINGS

Drift here means: two or more parts of the system encode the same concept differently, in ways
explicable by independent generation sessions that could not see each other's decisions.

Not every inconsistency is drift, and drift is not automatically a defect. Each finding states
whether it causes harm.

---

## D-1 · One concept, two table names — 14 confirmed pairs
**Impact: CRITICAL (these are live runtime failures) · Confidence: HIGH**

The strongest single piece of evidence in this audit. The application queries a name; the database
holds the same concept under a different name; nothing reconciles them.

| Application says | Database says |
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

Every pair is a plausible synonym — `bill_items`/`bill_line_items`, `ipd_admissions`/`admissions`.
That is exactly what makes it drift rather than error: each name is *reasonable*, and each was
chosen by a session that had no way to know the other existed.

Why it survived review: `types.ts` is stale and missing 91 live tables, so TypeScript could not
contradict the wrong names; and the call sites use `(supabase as any).from(...)`, which suppresses
the type check even where types exist. Consequences in
[`21_CRITICAL_FINDINGS.md § C-03, C-04, C-05`](21_CRITICAL_FINDINGS.md).

## D-2 · One concept, two tables — 5 confirmed duplicate pairs
**Impact: MEDIUM · Confidence: HIGH**

| Pair | Status | Verdict |
|---|---|---|
| `med_admin_records` / `mar_records` | both 0 rows, both 0 app refs | **TRUE DUPLICATE** — MAR modelled twice, neither used |
| `fixed_assets` / `facility_assets` | both live, 0 rows | **PARTIAL OVERLAP** — residue of the `asset_register` merge |
| `ai_provider_config` / `platform_ai_provider_config` | both live | **PARTIAL OVERLAP** — hospital vs platform scope, but unclear boundary |
| `discount_approvals` / `bill_discount_approvals` | both live | **PARTIAL OVERLAP** |
| `demand_forecasts` / `bed_demand_forecasts` | both live, 0 rows | **PARTIAL OVERLAP** |

`med_admin_records` / `mar_records` is unambiguous: MAR is the Medication Administration Record,
one clinical artefact, two tables, both empty and unreferenced. Two sessions built the same thing
and neither implementation was wired up.

## D-3 · The `asset_register` arc — built, merged away, resurrected twice
**Impact: MEDIUM · Confidence: HIGH**

June 2026: `merge_asset_register_into_fixed_assets.sql` deliberately drops `asset_register` and
`depreciation_ledger`, consolidating into `fixed_assets`. September 2026: two migrations two days
apart each re-create both tables, in near-identical form.

A prior session's *architectural decision to remove duplication* was itself undone by duplication.
Neither September session could see the June rationale. Full reconstruction in
[`11_MIGRATION_DRIFT_AUDIT.md`](11_MIGRATION_DRIFT_AUDIT.md).

## D-4 · Duplicate values inside the `app_role` enum
**Impact: MEDIUM · Confidence: HIGH**

`app_role` contains both `lab_tech` **and** `lab_technician`, and both `billing_executive` **and**
`billing_staff`. Enum values can only be appended in PostgreSQL, so this is a permanent fossil of
two naming conventions.

`has_role(uid, 'lab_tech')` and `has_role(uid, 'lab_technician')` give different answers for the
same person. Any authorisation check picks one and silently excludes users holding the other.
Detail in [`07_IDENTITY_ARCHITECTURE_AUDIT.md § I-4`](07_IDENTITY_ARCHITECTURE_AUDIT.md).

## D-5 · Two identity conventions — 46 tables vs 286
**Impact: HIGH · Confidence: HIGH**

53 FKs point at `auth.users`; 338 point at `public.users`. Which convention a table uses is not
predictable from its domain. Detail in
[`07_IDENTITY_ARCHITECTURE_AUDIT.md § I-1`](07_IDENTITY_ARCHITECTURE_AUDIT.md).

## D-6 · Two triggers implementing one day-lock rule
**Impact: LOW · Confidence: HIGH**

`bill_payments` carries both `trg_prevent_payment_on_locked_bill_day` and
`trg_prevent_payment_on_locked_day`, backed by two separate functions enforcing the same rule.
Both fire on every payment insert. Harmless, but doubles the work and makes it ambiguous which is
authoritative.

## D-7 · Policy names assert guarantees their bodies do not implement
**Impact: CRITICAL · Confidence: HIGH**

A recurring and distinctive pattern — the identifier carries the requirement, the SQL does not:

| Policy | Name promises | Body actually does |
|---|---|---|
| `hospital_chains_platform_only` | platform-admin only | `USING (true) WITH CHECK (true)` |
| `chain_memberships_platform_only` | platform-admin only | `USING (true) WITH CHECK (true)` |
| `users."Admins can manage users"` | admin only | tenant check only — **no role check** |
| `queue_state."Anyone can read queue_state"` | (honest) | `USING (true)` — including `anon` |

The third is the most instructive: any user in a hospital can modify any colleague's `role`,
`can_login` or `mfa_required`, because "Admins" appears only in the name.

This shape is characteristic of generated code, where a descriptive identifier is produced
alongside an implementation that does not enforce it — and it is invisible to review that reads
policy names rather than policy bodies.

## D-8 · Free-text status columns against a mostly-unused enum system
**Impact: MEDIUM · Confidence: HIGH**

`status` is `text` on **162 of 163** tables that have the column; exactly one uses a
`USER-DEFINED` (enum) type. Seven enum types exist (`app_role`, `bed_status`, `department_type`,
`gender_type`, `hospital_type`, `subscription_tier`, `ward_type`) and are barely used.

374 CHECK constraints partially compensate, but coverage is uneven — `bills` constrains
`bill_status`, `bill_type` and `payment_status`, while `journal_line_items` has none at all. The
result is that valid status vocabularies are defined in three different places (enum types, CHECK
constraints, and TypeScript literals) with no single authority.

`tpa_queries` shows the cost: `20260529_insurance_upgrade.sql` drops both
`tpa_queries_status_check` **and** `tpa_queries_status_chk` — defensively guessing the constraint
name because the session did not know which convention an earlier session had used.

## D-9 · `types.ts` is stale and hides the rest
**Impact: HIGH · Confidence: HIGH**

The generated `types.ts` describes 457 tables. The live database has 548. **91 live tables have no
generated types**, so every query against them is unchecked. Combined with the widespread
`(supabase as any)` casts, TypeScript provides no protection at precisely the places D-1's wrong
names live.

This is the enabling condition for most of the contract violations rather than a defect in itself.
Regenerating types is the cheapest high-value fix available.

## D-10 · Inconsistent audit-column coverage
**Impact: LOW · Confidence: HIGH**

| Column | Tables |
|---|---|
| `created_at` | 451 of 548 |
| `updated_at` | **96** of 548 |
| `deleted_at` | **1** of 548 |
| `created_by` | partial |

Every timestamp that exists is `timestamptz` — **100% consistent typing, zero exceptions**, which
is genuinely well done and rules out an entire class of timezone defect.

The gaps are coverage, not type. `updated_at` on 96 of 548 tables means most tables cannot answer
"when did this last change". `deleted_at` on exactly one table means there is effectively **no
soft-delete strategy** — deletions are physical, which interacts badly with the CASCADE findings
in [`21_CRITICAL_FINDINGS.md § C-10`](21_CRITICAL_FINDINGS.md).

## D-11 · `hospital_id` nullability is inconsistent
**Impact: MEDIUM · Confidence: HIGH**

Of the 494 tables carrying `hospital_id`: **455 `NOT NULL`, 39 nullable.** (501 columns total
across the schema; the other 7 are on views.)

A nullable tenant column is a silent isolation hole. `hospital_id = get_user_hospital_id()`
evaluates to `NULL` — not `true` — for a row with a NULL tenant, so RLS denies it. The row becomes
invisible to every user rather than visible to the wrong one. That fails safe, which is why this is
MEDIUM rather than HIGH, but it means orphaned rows accumulate unreachably.

13 further tables carry `hospital_id` that **no policy references** — the column is dead weight
suggesting tenancy that is not enforced.

---

## Summary

| # | Finding | Impact |
|---|---|---|
| D-1 | 14 table-name synonym pairs → runtime failures | CRITICAL |
| D-7 | Policy names promise what bodies don't enforce | CRITICAL |
| D-5 | Dual identity convention (46 vs 286 tables) | HIGH |
| D-9 | `types.ts` missing 91 live tables | HIGH |
| D-2 | 5 duplicate/overlapping table pairs | MEDIUM |
| D-3 | `asset_register` merged then resurrected twice | MEDIUM |
| D-4 | Duplicate `app_role` enum values | MEDIUM |
| D-8 | Free-text status against unused enums | MEDIUM |
| D-11 | 39 nullable `hospital_id`; 13 unused | MEDIUM |
| D-6 | Duplicate day-lock triggers | LOW |
| D-10 | Uneven `updated_at` / no soft-delete | LOW |

**The characteristic signature** of this codebase is not bad modelling — the domain model is
reasonable throughout. It is **local coherence without global coherence**: each piece is sensible
on its own terms, and adjacent pieces disagree about names, conventions, and which layer enforces
what. That is precisely the profile expected when many capable but isolated generation sessions
each solve their part correctly without a shared authority over naming and enforcement.
