---
name: module-scaffold
description: Use when adding a whole new HMS module or a new top-level route/screen to the app — registering it in the module catalogue, wiring the route and role guard, adding it to the sidebar and module launcher, declaring its tabs and gated actions, and hooking it into entitlement gating. Covers the six places a module must be registered and what silently breaks when one is missed.
---

# Scaffolding a module

A module is not a component — it is an entry in six registries. Miss one and the failure is silent:
the screen exists but nobody can reach it, or it ships enabled to hospitals that never bought it.

Reference implementation: `src/pages/opd/` + `src/components/opd/`.

## The registration chain

Work in this order. Each step depends on the previous.

### 1. `ALL_MODULES` in [modules.ts](../../../src/lib/modules.ts) — start here

```typescript
{ name: "Day Care Unit",
  desc: "Same-day procedures & day care admissions",
  icon: "🩺",
  route: "/ipd/day-care",
  category: "Clinical",
  roles: ["doctor", "nurse", "receptionist", "super_admin"],
  isNew: true },
```

This single entry drives the module launcher, the category grouping and colour, **and**
`ROUTE_ROLES` — which is *derived* by iterating `ALL_MODULES`, not hand-maintained:

```typescript
ALL_MODULES.forEach(m => { ROUTE_ROLES[m.route.split('?')[0]] = m.roles; });
```

So do **not** hand-add a plain route to `ROUTE_ROLES`. Set `roles` here and it appears
automatically. `routeRoles.ts` only carries explicit *overrides* after that loop — add one there
only when the guard must differ from the launcher entry (as `/settings`, `/billing`, `/lab` do).

`category` must be one of the ten `ModuleCategory` values; `CATEGORY_COLORS` has no fallback.

### 2. `ROUTE_TO_MODULE_KEY` in [moduleKeys.ts](../../../src/lib/moduleKeys.ts)

```typescript
"/ipd/day-care": "day_care",
```

Then add the key to `CANONICAL_MODULE_KEYS`.

**This is what makes the module gateable.** `isModuleKeyAllowed` treats a key *not* in
`CANONICAL_MODULE_KEYS` as untracked and therefore **allowed for everyone** — so a module you forget
to register here ships to every hospital regardless of plan. See
[platform-control-plane](../platform-control-plane/SKILL.md).

Keep `moduleKeys.ts` a **leaf**: pure data, zero imports. It was extracted precisely to break the
cycle `HospitalContext → moduleRegistry → useSubscriptionConfig → useHospitalId → HospitalContext`.
Adding an import here reintroduces it.

### 3. `MODULE_TABS` / `MODULE_ACTIONS` in [tabPermissions.ts](../../../src/lib/tabPermissions.ts)

Declare every tab and every gated action. A gate keyed on an undeclared name resolves to "not
allowed", so the control silently never renders — which reads as a missing feature, not a
misconfiguration.

### 4. The route in `App.tsx`

Lazy import, route wrapped in `RoleGuard`. Match the surrounding entries exactly.

### 5. Sidebar / navigation

The 1-2-3 Click law is not satisfied by a component that exists but is unreachable. Any action must
be within three clicks of the dashboard.

### 6. Migrations for new tables

Follow [supabase-migration](../supabase-migration/SKILL.md): `hospital_id`, RLS enabled, isolation
policy with both `USING` and `WITH CHECK`, `*_by` columns to `public.users(id)`, audit trigger on
PHI tables.

## Then build the screens

Page shell owns containment (`h-full overflow-hidden flex flex-col`), tabs scroll
(`p-4 overflow-auto`). Reuse `StatusBadge`, `EntityList`, `LoadingSpinner`, `EmptyState`. Every
screen ships loading, error, and empty states.

Details in [react-component](../react-component/SKILL.md); query discipline in
[multi-tenant-data-access](../multi-tenant-data-access/SKILL.md).

For a controlled `<Tabs>` whose current tab may be hidden by entitlement, use
`useDefaultVisibleTab(moduleKey, tabDefs, current)` rather than defaulting to `tabs[0]`.

## Domain rules still apply

- Clinical module → [clinical-compliance](../clinical-compliance/SKILL.md): NABH evidence, consent,
  drug safety, NEWS2, immediate alerts.
- Anything charging money → [billing-and-gst](../billing-and-gst/SKILL.md): `postCharge`, never a
  direct `bill_line_items` insert.
- Server-side work → [edge-function](../edge-function/SKILL.md).
- Printed output → [print-and-export](../print-and-export/SKILL.md).

`MODULE_DEPARTMENT` in `modules.ts` and `moduleDepartments.ts` map modules to hospital departments —
register the link if the module belongs to one, or department-scoped views will not see it.

## Before you call it done

```bash
npm run lint
npm run check:rls-coverage
npm run check:user-fk
npm run check:db-contract
```

Then load the route at `localhost:8080` and confirm it renders — the registries are only half the
work, and a missing lazy import fails at runtime, not at build.

## Registration checklist

- [ ] `ALL_MODULES` entry with valid `category` and correct `roles`
- [ ] `ROUTE_TO_MODULE_KEY` + `CANONICAL_MODULE_KEYS` — **without this the module is ungated**
- [ ] `ROUTE_ROLES` override only if the guard must differ from `ALL_MODULES.roles`
- [ ] `MODULE_TABS` / `MODULE_ACTIONS` declared for every tab and gated action
- [ ] Lazy import + `RoleGuard` route in `App.tsx`
- [ ] Sidebar entry; reachable in ≤ 3 clicks
- [ ] Migrations: `hospital_id`, RLS, isolation policy, `_by` FKs, audit triggers
- [ ] `moduleKeys.ts` still import-free
- [ ] Department link registered if applicable
- [ ] Route renders in the running app
