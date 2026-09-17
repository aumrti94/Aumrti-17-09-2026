---
name: vitest-testing
description: Use when writing, running, or fixing a unit or component test in this repo — anything matching src/**/*.{test,spec}.{ts,tsx}, testing a src/lib module, or rendering a React component with Testing Library. Covers the real commands (there is no npm test script), what vitest.config.ts actually configures, mocking Supabase's errors-as-values contract, and the HospitalContext wrapper components need. Load before writing the test, not after it fails.
---

# Testing with Vitest

## Read this first — what exists, and what gates

Verified against the repo on 2026-09-11. Trust this over `docs/testing/*.md`, which predates it.

- **There are zero `*.test.ts(x)` / `*.spec.ts(x)` files under `src/`.** Not one. Commit `2324488`
  removed the suite ("restarting testing from a clean slate") and nothing has replaced it.
- **`package.json` has no `test` script.** `npm run test`, `npm run test:watch` and
  `npm run test:coverage` do not exist. Vitest runs only via `npx`.
- **CI runs no tests.** `.github/workflows/ci.yml` has one job, `checks`: Lint →
  `check:rls-coverage` → `check:user-fk` → `check:db-contract` → `check:openapi` →
  `check:lab-catalog` → Build. It carries a comment saying it was deliberately renamed from `test`
  because a green "test" check was being reported while nothing was tested. Do not recreate that.
- **`vitest.config.ts` declares no coverage thresholds and no `coverage.include`.** Coverage is a
  report you can read, not a gate anything fails on.
- **E2E is not wired up** — `@playwright/test` is installed, but there is no `playwright.config.*`
  and no `e2e/` directory. See [playwright-e2e](../playwright-e2e/SKILL.md).

So: **unit tests gate nothing, coverage gates nothing, E2E does not exist.** Say that plainly when
you report. CLAUDE.md explicitly forbids claiming a change "isn't mergeable" for missing coverage,
or that "coverage can only go up" — neither is true today.

## Running

```bash
npx vitest run                                  # whole suite, once
npx vitest                                      # watch
npx vitest run --coverage                       # v8 → text-summary, text, html
npx vitest run src/lib/billTotals.test.ts       # one file
```

Config facts you will otherwise trip over: `environment: "jsdom"`, `globals: true` (so
`describe`/`it`/`expect` need no import, though importing them is fine and clearer),
`setupFiles: ["./src/test/setup.ts"]`, `include: ["src/**/*.{test,spec}.{ts,tsx}"]`, and `@`
aliased to `src`.

Node 20.19+ or 22.12+ — on Node 18 rolldown's `styleText` import throws loading the config first.

`src/test/setup.ts` loads `@testing-library/jest-dom` and polyfills `ResizeObserver`, `matchMedia`
and `elementFromPoint` — the last two guarded for Node-environment tests. A missing browser API
belongs there, not in one test file.

**`@testing-library/user-event` is not installed.** `@testing-library/react` (^16) and
`@testing-library/jest-dom` (^6.6) are. Add user-event as a devDependency in the same change before
importing it, or use `fireEvent` from `@testing-library/react`.

## Start with the pure functions

Not because they are easy — because they need nothing that does not exist yet. Journey and
isolation tests need a staging environment and a second seeded tenant; this repo has neither. A
pure function in `src/lib/` is testable this afternoon.

`computeBillTotals` (`src/lib/billTotals.ts`), `computeBillMoney` (`src/lib/billMoney.ts`),
`getRoomChargeGSTRate` / `resolveServiceGstPercent` (`src/lib/gstRules.ts`), `splitGst`
(`src/lib/gst.ts`) and every `Calculator.calculate` in `src/lib/clinicalCalculators.ts` take plain
values and return plain values. No mocking, no jsdom, no fixtures.

**`checkDrugSafety` is not one of them.** Despite being patient-safety tier, it imports the Supabase
client and queries `drug_master` plus interaction and cross-reactivity tables. Testing it means
mocking — see below. Do not plan it as a pure-function test and discover the I/O halfway through.

