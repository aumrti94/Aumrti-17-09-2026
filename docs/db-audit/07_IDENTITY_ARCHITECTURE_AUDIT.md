# 07 — IDENTITY ARCHITECTURE AUDIT

All figures read from the live database on 2026-08-18. Aggregates only — no personal data was
selected.

## The canonical model, as actually implemented

`public.users` is the business identity. `auth.users` (Supabase GoTrue) is the credential store.
They are joined by `public.users.auth_user_id → auth.users.id`.

```sql
-- live definition, pg_proc
CREATE OR REPLACE FUNCTION public.get_user_hospital_id()
 RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT hospital_id FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1 $$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT EXISTS (SELECT 1 FROM public.users WHERE auth_user_id = _user_id AND role = _role::text) $$;

CREATE OR REPLACE FUNCTION public.is_aumrti_admin()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT EXISTS (SELECT 1 FROM public.aumrti_admins WHERE auth_user_id = auth.uid() AND is_active = true) $$;

`users.hospital_id` columns: id, hospital_id, branch_id, full_name, email, phone, role,
department_id, employee_id, is_active, last_login, created_at, registration_number,
auth_user_id, hpr_id, hpr_verified_at, mfa_required, can_login, designation
```

All three helpers are `STABLE SECURITY DEFINER` with a pinned `search_path` — correct, and the
right pattern for avoiding RLS recursion. **The core identity design is sound.** Tenancy is
one hospital per user, resolved through a single function used by essentially every policy.

Platform-level (cross-tenant) identity is a separate table, `aumrti_admins` (1 row, active),
which is the correct separation — platform staff are not hospital staff.

Role is a plain `text` column on `users`, compared against the `app_role` enum by cast inside
`has_role`. There is **no** `user_roles` junction table, no `roles` table, and no `permissions`
table; `role_permissions` exists but `users.role` is single-valued. One role per user.

## Finding I-1 · Two identity targets coexist — 46 tables vs 286

| FK target | Foreign keys | Distinct tables |
|---|---|---|
| `auth.users` | 53 | **46** |
| `public.users` | 338 | **286** |

Any column pointing at `auth.users` cannot be resolved to a hospital, a name, a role, or an
employee number without a second hop through `public.users`. Any column pointing at
`public.users` cannot be compared to `auth.uid()` without that same hop. Both conventions are
live, and which one a given table uses is not predictable from its domain — evidence of
independent generation sessions choosing differently.

`public.users` is the correct canonical target: it is the one the RLS helpers resolve through,
it is used by 86% of actor FKs, and it carries the tenant column. The 46 `auth.users` referrers
are the drift.

**Recommendation:** freeze `public.users` as canonical. Do not migrate the 46 tables wholesale —
they work today. Require new columns to reference `public.users(id)`, and convert the 46 only
where a query already performs the second hop.

## Finding I-2 · The "update own profile" policy can never match a row

```
users."Users can update own profile" [UPDATE] roles={authenticated}
    USING      : (id = auth.uid())
    WITH CHECK : (id = auth.uid())
```

`users.id` is the business primary key; the auth linkage is `users.auth_user_id`. Live check
across all 38 rows:

| | rows |
|---|---|
| `id = auth_user_id` | **0** |
| `id <> auth_user_id` | 28 |
| `auth_user_id IS NULL` | 10 |

The predicate is false for every row that exists. The policy grants nothing.

Self-service profile update is not actually broken, because the sibling policy
`"Admins can manage users" [ALL] USING (hospital_id = get_user_hospital_id())` is permissive and
lets any user in the hospital update any user row in that hospital — which is a *separate*
problem: that policy is named "Admins can manage users" but performs **no role check at all**.
A receptionist can modify a doctor's `role`, `can_login`, or `mfa_required`.

This is the same defect shape as C-01: the policy name states the intent, the body omits it.

**Recommendation:** correct the dead policy to `auth_user_id = auth.uid()`, and add
`has_role(auth.uid(), 'hospital_admin')` to the management policy.

