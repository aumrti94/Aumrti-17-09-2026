---
name: multi-tenant-data-access
description: Use whenever writing or reviewing a Supabase query — any .from(), .rpc(), .select(), .insert(), .update(), or .delete() in src/ or supabase/functions/. Covers tenant scoping on every query, why .single() is banned, how Supabase returns errors as values rather than throwing, the (supabase as any) cast, and the check:db-contract gate that catches names that do not exist.
---

# Multi-tenant data access

One deployment serves many hospitals. Isolation is enforced by RLS keyed on `hospital_id` — but RLS
is the backstop, not the query. Four failure modes account for nearly every data bug in this
codebase's history, and all four are invisible at review time.

## 1. Supabase returns errors as values

`await supabase.from(...)` does **not** throw on failure. It resolves to `{ data: null, error }`.
So this compiles, passes review, and fails silently forever:

```typescript
// WRONG — error dropped on the floor
const { data } = await supabase.from("bills").select("*").eq("hospital_id", hospitalId);
setBills(data || []);          // empty list on failure looks exactly like "no bills today"
```

```typescript
// RIGHT
const { data, error } = await supabase.from("bills").select("*").eq("hospital_id", hospitalId);
if (error) {
  toast({ title: "Could not load bills", description: error.message, variant: "destructive" });
}
setBills(data ?? []);
```

Plenty of existing code omits the error check. Don't propagate that half of the pattern — a nurse
station cannot tell "query failed" from "nothing today" when both render an empty panel.

## 2. Scope every query by hospital

```typescript
const { hospitalId } = useHospitalId();      // destructured — the hook returns an object
if (!hospitalId) return;                     // null while auth resolves

const { data, error } = await (supabase as any)
  .from("admissions")
  .select("*")
  .eq("hospital_id", hospitalId)             // ALWAYS, even though RLS also filters
  .eq("is_deleted", false);
```

- **Never hardcode a hospital id.** In the browser use `useHospitalId()`; outside a component use
  `getHospitalIdAsync()` from the same module; in an Edge Function derive it from the caller's JWT.
- **Stamp `hospital_id` on every insert.** RLS's `WITH CHECK` will reject a missing one, but the
  error is opaque; stamping it explicitly makes the failure legible.
- **`.eq("id", someId)` alone is not enough** for reads *or* writes. Add the tenant predicate — it
  is what makes an id guessed or leaked from elsewhere harmless.
- **Attribution columns** (`created_by`, `verified_by`, `discharged_by`, …) take `userId` from
  `useHospitalId()` — that is `public.users.id`. Never `supabase.auth.getUser().id`; the two
  diverged in migration `20260322111223`.

- **Looking a staff row up from an auth uid? Match on `auth_user_id`, never `id`:**

  ```typescript
  const { data } = await supabase
    .from("users").select("hospital_id")
    .eq("auth_user_id", user.id)     // NOT .eq("id", user.id)
    .maybeSingle();
  ```

  Same divergence, other direction — and it fails *silently*, returning no row. Eight sites had
  this and simply 404'd or loaded with no hospital for every account created after the migration.
  In an Edge Function, `_shared/asr-metering.ts` exports `resolveHospitalFromJwt(req, sb)`, which
  already does it correctly; prefer it over hand-rolling the lookup. `check:user-fk` guards the
  schema FKs, **not** this query predicate — nothing catches it automatically.

**In Edge Functions this matters far more**, because `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS
entirely. There, the `.eq("hospital_id", …)` filter is the *only* isolation. See
[edge-function](../edge-function/SKILL.md).

## 3. Never `.single()`

`.single()` errors when the result is not exactly one row. Since errors come back as values, that
error is usually never inspected — so a missing row becomes `data: null` and the caller proceeds as
if the record simply had no fields.

```typescript
const { data: patient, error } = await supabase
  .from("patients").select("*").eq("id", patientId).eq("hospital_id", hospitalId)
  .maybeSingle();

if (error) { /* real failure */ return; }
if (!patient) { /* legitimately absent — handle it */ return; }
```

`.maybeSingle()` plus an explicit null check, every time. **There are now zero `.single()` calls in
the codebase** — the last 41 were converted, including the `.select().single()` form after an
insert. Adding one back is a regression, not a style choice.

## 4. Names must resolve — `check:db-contract`

`npm run check:db-contract` compares every `.from()` and `.rpc()` identifier against the generated
`types.ts`. It exists because twenty `.from()` calls and six `.rpc()` calls once named objects that
did not exist, and survived review because the errors were never inspected. What that cost:

- Payroll wrote GL lines to `journal_entry_lines` (real table: `journal_line_items`) and reported
  success — **payroll never reached the ledger at all**.
- The sepsis 4-hour de-duplication guard read a table that did not exist, so it suppressed nothing
  and duplicate critical alerts fired on every vitals entry.
- HCX claims were submitted with an empty item list, because `bill_items` is `bill_line_items`.

Two behaviours to know:

- A name in **no** `CREATE TABLE` anywhere → hard failure. That is a typo.
- A name that exists in a migration but not yet in `types.ts` → reported as **pending**, not fatal.
  That is why a migration and the code using it belong in the same change.

The scan covers `src`, `supabase/functions`, `e2e`, and `scripts`.

## `(supabase as any)`

2,308 occurrences. `types.ts` is generated and lags the live schema — it was missing 98 live tables
at one point — so strict typing on `.from()` fails for tables that genuinely exist.

Keep the cast; it is the house convention. But understand what it costs: it disables the compiler's
check on table names, column names, **and** the shape of what comes back. `check:db-contract`
recovers the table/RPC-name half. Nothing recovers the column half, so declare a local `interface`
for the row shape you expect rather than letting `any` spread through the component.

## Soft deletes

Nothing is hard-deleted. Tables carry `is_deleted` (or a status column), so most reads need
`.eq("is_deleted", false)` — omit it and cancelled admissions, voided bills, and retired beds
reappear in live lists.

## Verifying isolation

An isolation claim needs an **automated two-hospital test**: seed hospital A and hospital B, act as
A, assert B's rows are unreachable. A manual check in one tenant proves nothing — every bug listed
above passed manual testing in a single hospital.

## Before you call it done

```bash
npm run check:db-contract
npm run check:rls-coverage
npm run check:user-fk
```

## Checklist

- [ ] `error` destructured and handled on every call
- [ ] `.eq("hospital_id", hospitalId)` on every query; `hospital_id` stamped on every insert
- [ ] `hospitalId` destructured from the hook and guarded for null
- [ ] `.maybeSingle()` + null check — no `.single()`
- [ ] `*_by` columns written with `userId` (`public.users.id`)
- [ ] `.eq("is_deleted", false)` where the table soft-deletes
- [ ] Row shape declared as an interface, not left as `any`
- [ ] Service-role queries in Edge Functions filter `hospital_id` explicitly
- [ ] Isolation change covered by a two-hospital test