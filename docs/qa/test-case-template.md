# Test Case Template — the 21-column contract

Every test case in this program lives as one row in a phase CSV under
[cases/](cases/), and every phase CSV has **exactly these 21 columns, in exactly this order**.

This is not a style preference. [tracker/build-tracker.mjs](tracker/build-tracker.mjs) reads
the CSVs and **hard-exits** if a header is missing a column, because a tracker with misaligned
columns is worse than no tracker at all. If `npm run qa:tracker` fails, your header has drifted.

> The older "11-field template" some of the agent briefs mention was the manual-spreadsheet
> shorthand. This page supersedes it. The 11 fields are all still here — the extra 10 are the
> ones that make a case reproducible against *this* app (mock data, Supabase verification,
> the settings you must configure first, and the spec that locks it).

---

## The columns

| # | Column | Filled by | What goes in it |
|---|---|---|---|
| 1 | `TC#` | author | `TC-P<phase><section>-<NNN>` — e.g. `TC-P2E-014`. Unique across the whole program; the tracker merges your results on this key, so **never renumber a shipped case**. |
| 2 | `Section` | author | `<phase><section> <name>` — e.g. `2E People & Access`. Must match the section table in [PHASE_MAP.md](PHASE_MAP.md). |
| 3 | `Priority` | author | `P1` / `P2` / `P3`. See below. |
| 4 | `Test Case` | author | One line, what is being proven. Not "test the staff page" — "Staff row saves with the correct hospital_id". |
| 5 | `Steps` | author | Numbered, `1) … 2) … 3) …` on one line. Written so someone who has never seen the screen can follow them. Name the route explicitly. |
| 6 | `Expected Result` | author | What must be true. Includes the DB effect where there is one, not just the toast. |
| 7 | `Status(PASS/FAIL/BLOCKED)` | **tester** | `PASS` / `FAIL` / `BLOCKED` / `N/A`. Dropdown in the tracker. |
| 8 | `mock data` | author | The named block from [MOCK_DATA_BOOK.md](MOCK_DATA_BOOK.md) to type. `None` if the case needs none. **Never invent values here.** |
| 9 | `Cross-Module Link` | author | The module this setting or action reaches into — `OPD`, `Billing`, `Pharmacy`. Blank if genuinely self-contained. |
| 10 | `Settings need to set before entering to the module` | author | The prerequisite from [SETTINGS_PREREQ_MATRIX.md](SETTINGS_PREREQ_MATRIX.md). `None` if there is none. This column is why testers stop logging configuration as bugs. |
| 11 | `Actual Result(What happened)` | **tester** | Mandatory on FAIL/BLOCKED. |
| 12 | `Console Error(Copy-paste red text)` | **tester** | F12 → Console, verbatim red text. Mandatory on FAIL. |
| 13 | `Screenshot(Y/N)` | **tester** | `Y`/`N`. Mandatory `Y` on FAIL. |
| 14 | `Notes` | **tester** | Anything the next person needs. |
| 15 | `Journey Scenario` | author | The scenario ID from [JOURNEY_SCENARIOS.md](JOURNEY_SCENARIOS.md). Phases 1–2 have no patient stories, so they use `P1-Setup` / `P2-Setup`. Drives the Scenario Status sheet. |
| 16 | `Why This Exists` | author | The business or clinical consequence of this case failing, in plain language. **Not optional.** A case nobody can justify is a case nobody will maintain. |
| 17 | `Test Type` | author | `Positive` / `Negative` / `Boundary` / `RBAC` / `Cross-Module`. Dropdown. |
| 18 | `Role/Login` | author | Which account runs it — `hospital_admin (Hospital A)`, `Logged out`, `nurse (Hospital B)`. From [MOCK_DATA_BOOK.md](MOCK_DATA_BOOK.md#staff-logins). |
| 19 | `Supabase Verify` | author | Exact table + filter to check in the Table Editor — `departments where hospital_id = A and name = 'Nephrology'`. `None` for pure-UI cases. |
| 20 | `Playwright Spec` | author | Path to the spec that locks this case, e.g. `e2e/phase-02-settings/P2E.people-access.spec.ts`. Blank until automated. Every P1 must eventually carry one. |
| 21 | `Defect ID` | **tester** | `BUG-P<phase>-<NNN>`, cross-referenced in the Defect Log sheet. |

The six **tester** columns (7, 11, 12, 13, 14, 21) are preserved across tracker rebuilds — the
script reads the existing workbook and merges your answers back on `TC#`. Re-running
`npm run qa:tracker` after adding cases is always safe.

---

## Priority

| | Meaning | Examples |
|---|---|---|
| **P1** | Patient safety or money | drug allergy block, bill total, stock decrement, cross-tenant leak, NDPS sign-off, a role gate that fails open, a fee that falls back to the hardcoded ₹500 |
| **P2** | Core workflow | token creation, tab navigation, report printing, a master saving correctly |
| **P3** | Cosmetic / convenience | label wording, column order, empty-state text |

Two rules that follow from it:

- **Every P1 gets at least one `Negative` and one `Boundary` sibling case.** A feature that only
  works when used correctly is not tested.
- **Every P1 must end up with a passing Playwright spec** before its phase gate can go green.

---

## Writing rules

1. **Never invent test data.** If it isn't in `MOCK_DATA_BOOK.md`, add it there first, then
   reference it by name in column 8.
2. **Synthetic data only** — never real patient PHI in a case, a fixture, or a screenshot.
3. **Trust the database, not the UI.** A green toast is not a pass. If column 19 says `None`
   for something that writes data, the case is incomplete.
4. **Steps name the route.** `1) Open /settings/wards` — not "go to ward settings".
5. **Expected Result is falsifiable.** "Works correctly" is not an expected result.
6. **Indian conventions.** DD/MM/YYYY, `en-IN` number grouping, ₹, Indian names and addresses,
   ABHA-format IDs. Indian English spelling — Anaesthesia, Gynaecology.
7. **Every case traces to a requirement.** Column 16 is where that trace is written in prose.

---

## CSV mechanics

- UTF-8, no BOM, `\n` line endings.
- Quote any field containing a comma, quote, or newline; escape inner quotes by doubling them.
  The parser in `build-tracker.mjs` is RFC-4180 and handles all three.
- Leave tester columns empty — do not pre-fill `Status`.
- Filename: `cases/phase-<NN>-<slug>.csv`. The `NN` must match the `PHASE_TITLES` map in
  `build-tracker.mjs` or the sheet is titled `Phase NN` with no name.

Header line, verbatim:

```
TC#,Section,Priority,Test Case,Steps,Expected Result,Status(PASS/FAIL/BLOCKED),mock data,Cross-Module Link,Settings need to set before entering to the module,Actual Result(What happened),Console Error(Copy-paste red text),Screenshot(Y/N),Notes,Journey Scenario,Why This Exists,Test Type,Role/Login,Supabase Verify,Playwright Spec,Defect ID
```

---

## Worked example

A real row from Phase 2, wrapped for readability:

| Column | Value |
|---|---|
| TC# | `TC-P2D-012` |
| Section | `2D Structure` |
| Priority | `P1` |
| Test Case | `Ward saves rate_per_day and IPD bills that rate` |
| Steps | `1) Log in as hospital_admin (Hospital A) 2) Open /settings/wards 3) Create ward 'Nephrology Ward' with rate_per_day 3500 4) Save 5) Admit a patient to a bed in that ward 6) Open the IPD bill` |
| Expected Result | `wards.rate_per_day = 3500.00 and the IPD room charge line reads ₹3,500.00 per day — NOT the ₹500 fallback.` |
| mock data | `Phase 2 additions — Nephrology Ward` |
| Cross-Module Link | `IPD, Billing` |
| Settings need… | `Tier 0 complete; ward must exist before admission` |
| Journey Scenario | `P2-Setup` |
| Why This Exists | `Room charge precedence is wards.rate_per_day → service_rates → service_master → ₹500. If the ward rate does not save, every admission silently under-bills at ₹500/day and nobody notices until the month-end reconciliation.` |
| Test Type | `Cross-Module` |
| Role/Login | `hospital_admin (Hospital A)` |
| Supabase Verify | `wards where hospital_id = A and name = 'Nephrology Ward' → rate_per_day = 3500` |
| Playwright Spec | `e2e/phase-02-settings/P2D.structure.spec.ts` |

Note what makes it usable: the route is named, the expected result states the DB value *and*
the ₹ the user must see, and "Why This Exists" explains the failure mode in money.
