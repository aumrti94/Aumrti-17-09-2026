# Phase 2 — consolidate the embedded logic: completion record

**Phase:** 2 of [PHASED_TEST_PLAN.md](PHASED_TEST_PLAN.md) §8 · **Date:** 2026-09-11
**Estimate in the plan:** 2.5 ew, no infra.

**Result: all three extractions complete, all call sites repointed.** 976 tests passing,
3 skipped, 17 suites. Coverage on the three new modules: 100% line and function, 100/98/100
branch. Two further silent defects found and fixed while repointing.

---

## 1. The three extractions

| Decision | Was | Now | Tests |
|---|---|---|---|
| "Is this consumed service already billed?" | **Three** competing implementations across four surfaces | [billedServiceCheck.ts](../../src/lib/billedServiceCheck.ts) | 31 |
| `scanHospital` | Inline in a Deno edge function, unimportable by any test | [_shared/leakageScan.ts](../../supabase/functions/_shared/leakageScan.ts) | 42 |
| Claim KPI maths | Inline in `PaymentReconciliation.tsx`'s `loadKPIs` / `loadTpaPerformance` | [claimKpis.ts](../../src/lib/claimKpis.ts) | 33 |

### 1.1 The plan undercounted the first one

It describes "2 competing implementations". There were **three**:

| Surface | How it answered |
|---|---|
| `LeakageScanner.tsx` | `existingDesc.some(d => d.includes(testName))` — **substring** on description |
| `PreDischargeLeakageBanner.tsx` | exact match against a `Set` of lowercased descriptions |
| `UnbilledServicesModal.tsx` | `source_dedupe_key` — correct |
| `daily-leakage-scan` | `billing_status` / `bill_linked` flags |

**Description matching is not a billing check.** It is wrong in four ways that all happen in a
normal week at a hospital, and every one of them is silent — which is why nothing had caught
them:

1. **Overlapping names.** Billing "Blood Sugar Fasting" made a separate "Blood Sugar" order
   read as billed. The hospital is never paid for it — and the scanner that exists to catch
   exactly that reported a clean bill.
2. **The same drug twice.** Two Paracetamol dispenses in one admission share a description, so
   the second was silently written off.
3. **Edited master data.** A test renamed in `lab_test_master` after the order no longer
   matched its own bill line, so it was re-offered — **pre-selected** — and billed twice.
4. **Voided bills.** A line on a cancelled bill still carries its description, so the service
   read as billed while the hospital held no valid claim on it.

All four are asserted by name in [billedServiceCheck.test.ts](../../src/lib/billedServiceCheck.test.ts).

### 1.2 The Deno boundary, and how it was actually closed

