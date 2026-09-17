---
name: react-component
description: Use when creating or editing a React component, tab, page, modal, or screen in this repo. Covers the house data-fetching pattern, hospital scoping via useHospitalId, the shared primitives (StatusBadge, EntityList, LoadingSpinner, EmptyState) that must be reused instead of hand-rolled, and the Zero Scroll / 1-2-3 Click / Clarity design laws. Load before writing JSX, not after.
---

# React components in Aumrti

Exemplar to copy from: [FleetTab.tsx](../../../src/components/ambulance/FleetTab.tsx) — a complete
list + create-dialog tab in 149 lines.

## The five things that are wrong most often

1. `useHospitalId()` returns an **object**, not a string. Destructure it.
2. Toast comes from `@/hooks/use-toast`, not `@/components/ui/use-toast`.
3. Supabase returns errors as *values*. An unchecked `const { data } = await ...` fails silently.
4. Status is rendered with `<StatusBadge>`, never a bare string.
5. Imports use **double quotes** — the repo is 5884:34 on this.

## Hospital scoping

```typescript
import { useHospitalId } from "@/hooks/useHospitalId";

const { hospitalId } = useHospitalId();   // NOT: const hospitalId = useHospitalId()
```

`useHospitalId()` is a thin alias for `useHospitalContext()` and returns
`{ hospitalId, userId, role, permissions, fullName, loading }` — all nullable while auth resolves.
Both hook names are used in the codebase; prefer `useHospitalId` in new module code and
`useHospitalContext` when you also need `permissions` or `role`.

Always guard before querying — on first render `hospitalId` is `null`, and a query without it
either returns another tenant's rows or none at all:

```typescript
if (!hospitalId) return;
```

`userId` is the `public.users.id` staff row, and it is what belongs in any `*_by` attribution
column. Never write `supabase.auth.getUser().id` there — see [supabase-migration](../supabase-migration/SKILL.md).

## Data fetching — the house pattern

`useEffect` + `useCallback` + raw supabase is the dominant pattern (538 files vs 76 using React
Query). Use it for module-local data. Reach for React Query only when the same data is shared
across distant components and genuinely benefits from a cache.

```typescript
const { hospitalId } = useHospitalId();
const { toast } = useToast();
const [rows, setRows] = useState<Vehicle[]>([]);
const [loading, setLoading] = useState(true);

const load = useCallback(async () => {
  if (!hospitalId) return;
  setLoading(true);
  const { data, error } = await (supabase as any)
    .from("ambulance_vehicles")
    .select("*")
    .eq("hospital_id", hospitalId)
    .eq("is_deleted", false)
    .order("vehicle_no");
  if (error) {
    toast({ title: "Could not load fleet", description: error.message, variant: "destructive" });
  }
  setRows(data ?? []);
  setLoading(false);
}, [hospitalId, toast]);

useEffect(() => { load(); }, [load]);
```

Non-negotiable in that block:

- **`.eq("hospital_id", hospitalId)` on every query.** RLS is the backstop, not the filter.
- **Destructure and check `error`.** Much of the existing code writes `const { data } = await ...`
  and drops the error on the floor. Do not copy that half — it is the silent-failure class the
  `check:db-contract` gate exists to catch.
- **Never `.single()`.** Use `.maybeSingle()` and null-check. The codebase is now at zero
  `.single()` calls — adding one is a regression.
- `(supabase as any)` is the house cast — `types.ts` lags the live schema, so strict typing on
  `.from()` fails for many real tables. Keep the cast, but the table name still must resolve, or
  `npm run check:db-contract` fails.

## Reuse these — do not rebuild them

| Need | Use | Import |
|---|---|---|
| Any status/state pill | `StatusBadge` | `@/components/shared` |
| Search + add + table list | `EntityList` | `@/components/shared` |
| Spinner | `LoadingSpinner` | `@/components/LoadingSpinner` (default export) |
| Zero-results panel | `EmptyState` | `@/components/EmptyState` (default export) |
| Crash containment | `ErrorBoundary` | `@/components/ErrorBoundary` |
| Money | `formatCurrency` / `formatINR` | `@/lib/currency` |
| Dates | `formatDateIST`, `formatDateTimeIST` | `@/lib/dateUtils` |

`StatusBadge` already knows ~50 statuses across OPD, lab, pathology, IPD, billing, priority and
insurance. If yours is missing, **add it to `STATUS_CONFIG`** rather than styling a `<span>` locally
— an unknown status silently falls back to grey, which is how "sample collected" and "validated"
once looked identical to a doctor scanning a list.

Everything in `@/components/ui/*` is shadcn — use it rather than raw HTML controls, with the
exception of `<select>`, which the codebase still writes natively in dense forms.

## The three design laws

**Zero Scroll** — the screen fits `100vh`; no page-level scrollbar.
Page shells own containment (`h-full overflow-hidden`); an inner tab or panel is where scrolling is
allowed (`p-4 overflow-auto`). Copy the level you are writing at — putting `overflow-hidden` on a
tab clips its content, and putting `overflow-auto` on a page shell breaks the law.

**1-2-3 Click** — any action reachable within 3 clicks of the dashboard. A new screen needs a route
and a nav entry, not just a component.

**Clarity** — 14px minimum (`text-[14px]` / `text-sm`) for any label carrying clinical or financial
meaning. Chrome — tab headers, helper text, table meta — uses `text-xs`, and that is fine. A drug
name, dose, result value, or amount is not chrome. Tablet-first at the 768px breakpoint: the device
at a nurse station is a tablet, so `md:` is the primary target, not an afterthought.

## Every screen ships with

Loading, error, and empty states. All three, every time — a nurse station cannot distinguish
"still loading", "query failed", and "genuinely nothing today" from an identical blank panel.

## Before you call it done

```bash
npm run lint
npm run check:db-contract    # every .from()/.rpc() name must resolve
```

Detailed layout recipes, form/dialog conventions, and the permission-gating pattern:
[references/patterns.md](references/patterns.md).