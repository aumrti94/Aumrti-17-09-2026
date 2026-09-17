# Do We Need Every Setting Configured Before Testing Modules? — No, and Here's the Alternative

**Status:** Recommendation, grounded in an existing pattern already in the repo.
**Date:** 2026-09-10

**Direct answer: no.** Configuring all ~65 modules' worth of Settings screens before testing any
module is the wrong prerequisite to chase, for a reason already proven earlier today — a setting
can be fully configured, save without error, and **do nothing** (`Settings → Notifications`'
`notification_config` is a confirmed example: fully fillable, nothing reads it back). Pre-loading
every setting doesn't establish a real prerequisite; it just produces a lot of data that looks like
readiness without proving any of it works. The actual prerequisite is smaller than "all settings,"
and the codebase already contains the right pattern to follow.

---

## The pattern already exists — [00-schema-core.sql](../../supabase/tests/booking-engine/00-schema-core.sql)

The one real automated test suite in this repo doesn't seed the full 612-migration schema before
testing. It builds a **minimal stand-in** with only the tables the code under test actually
touches: `hospitals`, `departments`, `users`, `patients`, `service_master`, `opd_tokens`,
`hospital_settings` — seven tables, not the whole database. That's the model to replicate at the
settings/module level too: **seed exactly what the thing under test reads, not everything that
could theoretically exist.**

---

## The actual answer: two tiers, not one flat prerequisite

### Tier 0 — a small, genuinely global baseline (build once, reuse everywhere)

A handful of things are real prerequisites because nearly every module transitively depends on
them through the hub mechanisms found in the connectivity analysis (billing, entitlements, RLS):

- One `hospitals` row, one `hospital_id` to scope everything to
- At least one active user per role a test needs to act as (doctor, nurse, billing_executive, etc.)
- At least one department
- Base `service_master`/rate entries for whatever services the test bills
- GST configuration (since almost every billable action eventually touches `gstRules`)
- Module entitlements/feature flags set so the module under test isn't blocked by the platform
  control-plane layer before it's even reached

This is small, stable, and worth building once as a reusable seed fixture — not clicked through the
UI by hand each time, and not re-derived per test. This is the equivalent of `00-schema-core.sql`
at the application-settings layer.

### Tier 1 — module-specific settings, seeded per test as that module is tested

Everything else — notification routing, escalation rules, a specific specialty's own configuration
screen, TPA-specific settings — should be seeded **when that module's tests are written**, not
upfront. Reasons this is the better order, not just a lighter one:

1. **It matches the risk-tiered rollout already recommended** (patient-safety and multi-tenancy
   first, everything else after) — pre-configuring all 65 modules' settings before testing any of
   them front-loads work for modules that won't be tested for months, for no benefit.
2. **It catches "does this setting do anything" as part of testing the module, not before it.**
   The right test isn't "seed the setting, then test the module" — it's "seed the setting to two
   different values, then assert the module's behavior actually differs." That's the only way the
   dead `notification_config` gets caught before production instead of after. Bulk-seeding
   settings ahead of time doesn't create this check; it just creates data sitting there unverified.
3. **It's repeatable.** A Tier-1 seed written alongside a module's tests travels with that module —
   into the still-missing staging environment, into a second test-tenant, into CI. A one-time
   manual settings pass through the UI doesn't; it has to be redone by hand every time the
   environment is rebuilt, which is exactly the kind of thing that quietly drifts or gets skipped
   under time pressure.

---

## What this looks like in practice

1. Build the Tier-0 fixture now, as code (a seed script or SQL fixture), not as a UI walkthrough —
   this becomes the standard starting state every test run begins from, matching the pattern
   `00-schema-core.sql` already establishes.
2. When a module's tests are written, its test file seeds exactly the settings that module reads —
   colocated with the test, not in a separate "settings setup" phase.
3. For any setting under test, include the behavior-changes-when-setting-changes assertion as a
   first-class test case, not an afterthought — this is the one check that would have caught the
   dead notification config, and it only happens if it's built into how each module's tests are
   written, not by exhaustively pre-populating Settings.
4. Treat "is this setting actually wired to anything" as itself a finding to check *before* writing
   its seed fixture — if a setting has no verified reader (as traced in the notification analysis),
   seeding it and testing around it produces a test that passes for a feature that doesn't work,
   which is worse than not testing it at all.

---

## Not done here

No fixture code was written. This is the sequencing recommendation; building the actual Tier-0 seed
script is a concrete next step if wanted.
