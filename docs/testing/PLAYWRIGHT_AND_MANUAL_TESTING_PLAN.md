# Two-Track Testing — Playwright (Automated) + Manual Journeys

**Status:** Recommendation and structure. Companion to
[PATIENT_JOURNEY_TAXONOMY.md](PATIENT_JOURNEY_TAXONOMY.md).
**Date:** 2026-09-10

---

## Ground truth first

| Fact | Detail |
|---|---|
| `@playwright/test` | **Already installed** (^1.57.0) |
| `playwright.config.ts` | **Does not exist** |
| `e2e/` or spec directory | **Does not exist** |
| `npm test` / `test:e2e` script | **Not in package.json at all** |
| Faker / mock-data library | Not installed |
| `vitest.config.ts` | Exists, no coverage thresholds |

So Playwright is a dependency that was added and never wired up — likely a casualty of the
2026-09-05 test purge. The first step isn't installing it; it's configuring it. That's a smaller
starting cost than it looks.

---

## The one thing that decides whether either track works

**Manual testing does not automatically catch silent failures.** This is the trap worth naming
before any scripts get written.

Re-read the eight defects found today: a manual tester clicking through would see *"Notification
settings saved successfully"* and move on. They'd see a leakage scan report *"✓ No unbilled
services detected — bill appears complete"* and tick the box. They'd see NABH indicators render
with plausible numbers. **Manual testing catches none of them either** — not because the tester is
careless, but because the UI reports success in every case.

So both tracks need the same discipline, expressed differently:

| Track | How "assert on state" is expressed |
|---|---|
| Playwright | After a UI action, query the DB directly and assert exact values — `expect(billLines).toHaveLength(1)`, `expect(total).toBe(4720)` |
| Manual | The script must include **verification steps**, not just action steps: "Open Billing → confirm the lab charge appears **once** at ₹450" — a cross-screen check, not "no error appeared" |

A manual script that is only a list of clicks is a demo, not a test.

---

## Mock data: deterministic fixtures, never random

You said the Playwright script should "automatically take mock data." Important design decision
here, and the intuitive choice is the wrong one.

**Do not use faker/random generation for anything that feeds a calculation.** If drug quantities,
rates, or GST percentages are random, you cannot assert `total === 4720` — you can only assert
`total > 0`, which is exactly the weak assertion that passes on all eight silent bugs.

The split:

| Field type | Approach |
|---|---|
| Cosmetic (name, address, phone) | Random/faker is fine — nothing asserts on it |
| Anything feeding a calculation or rule (rates, quantities, GST %, dates, payer type, allergy) | **Fixed fixture values**, committed to the repo, so expected results are known constants |

Precedent already exists in the repo: the pgTAP suite's `00-schema-core.sql` builds a minimal
fixed fixture, and the `seed-dashboard` edge function seeds named patients. Follow that pattern —
a `fixtures/` directory of known hospitals, patients, services, and rates, with the expected
outputs derivable by hand.

---

## Division of labour — not "same journeys, twice"

The wasteful version of two-track testing is manual re-walking whatever Playwright already covers.
Each track should do what only it can:

**Playwright owns:**
- Exact state assertions after every step
- Repetition and regression (does it *still* work after a change)
- Running the same journey as **two hospitals** — multi-tenant isolation nearly free via two
  `storageState` files, one login per tenant
- Boundary/timing conditions (the 12h/24h leakage windows, the 30-min escalation cool-off)
- Duplicate detection — run a step twice, assert still exactly one row

**Manual owns:**
- **Exploratory first-pass** on a journey nobody has automated yet — discovering what the real
  workflow is, and what's missing rather than wrong
- Clinical sensibility — does this order of screens match how a ward actually runs
- Zero Scroll / 1-2-3 Click / Clarity on a **real tablet**, not a resized browser
- Print output (bills, discharge summaries, prescriptions) — physical paper correctness
- Anything requiring a real external system: ABDM sandbox, actual WhatsApp/SMS delivery

**Neither owns — escalate instead:**
- Whether the drug-interaction *ruleset itself* is clinically correct. That's a licensed
  clinician's sign-off (Dr. Ramesh's open item), not a QA task at either level.

---

## The pipeline that keeps them from duplicating

```
New journey  →  Manual exploratory pass  →  Findings + real workflow captured
                                                      │
                                                      ▼
                                          Playwright spec encodes it
                                                      │
                                                      ▼
                        Manual STOPS re-running it — moves to the next journey
                        (Playwright now owns regression forever)
```

Manual is the **frontier**; Playwright is the **ratchet**. Once a journey is automated, manual
only returns to it when the workflow itself changes.

---

## The checklist shape

One row per journey, per the 16 in the taxonomy doc:

| Field | Example |
|---|---|
| Journey ID | `J06` |
| Name | IPD elective surgical, TPA-insured |
| Tier | 2 (revenue/scheme) |
| Segments used | Registration → Encounter → Orders → Charge posting → Billing → Claim → Discharge |
| Fixture set | `fixtures/tpa-surgical.ts` |
| Playwright spec | `e2e/journeys/j06-ipd-tpa-surgical.spec.ts` |
| Key state assertions | exactly 1 bill line per OT charge; `claim.claimed_amount === bill.total`; NABH evidence row exists |
| Negative forks | TPA underpays; unbilled service at discharge; duplicate charge post |
| Two-hospital run | Yes |
| Manual script | `manual/J06.md` |
| Manual-only checks | Printed bill layout; tablet ergonomics in OT |
| Status | Not started |
| Sign-off | QA + revenue owner |

Tier 1 journeys additionally carry a **statutory sign-off** column — MLC/MCCD correctness isn't a
QA pass, it's a medico-legal one.

---

## Suggested build order

1. `playwright.config.ts` + `npm run test:e2e` script + two-tenant `storageState` auth setup
2. The `fixtures/` fixed dataset (Tier-0 baseline from
   [TEST_PREREQUISITES_STRATEGY.md](TEST_PREREQUISITES_STRATEGY.md))
3. The 9 reusable **segments** as page objects / helpers — not journeys yet
4. Journey J06 end-to-end as the reference implementation, run as two hospitals
5. Tier 1 journeys (J01–J05), each with its manual script written first
6. Everything else, ratcheting

Unit tests on `drugSafetyCheck` / `clinicalCalculators` / `gstRules` / `billTotals` run in
parallel throughout — they need none of this infrastructure and shouldn't wait for it.

---

## Not done here

Nothing built yet. Steps 1–3 above are concrete, unblocked, and buildable now — that's the natural
next move, and it's scaffolding rather than another analysis document.
