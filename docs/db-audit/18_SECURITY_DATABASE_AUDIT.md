# 18 — SECURITY DATABASE AUDIT

Live capture 2026-08-18T16:42:54Z · PostgreSQL 17.6 · 548 tables · 970 policies · 458 public functions.

## Supabase Security Advisor classes — full result

| Advisor class | Result |
|---|---|
| RLS disabled on exposed table | **0 of 548** — clean |
| RLS enabled, no policy | 4 — **deliberate deny-all**, correct |
| Missing primary key | **0 of 548** — clean |
| `SECURITY DEFINER` function with mutable `search_path` | **4 of 141** |
| `SECURITY DEFINER` / owner-run **view** | **6 of 8** — 4 exploitable → **S-1** |
| Multiple permissive policies | 78 combinations across 61 tables |
| RLS `initplan` (per-row `auth.*()` re-evaluation) | 134 policies |
| Unindexed foreign keys | 905 of 1,474 |
| Duplicate indexes | 42 pairs |
| Unused indexes (0 scans) | 1,063 — *low signal, stats recently reset* |
| `auth.users` exposed to API | not directly granted — clean |
| Sensitive columns exposed | **S-1, S-2** |

Four whole classes come back clean, which is unusual and worth stating: **every** table has RLS,
**every** table has a primary key, `auth.users` is not exposed, and 137 of 141 `SECURITY DEFINER`
functions correctly pin `search_path`.

---

## S-1 · Four RLS-bypassing views are granted to `anon` — cross-tenant PHI and financial exposure
**Severity: CRITICAL · Confidence: HIGH**

A PostgreSQL view executes with the privileges of its **owner** unless created with
`security_invoker = true`. All 8 views here are owned by `postgres`. Six lack `security_invoker`,
so they read their base tables with RLS bypassed. Four of those six **also apply no tenant filter
of their own** and are granted to `anon` and `authenticated`:

| View | `security_invoker` | Self-filters | Granted to | App refs | Exposes |
|---|---|---|---|---|---|
| `ipd_advance_balances` | **NO** | **NO** | `anon`, `authenticated` | 11 | `patient_id`, `admission_id`, `hospital_id`, advance balances — **all hospitals** |
| `unbilled_service_summary` | **NO** | **NO** | `anon`, `authenticated` | 0 | unbilled revenue per hospital — **all hospitals** |
| `bed_reprice_previews` | **NO** | **NO** | `anon`, `authenticated` | 0 | hospital names + current/proposed pricing — **all hospitals** |
| `addon_entitlement_drift` | **NO** | **NO** | `anon`, `authenticated` | 2 | platform add-on/plan commercial data |
| `platform_payment_config_status` | NO | yes | `authenticated` | 1 | gateway key *presence* booleans (not secrets) |
| `hospital_ai_budget_status` | NO | yes | `authenticated` | 4 | AI spend — self-filtered, OK |
| `inventory_value_by_hospital` | **YES** | — | `anon`, `authenticated` | 1 | correctly invoker-scoped |
| `quality_indicators_current` | **YES** | — | `anon`, `authenticated` | 8 | correctly invoker-scoped |

`ipd_advance_balances` is the serious one. Its body is a bare aggregate over `ipd_advances` with
`GROUP BY admission_id, hospital_id, patient_id` and **no `WHERE`** tying rows to the caller. It is
actively used in 11 places, so it is not dead code. Any holder of the publishable anon key can
enumerate patient identifiers, admission identifiers and outstanding financial balances for every
hospital on the platform.

This defeats the tenant isolation that the 494 `hospital_id` policies otherwise establish —
`ipd_advances` itself has correct RLS, and the view walks straight past it.

That two of the eight views *do* set `security_invoker` shows the mechanism was known.

**Fix:** `ALTER VIEW … SET (security_invoker = true)` on all six, and `REVOKE … FROM anon` on the
four. `security_invoker` alone is sufficient — base-table RLS then applies — but revoking `anon`
is defence in depth.

## S-2 · `queue_state` publishes patient names to `anon` — see C-02
**Severity: CRITICAL**