The repo's existing pattern for sharing logic with edge functions is a comment —
`"TWIN of sortHistoryTimeline() in src/lib/historyDigest.ts — keep the two in lockstep"`, and
five more like it. That is precisely the fragility the plan wants removed ("so the cron path
and any 'scan now' path are **provably** identical logic"), so Phase 2 did not add a sixth.

`leakageScan.ts` has no imports at all, so it lives in `supabase/functions/_shared/` — the
existing Deno convention, already proven by `whatsapp-meta.ts` — and is imported by the edge
function directly and by the vitest suite via a relative path. One file, two callers, no twin
to keep in lockstep. `vitest.config.ts` names it explicitly in `coverage.include` so its
coverage is a real gate rather than an unmeasured directory.

---

## 2. Boundary cases the plan called for

| Case | Asserted |
|---|---|
| Two tests with overlapping names | ✅ §1.1 case 1 |
| Same drug dispensed twice in one admission | ✅ §1.1 case 2 |
| Master data description edited after the order | ✅ §1.1 case 3 |
| Voided / refunded bill lines must not count as billed | ✅ plus a distinct `prior_bill_voided` reason |
| Grace window 11h59m vs 12h01m (lab/radiology/pharmacy) | ✅ and **exactly 12h00m**, which is inside the window |
| Grace window 23h59m vs 24h01m (OT) | ✅ and exactly 24h00m |
| `approved_amount < claimed_amount` stays visible in pending | ✅ pending counts the **claimed** amount, not the approved one |
| Raising a dispute does not zero it before resolution | ✅ |

Two additions the plan did not list, both of which change a rupee figure:

- **Per-row clamping on disputed underpayments.** A TPA that overpaid one claim must not net
  off another claim's genuine shortfall — the hospital would dispute ₹0 and never recover it.
- **Aggregate recovery rate, not an average of per-row rates.** A ₹10 claim paid in full
  alongside a ₹1,00,000 claim paid at 50% is 50% recovery, not 75%. Averaging per-row rates
  lets one tiny claim mask a large shortfall.

---

## 3. Defects found while repointing

Neither was findable from a pure-function test — both are wiring, like the two Phase 1
remediation found:

| ID | Severity | Defect |
|---|---|---|
| **KNOWN-BUG-117** | **S2** | `LeakageScanner.addToBill` wrote its bill line with **no `source_dedupe_key`**. Harmless while the scan matched on description; fatal the moment it matches on identity, because the next scan cannot see the line it just wrote and re-offers the same service. Fixed in the same change — the key is now carried from the candidate onto the insert. |
| **KNOWN-BUG-118** | **S2** | `UnbilledServicesModal` looked up charged lines **without joining `bills.bill_status`**, so a line on a *cancelled* bill counted as charged. A voided-and-not-yet-re-raised service vanished from the modal entirely and was never billed again — the exact mirror of the double-billing defect the file's own comment describes fixing. Now joined; such services are listed with a "prior bill voided" marker. |

**A deliberate behaviour change worth flagging.** That modal pre-ticked every row and bills on
confirm. It now pre-ticks only services that were **never** billed. A service whose sole bill
line sits on a cancelled bill is genuinely unbilled, but it is indistinguishable from a bill a
colleague is mid-way through voiding and re-raising — so it is listed and *not* ticked. A
ticked box is a decision made on the user's behalf, and that is the one case where it should
not be.

---

## 4. Exit gate status

| Criterion | Status |
|---|---|
| Exactly one implementation of each of the three decisions | ✅ Three modules, four call sites repointed (`LeakageScanner`, `PreDischargeLeakageBanner`, `UnbilledServicesModal`, `daily-leakage-scan`), plus `PaymentReconciliation` for the KPIs. |
| `grep` proves no `description`-substring billing comparison remains in `src/` | ✅ The only surviving `description.includes` is a **search-box filter** in `PendingCollectionsPanel.tsx`. Two literal hits for `existingDesc` remain — both prose in comments describing what was removed. |
| Boundary cases asserted, not assumed | ✅ §2. |
| Zero open S1/S2 | ✅ Both defects found this phase were fixed in it. Four S2 remain open against Phases 4, 5 and 9, carried with owners. |
| Thresholds ratcheted | ✅ Global floor 4.5→**5.2** lines, 80→**83** branches, 38→**42** functions. Three new per-file gates (18 total). |

---

## 5. Verification

```bash
npm test                     # 976 passed | 3 skipped (979), 17 suites
npm run test:coverage        # exit 0 — global + 18 per-file thresholds met
npm run lint                 # 0 errors, 1 pre-existing warning (StatusBadge.tsx)
npm run build                # built in ~6s
npm run check:inventory      # current
npm run check:db-contract    # 555 tables, 107 edge functions, all names resolve
```

**The edge function change is not executed anywhere.** `daily-leakage-scan` now imports from
`_shared/leakageScan.ts`; that import path follows the convention `whatsapp-meta.ts` already
proves, but the function has **not been redeployed**, so the wiring is verified by static
analysis and the shared module's unit tests, not by a real invocation. `npm run
supabase:deploy` is still required. The same caveat from Phase 0 applies to the two migrations
written there.

## 6. Carried forward

- **KNOWN-BUG-003 is now closed by construction** — the two competing "already billed"
  implementations no longer exist. Left in the register as resolved rather than deleted.
- **`leakageScan.ts` is outside the generated inventory** because that inventory scans
  `src/lib/**`. It is covered and gated; it simply does not appear as a row. Noted in the
  generator so the absence is deliberate rather than a gap.
- Phase 3 (test infrastructure, local Supabase) is the next gate and the first one that needs
  infra.
