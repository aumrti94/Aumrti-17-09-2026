# Defect Process

## Defect ID

`BUG-P<phase>-<NNN>` — e.g. `BUG-P4-017` = Phase 4, seventeenth defect found.

Numbers are never reused, even after a bug is closed. Put the ID in the test case's
`Defect ID` column so the case and the bug stay linked.

---

## Severity

Severity is inherited from the failing test case's Priority, then adjusted if the actual
impact is worse than expected.

| Severity | Meaning | Response |
|---|---|---|
| **P1 — Critical** | Patient could be harmed, money is wrong, or data leaks across hospitals | Blocks the phase gate. Fix before anything else. |
| **P2 — Major** | Core workflow broken or blocked, but no safety/money impact | Must be fixed before the phase closes. |
| **P3 — Minor** | Cosmetic, wording, layout, convenience | Can ship. Batch these. |

**Automatic P1, regardless of what the case said:**
- A drug allergy or interaction alert that does not fire
- Any bill total, tax or discount that computes wrong
- Stock that doesn't decrement, or decrements twice
- NDPS dispensing without dual sign-off
- A patient from Hospital B visible to a Hospital A user
- PHI appearing in a console log or error message
- An obstetric USG that doesn't force PCPNDT Form F
- Any charge billed twice, or a charge that vanishes at discharge

---

## Evidence rule

A FAIL is not accepted into the Defect Log without all three:

1. **Actual Result** — what actually happened, in plain words. Not "didn't work."
2. **Console Error** — F12 → Console → copy the red text verbatim. If there was none, write
   `none`. Blank is not the same as none.
3. **Screenshot** — `Y`, and the file saved next to the tracker as `BUG-P4-017.png`.

Without these, the bug can't be reproduced and will come straight back as "cannot
reproduce", wasting a round trip.

---

## Reproduction steps

Copy the test case's Steps, then add what made it fail:
- which hospital (A or B) and which role you were logged in as
- the exact mock data IDs used (`PT-QA-0014`, not "a patient")
- whether it fails every time or intermittently
- what the Supabase table showed vs what the UI showed

---

## Routing — who fixes what

From `.agents/agents.md`. Put the owner in the Defect Log's Owner column.

| Area | Owner |
|---|---|
| Clinical modules — OPD, IPD, Emergency, Nursing, OT, Lab, Radiology; drug safety; NABH evidence | **Priya** |
| Billing, GST, insurance claims, payments, accounts | **Ravi** |
| Database, RLS, migrations, edge functions, triggers | **Meera** |
| Frontend, layout, forms, responsiveness, design-law violations | **Kiran** |
| Security, DPDP, cross-tenant leaks, PHI exposure | **Ananya** |
| Architecture / cross-module data flow | **Arjun** |
| Clinical realism — "this is not how a doctor works" | **Dr. Ramesh** |
| AI feature behaviour, prompts, cost, model output | **Dr. Nalini** |
| Test gate, sign-off | **Sunita** |

Cross-module bugs go to the module that **wrote** the bad data, not the one that displayed
it. A wrong figure showing in Billing but caused by the pharmacy dispense path is Suma/Ravi
jointly, filed against Pharmacy.

---

## Status lifecycle

```
Open → Fixing → Fixed → Verified
                  ↓
              Reopened  (goes back to Fixing)
```

- **Open** — logged, not yet picked up
- **Fixing** — someone is working on it
- **Fixed** — code changed, not yet re-tested
- **Verified** — the original test case was re-run and passed. Only *you* set this, not the
  person who fixed it.
- **Reopened** — re-test failed. Note what still doesn't work.

A bug is never closed by the person who fixed it.

---

## Re-test rule

When a batch of fixes lands, **re-run the entire phase** — not just the failed cases.

This is not bureaucracy. Billing totals, permission resolution and the charge-dedupe logic
are shared across many screens, so a fix in one place routinely breaks a scenario that
passed earlier. In this codebase the discharge charge sweep and the OPD bill linking are
both known to be sensitive to changes elsewhere.

Mark the re-run in the tracker by clearing Status and running clean. The Summary sheet's
pass % should be recomputed from scratch, not patched.

---

## Won't-fix

Some findings are real but deliberately out of scope. Record them as `Won't fix` with a
one-line reason in the Defect Log rather than deleting them, so the same thing isn't
re-reported next phase. Anything P1 needs explicit sign-off to be marked won't-fix.
