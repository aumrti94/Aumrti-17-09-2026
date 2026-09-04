# Aumrti HMS

Multi-tenant Hospital Management System for Indian hospitals. React + TypeScript + Vite frontend,
Supabase (Postgres + RLS + Auth + Edge Functions) backend. One deployment serves many hospitals;
tenant isolation is enforced at the database layer via Row-Level Security keyed on `hospital_id`.
See [README.md](README.md) for the product overview, stack, and command surface.

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

- New `src/lib/**` logic needs a unit test in the same PR. Coverage there is a ratchet — it can
  only go up (see [vitest.config.ts](vitest.config.ts)).
- `drugSafetyCheck`, `clinicalCalculators`, and `gstRules`/billing totals are patient-safety and
  revenue surfaces — they carry the highest coverage bar in the repo and a change to them without
  a test is not mergeable.
- Multi-tenant isolation claims need an automated two-hospital test, never a manual check alone.

## The agent system

Requests get routed to a **pod**, not handled directly. Say what you want in plain English —
naming a module or a person's name (e.g. `@priya`, `@meera`) is optional, not required.

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
