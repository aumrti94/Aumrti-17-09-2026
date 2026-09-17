# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Multi-tenant Hospital Management System for Indian hospitals. React + TypeScript + Vite frontend,
Supabase (Postgres + RLS + Auth + Edge Functions) backend. One deployment serves many hospitals;
tenant isolation is enforced at the database layer via Row-Level Security keyed on `hospital_id`.
See [README.md](README.md) for the product overview, module catalogue, and full stack breakdown.

## Commands

```bash
npm install
npm run dev                  # dev server, http://localhost:8080
npm run build                # production build (tsc + vite build)
npm run lint                 # ESLint over the whole repo — no per-file target

npm run check:rls-coverage   # every table has a Row-Level Security policy
npm run check:user-fk        # *_by columns FK public.users, not auth.users
npm run check:db-contract    # every .from()/.rpc() call matches the generated schema
npm run check:openapi        # published API docs match the route registry
npm run check:lab-catalog    # generated lab test catalogue is in sync

npm run supabase:link        # link local checkout to a Supabase project (needs .env.local)
npm run supabase:push        # apply pending migrations in supabase/migrations/
npm run supabase:deploy      # deploy Edge Functions in supabase/functions/
```

All `check:*` scripts and `lint`/`build` run in CI on every PR
([.github/workflows/ci.yml](.github/workflows/ci.yml)) — run the relevant one locally before
pushing a change that touches migrations, `.from()`/`.rpc()` calls, or `*_by` columns.

There is no unit or e2e test command right now — see **Testing** below before adding one back.
`supabase/tests/` has pgTAP database tests, run manually per
[supabase/MIGRATION_RUNBOOK.md](supabase/MIGRATION_RUNBOOK.md), not wired into `npm run`.

## Architecture

- **Routing (`src/App.tsx`):** every route is lazy-loaded and wrapped in `AuthGuard` →
  `RoleGuard(ROUTE_ROLES[route])` → `ModuleErrorBoundary`. Role lists live in
  `src/lib/routeRoles.ts`, not inline on the route.
