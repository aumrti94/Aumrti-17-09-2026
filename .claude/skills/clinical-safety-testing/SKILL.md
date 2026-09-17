---
name: clinical-safety-testing
description: Use when writing or reviewing a test for a clinical action — prescribing, dispensing, vitals and NEWS2, triage, deterioration escalation, clinical alerting, or NABH evidence logging. Covers what to assert so a silent failure fails the test, the drug-safety fail-open forks, alert exactly-once, and NABH evidence linkage. Load before writing the test, not after it passes.
---

# Clinical safety testing

[clinical-compliance](../clinical-compliance/SKILL.md) owns the rules — log NABH evidence, never
mock a drug check, alerts surface immediately. This skill owns **how you prove those rules actually
hold**. For runner mechanics see [vitest-testing](../vitest-testing/SKILL.md); for what tier a test
belongs in, [test-strategy](../test-strategy/SKILL.md).

## The governing rule: every clinical defect here was silent

Not one of these threw. Not one failed a build. Each was found by reading code, not by a test going
red:

- `nabh_criteria` was never seeded, so `logNABHEvidence()` UPDATE-ed by criterion number and
  **updated zero rows** at ~50 call sites, for months. Every call returned success.
- `LabTATPanel` re-raises the same overdue alert on every `load()` with no existing-alert check —
  `src/components/lab/LabTATPanel.tsx:94`. The alerts were created correctly. There were just N of
  them, and `clinical_alerts` carries **no unique constraint in any migration**.
- A prescribing gate was written against `hasContraindication`, a field `DrugSafetyResult` does not
  have. It read `undefined`, never fired, and every prescription saved unblocked.

So: **"the clinical workflow completed" is not an assertion.** `expect(result).toBeDefined()`,
`expect(error).toBeNull()`, and "the modal opened" would each have passed against all three. Assert
the row, the count, and the value that changes the clinical decision.

## Where you are starting from (verified 11/09/2026)

There is **no `test` script** in `package.json` — the runner is `npx vitest run`. There are **zero
`*.test.ts(x)` files under `src/`**: no NEWS2 test, no drug-safety test, nothing. CI
(`.github/workflows/ci.yml`, job `checks`) runs lint, the five `check:*` scripts and `build` — **no
tests**. `vitest.config.ts` sets jsdom + globals + `src/test/setup.ts` and has **no coverage
thresholds**. `@testing-library/react` and `jest-dom` are installed; **`user-event` is not** — drive
interactions with `fireEvent`. Playwright is a dependency with no config and no `e2e/`.

Nothing blocks a merge for missing coverage today. Do not claim otherwise. Write the test because
the defect is silent, not because a gate demands it.

## 1. Drug safety — the highest-value test in the repo

`checkDrugSafety(newDrug, currentDrugs, patientAllergies, hospitalId)` from
`@/lib/drugSafetyCheck` returns `DrugSafetyResult`. **The assertion that matters is
`hasIssues === true`** for a known interacting pair, and that a documented allergy actually blocks.

```typescript
const r = await checkDrugSafety("Aspirin", ["Warfarin"], [], HOSPITAL_A);
expect(r.hasIssues).toBe(true);
expect(r.interactions.length).toBeGreaterThan(0);

const a = await checkDrugSafety("Amoxicillin", [], ["Penicillin"], HOSPITAL_A);
expect(a.hasIssues).toBe(true);
expect(a.worstSeverity).toBe("contraindicated");   // direct + cross-reactivity both land here
```

Assert on `hasIssues` and `worstSeverity`, never on a field you have not read off the interface.
Cover the brand fork — `"Mox 500"` against a Penicillin allergy must behave identically to
`"Amoxicillin"`. **Never mock the interaction check to make a test pass**: a mocked
`checkDrugSafety` returning `hasIssues: true` proves the modal renders and nothing about whether
the drug is unsafe. Seed `drug_interactions` / `drug_allergy_cross_reactivity` and call the real
function.

### The negative fork: does it block, or silently allow, on timeout?

This is the test no happy path sees, and both forks are **fail-open in the code today**:

- `checkDrugSafety` queries `drug_interactions` and `drug_allergy_cross_reactivity` **without
  destructuring `error`** (`drugSafetyCheck.ts:221` and `:277`). A failed or timed-out query yields
  `data: null` → zero interactions → `hasIssues` stays `false`. Indistinguishable from "safe".
- `checkDrugBankDDI` returns `null` on any error or throw.
- At dispensing, `src/components/pharmacy/ip/ADRCheckPanel.tsx` catches an AI failure to
  `setResult(null)` (`:92`) and then renders green **"No interactions detected"** (`:108`). A
  timeout looks exactly like a clear.

```typescript
it("does not report safe when the interaction lookup fails", async () => {
  mockInteractionQueryToFail();                 // the transport, never the decision
  const r = await checkDrugSafety("Aspirin", ["Warfarin"], [], HOSPITAL_A);
  expect(r.hasIssues).toBe(true);               // FAILS TODAY — document it as a defect, do not
});                                             // relax the assertion to match the bug
```