`"Anyone can read queue_state" [SELECT] roles={public} USING (true)` over a table containing
`current_patient_name`. Detail in [`21_CRITICAL_FINDINGS.md § C-02`](21_CRITICAL_FINDINGS.md).

## S-3 · `hospital_chains` / `chain_memberships` fully open — see C-01
**Severity: CRITICAL**

`[ALL] roles={authenticated} USING (true) WITH CHECK (true)`, with full DML grants to
`authenticated`. Detail in [`21_CRITICAL_FINDINGS.md § C-01`](21_CRITICAL_FINDINGS.md).

## S-4 · Anon can update patient portal sessions — see C-07
**Severity: HIGH**

Two overlapping anon `UPDATE` policies with `WITH CHECK (true)`, one of which lets any anon caller
modify any session active in the past 24 hours, including flipping `otp_verified`.

## S-5 · Cross-tenant reads on seven tenant-scoped tables
**Severity: HIGH · Confidence: HIGH**

`USING (true)` `SELECT` policies on tables that carry `hospital_id`:

| Table | Leaks |
|---|---|
| `discount_codes` | every code, value, `max_uses`, validity — usable by any tenant |
| `admission_sequences` | each hospital's admission counter → patient-volume intelligence |
| `opd_token_sequences` | each hospital's per-doctor token counter → consultation volumes |
| `ai_language_settings` | per-hospital AI configuration (`public` role — anon-reachable) |
| `tv_display_settings` | per-hospital display config (`public` role — anon-reachable) |
| `platform_ai_provider_config` | provider, model, `api_key_ref` — writes correctly gated by `is_aumrti_admin()`, reads not |
| `queue_state` | see S-2 |

`admission_sequences` and `opd_token_sequences` are competitively sensitive: on a shared platform,
one hospital can watch another's patient throughput accumulate in real time.

None of these has a write hole — writes are either absent or correctly gated. Read-only leakage.

