-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- API Platform — Phase 0: api_keys secret hardening
--
-- WHY THIS EXISTS
-- src/pages/settings/SettingsAPIPortalPage.tsx generated a key and wrote the RAW SECRET into
-- api_keys.key_hash. The column name says hash; the value was the credential itself. Under the
-- existing `api_keys_all` policy every authenticated user in the tenant could SELECT it, so any
-- receptionist login could read every live integration key the hospital had ever issued.
--
-- The sibling page src/pages/settings/SettingsAPIKeysPage.tsx did it correctly (SHA-256), which
-- is why the table now holds a mix of real digests and plaintext secrets.
--
-- A plaintext secret that has been readable at rest is compromised by definition. These keys are
-- therefore REVOKED AND SCRUBBED, not migrated — a hospital re-issues from the portal. Nothing
-- consumes api_keys yet (the gateway does not exist), so no live integration breaks.
--
-- Also adds the columns the portal UI has been collecting and silently discarding: scopes and
-- credential environment.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

-- ── 1. Columns the API platform needs ────────────────────────────────────────────────────────
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS scopes            text[]      NOT NULL DEFAULT '{}';
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS environment       text;
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS revoked_at        timestamptz;
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS revoked_reason    text;
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS rate_limit_per_min integer;
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS last_used_ip      inet;

COMMENT ON COLUMN public.api_keys.key_hash IS
  'SHA-256 hex digest of the API key. NEVER the key itself — the raw secret is shown once at '
  'creation and is not recoverable. Enforced by api_keys_key_hash_is_sha256.';
COMMENT ON COLUMN public.api_keys.scopes IS
  'Granted scopes, e.g. {read:patients,write:appointments}. Enforced per-route by api-gateway.';
COMMENT ON COLUMN public.api_keys.environment IS
  'sandbox | production. Redundant with key_prefix by design: the prefix makes the mode legible '
  'wherever the key text appears, the column makes it queryable.';

-- ── 2. Backfill environment from the existing prefix ─────────────────────────────────────────
-- Both prefix conventions are in the wild: sk_live_/sk_test_ from the portal page, hms_live_
-- from the API-keys page.
UPDATE public.api_keys
   SET environment = CASE
         WHEN key_prefix LIKE '%live%' THEN 'production'
         ELSE 'sandbox'
       END
 WHERE environment IS NULL;

ALTER TABLE public.api_keys ALTER COLUMN environment SET DEFAULT 'sandbox';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'api_keys_environment_valid'
       AND conrelid = 'public.api_keys'::regclass
  ) THEN
    ALTER TABLE public.api_keys
      ADD CONSTRAINT api_keys_environment_valid
      CHECK (environment IN ('sandbox', 'production'));
  END IF;
END $$;

-- ── 3. Revoke and scrub every plaintext secret ───────────────────────────────────────────────
-- Predicate is "is not a SHA-256 hex digest" rather than "starts with sk_", so anything that was
-- never a real hash is caught regardless of which prefix convention wrote it.
--
-- key_hash is NOT NULL, so the secret is overwritten with the digest of a fresh random UUID —
-- a value with no known preimage, therefore unusable as a credential, while still satisfying
-- both NOT NULL and the digest-shape constraint added below.
UPDATE public.api_keys
   SET key_hash       = encode(sha256(gen_random_uuid()::text::bytea), 'hex'),
       is_active      = false,
       revoked_at     = COALESCE(revoked_at, now()),
       revoked_reason = 'Auto-revoked: secret was stored in plaintext and readable at rest. '
                        'Re-issue this key from Settings → API Portal.'
 WHERE key_hash !~ '^[0-9a-f]{64}$';

-- ── 4. Make the regression impossible at the storage layer ───────────────────────────────────
-- Defence in depth: even if a future UI change reintroduces the bug, Postgres refuses the write.
-- NOT VALID skips re-checking existing rows — step 3 has already normalised every one of them,
-- but NOT VALID keeps this migration safe to run against a table that has since drifted.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'api_keys_key_hash_is_sha256'
       AND conrelid = 'public.api_keys'::regclass
  ) THEN
    ALTER TABLE public.api_keys
      ADD CONSTRAINT api_keys_key_hash_is_sha256
      CHECK (key_hash ~ '^[0-9a-f]{64}$') NOT VALID;
  END IF;
END $$;

-- ── 5. Tighten RLS to admins ─────────────────────────────────────────────────────────────────
-- The old policy granted every authenticated user in the tenant full access to the credential
-- table. /settings/api-portal is already restricted to super_admin + hospital_admin at the app
-- layer (src/lib/routeRoles.ts); this makes the database agree, so a direct PostgREST call from
-- a nurse's session cannot enumerate or revoke the hospital's integration keys.
DROP POLICY IF EXISTS "api_keys_all" ON public.api_keys;

CREATE POLICY "api_keys_admin_only" ON public.api_keys
  FOR ALL TO authenticated
  USING (
    hospital_id = public.get_user_hospital_id()
    AND (public.has_role(auth.uid(), 'hospital_admin') OR public.has_role(auth.uid(), 'super_admin'))
  )
  WITH CHECK (
    hospital_id = public.get_user_hospital_id()
    AND (public.has_role(auth.uid(), 'hospital_admin') OR public.has_role(auth.uid(), 'super_admin'))
  );

-- ── 6. Lookup index for the gateway ──────────────────────────────────────────────────────────
-- Every authenticated API request hashes the presented key and looks it up by digest. Partial on
-- is_active because revoked keys are never a hit.
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash_active
  ON public.api_keys (key_hash)
  WHERE is_active = true;
