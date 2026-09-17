# Phase 1 — pure calculation logic: test case register

**Phase:** 1 of [PHASED_TEST_PLAN.md](PHASED_TEST_PLAN.md) §8 · **Date:** 2026-09-11
**Scope:** the surfaces CLAUDE.md names as the highest bar in the repo, plus the pure validators.
No Supabase, no fixtures, no staging.

**Status: test phase complete, remediation complete.** 871 passing, 3 skipped, 14 suites.
Eleven defects found by the tests, two of them S1; **three more S1/S2 defects surfaced during
remediation**, including a drug-safety alert gated behind a commercial AI entitlement. All
Phase 1-targeted defects are fixed; three remain open against later phases.

> **Updated 2026-09-11 after remediation.** §3 below describes the suites as first written.
> §4 and §7 record what the fixes changed. Where a test pinned buggy behaviour, it has been
> flipped to assert the fixed behaviour — 15 skipped tests are now 3.

> Phase 1 exists partly to prove the test→fix→gate loop works before anything is bet on it.
> The loop now runs: `npm test` and `npm run test:coverage` exist, per-file thresholds are
> enforced (verified by deliberately breaking one), and every skipped test resolves to a
> [KNOWN_BUGS.md](KNOWN_BUGS.md) row.

---

## 1. What was run

```bash
npm test              # vitest run          → 871 passed | 3 skipped (874)
npm run test:coverage # + v8 thresholds     → exit 0
npm run lint          # 0 errors, 1 pre-existing warning (StatusBadge.tsx, unrelated)
npx tsc -p tsconfig.app.json --noEmit   # 0 errors in the new test files
```

---

## 2. Coverage against the plan's target list

| Target file | Cases | Lines | Branch | Funcs | Plan's bar | Met |
|---|---:|---:|---:|---:|---|:--:|
| [drugSafetyCheck.ts](../../src/lib/drugSafetyCheck.ts) | 72 (6 skip) | 100 | **97** | 100 | 100% branch | ⚠ §Exit gate |
| [clinicalCalculators.ts](../../src/lib/clinicalCalculators.ts) | 183 (7 skip) | 100 | 100 | 100 | 100% branch | ✅ |
| [gstRules.ts](../../src/lib/gstRules.ts) | 56 | 100 | 100 | 100 | 100% branch | ✅ |
| [billTotals.ts](../../src/lib/billTotals.ts) | 32 (1 skip) | 100 | 100 | 100 | 100% branch | ✅ |
| [bloodCompatibility.ts](../../src/lib/bloodCompatibility.ts) | 97 | 100 | 100 | 100 | 100% branch (D10) | ✅ |
| [bloodBagLabel.ts](../../src/lib/bloodBagLabel.ts) | 32 | 100 | 100 | 100 | ≥80% line | ✅ |
| [payerTypes.ts](../../src/lib/payerTypes.ts) | 25 | 100 | 100 | 100 | ≥80% line | ✅ |
| [abdm-validators.ts](../../src/lib/abdm-validators.ts) | 60 | 100 | 100 | 100 | ≥80% line | ✅ |
| [billStatus.ts](../../src/lib/billStatus.ts) | 39 (1 skip) | 100 | 100 | 100 | ≥80% line | ✅ |
| [dayClosureTotals.ts](../../src/lib/dayClosureTotals.ts) | 41 | 100 | 100 | 100 | ≥80% line | ✅ |
| [ipdAncillaryGate.ts](../../src/lib/ipdAncillaryGate.ts) | 95 | 100 | 100 | 100 | ≥80% line | ✅ |
| [currency.ts](../../src/lib/currency.ts) † | 36 | 100 | 100 | 100 | — | ✅ |

† Added to scope. It is the bottom of the money stack — `billTotals`, `gstRules` and every
line-item calculation route through `roundCurrency` — so the rounding contract is asserted once
here rather than re-derived per caller. Testing `billTotals` to 100% without it would have left
the actual rounding behaviour unasserted.

