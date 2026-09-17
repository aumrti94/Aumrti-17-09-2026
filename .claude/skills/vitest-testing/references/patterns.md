# Testing patterns — detail

## The gate — nothing is wired

Verified 2026-09-11. Everything in this section is a **proposal**, not the current state.

| Thing | Status today |
|---|---|
| `test` / `test:watch` / `test:coverage` npm scripts | **Do not exist.** Only `npx vitest run` works |
| Tests in CI | **None.** `ci.yml` has one job, `checks`, running lint + the five `check:*` scripts + build |
| Coverage thresholds | **None** in `vitest.config.ts`, and no `coverage.include` either |
| `*.test.ts(x)` files under `src/` | **Zero** |

### Proposed — npm scripts (not present)

```jsonc
// package.json "scripts" — PROPOSED, not currently in the file
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage"
```

### Proposed — CI wiring (not present)

A `Unit tests` step in the `checks` job, after `Lint`. Two constraints when that lands:

- **Do not pass `--passWithNoTests`.** Vitest exits 1 on an empty suite, which is correct here: an
  empty suite reporting green is precisely how this repo lost its entire test tree without CI
  noticing.
- **Do not rename the job to `test`.** The comment at the top of `ci.yml` explains why it was
  renamed away from that — a job named `test` that runs no tests reported a green "test" check on
  every PR.

### Proposed — coverage thresholds (not present)

```ts
// vitest.config.ts — PROPOSED
coverage: {
  provider: "v8",
  reporter: ["text-summary", "text", "html"],
  include: ["src/lib/**"],          // there is no `include` today, so coverage reports everything
  thresholds: {
    lines: 0,                        // repo-wide floor, raised as the suite grows
    "src/lib/drugSafetyCheck.ts": { lines: 90 },
    "src/lib/billTotals.ts": { lines: 90 },
    "src/lib/gstRules.ts": { lines: 90 },
  },
}
```

Per-file thresholds are what would make "ratchet" mean anything — one repo-wide number lets coverage
on a patient-safety surface fall while trivial code props the average up. Until this lands, coverage
gates nothing, and CLAUDE.md is explicit that you must not claim otherwise.

## E2E

`@playwright/test` ^1.57.0 is installed. There is no `playwright.config.*` and no `e2e/` directory.
`scripts/check-db-contract.mjs` already lists `e2e` in `SCAN_DIRS` (line 36), harmlessly while the
directory is absent — and usefully the moment it exists. Standing E2E up is its own piece of work:
[playwright-e2e](../../playwright-e2e/SKILL.md).

Never put a Playwright spec under `src/`. `vitest.config.ts` matches `src/**/*.{test,spec}.{ts,tsx}`,
so vitest picks it up and it fails on missing Playwright globals.

## Fixtures

Small, local, obviously synthetic.

```typescript
const HOSPITAL_A = "00000000-0000-0000-0000-00000000000a";
const HOSPITAL_B = "00000000-0000-0000-0000-00000000000b";

const bill = (over: Partial<BillTotalsInput> = {}): BillTotalsInput => ({
  items: [{ taxable_amount: 1000, gst_amount: 120 }],
  ...over,
});
```

A builder with overrides beats a shared mutable fixture: each test states only what it cares about,
and one test cannot corrupt another's data.

No PHI, and nothing that *looks* like PHI. Test data ends up in issues and CI logs — use
`9000000001` for a mobile, never a plausible one, and never a real-format Aadhaar. The Edge Function
PHI redactor treats any 12-digit group as one, which is a fair hint about how such a value reads.

## Money assertions

Compare rounded rupees with `toBe`, not `toBeCloseTo` — `roundCurrency` exists so results are exact
at 2dp, and `toBeCloseTo` hides the drift the test is there to catch.

```typescript
expect(t.total).toBe(1020);              // yes
expect(t.total).toBeCloseTo(1020);       // hides the bug
```

Boundaries are where money bugs live. `BillTotalsInput`'s `Money` type is
`number | string | null | undefined`, so a string-typed amount is a real input, not a hypothetical.
Cover `0`, negatives, string amounts, and exactly-at-threshold: `getRoomChargeGSTRate` switches on
`ratePerDay > 5000`, so 5,000 is 0% and 5,001 is 5% — assert 4,999 / 5,000 / 5,001, and assert an
ICU-equivalent category (`icu`, `nicu`, `sicu`, `picu`, `ccu`, `iccu`) stays exempt above it.

Round-trip the split: `splitGst` returns `{ gst, cgst, sgst, igst, interState }` and halves `gst`
for an intra-state sale. Assert `cgst + sgst === gst` after rounding across a range of amounts and
rates, and that an inter-state sale puts the whole figure in `igst` with `cgst`/`sgst` at zero.

## Async, timers, and the drug-safety case

`checkDrugSafety` is `async` and hits Supabase (`drug_master` alias resolution, interaction and
cross-reactivity lookups), so it needs the client mocked — it is not a pure function:

```typescript
await expect(checkDrugSafety("warfarin", ["aspirin"], [])).resolves.toMatchObject({
  hasIssues: true,
});
```

Its signature is `(newDrug, currentDrugs, patientAllergies, hospitalId = "")` and it returns
`{ hasIssues, interactions, allergyConflicts, duplicates, worstSeverity }`. Gate assertions on
`hasIssues` — there is no `hasContraindication` field, and reading one yields `undefined`, which is
falsy, which means no gate at all.

`vi.useFakeTimers()` for anything time-dependent, with `vi.useRealTimers()` in `afterEach`. Pin
"now" rather than trusting the clock. Set `TZ` explicitly for date assertions — this codebase
formats `en-IN`/IST, and a test that depends on the runner's zone fails differently in CI.

## Testing the error path

The highest-value Supabase test in this repo:

```typescript
it("surfaces a load failure instead of rendering an empty list", async () => {
  mockQuery.mockResolvedValue({ data: null, error: { message: "boom" } });
  render(<BillList />);
  expect(await screen.findByText(/could not load/i)).toBeInTheDocument();
});
```

Errors come back as values, so a helper that ignores `error` and one that handles it behave
identically until you feed it a failure. "Failed" rendering as "nothing today" is the defect class
this repo keeps hitting.

## Checklist

- [ ] Co-located `*.test.ts(x)` under `src/`, named for the behaviour
- [ ] Pure logic tested directly — no mocking where extraction would do
- [ ] Error path asserted, not just the happy path
- [ ] Money compared with `toBe` on rounded values; boundaries covered
- [ ] Components wrapped in `HospitalContext.Provider` from `@/hooks/useHospitalContext`
- [ ] No PHI or PHI-shaped values in fixtures
- [ ] Time and timezone pinned
- [ ] `npx vitest run` passes — and reported as **local-only**, gating nothing
