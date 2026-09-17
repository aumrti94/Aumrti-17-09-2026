# React patterns — detail

## Layout: where containment lives

Zero Scroll is enforced at two different levels, and copying the wrong one is the usual mistake.

**Page shell** — owns containment, never scrolls:

```tsx
<div className="h-full overflow-hidden flex flex-col">
  <header className="shrink-0 …">…</header>
  <Tabs className="flex-1 min-h-0">…</Tabs>
</div>
```

`min-h-0` on the flex child is load-bearing. Without it a flex item refuses to shrink below its
content height and the inner `overflow-auto` never engages — the page grows a scrollbar instead.

**Tab / panel** — the level that is allowed to scroll:

```tsx
<div className="p-4 overflow-auto">…</div>
```

**Grid of cards:** `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3`. Tablet-first — `md:` is
the primary target (768px), not a desktop afterthought.

## Create/edit dialog

The house pattern is a shadcn `Dialog` holding one `form` state object, with a `saving` flag that
disables the submit button. From [FleetTab.tsx](../../../../src/components/ambulance/FleetTab.tsx):

```tsx
const [showForm, setShowForm] = useState(false);
const [saving, setSaving] = useState(false);
const [form, setForm] = useState({ vehicle_no: "", vehicle_type: "bls" });

const save = async () => {
  if (!form.vehicle_no || !hospitalId) {
    toast({ title: "Vehicle number is required", variant: "destructive" });
    return;
  }
  setSaving(true);
  const { error } = await (supabase as any).from("ambulance_vehicles").insert({
    hospital_id: hospitalId,          // ALWAYS stamp the tenant
    created_by: userId,               // public.users.id, never the auth uid
    vehicle_no: form.vehicle_no.trim().toUpperCase(),
  });
  if (error) {
    toast({ title: "Save failed", description: error.message, variant: "destructive" });
  } else {
    toast({ title: "Vehicle added" });
    setShowForm(false);
    setForm({ vehicle_no: "", vehicle_type: "bls" });
    load();                            // refetch, don't hand-patch local state
  }
  setSaving(false);
};
```

Points that generalise:

- Validate before the round trip; surface the failure as a `destructive` toast.
- Stamp `hospital_id` on **every** insert. RLS will reject a missing one, but the resulting error
  is opaque — stamping it explicitly is what makes the failure legible.
- Refetch after mutate rather than splicing local state. Cheap here, and it keeps derived
  server-side fields (numbers, statuses, totals) truthful.
- Empty optional text fields go in as `null`, not `""`.

## Toast

```tsx
import { useToast } from "@/hooks/use-toast";
const { toast } = useToast();

toast({ title: "Saved" });
toast({ title: "Save failed", description: error.message, variant: "destructive" });
```

Only two variants exist: default and `destructive`.

Never put PHI in a toast description that also gets logged, and never surface a raw Postgres error
to a clinical user where a plain sentence would do — `@/lib/errorMessage` has the mapping helper.

## Permission gating

All gates route through one surface so the plan → hospital → role composition stays in one place:

```tsx
import { useModuleAccess } from "@/components/access/useModuleAccess";

const { tabAllowed, actionAllowed } = useModuleAccess();

{actionAllowed("oncology", "book_chemo") && <Button>Book Chemo</Button>}
```

Tabs and actions are declared in `MODULE_TABS` / `MODULE_ACTIONS` in
[tabPermissions.ts](../../../../src/lib/tabPermissions.ts). A new tab or gated button needs an entry
there — a gate keyed on a name that isn't declared resolves to "not allowed" and the control simply
never appears.

For a controlled `<Tabs>` whose current tab may be hidden by entitlement, use
`useDefaultVisibleTab(moduleKey, tabDefs, current)` rather than defaulting to `tabs[0]`.

Permission gating is a UX affordance, not a security boundary. The boundary is RLS. Never rely on a
hidden button to protect data.

## Realtime

`useRealtimeRefetch` (see [src/hooks/useRealtimeRefetch.ts](../../../../src/hooks/useRealtimeRefetch.ts))
subscribes to table changes and re-runs your loader. Worth it for queues and boards that several
stations watch at once — OPD queue, IPD beds, lab worklist. Not worth it for settings screens.

## Formatting

```tsx
import { formatCurrency } from "@/lib/currency";        // alias of formatINR
import { formatDateIST, formatDateTimeIST } from "@/lib/dateUtils";

formatCurrency(1234.5)        // ₹1,234.50
formatDateIST(row.created_at) // DD/MM/YYYY, en-IN
```

Other currency helpers when you need them: `formatINRExact`, `formatINRPrecise`,
`formatINRCompact` (for dashboard tiles), `calcGST`, `calcLineTotal`, `roundCurrency`.

Never display a raw number for money, and never show an ISO timestamp to a user.

Indian English throughout, in UI strings as well as identifiers: Anaesthesia, Gynaecology,
Paediatrics, finalised, immunisation.

## Checklist

- [ ] `const { hospitalId } = useHospitalId()` — destructured, and guarded before querying
- [ ] `.eq("hospital_id", hospitalId)` on every query; `hospital_id` stamped on every insert
- [ ] `error` destructured and handled on every supabase call
- [ ] `.maybeSingle()`, never `.single()`
- [ ] Loading, error, and empty states all present
- [ ] Status rendered via `StatusBadge`
- [ ] Money via `formatCurrency`, dates via `formatDateIST`
- [ ] Clinical/financial labels ≥ 14px
- [ ] Containment matches the level (page shell vs tab)
- [ ] Reachable in ≤ 3 clicks — route and nav entry added
- [ ] `npm run lint && npm run check:db-contract`