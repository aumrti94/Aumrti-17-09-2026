# Connectivity Across Clinical, Diagnostics, Surgical, Pharmacy, Finance, Operations, Specialized, Patient, Analytics, Settings

**Status:** Analysis + methodology, grounded in the actual code and in everything found across the
four earlier analyses this session. Not a plan.
**Date:** 2026-09-10

These are exactly the 10 categories in [modules.ts](../../src/lib/modules.ts)'s `ModuleCategory`
type — this isn't an arbitrary taxonomy, it's the one the app itself uses to group its ~65 modules.
Treating 10 categories as 45 pairwise combinations to test independently would be the wrong shape
for this problem. What's actually true, from everything traced this session: **almost all
cross-category traffic flows through a small number of hub mechanisms**, not through direct
category-to-category calls. Test the hubs, and most of the graph is covered.

---

## The real graph, not the theoretical one

```
Clinical ─┐
Diagnostics ─┤
Surgical ─┼──► bill_line_items (source_module) ──► Finance ──► Analytics (Revenue Intelligence)
Pharmacy ─┤         │                                  │
Specialized ─┘      │                                  └──► insurance_claims ──► Analytics
                     │
Clinical ─┐          │
Diagnostics ─┤       │
Surgical ─┼──────────┴──► clinical_alerts ──► Operations (Notifications) ──► escalation (SMS/email)
Pharmacy ─┤
Specialized ─┘

Clinical ─┐
Diagnostics ─┤
Surgical ─┼──────────────► nabh_evidence_log ──► Operations (Quality & NABH) ──► Analytics
Pharmacy ─┤
Specialized ─┘

Patient ──────(patient_id, the universal join key)──────► every category above

Settings ──────(configuration read at call time)─────────► every category above
   (NOT a data-flow node — governs behavior in the others, doesn't carry data itself)
```

Five things carry almost all of the actual connectivity:

| Hub | Categories that write | Categories that read | Already tested this session? |
|---|---|---|---|
| `bill_line_items` (+ `source_module`/`source_dedupe_key`) | Clinical, Diagnostics, Surgical, Pharmacy, Specialized | Finance, Analytics | Yes — [REVENUE_LEAKAGE_ANALYSIS.md](REVENUE_LEAKAGE_ANALYSIS.md); found two inconsistent implementations |
| `clinical_alerts` | Nearly every category (48+ call sites) | Operations (Notifications), Analytics | Yes — [NOTIFICATION_SYSTEM_ANALYSIS.md](NOTIFICATION_SYSTEM_ANALYSIS.md); found no dedup, and a disconnected Settings config |
| `insurance_claims` / `insurance_payment_reconciliation` | Finance (Insurance/TPA, PMJAY modules) | Finance (Accounts), Analytics | Yes — [INSURANCE_PMJAY_BILLING_ANALYSIS.md](INSURANCE_PMJAY_BILLING_ANALYSIS.md); found the bill-vs-claim balance isn't reconciled |
| `nabh_evidence_log` + the quality-indicator engine | Nearly every category (47+ call sites) | Operations (Quality & NABH), Analytics | Yes — [ABHA_NABH_ACCURACY_ANALYSIS.md](ABHA_NABH_ACCURACY_ANALYSIS.md); found a claimed test that doesn't exist |
| `patients.id` (patient_id) | Every category | Every category | Not yet — this is the one hub with no dedicated analysis so far |

That last row matters: **`patient_id` is the one true universal connector** — it's the join key
every category's records ultimately hang off. Everything else in this table is really "N
categories write, 1–2 categories read." `patient_id` is "every category writes and reads,"
which makes it the highest-leverage thing to test directly (see below) rather than the most
overlooked.

---

## Settings is a different kind of connection, and it's already proven to break

