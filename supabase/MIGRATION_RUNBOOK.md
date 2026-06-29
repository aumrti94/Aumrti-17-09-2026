# Supabase Migration Runbook — Aumrti HMS

How to bring a **brand-new (or freshly re-pointed) Supabase project** to a fully-migrated,
fully-deployed state — without the credential/link issues we hit before.

> **Secrets live in `.env.local`** (project root, gitignored, untracked). This runbook is
> non-secret. The personal **access token is NOT in any file** — it's held by `supabase login`.

---

## Where each credential lives & who reads it

| Consumer | Reads | From |
|---|---|---|
| **App (Vite/React)** | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | `.env.local` (automatically) |
| **Supabase CLI** (`link`, `db push`, `functions deploy`) | access token + `SUPABASE_DB_PASSWORD` | `supabase login` keychain + per-session env (loader below) |
| **Deployed edge functions** | provider/API secrets via `Deno.env` | `supabase secrets set` (stored in Supabase, **not** `.env.local`) |

Only `VITE_*` vars are bundled into the browser — keep DB password / service_role as **non-VITE** names.

---

## Project index (non-secret)

| Name | Ref | URL | Org | Status |
|---|---|---|---|---|
| **AumrtiHMS Main** | `pdxvisvmnzjhsgmvygku` | https://pdxvisvmnzjhsgmvygku.supabase.co | `ggsxhowdkpbppbqcxero` | **ACTIVE** (linked, all migrations applied Jun 2026) |

---

## ⚠️ The one rule that bit us — TOKEN ↔ ORG MATCH
The token you give `supabase login` must belong to the **account that owns the target project's
org**. A token from another account returns **HTTP 403** ("account does not have the necessary
privileges") on `link` / `db push` / `functions deploy`. Create tokens (while logged into the
owning account) at <https://supabase.com/dashboard/account/tokens>.

---

## 0. Prerequisites
- `supabase --version` (we use 2.106.0); `npm install` done.
- Docker **not** required for remote `db push` / `functions deploy` (a "Docker is not running" warning is harmless).

## 1. Create the project & record it
1. Dashboard → **New project** (region **ap-south-1 / Mumbai**). Note ref / URL / org.
2. Add/swap its block in `.env.local` (copy the AumrtiHOS block, change the ref/URL).
3. Fill the secrets in `.env.local`: `SUPABASE_DB_PASSWORD` (Settings → Database), `SUPABASE_SERVICE_ROLE_KEY` (Settings → API).

## 2. Authenticate the CLI (token via keychain — one time per machine/account)
```bash
supabase login        # opens browser / prompts for a token from the OWNING account
supabase projects list # should list the project, NO 403
```

## 3. Load the per-session CLI vars from `.env.local`
The CLI does not auto-read `.env.local`; export the non-VITE keys for this shell:

**bash / Git Bash:**
```bash
export $(grep -E '^SUPABASE_(PROJECT_REF|DB_PASSWORD)=' .env.local | xargs)
```

**PowerShell:**
```powershell
Get-Content .env.local |
  Where-Object { $_ -match '^(SUPABASE_PROJECT_REF|SUPABASE_DB_PASSWORD)=' } |
  ForEach-Object { $k,$v = $_ -split '=',2; Set-Item "env:$k" $v }
```

## 4. Link the repo to the project
```bash
supabase link --project-ref $SUPABASE_PROJECT_REF   # PS: $env:SUPABASE_PROJECT_REF
```
Rewrites `supabase/.temp/*` (gitignored — no commit noise).

## 5. Apply ALL migrations

**Preferred (when CLI auth works — no 403):**
```bash
supabase migration list   # review local-vs-remote first
supabase db push          # applies every pending migration in supabase/migrations/ (timestamp order)
```

**Fallback via pooler URL (when CLI returns 403 on management API):**
```bash
# install pg module first (no-save so it doesn't touch package.json)
npm install pg --no-save --legacy-peer-deps

# apply all pending migrations gracefully (skips failures, continues)
node scripts/apply-pending-migrations.mjs

# retry any skipped ones after their dependencies are now created
node scripts/apply-pending-migrations.mjs
```
The script at `scripts/apply-pending-migrations.mjs` reads credentials from `.env.local`
(`SUPABASE_PROJECT_REF` + `SUPABASE_DB_PASSWORD`), connects via the Session-mode pooler, and
applies every pending migration in timestamp order, rolling back individual failures and continuing.

**Known migration ordering quirk on a brand-new project:**
- `20260611000001_merge_asset_register_into_fixed_assets` will skip on first pass (fixed_assets
  doesn't exist yet). Re-run the script after `20260901000007_add_asset_management_tables` applies
  — it will succeed on the second pass.
- `20260607000003_cascade_hospital_fks` times out via the pooler. Mark it as applied by running
  the no-op workaround and apply the CASCADE SQL manually via the Supabase Dashboard SQL Editor.

- Brand-new project = full set (300+) in order; two-pass script run needed.
- Existing project = only what's missing. ⚠️ If it was bootstrapped another way, reconcile with
  `supabase migration list --db-url <pooler-url>` first.

## 6. Deploy edge functions + their secrets
```bash
supabase functions deploy                                  # all functions
# or one:  supabase functions deploy register-hospital --project-ref <ref>
supabase secrets set OPENAI_API_KEY=sk-... ANTHROPIC_API_KEY=... AZURE_OPENAI_API_KEY=...
```

## 7. Seed defaults & first hospital
`register-hospital` edge fn creates the first hospital + super-admin + trial subscription and calls
`seed_default_roles_for_hospital` + `seed_hospital_defaults`. Register via `/register` or invoke directly.

## 8. Point the app at the project
In `.env.local` set the active `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`, then `npm run dev`.

---

## MCP note
`mcp_config.json` uses `${SUPABASE_ACCESS_TOKEN}` / `${SUPABASE_PROJECT_REF}`. The MCP server needs
those in its environment — set `SUPABASE_ACCESS_TOKEN` for the MCP process from the owning account
(the CLI itself uses the `supabase login` keychain).

## Quick checklist
- [ ] `.env.local` block filled (db password, service_role)
- [ ] `supabase login` done with the **owning-account** token; `supabase projects list` (no 403)
- [ ] per-session vars loaded (step 3)
- [ ] `supabase link` ok
- [ ] `supabase db push` applied all migrations
- [ ] `supabase functions deploy` + secrets set
- [ ] first hospital seeded · `.env.local` VITE_ vars set · dev server restarted
