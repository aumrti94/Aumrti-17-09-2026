# Patient Journey Taxonomy — How Many, Which Ones, and How to Build Them Without 200 Tests

**Status:** Recommendation. Supersedes the "three journey spines" section of
[TEST_STRATEGY_RECOMMENDATION.md](TEST_STRATEGY_RECOMMENDATION.md).
**Date:** 2026-09-10

**You're right — three was too few.** The schema itself says so.

---

## The real dimensions, read from the migrations

These aren't invented categories; they're `CHECK` constraints in the database:

| Dimension | Values | Source |
|---|---|---|
| `admission_type` | elective, emergency, transfer, daycare, trauma | `20260531150001_hospital_config_values.sql` |
| `discharge_type` | regular, **lama**, **expired**, transfer, daycare | `20260904000021_discharge_summary_structured.sql` |
| `patient_category` | general, bpl, cghs, echs, pmjay, esi, insurance, medicalaid | `20260904000020_patient_category.sql` |
| `visit_type` | new, revisit, followup, emergency | `20260904000025_p1_gaps.sql` |

Plus the specialty pathways with their own EMRs in the module registry — obstetric ANC,
partograph, neonatal, dialysis, oncology day care, mortuary/medico-legal, IVF, home care.

**5 admission types × 8 patient categories × 5 discharge types = 200 combinations** before any
specialty pathway is layered on. So the answer isn't 3, and it also isn't "all of them" — it's
choosing the ~16 that carry *distinct rules*, and composing them rather than writing 16 monoliths.

---

## Correction to your framing: 16 journeys ≠ 16 independent tests

If each journey is written as a standalone end-to-end script, you get 16 × 2 hospitals × negative
forks ≈ 100+ slow, flaky, massively duplicated tests — most of them re-walking the same
registration and billing steps. That's the version of this that collapses under its own weight in
month three.

Instead: **build ~9 reusable segments, and assemble journeys from them.**

```
[Registration]──[Encounter]──[Clinical doc]──[Orders]──[Charge posting]──[Billing]──[Claim*]──[Discharge]──[Statutory filing*]
                                                                                      *conditional on payer / outcome
```

A journey is then a short declaration — "emergency admission + trauma + MLC + expired discharge" —
not 400 lines of new script. Adding the 17th journey costs almost nothing. This is what makes
"10–20 journeys" sustainable rather than aspirational.

---

## The 16, risk-ranked

Ranked by **irreversibility**, not patient volume — a statutory clock missed or a death certificate
mishandled is unrecoverable; a mispriced OPD token is a correction.

### Tier 1 — statutory / legally irreversible (build first)

| # | Journey | Why it ranks here |
|---|---|---|
| 1 | Emergency → **MLC** → police intimation | Hard legal clock; security-pod flagged these as needing verification that they *actually fire*, not just exist in code |
| 2 | Death in hospital → **MCCD** → mortuary release (`discharge_type='expired'`) | Statutory certificate + body release chain |
| 3 | Maternity: ANC → partograph → delivery → postnatal | WHO alert/action lines are time-bound clinical triggers |
| 4 | Neonatal → NICU (APGAR, Bhutani, CCHD screening) | Screening windows are age-in-hours dependent |
| 5 | **NDPS** controlled-drug dispensing | Dual sign-off is a legal requirement, not a workflow preference |

### Tier 2 — revenue / scheme correctness

| # | Journey | Why |
|---|---|---|
| 6 | IPD elective surgical, TPA-insured → OT → claim → reconciliation | Crosses all five hubs; lands on both gaps found today |
| 7 | IPD **PMJAY/CGHS scheme** patient | Nursing-bundling rule — the payer-spelling bug already bit here once |
| 8 | Day care — **dialysis** (recurring sessions) | Recurring billing, session-level leakage risk |
| 9 | Day care — **oncology/chemo** | Protocol-driven, high-value drugs |
| 10 | **LAMA / DAMA** discharge (`discharge_type='lama'`) | Partial billing + consent capture on an incomplete stay |
| 11 | **Transfer out** (`discharge_type='transfer'`) | Records handoff mid-episode |

### Tier 3 — volume / routine

| # | Journey |
|---|---|
| 12 | OPD walk-in, cash, **new** visit |
| 13 | OPD **follow-up** visit (follow-up fee + visit cap) |
| 14 | Preventive health package |
| 15 | Teleconsult |
| 16 | Home care post-discharge |

---

## New finding while reading these enums: `visit_type` has the same spelling drift as `payer_type`

Four migrations disagree on the vocabulary for the same column:

| Migration | Accepted values |
|---|---|
| `20260418180322` | `'new'`, `'follow_up'`, `'review'` |
| `20260904000025_p1_gaps` | `'new'`, `'revisit'`, `'followup'`, `'emergency'` |
| `20261014000002` (public booking) | `'new'`, `'follow_up'`, `'review'` |
| `20261015000002` (follow-up cap) | `WHEN visit_type IN ('followup', 'follow_up')` — **defensively handles both** |

That last row is the tell: someone already hit this and patched around it rather than fixing the
vocabulary. It's the identical failure mode `payerTypes.ts` documents for `esi`/`cghs` — two call
sites drifting on the spelling of the same concept, one silently not matching.

This directly threatens **journey 13**: if the follow-up fee rule and the visit-cap rule recognise
different spellings, a follow-up visit gets charged as a new visit — silently, with a valid-looking
bill. Same class as every other defect found today: no error, just wrong. Worth a consolidation
into one shared constant (as `payerTypes.ts` already did) plus a regression test.

---

## How this changes the plan

1. **Build the 9 segments first**, not journey #1. The segments are the actual engineering work;
   journeys after that are assembly.
2. **Tier 1 journeys first** — they're where "silent failure" is legally unrecoverable, and they're
   the ones a pilot hospital's medical superintendent will ask about.
3. **Run Tier 1 + journey 6/7 as two hospitals.** No need to run all 16 twice — multi-tenant
   isolation is a property of the *segments* (charge posting, alerts, records), so proving it on the
   highest-risk journeys covers the shared machinery.
4. **State assertions still apply at every step** — unchanged from the strategy doc, and the reason
   this whole approach works.
5. Negative forks attach to journeys, not to the list — journey 6 forks on "TPA underpays," journey
   5 forks on "second signatory absent," journey 1 forks on "intimation window missed."

---

## Not done here

No code written. The `visit_type` vocabulary drift is a real bug worth fixing independently of
testing — flagging it rather than folding it into a test plan.