Two more dispensing forks worth their own tests: `ADRCheckPanel` short-circuits to
`safe_to_dispense: true` when `currentMedications` is empty (`:47`) — **so a patient on no other
drug never has their allergies checked at all** — and `checkDrugSafety` is called only from
`RxOrdersTab` and `IPDMedicationsTab`, i.e. at **prescribing**. Nothing in
`src/components/pharmacy/` calls it. Assert the block at the step you claim is guarded.

## 2. Alert exactly-once

Run the alert-raising step, assert exactly one row. Run **the same step again**, assert **still
exactly one**. A dedupe guard reading a table that does not exist suppresses nothing and looks
identical to one that works — that is how the sepsis duplicate-alert bug survived review.

```typescript
await loadLabTATPanel();
await loadLabTATPanel();                        // same condition, second render/refresh
const { data } = await supabase.from("clinical_alerts")
  .select("id").eq("hospital_id", HOSPITAL_A).eq("alert_type", "lab_tat_overdue");
expect(data).toHaveLength(1);
```

Test the window, do not trust it: fire inside the window and assert no second row; advance fake
timers past it and assert the alert re-fires, because a "dedupe" that suppresses forever is a
silenced alert, and alerts are never silenced. Assert severity and immediacy too — no batching, no
digest, no polling delay.

## 3. NABH evidence — assert the row *and* its linkage

`logNABHEvidence()` returns `{ ok, error }` and **never throws**, by design. So `ok: true` is the
weakest possible assertion and the one the ~50-call-site outage would have passed.

```typescript
await performClinicalAction();
const { data } = await supabase.from("nabh_evidence_log")
  .select("criterion_number, compliance_status, is_known_criterion, source")
  .eq("hospital_id", HOSPITAL_A).eq("criterion_number", "COP.3");

expect(data).toHaveLength(1);
expect(data![0].is_known_criterion).toBe(true);   // the linkage — see below
expect(data![0].compliance_status).toBe("compliant");
```

`is_known_criterion` is set by the `BEFORE INSERT` trigger
`tg_nabh_evidence_log_known_criterion`, which checks `nabh_standards.standard_code`. A client
cannot set it. `false` means the code you logged matches **no** standard — evidence written into a
void, which is precisely the unseeded-table failure repeating. Assert it is `true`, and assert
`compliance_status` is one of the three real values, since a uuid passed into that parameter writes
garbage into the accreditation trail without erroring.

## 4. Clinical calculators — free wins, boundaries only

`src/lib/news2.ts` and `src/lib/clinicalCalculators.ts` are pure functions — no staging, no
fixtures, no Supabase. There is no reason these are untested today.

Test **at each escalation boundary and either side**, because the boundary is where the clinical
decision changes. `getNEWS2Level` steps at 4/5, 6/7 and 7/8 — assert 4, 5, 6, 7 and 8 individually,
not a midpoint. Assert the partial-input contract too: `calculateNEWS2` takes a
`Partial<VitalsInput>` and scores a missing observation as 0, so two of seven parameters returns a
reassuring number that means nothing.

`CALCULATORS` exposes `calculate(v: Record<string, string>): CalcResult` — every input arrives as a
**string**. Boundary table and verified calculator ids:
[references/patterns.md](references/patterns.md).

## 5. Negative cases are journey forks, not invalid input

A negative case is not `calculate("abc")`. It is a real clinical path the patient can take:

- A documented allergy **blocks** dispensing — assert the dispense did not happen, not that a
  warning rendered.
- Escalation fires **at** the threshold, not one point past it.
- An override is **audited before** the action proceeds. `recordAncillaryOverride()` in
  `src/lib/ancillaryGateChecks.ts` returns `false` when the audit row could not be written and the
  caller must then refuse — test that fork: audit write fails → service must not proceed.

## Fixtures: no PHI, ever

Test data gets pasted into issues, CI logs and screenshots. Use `9000000001`-style placeholder
mobiles. **Never** a realistic Aadhaar or ABHA number, even a fake-looking one. Patient allergies
live in `allergy_records` (there is no `patient_allergies` table). Seed two hospitals in any
fixture that touches a tenant-scoped table — see
[multi-tenant-data-access](../multi-tenant-data-access/SKILL.md).

Indian English in test names and fixture strings — Anaesthesia, Gynaecology, Paediatrics. Dates
`DD/MM/YYYY` via `en-IN`; pin the timezone before asserting on a formatted date.

## Checklist

- [ ] Asserts a row, a count, or a decision value — not that a call returned OK
- [ ] Drug safety: `hasIssues` true for a real interacting pair, allergy blocks, brand alias covered
- [ ] Drug safety: the lookup-failure / timeout fork tested explicitly, check never mocked
- [ ] Alert step run **twice**, exactly one row asserted; dedupe window tested both sides
- [ ] NABH: evidence row asserted **and** `is_known_criterion === true`
- [ ] Calculators tested at the escalation boundary and either side
- [ ] Override paths assert the audit row exists *before* the action proceeded
- [ ] No realistic Aadhaar / ABHA / mobile anywhere in a fixture