## Finding I-3 · 17 identities cannot resolve to a tenant

| Check | Result |
|---|---|
| `public.users` rows | 38 |
| `auth.users` rows | 35 |
| `public.users` with `auth_user_id IS NULL` | **10** |
| `auth.users` with no matching `public.users` row | **7** |
| `public.users` with a dangling `auth_user_id` | 0 |
| `auth_user_id` values appearing in >1 `users` row | 0 |
| distinct hospitals represented | 6 |
| `users.hospital_id IS NULL` | 0 |

For all 17, `get_user_hospital_id()` returns `NULL`. `hospital_id = NULL` is `NULL`, never true,
so every tenant policy denies. Those accounts authenticate successfully and then see a
functioning but completely empty application, with no error to explain why.

The 10 NULL-linkage rows are most likely staff created as business records before a login was
provisioned (`create-staff-login` / `admin-set-staff-password` edge functions exist for exactly
that flow). The 7 orphaned auth identities are the more troubling direction — a credential with
no business record.

There is **no database constraint preventing either state**: `users.auth_user_id` is nullable and
carries no `NOT NULL`, and nothing enforces that an `auth.users` row acquires a `public.users`
row. This is the identity-layer instance of the general pattern in
[`15_AI_UNDER_ENGINEERING_FINDINGS.md`](15_AI_UNDER_ENGINEERING_FINDINGS.md).

**Recommendation:** add a scheduled reconciliation check (not a blocking constraint — the
provisioning flow legitimately creates the business row first), and surface "account not linked to
a hospital" in the UI rather than rendering an empty app.

## Finding I-4 · `app_role` ships duplicate role values

```
app_role = { super_admin, hospital_admin, doctor, nurse, receptionist, pharmacist,
             lab_tech, accountant, billing_executive, hr_manager, lab_technician,
             radiologist, cfo, billing_staff, mrd_officer, insurance_executive }
```

`lab_tech` and `lab_technician` are the same role. `billing_executive` and `billing_staff` are
the same role. Enum values can only be appended in PostgreSQL, so this is the fossil record of
two sessions naming one concept differently — and the values were appended rather than
reconciled.

Consequence: `has_role(uid, 'lab_tech')` and `has_role(uid, 'lab_technician')` return different
answers for the same person. Any policy or UI guard checking one misses users assigned the other.

**Recommendation:** determine which value is in use (`SELECT role, count(*) FROM users GROUP BY 1`),
standardise the data, and leave the orphaned enum labels in place — dropping enum values requires
a type rewrite and is not worth the risk. Add a CHECK or application-level guard restricting new
assignments to the canonical set.

## Finding I-5 · Role is a `text` column compared against an enum

`users.role` is `text`; `app_role` is an enum; `has_role` bridges them with `role = _role::text`.
Nothing constrains `users.role` to the enum's values — an arbitrary string can be stored, and it
will simply never match any `has_role` check, failing closed.

Failing closed is the safe direction, so this is **LOW** severity. It is recorded because it means
the enum provides documentation, not enforcement.

**Recommendation:** add `CHECK (role IN (...))` or convert the column to `app_role`. Low priority.

## Summary

| # | Finding | Severity |
|---|---|---|
| I-1 | Dual identity targets: 46 tables → `auth.users`, 286 → `public.users` | HIGH |
| I-2 | `USING (id = auth.uid())` matches 0 rows; management policy has no role check | HIGH |
| I-3 | 10 users unlinked + 7 orphaned auth identities, unconstrained | MEDIUM |
| I-4 | `app_role` contains two duplicate role pairs | MEDIUM |
| I-5 | `users.role` is unconstrained `text` | LOW |

**What is correct and should not be changed:** the `get_user_hospital_id` / `has_role` /
`is_aumrti_admin` helper design; the `SECURITY DEFINER` + pinned `search_path` pattern; the
separation of `aumrti_admins` from `users`; one-hospital-per-user as the tenant rule.
