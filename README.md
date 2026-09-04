# Aumrti HMS

Aumrti is an AI-first Hospital Management System for Indian hospitals, built as a single
multi-tenant application: one deployment serves many hospitals, with data isolated per hospital
at the database level (Row-Level Security keyed on `hospital_id`).

It covers the operational surface of running a hospital — outpatient and inpatient care,
emergency, OT, nursing, lab and radiology, pharmacy, billing and GST, insurance/TPA, HR and
payroll, and NABH/ABDM regulatory compliance — as **61 billable modules** behind a single
subscription-gated web app, plus a companion mobile app in [mobile/](mobile/).

Numbers below are generated from the codebase itself (`npm run docs:facts`), not hand-typed —
see [docs/product/FACT_BASE.md](docs/product/FACT_BASE.md) for the sourcing rule behind each one.

## What's in the app

| Category | Tiles | Examples |
|---|---|---|
| Clinical | 13 | OPD, IPD/Wards, Emergency, OT, Nursing, Telemedicine, Home Care |
| Diagnostics | 2 | Laboratory (LIS), Radiology (RIS) |
| Surgical | 2 | Blood Bank, CSSD |
| Pharmacy | 2 | Inpatient dispensing (NDPS), Retail POS |
| Finance | 9 | Billing, GST, Accounts, Insurance/TPA |
| Operations | 15 | Inventory, HR/Payroll, Scheduling, Facility |
| Specialized | 13 | ABDM, Quality/NABH, CRM, LMS |
| Patient | 3 | Patient portal-facing features |
| Analytics | 7 | BI dashboards, HMIS reporting |
| Settings | 1 | Hospital configuration |

Full module-by-module breakdown, routes, and billing keys: [docs/product/MODULE_CATALOGUE.md](docs/product/MODULE_CATALOGUE.md).

## Stack

- **Frontend:** React 18 + TypeScript + Vite, shadcn/ui (Radix primitives) + Tailwind CSS
- **Data & auth:** Supabase (Postgres + Row-Level Security + Auth + Edge Functions on Deno)
- **State/data-fetching:** TanStack Query
- **Testing:** Vitest (unit) + Playwright (end-to-end)
- **Mobile:** React Native (Expo) in [mobile/](mobile/)

## Getting started

Requires Node `^20.19.0 || >=22.12.0`.

```bash
npm install
cp .env.example .env.local   # fill in your Supabase project's URL + anon key
npm run dev                  # http://localhost:8080
```

`.env.local` is git-ignored — never commit it. It also needs `SUPABASE_DB_PASSWORD` and
`SUPABASE_SERVICE_ROLE_KEY` for local migration/admin scripts; get both from your Supabase
project's dashboard, not from anyone else's copy of this file.

To stand up a database schema and push migrations, follow
[supabase/MIGRATION_RUNBOOK.md](supabase/MIGRATION_RUNBOOK.md) — `supabase link`,
`supabase db push`, and edge function deploys.

For the full first-time setup — creating a test hospital and admin user, configuring the auth
email provider, and SMTP for production email — see [docs/SETUP_GUIDE.md](docs/SETUP_GUIDE.md).

## Everyday commands

```bash
npm run dev                # start the dev server
npm run build               # production build
npm run lint                 # ESLint

npm run test                # unit tests (Vitest)
npm run test:watch           # unit tests, watch mode
npm run test:coverage        # unit tests with coverage report

npm run test:e2e             # full Playwright suite
npm run test:e2e:ui          # Playwright UI mode
npm run qa:phase1            # run one QA phase only (phase1..phase5)
npm run qa:tracker           # rebuild docs/qa/tracker/AUMRTI_QA_TRACKER.xlsx from results

npm run check:rls-coverage   # every table has a Row-Level Security policy
npm run check:lib-test-coverage  # every src/lib file has a test, is exempt, or is a tracked gap
npm run check:user-fk        # *_by columns FK public.users, not auth.users
npm run check:db-contract    # every .from()/.rpc() call matches the generated schema
npm run check:openapi        # published API docs match the route registry
```

All of these run in CI on every PR — see [.github/workflows/ci.yml](.github/workflows/ci.yml) and
[.github/workflows/qa-e2e.yml](.github/workflows/qa-e2e.yml).

## Project layout

```
src/
  pages/          route-level screens (225 components)
  components/     feature components, grouped by module (589 components)
  lib/            pure business logic — billing, GST, drug safety, clinical calculators
  hooks/          data-fetching and shared UI state
  contexts/       app-wide React context providers
  integrations/   generated Supabase client + types (do not hand-edit)
  test/           Vitest setup + shared test utilities
supabase/
  migrations/     schema history, applied in filename order
  functions/      Edge Functions (Deno), one directory per function
  tests/          pgTAP database tests
e2e/
  phase-NN-*/     Playwright specs, grouped by product area
  fixtures/       shared login/session fixtures and mock data
  reporters/      custom reporter that feeds the QA tracker workbook
docs/
  product/        generated fact base + module catalogue (source of truth for numbers)
  qa/             QA scenarios, mock data book, phase map, tracker
  api/            generated OpenAPI spec
mobile/           React Native (Expo) companion app
.claude/          Claude Code agent/skill/command configuration for this repo
```

## Rules the codebase enforces

These are structural, not stylistic — CI fails without them:

- **Tenant isolation:** every table gets a Row-Level Security policy keyed on `hospital_id`;
  never hardcode a hospital ID in application code, always read it via `useHospitalId()`.
- **Supabase queries:** use `.maybeSingle()`, never `.single()` — Supabase errors are returned as
  values, not thrown, so an unexpected empty result must be handled, not assumed away.
- **Staff-attribution columns** (`*_by`) FK to `public.users(id)`, never `auth.users(id)` —
  the two diverge for any account created after migration `20260322111223`.
- **Dates** display as `DD/MM/YYYY` via the `en-IN` locale; British/Indian English spelling
  throughout (Anaesthesia, Gynaecology, ...).

## Contributing

- Read [CLAUDE.md](CLAUDE.md) before making structural changes — it's the load-bearing rulebook
  for this repo (multi-tenancy, RLS, testing, and the module boundaries).
- New `src/lib` logic needs unit tests — coverage on that directory is enforced and ratchets up,
  never down (see [vitest.config.ts](vitest.config.ts)).
- New Playwright specs belong under the relevant `e2e/phase-NN-*/` directory, using that phase's
  existing fixtures/helpers rather than new ad-hoc ones.