- **Module catalogue (`src/lib/modules.ts`):** `ALL_MODULES` is the single source of truth for the
  67 billable module tiles — name, route, category, allowed roles. Registering a new module means
  touching it plus the route in `App.tsx`, the role list in `routeRoles.ts`, entitlement gating,
  and the sidebar/launcher — see the `module-scaffold` skill for the full checklist; missing one
  spot fails silently (module renders but isn't reachable, or is reachable but unbilled).
  Category colors (`CATEGORY_COLORS`) are the only place UI category color-coding is defined.
- **`src/integrations/supabase/`:** generated Supabase client and DB types — do not hand-edit;
  regenerate via the Supabase CLI after a migration.
  `src/lib/getHospitalId.ts` / `src/hooks/useHospitalId.ts` are the only sanctioned way to read the
  current tenant.
  `src/contexts/HospitalContext.tsx` provides it app-wide.
- **`src/lib/`:** all pure business logic (billing/GST math, drug safety, clinical calculators,
  payroll, entitlement resolution) lives here, decoupled from components — this is what
  `check:db-contract` and the future test ratchet both target.
- **Mobile app** in [mobile/](mobile/) is a separate React Native/Expo project, not built by Vite
  and excluded from the root ESLint React-Fast-Refresh rules.

## Working in this repo

This is patient-data software. The rules below are not style preferences — several map directly
to a CI check that fails the build, and the rest exist because a past incident or audit found the
alternative. Treat them as load-bearing.

### Multi-tenancy & data access

- Never hardcode a `hospital_id`. Always read it via the `useHospitalId()` hook.
- Never use Supabase's `.single()`. Use `.maybeSingle()` with an explicit null check — Supabase
  returns errors as values rather than throwing, so an unhandled empty result fails silently at
  runtime, not at review time.
- Every new table needs: a `hospital_id` column, `ENABLE ROW LEVEL SECURITY`, and an isolation
  policy. Enforced by `npm run check:rls-coverage` in CI.
- Staff-attribution columns (anything ending `_by`) must FK to `public.users(id)`, **never**
  `auth.users(id)` — the two diverge for every account created after migration
  `20260322111223`; an `auth.users` FK silently rejects writes from newer accounts. Enforced by
  `npm run check:user-fk`.
- Migration files must be idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE`). Never drop a table in
  a production migration — add a soft-delete column instead.
- PHI tables (patients, prescriptions, bills, ...) need audit triggers. No PHI in Supabase logs,
  Edge Function `console.log`, or error messages, ever.
- Every `.from()` / `.rpc()` call must resolve against the generated schema. Enforced by
  `npm run check:db-contract`.

### Clinical & compliance

- Log NABH evidence on clinical actions via `logNABHEvidence()` — never skip it.
- Drug interaction and allergy checks must be real. Never mock or skip them, including in demos.
- Clinical alerts surface immediately; they are never silenced or batched.
- Indian English spelling throughout: Anaesthesia, Gynaecology, etc. — not the US spelling.
- Dates display as `DD/MM/YYYY` via the `en-IN` locale. Money via `formatCurrency()` — never a
  raw number.

### UI

Three rules apply to every screen, no exceptions:

1. **Zero Scroll** — every screen fits `100vh`; no page-level scrollbar.
2. **1-2-3 Click** — any action is reachable in at most 3 clicks from the dashboard.
3. **Clarity** — 14px minimum for labels that carry clinical or financial meaning; status is
   always color-coded via the shared `StatusBadge` component, never a bare string.

Tablet-first (768px breakpoint), not mobile-first — the primary device at a nurse station is a
tablet.

### Testing

> **Current state (2026-09-05): the rules below are the target, not an enforced gate.** The test
> suite was removed on this date ("restarting testing from a clean slate") and has not yet been
> rebuilt. `vitest.config.ts` has no coverage thresholds, CI runs no tests, and there is no
> mechanism today that blocks a merge for missing coverage. Do not assert that a change "isn't
> mergeable" or that coverage "can only go up" — neither is currently true. See the README for
> what test infrastructure exists (`supabase/tests/`, pgTAP, run manually) and treat rebuilding
> this as its own piece of work, not something a cleanup pass restores incidentally.

- New `src/lib/**` logic should get a unit test in the same PR once the suite exists again.
  The intent is a ratchet — coverage only goes up — enforced via `vitest.config.ts` once its
  `coverage.include`/thresholds are restored.
- `drugSafetyCheck`, `clinicalCalculators`, and `gstRules`/billing totals are patient-safety and
  revenue surfaces and should carry the highest coverage bar in the repo when tests return.
- Multi-tenant isolation claims should be backed by an automated two-hospital test, never a
  manual check alone, once such a test exists.

## The agent system

Requests get routed to a **pod**, not handled directly. Say what you want in plain English —
naming a module or a person's name (e.g. `@priya`, `@meera`) is optional, not required.

### Leadership tier — say a name, get a team

Five leaders are invocable agents. They read the roster, decide who is needed, and activate those
pods themselves — in parallel. They hold `Task` but not `Edit`/`Write`/`Bash`: they assemble and
arbitrate, they do not write code.

| Say | Agent | Brings the team together for |
|---|---|---|
| "Nikhil, ..." | `nikhil-pm` | Building a feature — scoping, sequencing, assembling the delivery team |
| "Preethi, ..." | `preethi-ceo` | Priority, vision, build-vs-buy, arbitrating a cross-pod disagreement |
| "Vikram, ..." | `vikram-cto` | Architecture and infra spanning modules, vendors, scaling, control plane |
| "Kavitha, ..." | `kavitha-cfo` | Unit economics, pricing, any ₹ figure heading for a board |
| "Nalini, ..." | `nalini-cdo` | **Gate on every clinical-path AI feature**, prompt governance, SaMD |

> "Nikhil, please involve whoever is needed" → Nikhil decomposes the request into surfaces, looks
> each up in the roster, and spawns the owning pods concurrently — `data-pod` for Meera's schema,
> `security-pod` for Ananya's PHI review, `frontend-pod` for Kiran's design-law check — then
> synthesises what came back.

`conductor` remains available for pure routing with no persona attached.

### Where to look things up

- `.claude/agents/refs/_roster-index.md` — **all 79 specialists in one table**: name, handle, role,
  pod, which subagent reaches them, and the mandatory CC gates. Read this first when you know a
  name but not its owner.
- `.claude/agents/refs/_leadership-protocol.md` — how a leader decomposes a request, activates in
  parallel, and synthesises.
- `.claude/agents/refs/_team-coordination-rules.md` — per-pod activation maps, the **Convene
  Protocol** for multi-agent discussion, and the delegation depth limit.
- `.claude/agents/refs/_review-gates.md` — the escalation chain when two agents disagree.

Pods hold `Task` and may pull in a peer pod for a mandatory CC gate, one hop only. Delegation depth
is capped: `leader → pod → peer pod (review only) → stop`. A pod never calls a leadership agent.

| Pod | Owns | Agent file |
|---|---|---|
| `clinical` | Clinical & hospital-operations modules (OPD, IPD, Emergency, Lab, Radiology, Pharmacy, Blood Bank, CSSD, facility/biomedical/inventory ops...) | `.claude/agents/clinical-pod.md` |
| `revenue` | Billing, GST, insurance/TPA, accounts, payroll | `.claude/agents/revenue-pod.md` |
| `data` | Supabase schema, RLS, migrations, infra, AI platform/governance, analytics | `.claude/agents/data-pod.md` |
| `frontend` | React/UX, component work, localization, mobile, CRM/patient-engagement UI | `.claude/agents/frontend-pod.md` |
| `quality` | Vitest, Playwright, QA test-case authoring, performance, integration layer | `.claude/agents/quality-pod.md` |
| `security` | DPDP/PHI, ABDM/FHIR, statutory/regulatory, platform strategy | `.claude/agents/security-pod.md` |
| `platform` | SaaS control plane — tenancy, subscriptions, entitlements, growth/PLG, platform analytics | `.claude/agents/platform-pod.md` |
| `growth` | GTM, customer success, product/exec, partnerships, implementation, and the strategy advisory bench | `.claude/agents/growth-pod.md` |

Each pod file carries that pod's hard rules and a routing table to its specialists. The ~76
individual specialist personas (their original expertise, hard rules, and communication style)
live under `.claude/agents/refs/<pod>/<name>.md` — a pod reads its own refs on demand rather than
having all of them loaded at once. Nothing from the old `.agents/agents.md` was discarded; it was
split so routing decisions don't require holding 76 personas in context to make one.

The full historical activation map and cross-pod escalation chain are preserved verbatim in
`.claude/agents/refs/_team-coordination-rules.md` and `_review-gates.md`.