*What* to test in what order across the product is [test-strategy](../test-strategy/SKILL.md); proving
isolation with real rows is [tenant-isolation-testing](../tenant-isolation-testing/SKILL.md).

## Test the contract, not the arithmetic you just read

```typescript
import { describe, it, expect } from "vitest";
import { computeBillTotals } from "@/lib/billTotals";

describe("computeBillTotals", () => {
  it("nets discount off total, then nets advance off patientPayable", () => {
    const t = computeBillTotals({
      items: [{ taxable_amount: 1000, gst_amount: 120 }],
      discountAmount: 100,
      advanceReceived: 500,
    });
    expect(t.total).toBe(1020);
    expect(t.patientPayable).toBe(520);
  });

  it("never returns a negative balance", () => {
    const t = computeBillTotals({ items: [], paidAmount: 500 });
    expect(t.balanceDue).toBe(0);
  });
});
```

Re-deriving the implementation's own sum proves nothing. The assertions worth writing encode a rule
someone could plausibly break: `total` is net of discount but still gross of advance, while
`patientPayable` is net of advance *and* insurance — swap those two and every insured bill is wrong
by the advance; `cgst + sgst === gst` after rounding each (`splitGst` halves, and halves of odd
paise are where the one-rupee-off invoice comes from); `getRoomChargeGSTRate` exempts
ICU-equivalent beds at any rate while an ordinary room crosses at `> 5000`, so assert 4,999 /
5,000 / 5,001 explicitly.

`BillTotals` is `{ subtotal, gst, total, patientPayable, balanceDue, paymentStatus }` — there is no
`refundDue` on it. `refundDue`, and the rule that it and `balanceDue` are mutually exclusive and
both non-negative, live in `src/lib/billMoney.ts`. Assert each against the type it belongs to.

## Testing Supabase-touching code

Prefer not to mock. Extracting the calculation into a pure function and testing that is the house
precedent — `billTotals`/`billMoney` exist because `recalculateBillTotalsSafe` needed exactly that
split. When you must:

```typescript
import { vi, beforeEach } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  })) },
}));

beforeEach(() => vi.clearAllMocks());
```

**Assert the error path.** Supabase resolves to `{ data: null, error }` rather than throwing, so a
helper that drops `error` and one that handles it are indistinguishable on the happy path. Only
`{ data: null, error: { message: "boom" } }` tells them apart — and "the query failed" rendering as
"nothing today" is this codebase's recurring defect shape. See
[multi-tenant-data-access](../multi-tenant-data-access/SKILL.md).

## Component tests

Components read the tenant through context, and the context object is exported from the **hook**
file, not the provider file:

```typescript
import { render, screen } from "@testing-library/react";
import { HospitalContext } from "@/hooks/useHospitalContext";
```

`src/contexts/HospitalContext.tsx` exports only `HospitalProvider` and the `HospitalContextValue`
type — it was split that way on purpose. Wrap the component in a `HospitalContext.Provider` with a
`hospitalId`, or it sits in its `if (!hospitalId) return` guard forever and every assertion fails
for a reason the failure message will not tell you.

Query by role and accessible name, never by class. Assert that loading, error and empty states are
distinguishable from each other — that is a real test of the three-state rule in
[react-component](../react-component/SKILL.md), not a formality.

## Conventions

- Co-locate: `src/lib/billTotals.ts` → `src/lib/billTotals.test.ts`. Keep Playwright specs out of
  `src/` entirely — vitest's `include` would pick them up and fail on missing globals.
- Name the behaviour, not the function: `"never returns a negative balance"`, not `"works"`.
- **No PHI, and nothing PHI-shaped**, in any fixture — test data gets pasted into issues. Use
  `9000000001`-style obvious placeholders for a mobile, and never a real-format Aadhaar.
- Pin `TZ` and assert `en-IN`/`DD/MM/YYYY` formatting deliberately; a date test that passes in the
  morning and fails at 23:55 IST is worse than none.
- No network in a unit test.

## Before you call it done

```bash
npx vitest run
npm run lint
```

Proposed coverage thresholds, proposed CI wiring, fixture builders, money and timer patterns —
all clearly marked as not yet real: [references/patterns.md](references/patterns.md).
