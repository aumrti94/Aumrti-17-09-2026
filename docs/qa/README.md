# Aumrti HMS — QA Program

This folder is the whole testing program. If you read nothing else, read this page.

> **Built fresh on 26 Jul 2026.** Nothing here is carried over from earlier QA attempts.
> Any older test cases, coverage ledgers or e2e specs found in git history are **dead** and
> must not be revived — they describe a build that no longer matches this one.

---

## What this program is for

You built this HMS with AI and have never systematically tested it. This program exists to
answer one question with evidence:

> **If a hospital goes live on Aumrti tomorrow, will it work for every kind of patient that
> walks through the door?**

Not "does the OPD screen load" — but does it work for the cash walk-in *and* the CGHS
pensioner without a referral letter *and* the penicillin-allergic patient *and* the woman
who needs an obstetric scan that legally requires a PCPNDT Form F.

That's why the program is built around **scenarios**, not screens.

---

## The documents, and when to read each

| Read this | When |
|---|---|
| **[PRODUCT_TOUR.md](PRODUCT_TOUR.md)** | First, once. Tells you what every module in your product actually is, who uses it in an Indian hospital, and what pain it solves. You cannot test what you can't explain. |
| **[JOURNEY_SCENARIOS.md](JOURNEY_SCENARIOS.md)** | Before each phase. The patient stories you're simulating. This is where you learn hospital workflow. |
| **[MOCK_DATA_BOOK.md](MOCK_DATA_BOOK.md)** | Constantly. Every name, number, ID and amount you need to type. Never invent test data. |
| **[SETTINGS_PREREQ_MATRIX.md](SETTINGS_PREREQ_MATRIX.md)** | Before touching any module. What must be configured first, and what silently breaks if it isn't. |
| **[PHASE_MAP.md](PHASE_MAP.md)** | To see where you are and what's next. |
| **[GO_LIVE_READINESS.md](GO_LIVE_READINESS.md)** | Before letting any real hospital on the system. |
| **[DEFECT_PROCESS.md](DEFECT_PROCESS.md)** | Every time something fails. |

---

## The tracker

`tracker/AUMRTI_QA_TRACKER.xlsx` is where you record results. Generate or refresh it with:

```bash
node docs/qa/tracker/build-tracker.mjs
```

The CSVs in `cases/` are the source of truth. The script merges on `TC#`, so **anything you
have already typed into the Excel file is preserved** when you regenerate it after new cases
are added. It is safe to re-run at any time.

Sheets you'll use:
- **One per phase** — the test cases. Use the autofilter on `Journey Scenario` to collapse
  the sheet to a single patient story and work it start to finish.
- **Scenario Status** — one row per scenario across the whole app. The "are we ready?" view.
- **Go-Live Readiness** — the must-pass subset, with a single red/green verdict.
- **Summary** — per-phase pass %, open defects, and the phase GATE.
- **Defect Log** — every bug you find.

---

## First-time setup

Before Phase 1, once:

1. **Create `.env.test`** in the repo root (it's gitignored). Copy the QA block from
   `.env.example` and fill it in.

2. **Set the safety gates.** These two are what stop a stray run touching real data:
   ```
   QA_ALLOW_PROJECT_REF=<your project ref, e.g. abcdefghijklmnop>
   QA_SEEDING_CONFIRMED=true
   ```
   Until `QA_ALLOW_PROJECT_REF` matches the target project, **every database
   assertion skips itself** rather than guessing whether it's pointed at production.

3. **Dry-run the seeder and read what it plans to do:**
   ```bash
   npm run qa:seed:dry
   ```

4. **Seed**, then create the staff logins through the UI (that's Phase 1 section 1D):
   ```bash
   npm run qa:seed
   npm run qa:seed:verify     # row counts
   ```

## The rhythm — repeat this for each phase

1. **Reset the test data**
   ```bash
   npm run qa:seed:dry     # see what it will do
   npm run qa:seed         # actually seed
   ```
   Safe to re-run between phases. It only ever touches the two QA hospitals — it refuses
   outright if the target hospital's name isn't one of them.

2. **Set the prerequisites.** Open `SETTINGS_PREREQ_MATRIX.md`, find this phase, and
   configure everything it lists. **Do not skip this.** Most "bugs" you'd find otherwise are
   just missing configuration — and this app fails silently, so you'd waste a day.

3. **Read the scenario.** Open `JOURNEY_SCENARIOS.md` and read the story for the scenario
   you're about to run. Understand who the patient is before you start clicking.

4. **Run the scenario end to end.** Filter the tracker to that one scenario. Work down the
   rows. Fill in as you go:
   - `Status` — PASS / FAIL / BLOCKED
   - `Actual Result` — what actually happened (mandatory on FAIL/BLOCKED)
   - `Console Error` — open DevTools (F12) → Console, copy any red text verbatim
   - `Screenshot` — Y/N (mandatory Y on FAIL)

5. **Verify in Supabase.** Every row has a `Supabase Verify` column telling you the exact
   table and filter to check.

   > **A green toast does not mean the data was saved.** This app has code paths that show
   > success and write nothing. If you did not see the row in the Table Editor, the test did
   > not pass.

6. **Log every failure** in the Defect Log sheet as `BUG-P<phase>-<NNN>`. See
   `DEFECT_PROCESS.md` for severity and who fixes it.

7. **Fix, then re-run the WHOLE phase.** Not just the failed rows. A fix in shared billing or
   permission code routinely breaks a scenario that passed an hour ago.

8. **Lock it.** Once the phase is green, its Playwright specs are run so it can never
   silently regress:
   ```bash
   npm run qa:phase1                    # the whole phase
   npx playwright test -g "TC-P1E"      # one section
   npx playwright test --ui             # interactive
   ```

   > **On first run, expect selector failures.** The specs use accessible-name lookups
   > (`getByLabel(/email/i)` etc.) rather than test IDs, because your components don't
   > carry test IDs yet. Where a label doesn't match, the spec fails on the *selector*,
   > not on your app. Fix the selector — that's a one-line change and normal for a first
   > automation pass. Do not log those as product defects.

9. **Move to the next phase.** Its scenarios and cases get written then — deliberately, so
   they're informed by what broke in this one.

---

## Phase gate — when is a phase actually done?

A phase is DONE only when **all** of these are true:

- [ ] Every case has a Status (no blanks)
- [ ] Zero open **P1** defects
- [ ] Every FAIL has Actual Result + Console Error + Screenshot=Y
- [ ] Every P1 case has a passing Playwright spec
- [ ] The full phase was re-run after the last fix

The Summary sheet computes this. It reads **BLOCKED** until it's satisfied.

---

## Priorities

| | Meaning | Examples |
|---|---|---|
| **P1** | Patient safety or money | drug allergy block, bill total, stock decrement, cross-tenant leak, NDPS sign-off |
| **P2** | Core workflow | token creation, tab navigation, report printing |
| **P3** | Cosmetic / convenience | label wording, column order, empty-state text |

Every P1 workflow gets at least one **Negative** and one **Boundary** sibling case. A
feature that only works when used correctly is not tested.

---

## Test environment

Two QA hospitals on your existing Supabase project, isolated from real data by RLS:

- **Hospital A** — Aarogya Multispecialty Hospital (Hyderabad, Telangana) — Professional plan
- **Hospital B** — Sanjeevani General Hospital (Pune, Maharashtra) — Starter/trial

Hospital B exists for one reason: to prove Hospital A's users can never see its data. Every
clinical phase includes a cross-tenant isolation check against it.

Credentials live in `.env.test` (gitignored). See `MOCK_DATA_BOOK.md`.

> **Safety:** `qa-seed.mjs` and the Playwright `global-setup.ts` both refuse to run unless
> the target is a recognised QA tenant. They never issue an unscoped delete or update.

---

## Ground rules

1. **Never invent test data.** If it isn't in `MOCK_DATA_BOOK.md`, don't type it. Consistent
   data is what makes a failure reproducible.
2. **Trust the database, not the UI.**
3. **A FAIL without evidence gets sent back.** Actual Result + Console Error + Screenshot.
4. **Test negative cases with the same care as positive ones.** The bugs that hurt hospitals
   live in the paths nobody tries.
5. **Don't fix as you test.** Log it, finish the scenario, fix in a batch. Mid-run fixes
   invalidate everything you tested before them.