**Excluded after triage:** 11 further `USING (true)` tables are global reference or platform
catalogues (`drug_interactions`, `nabh_chapter_names`, `plan_features`, `subscription_plans`,
`platform_incidents`, …) where cross-tenant read is the intended behaviour. Listed in
[`21_CRITICAL_FINDINGS.md § False positives`](21_CRITICAL_FINDINGS.md#false-positives-corrected).

## S-6 · Unconstrained anon/authenticated inserts
**Severity: MEDIUM**

`WITH CHECK (true)` on `INSERT` for `enterprise_leads` (lead-form pollution — plausibly
intentional for a public marketing form, but unbounded and unrated) and
`entitlement_fail_open_events` (an audit table any authenticated user can write arbitrary rows
into, which undermines its evidentiary value).

## S-7 · Four `SECURITY DEFINER` functions with mutable `search_path`
**Severity: MEDIUM · Confidence: HIGH**

```
cleanup_expired_trusted_devices()
get_active_phi_key_version(p_hospital_id uuid)
next_seq(p_hospital_id uuid, p_type text)
purge_old_phi_audit()
```

Without `SET search_path`, a caller who can create objects in an earlier schema on the resolution
path can shadow a referenced table or function and have it execute with the definer's elevated
privileges. `authenticated` cannot create schemas by default in Supabase, which sharply limits
exploitability — hence MEDIUM, not HIGH.

Two of the four touch PHI key material and PHI audit retention, which is why they are worth fixing
even at low exploitability. The remaining 137 `SECURITY DEFINER` functions pin `search_path`
correctly, so the fix is to match an established pattern.

## S-8 · 78 multiple-permissive-policy combinations across 61 tables
**Severity: MEDIUM (performance) / situational (correctness)**

Permissive policies are OR-ed, so every additional policy on the same `(table, command, role)`
both widens access and adds per-row evaluation cost.

Mostly this is benign layering (a tenant policy plus an `is_aumrti_admin()` override). It becomes
a correctness problem when two policies encode *contradictory* assumptions — `patient_portal_sessions`
(S-4) is the clear case, where one policy restricts writes to unverified sessions and its sibling
ignores verification entirely. The permissive OR means the weaker policy always wins.

Full enumeration in [`06_RLS_FORENSIC_AUDIT.csv`](06_RLS_FORENSIC_AUDIT.csv) (`flags` column).

## S-9 · 134 policies re-evaluate `auth.*()` per row
**Severity: LOW (performance only)**

Policies written as `hospital_id = get_user_hospital_id()` rather than
`hospital_id = (SELECT get_user_hospital_id())` re-execute the function for every candidate row.
Wrapping in a scalar subquery lets the planner hoist it to an InitPlan and evaluate once.

No security impact. Compounds C-08 — an unindexed `hospital_id` plus a per-row function call on a
sequential scan is the worst combination available.

## S-10 · The CI guard that prevents RLS regressions has a 28% blind spot
**Severity: MEDIUM · Confidence: HIGH**

[`scripts/check-rls-coverage.mjs`](../../scripts/check-rls-coverage.mjs) is the control that stops
a new table shipping without RLS — a genuinely good piece of engineering that already prevented
recurrence of a defect class this codebase hit three times.

Running it now reports:

> `RLS coverage check passed — 396 tables created, all have ENABLE ROW LEVEL SECURITY`

But the live database has **548** tables. The guard sees 396 because its detection regex requires a
schema qualifier:

```js
const CREATE_TABLE_RE = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?public\.["']?(\w+)["']?/gi;
```

Of 589 `CREATE TABLE` statements in the migration history, only 413 are written `public.`-qualified.
The rest rely on `search_path` and write `CREATE TABLE IF NOT EXISTS asset_register (…)`. **~152
live tables are invisible to the guard** — a new unqualified table can ship with no RLS and the
check will still pass.

The guard's own `ENABLE_RLS_RE` already handles the optional `public.` prefix, and its comment
explicitly notes that some migrations omit it. The same allowance was not made in the
`CREATE TABLE` pattern.

This is not currently exploited — RLS coverage is 100% by independent live verification, which is
the reassuring part. But the control is weaker than its passing output implies.

**Fix:** make the `public.` prefix optional in `CREATE_TABLE_RE`, exactly as `ENABLE_RLS_RE`
already does, and assert the discovered table count against the live catalog so the guard fails if
it starts seeing fewer tables than exist.

---

## What is well built

Recording these explicitly, because a findings list read alone would misrepresent the system.

- **RLS coverage is 100%.** 548 of 548 tables. No exceptions, no allowlist.
- **PHI is genuinely protected.** `phi_encryption_keys` denies both `anon` and `authenticated`
  outright (`USING (false) WITH CHECK (false)`). `phi_access_audit` is insert-only and
  admin-read-only. `phi_backfill_log` likewise. Key versioning and rotation columns exist.
- **Narcotics records are immutable at the row level** — `USING (false)` on UPDATE and DELETE plus
  a dedicated mutation-prevention trigger, and a CHECK enforcing two distinct pharmacists.
- **The tenant helper design is correct** — `STABLE SECURITY DEFINER` with pinned `search_path`,
  avoiding the RLS-recursion trap that this pattern usually falls into.
- **Deny-all-by-default is used deliberately** on `abdm_rate_limits`, `razorpay_webhook_log`,
  `signup_otp_verifications`, `webhook_dlq` — RLS on, zero policies, reachable only by
  `service_role`. That is the right way to make a table service-only.
- **Every table has a primary key.** In a 548-table generated schema, that is not a given.

## Severity summary

| Severity | Findings |
|---|---|
| CRITICAL | S-1 (RLS-bypassing views), S-2 (`queue_state` PHI), S-3 (`hospital_chains`) |
| HIGH | S-4 (portal sessions), S-5 (7 cross-tenant reads) |
| MEDIUM | S-6 (open inserts), S-7 (mutable `search_path`), S-8 (permissive stacking), S-10 (CI guard blind spot) |
| LOW | S-9 (initplan) |

**Exposed surface: 12 tables + 4 views out of 548 tables + 8 views — roughly 2%.** Every one is
remediated by rewriting a policy body, setting `security_invoker`, or revoking a grant. None
requires a schema change.
