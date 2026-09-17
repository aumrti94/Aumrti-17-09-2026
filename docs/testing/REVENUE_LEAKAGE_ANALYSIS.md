# Revenue Leakage — What Exists, What's Fragile, How to Test It

**Status:** Analysis + recommendation, grounded in the actual code. Not a plan — flagging for a
decision before anything gets built or changed.
**Date:** 2026-09-10

---

## What already exists (four layers, not zero)

Aumrti already has a layered "did we bill everything we delivered" system:

| Layer | File | Mechanism | Scope |
|---|---|---|---|
| Nightly automated scan | [supabase/functions/daily-leakage-scan/index.ts](../../supabase/functions/daily-leakage-scan/index.ts) | `billing_status = 'unbilled'` / `bill_linked = false` flags, 12–24h grace window, `pg_cron` | All active hospitals, lab/radiology/pharmacy/OT |
| Hospital-wide dashboard | [src/components/billing/RevenueLeak/LeakageDashboard.tsx](../../src/components/billing/RevenueLeak/LeakageDashboard.tsx) | Reads `leakage_reports` snapshot + live `service_charges` for ancillary modules (dialysis, physio, home care, AYUSH, mortuary, dietetics, ambulance, CSSD) | Hospital-wide, all modules |
| Admission-scoped modal | [src/components/billing/UnbilledServicesModal.tsx](../../src/components/billing/UnbilledServicesModal.tsx) | `source_dedupe_key` on `bill_line_items`, checked against `billed` flags | One IPD admission |
| Per-bill scanner + discharge banner | [src/components/billing/LeakageScanner.tsx](../../src/components/billing/LeakageScanner.tsx), [src/components/ipd/PreDischargeLeakageBanner.tsx](../../src/components/ipd/PreDischargeLeakageBanner.tsx) | Case-insensitive **description substring match** | One bill / discharge gate |

The nightly scan raises a `clinical_alerts` row (severity `critical` at ≥₹50,000), and WhatsApps
CFO/billing_executive/hospital_admin roles via WATI. This is a real, running control — not
something to build from scratch.

---

## The actual gap

Two of the four layers (`LeakageScanner`, `PreDischargeLeakageBanner`) don't use the same
detection method as the other two. They match on free-text `description` instead of the hard
flags/keys the nightly scan and the admission modal use:

```ts
// LeakageScanner.tsx — fragile
if (!existingDesc.some((d) => d.includes(testName.toLowerCase()))) { ... }

// PreDischargeLeakageBanner.tsx — same pattern
if (testName && !billedDesc.has(testName.toLowerCase().trim())) { ... }
```

vs. the canonical approach used elsewhere in the same codebase:

```ts
// daily-leakage-scan/index.ts — reliable
.eq('billing_status', 'unbilled')

// UnbilledServicesModal.tsx — reliable
.eq('source_dedupe_key', dedupeKey)
```

Substring matching on description can fail in both directions:
- **False "already billed"** (real leakage silently missed) — if lab master data is edited
  ("CBC" → "CBC with ESR"), a scan looking for the old name won't match the new bill line at all,
  or two distinct tests with overlapping names collide.
- **False "unbilled"** (risk of double-billing) — trivial wording drift (extra whitespace, a
  different case) causes an already-billed item to look new; a user clicking "Add All" then
  double-charges the patient.

This is the same class of bug the codebase has already hit and fixed once — see the comment in
`UnbilledServicesModal.tsx` about the `billed` boolean alone re-offering already-charged items
until `source_dedupe_key` was added. `LeakageScanner` and `PreDischargeLeakageBanner` were built
without that fix.

**A second, related leakage variant:** a service can be billed but at the *wrong* rate. Two
comments already in the code confirm this has happened — `investigationBilling.ts` notes
`service_master` was queried for a `rate` column that doesn't exist (always null, silently
defaulting), and `UnbilledServicesModal.tsx` notes a radiology fee lookup queried a table name
(`modalities`) that never existed, so every radiology line silently priced at ₹0. A bill that
exists but is wrong is leakage too — it just doesn't show up in an "unbilled" scan at all.

---

## How to handle/test this for go-live

1. **Extract the "is this consumed service already billed" decision into one pure function**,
   same pattern as `evaluateAncillaryGate` in `ipdAncillaryGate.ts` — driven only by
   `billing_status` / `bill_linked` / `source_dedupe_key`, never by comparing description text.
   Have all four surfaces call it. Right now there are effectively two competing implementations
   of the same question, which is itself the leakage risk — they can disagree with each other.
2. **Unit test that pure function directly** against the edge cases that actually break substring
   matching: two tests with overlapping names, the same drug dispensed twice in one admission,
   master-data description edited after the order was placed, a cancelled/refunded bill's line
   items (must not count as "already billed" if the bill was voided).
3. **Extract `scanHospital` out of the Deno edge-function wrapper into shared logic** so it's
   directly unit-testable outside the server, and so a client-side "run scan now" call and the
   nightly cron call are provably running identical logic — right now they already are the same
   function, but nothing enforces that staying true as the file evolves.
4. **Test the grace-window boundaries explicitly** (11h59m vs 12h01m for lab/radiology/pharmacy,
   23h59m vs 24h01m for OT). An off-by-one here silently hides a day's revenue rather than
   crashing — the kind of bug that has no error message and shows up only as a smaller number.
5. **Turn the reconciliation into an integration test, not just a production job**: seed a test
   hospital with a mix of billed/unbilled services across lab, radiology, pharmacy, and OT, run
   the scan, assert the exact expected discrepancy set. This is the concrete answer to the gap
   revenue-pod flagged in the earlier brainstorm ("no mechanism to detect a billing error after it
   reaches a live invoice") — extended to also catch a service that never reached an invoice at
   all.
6. **Cover rate-lookup correctness separately** — the ₹0-fee bugs above are a silent-wrong-amount
   problem, not a missing-bill problem, and won't be caught by any leakage scan. This is exactly
   the `gstRules`/billing-totals unit-testing gap already named in `CLAUDE.md` as the highest-bar
   surface in the repo — the fix belongs there, not in the leakage layer.

---

## Not done here

No code was changed. This is analysis to inform the testing brainstorm — whether to consolidate
the two detection methods, and where the reconciliation test should live, is a decision for
whoever picks this work up next.
