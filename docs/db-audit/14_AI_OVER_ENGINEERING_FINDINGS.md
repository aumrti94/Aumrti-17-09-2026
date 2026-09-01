# 14 — AI OVER-ENGINEERING FINDINGS

Where the implementation is more complex than the problem requires. Each finding asks: *what was
this trying to solve, is the complexity justified, and what is the simplest safe design?*

**A standing caution.** 548 tables is not itself over-engineering. A hospital information system
covering OPD, IPD, ICU, OT, emergency, nursing, pharmacy, laboratory, radiology, blood bank,
inventory, procurement, billing, insurance, TPA, PM-JAY, HR, payroll, quality/NABH, infection
control, biomedical waste, dietetics, dental, IVF, vaccination, ABDM, HL7 and telemedicine will
legitimately need several hundred tables. No recommendation below reduces table count for its own
sake.

---

## O-1 · 432 of 548 tables contain no rows
**Confidence: HIGH on the count · LOW on the interpretation**

Only **116 tables (21%)** hold any data.

This looks alarming and mostly is not. The database serves 6 hospitals, 1,078 patients and 137
bills — an early-stage deployment. A table being empty means the feature has not been used yet,
not that it is unnecessary. Blood bank, IVF, dialysis, chemotherapy and ICU tables being empty is
exactly what a system that has not yet onboarded those departments looks like.

The defensible subset is **27 tables that are both empty and referenced nowhere in the
application** — no `.from()`, no edge function, no test:

`abdm_rate_limits`, `blood_antibody_screening`, `chain_memberships`, `coding_audits`,
`cold_storage_log`, `demand_forecasts`, `depreciation_postings`, `dialyzer_reuse`,
`embryology_records`, `hospital_chains`, `item_consumption_daily`, `mar_records`,
`med_admin_records`, `medication_adherence`, `package_station_logs`, `partograph_records`,
`patient_encounter_templates`, `patient_template_responses`, `pmjay_preauth_requests`,
`razorpay_plan_registry`, `tds_annual_summary`, `transfusion_reactions`, and 5 others.

Even here, **do not delete on this evidence alone.** An empty unreferenced table is consistent
with (a) abandoned generation, (b) a feature built ahead of its UI, or (c) a table written only by
an edge function or SQL trigger my scan did not attribute. Distinguishing these needs product
knowledge this audit does not have.

**Recommendation:** mark as `DEPRECATE — pending owner confirmation`, not `DELETE`. Exception:
`hospital_chains` and `chain_memberships` should be fixed or dropped promptly regardless, because
they are also a live security hole ([C-01](21_CRITICAL_FINDINGS.md)).

## O-2 · `admissions` has 81 columns
**Confidence: HIGH · Justified: NO**

| Table | Columns | `ADD COLUMN` events | Migrations |
|---|---|---|---|
| `admissions` | **81** | 61 | 26 |
| `hospitals` | 63 | 50 | 28 |
| `insurance_claims` | 62 | 48 | 11 |
| `insurance_pre_auth` | 56 | 41 | 10 |

`admissions` gained 61 of its 81 columns through later `ALTER TABLE` statements across 26
migrations. With **zero** `DROP COLUMN` statements in the entire 568-migration history, every
column ever added is still there — including those superseded by later ones.

**What it was solving:** each session needed one more fact about an admission and added a column,
which is locally the correct minimal change.

**Is it justified?** No. An 81-column table forces every `SELECT *` to read the full row, makes
the natural insert statement unwritable by hand, and obscures which columns are current.

**Simplest safe design:** extract the cohesive clusters that are already visible — discharge
details, insurance/TPA fields, bed/transfer history — into satellite tables keyed by
`admission_id`. This is a **medium-risk refactor with 4 live rows**, so the window to do it cheaply
is now. It is not urgent and it is not a safety issue.

## O-3 · 160 JSONB columns across 115 tables
**Confidence: HIGH · Justified: PARTIALLY**

| Table | JSONB columns |
|---|---|
| `ed_visits`, `hospitals`, `insurance_claims` | 5 each |
| `anaesthesia_records`, `audit_log`, `insurance_pre_auth`, `partograph_records` | 4 each |

Legitimate uses are clearly present: `audit_log` storing before/after row snapshots, ABDM/HL7
payload capture, AI response envelopes, and `vitals_snapshot` on alerts. Schemaless external
payloads belong in JSONB.

The questionable uses are where JSONB substitutes for modelling that the same schema does
elsewhere — `bed_reprice_previews` reads pricing out of `metadata->>'previous_amount_inr'` and
casts to numeric, meaning a business-critical monetary value has no type, no constraint and no
index. Five JSONB columns on `insurance_claims`, a table that already has 62 typed columns, is a
sign that later additions took the path of least resistance.