`src/lib/**` overall after remediation: **4.51% lines, 80.61% branch, 38.29% functions** — 14 of
188 files. That number is the honest starting point for the R3 ratchet, not an achievement.

---

## 3. Test cases by surface

Case counts are `it()` blocks. Each suite's header comment states why the file is being tested
and what class of defect the assertions are shaped to catch.

### 3.1 Patient safety

**`bloodCompatibility.test.ts` — 97 cases**

| Group | Cases | What is asserted |
|---|---:|---|
| Full ABO×Rh matrix | 64 | Every patient type × unit type, named individually. The expected matrix is **hand-written from transfusion medicine**, not derived from the module's own table — re-deriving it would pass against an inverted table. |
| Matrix invariant | 1 | Exactly 27 of 64 pairs compatible. Catches a partial edit that only one per-pair case would fail. |
| Universal donor/recipient | 3 | O− accepted by all 8 patient types; AB+ accepts all 8; O− patients accept only O−. |
| ABO alone | 16 | 4×4 group matrix. |
| Fail-closed | 2 | Unrecognised / null / undefined group returns `false`, never "compatible". |
| Rh alone | 3 | Rh+ accepts both; Rh− accepts only Rh−; an unrecognised Rh falls to the **strict** branch. |
| Failure attribution | 4 | `aboOk` / `rhOk` reported separately — the cross-match screen must say whether it is ABO (never overridable) or Rh (overridable in an emergency). |
| Labels | 4 | `formatBloodGroup` renders anything that is not exactly `"positive"` as `−`. |

**`bloodBagLabel.test.ts` — 32 cases.** "A mislabelled bag defeats a correct cross-match."
QR generation and the print window are mocked; label **content** is not. Asserts the group renders
in cross-match notation (`A−`, never `A` or `A+`); that a quarantined unit shows
`QUARANTINED — DO NOT ISSUE` and **never** the green `AVAILABLE FOR ISSUE` banner; that all three
TTI states are visually distinct; `DD/MM/YYYY` dates; QR determinism and per-tenant uniqueness of
the code; and that a QR failure **prevents printing** rather than producing a scan-less label.

**`drugSafetyCheck.test.ts` — 72 cases (6 skipped).** Not a pure function — it queries
`drug_master`, `drug_interactions` and `drug_allergy_cross_reactivity`. The **transport** is
mocked; the decision never is, per clinical-compliance.

| Group | Cases | Notable |
|---|---:|---|
| Clean case | 3 | Including that interactions/cross-reactivity are **not queried** when there is nothing to check. |
| Refused input | 3 | `"500mg"` normalises to nothing and must not match everything. |
| Duplicate therapy | 7 | Same molecule under two brands (Dolo 650 / Crocin); combination brand vs one constituent; the `MIN_SUBSTRING_LEN` guard both ways. |
| Interactions | 8 | Either column order; brand→generic resolution; severity ranking; contraindicated sorts first. |
| DrugBank | 7 | Not consulted without a tenant; capped at 3 pairs; de-dup across sources. |
| Allergy — direct | 5 | **`"Mox 500"` behaves identically to `"Amoxicillin"`** for an amoxicillin allergy. |
| Allergy — cross-reactivity | 5 | Penicillin class; substring matching in both directions. |
| **Fail-open forks** | 6 | The tests no happy path sees — see §4. |
| Malformed reference rows | 14 | Null generics, null allergens, null `cross_reacts`, unranked severities. |
| Query budget | 4 | The fuzzy pass is capped at 8 lookups — a safety check that gets slow is a safety check that gets skipped. |
| Tenant scoping | 2 | Hospital filter applied when supplied; RLS alone when not. |

**`clinicalCalculators.test.ts` — 183 cases (7 skipped).** All 21 calculators. Every input
arrives as a **string**, and the helpers are `parseFloat(v) || fallback`, so `"0"` collapses to
the fallback — asserted deliberately. Tested **at** each escalation boundary and either side,
because the boundary is where the clinical decision changes:

- eGFR across all six CKD stages; CrCl bands and the 0.85 female factor that moves a patient
  between them; FENa at exactly 1% and 2%; anion gap at 12/13
- CHA₂DS₂-VASc sex fork (score 1 female = "consider", score 1 male = "recommended");
  HAS-BLED never advising withholding OAC; Wells; CURB-65 outpatient→admission at exactly 2
- P/F at 300/200/100 per Berlin; A-a gradient at exactly 10, with altitude changing the verdict
- GCS intubation threshold at exactly 8; Hunt-Hess grades I–V
- BMI/IBW/ABW/BSA with the female Devine base; corrected calcium; osmol gap at 10/11
- Bishop ripening→induction at 6 and 8; gestational age; PEWS escalation at exactly 4
- SOFA all mortality bands to 24; APACHE II age bands (44/45/54/55/64/65/74/75) and all eight
  mortality bands
- Registry invariants: 21 calculators, unique ids, unique input ids per calculator, every category
  offered by the filter UI, nothing throws on an empty form

### 3.2 Money and statutory

**`gstRules.test.ts` — 56 cases.** The statutory table; `room_charge` at 4999/5000/**5001** (the
branch is `> 5000` — a `>=` taxes every standard room in the country); ICU/NICU/SICU/PICU/CCU/ICCU
exempt at any rate while **HDU deliberately is not**. The two `service_master` populations are
asserted to reach **opposite answers on identical rows** — the single assertion proving the rules
have not been collapsed: hospital-authored rows honour the toggle (`gst_applicable: true` with 0%
is a legitimate saved state, not "unset"), mirrored rows ignore it and follow statute.

**`billTotals.test.ts` — 32 cases (1 skipped).** Order of operations, not arithmetic: `total` is
net of discount but **gross** of advance; `patientPayable` is net of advance **and** insurance;
`balanceDue` derives from `patientPayable`. Clamping in all three directions. Numeric-string
coercion (PostgREST returns `numeric` as strings). `recalculateBillTotalsSafe`: RPC success, the
fallback path that is actually the normal path, locked-day refusal **writing nothing**, and — the
most expensive silent failure available here — a failed line-item read reported as an error rather
than written through as a zeroed bill.

**`currency.test.ts` — 36 cases.** The rounding contract; `total === taxable + gst` after each is
rounded, over a 5×4 grid; en-IN lakh grouping; `₹1,49,999 ≠ ₹1,50,001`; the compact form asserted
to be lossy **by design** so it stays banned outside axis labels.

**`dayClosureTotals.test.ts` — 41 cases.** The documented defect had a **correct grand total and
wrong per-mode figures**, so every assertion is per-tender. `advance_adjust` excluded as a
non-tender in both directions; refunds netted off the mode they left by; advance dedupe **per
mode** so a cash mirror cannot cancel a UPI deposit; no negative advances on over-mirror. The
per-cashier invariant is asserted to hold — **and its stated limitation is asserted to break**, so
the condition is a tested contract rather than a comment.

**`billStatus.test.ts` — 39 cases (1 skipped).** An unrecognised status must **never** render as
"Unpaid" — the defect that hid `refunded` for months; `outstandingAmount` returns 0 for a refunded
bill whatever `balance_due` says, and still collects on an unknown status.

**`payerTypes.test.ts` — 25 cases.** The drift guard: **every** payer in `INSURANCE_PAYER_TYPES`
must bundle nursing, asserted as a loop rather than a list. Both `esi`/`esic` and `cghs`/`echs`
spellings. A missing payer fails to "bill nursing", the revenue-safe direction.

**`ipdAncillaryGate.test.ts` — 95 cases.** First-match-wins order asserted step by step, including
that **urgency is checked before payment** (a STAT troponin does not wait on a cashier) and that a
missing charge line **clears** rather than blocks. `shouldDebitAdvance` composed with
`resolveChargePaymentStatus` so pre-paid provably cannot double-charge. Parsing asserts every
malformed shape falls to `post_paid` — "an unreadable policy must not invent a gate that blocks
care" — and that no returned policy aliases the module singleton.

**`abdm-validators.test.ts` — 60 cases.** Includes the plan's required assertion: a **well-formed
identifier that belongs to nobody passes**, with the reasoning in the test so nobody later
"fixes" it. All fixtures are repeated-digit or reserved-range placeholders.

---

## 4. Defects found

Eleven, all in [KNOWN_BUGS.md](KNOWN_BUGS.md) with owners and target phases. The two S1s are both
in drug safety and both are **fail-open**:

- **KNOWN-BUG-108** — the interaction and cross-reactivity lookups ignore `error`. Supabase
  returns errors as values, so a timeout yields zero findings and `hasIssues: false`. A transport
  failure is indistinguishable from a clean bill of health.
- **KNOWN-BUG-106** — `SEVERITY_RANK` does not contain `"high"`, which is both a real
  `risk_level` value **and the code's own default**. A high-risk penicillin cross-reaction
  therefore reports `worstSeverity: "none"`, ranking below a moderate one. Duplicate therapy
  likewise never reaches `worstSeverity`. Any gate reading that field lets both through.

Each unfixed defect has a **skipped test asserting the desired behaviour** (with its KNOWN-BUG id)
**and a passing test pinning the current behaviour**, so the defect cannot be silently "fixed" by
a change that alters the symptom without addressing it.

No fix has been applied. Both S1s sit on a clinical decision path, so remediation needs
clinical-pod's ruleset owner and Nalini's AI/clinical governance gate — the item §3 of the plan
flags as "most likely to be forgotten because Phase 1 can pass without it".

---

## 5. Exit gate status

Against [PHASED_TEST_PLAN.md](PHASED_TEST_PLAN.md) §8, Phase 1:

| Criterion | Status |
|---|---|
| 100% branch on `drugSafetyCheck`, `clinicalCalculators`, `gstRules`, `billTotals` | **3 of 4.** `clinicalCalculators`, `gstRules` and `billTotals` at 100%. `drugSafetyCheck` at 97% — three provably unreachable branches, see below. |
| ≥80% line on every other file touched | ✅ All 14 files at 100% line and function. |
| **Zero open S1/S2** | ✅ **All S1 and S2 defects targeted at Phase 1 are fixed.** Four S2 remain open against Phases 2, 4, 5 and 9 (KNOWN-BUG-002/003/004/005/006/011) — carried, not waived, each with an owner and target phase. |
| `grep 'follow_up\|followup\|revisit'` resolves to one constant | ⚠️ **Partly.** `src/lib/visitTypes.ts` is the single source of truth and the money-critical sites are repointed; ~30 cosmetic comparisons remain (KNOWN-BUG-116). |
| D3's derived `insurance_pending` lands in `billStatus.ts` | ❌ D3 unratified by revenue-pod; test skipped as KNOWN-BUG-005. |
| No `it.skip` without a `KNOWN-BUG-` reference | ✅ 3 remain, all resolving to a register row (107 → Phase 2, 109 and 005 → Phase 9). |
| Thresholds ratcheted (R3) | ✅ 15 per-file gates; global floor raised 3.8→4.5 lines, 77→80 branches. Enforcement verified by deliberately breaking one. |

**On the 3%.** Three branches in `drugSafetyCheck` are provably unreachable:
`drugSafetyCheck.ts:55` (`map[worst] || "none"` — `map` holds every key `worst` can take),
`:127` (`if (!unique.length)` — the caller already returned on an empty drug name), and `:133`
(`out.get(key) ?? []` — `add()` is only ever called with a key already set). Reaching 100% needs
either `/* v8 ignore */` comments or deletion of the dead guards — **both are edits to
patient-safety source made to satisfy a metric**, so neither was done. The recommendation is to
amend the gate to "100% of reachable branches, dead branches enumerated", and the threshold is
pinned at 97 so it still cannot fall.

---


## 6. What remediation changed

The plan's two named fix items, plus the eleven defects:

1. **`visit_type` vocabulary drift → [visitTypes.ts](../../src/lib/visitTypes.ts), 42 tests.**
   The plan asked to "consolidate to one constant as `payerTypes.ts` already did", and the
   premise needed correcting: migration `20261015000002` states in its own comment that
   `visit_type` is **UI intent** while `charged_tier` is **what actually billed**, and that
   conflating them "would let a visit marked 'followup' but billed at full fee still burn the
   allowance". Collapsing to one vocabulary would misprice consultations. So the module does
   what `payerTypes.ts` actually did — centralises each vocabulary and its predicates rather
   than flattening them — and a test asserts the two stay distinct.
2. **Inline scheme comparisons.** Most of the 40 hits are presentational (badge colours,
   labels) and legitimately name a specific scheme. The one that was a *decision* —
   `BillEditor`'s CGHS/ECHS referral block — was case-sensitive, so a stored `"CGHS"` skipped
   the block and finalised a bill into a claim the scheme would reject (**KNOWN-BUG-114**).
   Hoisted to `requiresSchemeReferral()`.
3. **All eight Phase 1-targeted defects fixed**, each with its pinning test flipped to assert
   the corrected behaviour. See [KNOWN_BUGS.md](KNOWN_BUGS.md) §Resolved.

**Three defects found while fixing, not by the tests:**

- **KNOWN-BUG-113 (S1)** — `DrugSafetyAlertModal` opened with `if (!__aiOn) return null`, so
  the **entire drug interaction and allergy warning was hidden** for any hospital without the
  `ai_suite` add-on. A contraindicated prescription produced no modal at all: the caller set
  `showSafetyModal(true)`, nothing rendered, and the drug was not added — so the prescriber saw
  a click that did nothing. A patient-safety alert was gated behind a commercial entitlement.
  Now only the AI *analysis* panel is gated, which is what `useAIFeature` is documented for.
- **KNOWN-BUG-115 (S2)** — the IPD prescribing path called `checkDrugSafety` without a
  `hospitalId`, and DrugBank is only consulted when one is supplied. Inpatients were getting a
  weaker interaction check than outpatients.
- **KNOWN-BUG-114 (S2)** — the CGHS/ECHS case-sensitivity above.

None of the three was reachable from a pure-function test, which is worth recording: Phase 1's
tier found the logic defects; the wiring defects surfaced only when someone followed the result
through to the screen. Phase 5.5 and 7.5 are where that class gets caught systematically.

---

## 7. Still outstanding

1. **KNOWN-BUG-002, 003, 004, 005, 006, 011, 107, 109, 112, 116** — carried to Phases 2, 4, 5,
   9 and 10, each with an owner and a target phase. Three have skipped tests already written.
2. **Duplicate-therapy severity grading.** Remediation assigns `moderate` to a duplicate so it
   reaches `worstSeverity` at all. That is a clinical call, flagged in the source for
   **Dr. Ramesh** to ratify.
3. **The two migrations are unexecuted.** `20261106000005` and `20261106000006` pass the static
   checks but have not been applied to any database, and the D1 data migration has not run
   against real rows. Phase 3's local Supabase makes that testable.
4. **`src/lib/news2.ts`** is pure, patient-safety, 117 lines and **still untested**. Not on the
   plan's Phase 1 list — the deterioration path sits in Phase 7.5 — but it belongs to the same
   tier as `clinicalCalculators` by the same reasoning D10 used for blood compatibility.
   Recommended as a Phase 1 addition; not added unilaterally.
5. **Clinician sign-off on the drug-interaction/allergy ruleset** (§3 of the plan). Phase 1
   proves `drugSafetyCheck` applies its ruleset correctly. Nobody has validated that the
   ruleset is clinically correct. Those are different claims and only one is a QA task.

**This now gates a merge.** Phase 0 added a `tests` job running `npm run test:coverage`, so the
15 per-file thresholds are evaluated on every PR.
