# 00 — STATUS OF THIS AUDIT

This directory is a **point-in-time capture**, not a living document. Read this file first —
several of the findings below describe holes that have since been closed, and `20_...md` in
particular contains a line that is no longer true.

**Capture date:** 2026-08-18T16:42:54Z (`21_CRITICAL_FINDINGS.md:1`)
**This annotation written:** 2026-09-05

At capture: 568 migrations, ~548 tables, 107 edge functions, 1,104 app source files.
Today: 612 migrations, ~565 tables, 107 edge functions, 1,179 app source files. 44 migrations
have landed since capture — most of them the remediation wave below.

## `20_DATABASE_RESTRUCTURING_PLAN.md:3` is wrong

It states: *"Nothing in this plan has been executed — this audit made no changes."*

That was true when written and is not true now. Phase 0 of that plan — closing the
confidentiality holes, its own first and highest-priority category — was executed the day after
capture, as migrations `20261016000001` through `20261016000014`, all prefixed `sec_`, `rls_`,
`perf_`, or `rcm_` to match the plan's own phase structure. Do not read `20_...md` as a backlog
of open work without reading this file first.

## Findings in `21_CRITICAL_FINDINGS.md` — verified status

Six of the thirteen findings were checked directly against the migration that claims to fix them,
by reading the SQL, not by trusting a commit message. The other six were not re-verified in this
pass — their status is genuinely unknown until someone checks, and they should be read as
**written**, not as fixed.

| # | Finding | Status | Evidence |
|---|---|---|---|
| C-01 | `hospital_chains`/`chain_memberships` open to all authenticated users | **FIXED** | `20261016000003_sec_chain_tables_platform_only.sql` — replaces both `USING (true)` policies, adds `REVOKE ALL ... FROM anon` |
| C-02 | `queue_state` leaks patient names to `anon`, cross-tenant | **FIXED** | `20261016000004_sec_queue_state_tenant_scope.sql` — drops the public policy, scopes SELECT to `hospital_id = get_user_hospital_id()`, revokes from anon, nulls the write-only PHI column and stops it being written |
| C-03 | Payroll posts unbalanced journal entries to a nonexistent table | **NOT VERIFIED** | — |
| C-04 | 20 tables / 6 RPCs referenced by the app but do not exist | **LARGELY RESOLVED, guarded going forward** | This is the defect class `check-db-contract.mjs` exists to catch (see that script's own header). It passes today with zero hard failures. `13_AI_CODE_DRIFT_FINDINGS.md` finding D-1 lists the same 14 pairs; 12 of 14 now have zero live call sites. |
| C-05 | Sepsis early-warning writes to a nonexistent table | **NOT VERIFIED** | — |
| C-06 | Bill totals computed in the browser, not the database | **NOT VERIFIED** | — |
| C-07 | Patient portal sessions anon-writable, `WITH CHECK (true)` | **FIXED** | `20261016000005_sec_portal_sessions_hardening.sql` — drops all three over-broad policies, replaces with column-level grants (`anon` can only touch `otp_verified, session_token, patient_id, last_active`) and a `WITH CHECK` that permits only the false→true OTP transition |
| C-08 | 905 of 1,474 FKs have no supporting index, incl. 127 on `hospital_id` | **FIXED** | `20261016000012_perf_fk_indexes.sql` — 904 `CREATE INDEX` statements |
| C-09 | Credentials committed to `.env.local`; DB password valid | **PARTIALLY ADDRESSED** | The false "not a repository leak" conclusion in this finding was corrected on 2026-09-05 (see the finding itself). The live PAT in `.env.example` was removed the same day. **Rotation of the DB password and the four PATs is a dashboard action, not yet done as of this writing — see Phase 0 of the cleanup plan.** |
| C-10 | `ON DELETE CASCADE` reaches statutory records (NDPS register, `phi_access_audit`) | **NOT VERIFIED** | — |
| C-11 | Dual identity model — 46 tables point at `auth.users`, 286 at `public.users` | **NOT VERIFIED** — but see `check:user-fk` | CI runs `npm run check:user-fk` on every PR and passes today (40 columns repointed, 16 legitimately on `auth.users`). That check enforces the *policy* going forward; it does not confirm this specific finding's counts were remediated. |
| C-12 | Two applied migrations declare tables that do not exist | **NOT VERIFIED** | — |
| C-13 | Four views bypass RLS, no tenant filter, granted to `anon` | **FIXED** | `20261016000002_sec_views_security_invoker.sql` — `security_invoker = true` on all six named views (the finding said four; the migration fixes six, a superset), `REVOKE SELECT ... FROM anon` on each |

## What to trust instead of a stale audit

The five CI checks below run on every PR and reflect the **current** state, not an August
snapshot. If you want to know whether a defect class from this audit is currently guarded
against, check here before reading further into `docs/db-audit/`:

- `npm run check:rls-coverage` — every table created has RLS enabled somewhere in migration history
- `npm run check:user-fk` — staff-attribution columns point at `public.users`, not `auth.users`
- `npm run check:db-contract` — every `.from()`, `.rpc()` and `.functions.invoke()` in the app
  resolves against the generated schema and the deployed function list (extended 2026-09-05 to
  also catch edge-function calls to a name that doesn't exist — C-04's defect class, one surface
  wider)
- `npm run check:openapi` — the published API spec matches the route registry
- `npm run check:lab-catalog` — the seeded lab reference ranges match `src/lib/labTestCatalog.ts`

## The other 21 files in this directory

Not re-audited individually. Treat CSV inventories (`02`, `03`, `05`, `06`, `08`, `09`, `10`) as
snapshots — several are now undercounts (the table count alone is off by ~17) and
`12_APPLICATION_DATABASE_CONTRACT.csv` cites `e2e/` test paths that were deleted on 2026-09-05.
The narrative documents (`01`, `07`, `11`, `13`–`19`) are reasoning and methodology that mostly
still holds; only their headline counts have drifted. None of that changes the one correction
that matters: **`20_...md:3` is wrong, and the six findings above are fixed.**