**Recommendation:** leave payload/snapshot JSONB alone. Promote to typed columns only where a
value is (a) monetary or clinical, (b) filtered or aggregated in queries, or (c) subject to a
business rule. Low priority; no correctness defect established.

## O-4 · Duplicate index pairs — 42
**Confidence: HIGH · Justified: NO**

Same table, identical column set, two indexes. Typically a `UNIQUE` constraint's implicit index
plus a hand-written one covering the same columns:

```
bills                       bills_hospital_bill_number_key  +  idx_bills_hospital_number
hospital_subscriptions      …_hospital_id_key               +  idx_hospital_subscriptions_hospital_id
daily_census_snapshots      …_hospital_id_snapshot_date_key +  idx_daily_census_hospital_date
insurance_claims            idx_insurance_claims_hospital_status + idx_ic_hospital_status
```

The last is the clearest drift signal — the same composite index written twice under two naming
conventions (`idx_insurance_claims_…` and `idx_ic_…`), by two sessions.

Pure cost: every write maintains both, and both consume cache. No benefit.

**Recommendation:** drop the redundant member of each pair — always the hand-written one, never
the constraint-backed one. Full list in
[`10_INDEX_PERFORMANCE_AUDIT.csv`](10_INDEX_PERFORMANCE_AUDIT.csv) (`DUPLICATE column set` flag).
Low risk, immediate benefit.

## O-5 · 78 multiple-permissive-policy combinations
**Confidence: HIGH · Justified: PARTIALLY**

61 tables have more than one permissive policy for the same `(command, role)`. Permissive policies
are OR-ed, so each additional one both widens access and costs a per-row evaluation.

Layering a tenant policy with an `is_aumrti_admin()` override is a reasonable pattern and accounts
for most instances. The problem is that a single restrictive policy would express the same intent
more cheaply and more legibly, and that stacking hides contradictions — `patient_portal_sessions`
carries two anon UPDATE policies encoding *incompatible* assumptions
([C-07](21_CRITICAL_FINDINGS.md)).

**Recommendation:** consolidate where the intent is a single rule with an admin exception:
`USING (hospital_id = (SELECT get_user_hospital_id()) OR (SELECT is_aumrti_admin()))`. This also
resolves [S-9](18_SECURITY_DATABASE_AUDIT.md) by making the calls InitPlan-hoistable.

## O-6 · Overlapping configuration systems
**Confidence: MEDIUM · Justified: UNCERTAIN**

Six tables configure a hospital: `hospital_settings` (9 rows), `hospital_config_values` (39 rows),
`hospital_feature_overrides`, `hospital_module_entitlements`, `hospital_addons`,
`hospital_pricing_overrides`.

`hospital_settings` (typed columns) and `hospital_config_values` (key/value) are two different
answers to "store a hospital setting", and **both hold data**, so both are in use.

I examined these as a suspected duplicate cluster and did **not** confirm it. Entitlements,
add-ons and pricing overrides are genuinely distinct commercial concepts with different lifecycles
and different authorities. The typed-vs-key-value split between the first two is real drift, but
proving which settings belong where requires product knowledge — **INSUFFICIENT EVIDENCE** for a
merge recommendation.

**Recommendation:** document the intended boundary before adding any new setting. No structural
change proposed.

## O-7 · 1,063 indexes with zero recorded scans
**Confidence: LOW — reported for completeness only**

`pg_stat_all_indexes.idx_scan = 0` for 1,063 of 1,555 indexes.

**This number should not be acted on.** Statistics accumulate since the last reset, the deployment
is early-stage with 432 empty tables, and an index on an empty table cannot record a scan. Zero
scans here means "no traffic yet", not "useless index".

Contrast with [C-08](21_CRITICAL_FINDINGS.md), where 905 *missing* FK indexes is actionable
regardless of traffic, because it is structural.

**Recommendation:** re-measure after 90 days of production traffic. Do not drop indexes on this
evidence.

---

## Summary

| # | Finding | Justified? | Action |
|---|---|---|---|
| O-4 | 42 duplicate index pairs | No | Drop redundant — safe, do now |
| O-5 | 78 permissive-policy stacks | Partly | Consolidate with admin-OR pattern |
| O-2 | `admissions` at 81 columns | No | Extract satellites while tables are small |
| O-3 | 160 JSONB columns | Partly | Promote monetary/clinical values only |
| O-1 | 27 empty + unreferenced tables | Unknown | Confirm with owner, then deprecate |
| O-6 | Six configuration tables | Uncertain | Document boundary; no merge |
| O-7 | 1,063 unscanned indexes | N/A | **Do not act** — insufficient traffic |

**Overall:** genuine over-engineering is modest — roughly 5–8% of the schema. The dominant pattern
is not excess structure but **additive accretion**: 851 `ADD COLUMN` against zero `DROP COLUMN`,
producing wide tables and duplicate indexes rather than wrong ones. That is a tidiness debt with a
real but bounded cost, and none of it threatens correctness.