Every other row above is a **data** connection — one category's write becomes another's read.
Settings is a **behavior** connection — a hospital admin's saved configuration is supposed to
change what another category actually does, with no new data record changing hands. That's harder
to test because "did the setting take effect" requires tracing whether the configuring category's
value is read at the point of decision in the configured category, not just that it saved.

This isn't theoretical — the notification analysis already found the concrete failure mode:
`Settings → Notifications` writes a full per-alert-type routing config (recipients, channel,
escalation), and **nothing in the codebase reads it back to actually route anything.** The
setting saves cleanly, looks correct in the UI, and does nothing. That's the shape every
Settings-to-category connection needs to be tested for: not "does the form save" but "does a
category's runtime behavior actually change when this setting changes" — service rates
(`service_master`/`lab_test_master` fee lookups feeding Finance), role/entitlement gates feeding
every category's route guard, quiet-hours feeding Operations' escalation timing, and so on.

---

## A finding in the registry itself, worth a cheap check

While reading `modules.ts` for the category list, five modules are declared with a `category` that
doesn't match the section comment they're physically grouped under — **Vaccination, Ambulance
Service, Home Care, Chronic Disease Management, and Dietetics & Nutrition are all tagged
`category: "Clinical"`** despite living under the `// ── SPECIALIZED CLINICAL ──` /
`// ── QUALITY & COMPLIANCE ──` comment blocks alongside modules tagged `"Specialized"` or
`"Operations"`. I'm not asserting this is a functional bug — `category` may only drive UI color
grouping and this could be intentional — but it's the kind of drift worth a one-line automated
check (assert `category` matches the section a module is declared in, or just accept the comment
sections are stale and remove them) rather than leaving it to catch someone's eye during a review.
It's also a small, concrete instance of the exact same "the categories look authoritative but
aren't internally consistent" theme every prior analysis this session turned up somewhere else.

---

## How to actually test this without testing 45 pairs by hand

1. **Test the five hubs, not the categories.** For each hub table, write one test suite that
   covers: every category that's supposed to write to it does so with the correct shape (positive),
   duplicate/conflicting writes are caught (negative — already proven missing for `clinical_alerts`),
   and every category that's supposed to read from it gets a complete, accurate view (the
   reconciliation pattern used throughout the earlier analyses). Four of five hubs already have a
   grounded starting point from this session's work; `patient_id` doesn't yet.
2. **Test `patient_id` as its own hub**, specifically for the failure mode unique to a true
   universal key: a record created in one category with a `patient_id` that doesn't (or no longer)
   resolves to a real patient — e.g., a merged/deduplicated patient record, or a record created
   before a patient-merge that never got repointed. This is the one connectivity risk this session
   hasn't looked at yet and is worth its own pass before go-live, given every other category
   depends on it being correct.
3. **Test Settings-to-category connections as "does behavior change," not "does the form save."**
   For each settings screen, the test is: change the value, then assert the configured category's
   actual runtime decision differs — not that the settings table has a new row. This is exactly
   the test that would have caught the dead `notification_config` before it shipped.
4. **Treat Analytics as a correctness mirror, not a new connectivity surface.** Every Analytics
   module (Revenue Intelligence, Population Health, HOD Dashboard) reads from the hubs above rather
   than originating new cross-category writes — so testing the five hubs correctly is most of what
   makes Analytics trustworthy too. The additional thing worth testing at the Analytics layer
   specifically is aggregation correctness (do the dashboard's totals match a manual sum of the
   underlying hub data for a known seeded period), since that's a new failure mode (wrong rollup
   logic) that doesn't exist at the hub layer itself.
5. **Fold this into the master inventory** from the coverage-methodology discussion — each hub
   becomes a small number of rows (one per category that touches it × positive/negative) instead
   of the full 45-pair combinatorial explosion, which is what makes "don't miss any connectivity"
   achievable rather than aspirational at this codebase's size.

---

## Not done here

No code was changed. `patient_id`-as-hub has no dedicated deep-dive yet in this session — worth
one if the next investigation continues this thread.
