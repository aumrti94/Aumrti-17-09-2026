-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- API Platform — Phase 2: schema
--
-- Tables behind the public API gateway and the outbound webhook engine. Nothing here is read by
-- the browser except through the API Portal screen; the gateway and dispatcher run as service
-- role and bypass RLS, so every policy below exists to gate everyone ELSE (see the reasoning in
-- 20261013000016_webhook_tables_rls.sql — Supabase grants `authenticated` table access by
-- default, and RLS is what narrows it).
--
-- Contract: docs/api/API_DESIGN_STANDARD.md and docs/api/EVENT_CATALOG.md.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1. api_events — the transactional outbox
--
-- Business triggers INSERT here in the SAME transaction as the row that caused the event. That
-- is the whole design: an event can never describe a write that rolled back, and can never be
-- lost because an HTTP call failed midway. Emitting from application code after commit gives
-- neither guarantee.
--
-- Append-only. The dispatcher stamps dispatched_at as service role; nothing else ever updates
-- a row, and nothing deletes one.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.api_events (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Public identifier sent to subscribers and used by them to deduplicate. Stable across
  -- retries — a redelivery carries the same event_id, which is what makes at-least-once
  -- delivery safe for the receiver to handle.
  event_id       text        NOT NULL UNIQUE DEFAULT ('evt_' || replace(gen_random_uuid()::text, '-', '')),
  hospital_id    uuid        NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  event_type     text        NOT NULL,
  resource_type  text,
  resource_id    uuid,
  -- Thin by default: ids and non-PHI metadata plus a self link. See EVENT_CATALOG.md §4.
  payload        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  contains_phi   boolean     NOT NULL DEFAULT false,
  environment    text        NOT NULL DEFAULT 'production'
                             CHECK (environment IN ('sandbox', 'production')),
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  dispatched_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.api_events IS
  'Transactional outbox for outbound webhooks. Written by business triggers in-transaction; '
  'drained by the webhook-dispatcher edge function. Append-only.';

-- The dispatcher''s claim query. Partial index so it stays small no matter how large the
-- history grows — only undispatched rows are ever scanned.
CREATE INDEX IF NOT EXISTS idx_api_events_pending
  ON public.api_events (occurred_at)
  WHERE dispatched_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_api_events_hospital
  ON public.api_events (hospital_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_events_type
  ON public.api_events (hospital_id, event_type, occurred_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2. webhook_deliveries — one row per attempt
--
-- Powers the portal's delivery log and its Replay button. When an integrator says "we never got
-- the discharge event", this table is the answer: it either shows a 200, or it shows their 502.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.webhook_deliveries (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     uuid        NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  endpoint_id     uuid        NOT NULL REFERENCES public.webhook_endpoints(id) ON DELETE CASCADE,
  event_id        uuid        NOT NULL REFERENCES public.api_events(id) ON DELETE CASCADE,
  attempt         integer     NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  status          text        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'succeeded', 'failed', 'dead')),
  response_status integer,
  -- Truncated to ~2KB by the dispatcher before insert. Deliberately NOT constrained by a CHECK:
  -- rejecting the delivery record because the receiver returned a verbose error would destroy
  -- exactly the evidence needed to debug that error.
  response_body   text,
  duration_ms     integer,
  error_message   text,
  next_retry_at   timestamptz,
  delivered_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.webhook_deliveries.response_body IS
  'First ~2KB of the receiver response. Never contains PHI — we send thin payloads and store '
  'only what the receiver echoed back.';

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_endpoint
  ON public.webhook_deliveries (endpoint_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_hospital
  ON public.webhook_deliveries (hospital_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_event
  ON public.webhook_deliveries (event_id);

-- Retry sweep: only rows actually awaiting a retry.
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_retry
  ON public.webhook_deliveries (next_retry_at)
  WHERE status = 'failed' AND next_retry_at IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 3. api_idempotency_keys
--
-- Partner systems retry on timeout. Without this a retried POST /v1/admissions occupies two
-- beds and a retried POST /v1/bills raises two invoices against one encounter — which is a GST
-- filing problem, not merely a data problem.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.api_idempotency_keys (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id         uuid        NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  api_key_id          uuid        REFERENCES public.api_keys(id) ON DELETE SET NULL,
  idempotency_key     text        NOT NULL,
  request_path        text        NOT NULL,
  -- SHA-256 of the request body. A client that reuses one Idempotency-Key for a DIFFERENT
  -- request has a bug; replaying the first response would hide it and silently drop the second
  -- write. The gateway compares fingerprints and returns 409 on mismatch instead.
  request_fingerprint text        NOT NULL,
  response_status     integer,
  response_body       jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  CONSTRAINT api_idempotency_keys_unique UNIQUE (hospital_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_api_idempotency_expiry
  ON public.api_idempotency_keys (expires_at);

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 4. api_request_log
--
-- Feeds the portal's usage panel and support triage by request_id.
--
-- There is deliberately NO request-body or response-body column. Every PHI route would put
-- patient data in here on every call, creating a second uncontrolled copy of the record with a
-- different retention policy — which is precisely what DPDP purpose limitation forbids. Ids,
-- routes, statuses and latencies are enough to debug; when they are not, the request_id ties
-- back to the audit_log row.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.api_request_log (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id   uuid        NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  api_key_id    uuid        REFERENCES public.api_keys(id) ON DELETE SET NULL,
  request_id    text        NOT NULL,
  method        text        NOT NULL,
  path          text        NOT NULL,
  -- The registry pattern ('/v1/patients/{id}'), not the concrete path — this is what makes
  -- per-endpoint usage aggregation possible without grouping on a million distinct UUIDs.
  route_pattern text,
  status_code   integer     NOT NULL,
  duration_ms   integer,
  ip_address    inet,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_request_log_hospital
  ON public.api_request_log (hospital_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_request_log_key
  ON public.api_request_log (api_key_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_request_log_request_id
  ON public.api_request_log (request_id);

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 5. api_rate_limits (+ increment RPC)
--
-- Same tumbling-window shape as abdm_rate_limits. Separate table rather than a shared one so a
-- burst of public API traffic can never evict or contend with the internal ABDM counters.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.api_rate_limits (
  key          text        PRIMARY KEY,
  count        integer     NOT NULL DEFAULT 1,
  window_start timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_rate_limits_window
  ON public.api_rate_limits (window_start);

CREATE OR REPLACE FUNCTION public.api_rate_limit_increment(
  p_key          text,
  p_window_start timestamptz
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO public.api_rate_limits (key, count, window_start)
  VALUES (p_key, 1, p_window_start)
  ON CONFLICT (key) DO UPDATE
    SET count = api_rate_limits.count + 1
  RETURNING count INTO v_count;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.api_rate_limit_increment IS
  'Atomic tumbling-window counter for the public API gateway. The key embeds the window epoch, '
  'so expired windows are simply new keys; stale rows are purged on a schedule.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 6. webhook_endpoints — PHI opt-in and failure state
--
-- include_phi cannot be set without a recorded purpose. This is Ananya's DPDP requirement made
-- structural rather than procedural: a fat payload posts patient data to a third-party host
-- where it lands in their logs and backups, and the hospital is accountable for that disclosure.
-- A CHECK is what stops it being switched on "temporarily" during an integration call.
--
-- failure_count already exists on this table and is reused as the CONSECUTIVE failure counter —
-- reset to 0 on any success. A second column would immediately disagree with it.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.webhook_endpoints ADD COLUMN IF NOT EXISTS include_phi      boolean NOT NULL DEFAULT false;
ALTER TABLE public.webhook_endpoints ADD COLUMN IF NOT EXISTS phi_purpose      text;
ALTER TABLE public.webhook_endpoints ADD COLUMN IF NOT EXISTS disabled_reason  text;
ALTER TABLE public.webhook_endpoints ADD COLUMN IF NOT EXISTS disabled_at      timestamptz;

COMMENT ON COLUMN public.webhook_endpoints.failure_count IS
  'CONSECUTIVE delivery failures. Reset to 0 on any 2xx. At 15 the endpoint is auto-disabled '
  'and the hospital admin notified.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'webhook_endpoints_phi_needs_purpose'
       AND conrelid = 'public.webhook_endpoints'::regclass
  ) THEN
    ALTER TABLE public.webhook_endpoints
      ADD CONSTRAINT webhook_endpoints_phi_needs_purpose
      CHECK (include_phi = false OR phi_purpose IS NOT NULL);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 7. webhook_dlq — accept outbound failures
--
-- The DLQ was built for INBOUND Razorpay callbacks. Exhausted OUTBOUND deliveries land here too
-- rather than in a second parallel queue with its own processor and its own bugs.
--
-- No CHECK constraint on `source` exists to widen — the permitted values were only ever a
-- comment on the column, so 'hospital_outbound' is already accepted. hospital_id and endpoint_id
-- are added because an outbound row is tenant-scoped, where a Razorpay row is platform-level and
-- correctly leaves them NULL.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.webhook_dlq ADD COLUMN IF NOT EXISTS hospital_id uuid REFERENCES public.hospitals(id) ON DELETE CASCADE;
ALTER TABLE public.webhook_dlq ADD COLUMN IF NOT EXISTS endpoint_id uuid REFERENCES public.webhook_endpoints(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_webhook_dlq_hospital
  ON public.webhook_dlq (hospital_id, created_at DESC)
  WHERE hospital_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 8. subscription_plans — API access as a real entitlement
--
-- Gated in both places: the portal hides issuance, and the gateway refuses the request. A plan
-- gate enforced only in the UI is not a gate.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS api_access             boolean NOT NULL DEFAULT false;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS webhooks_enabled       boolean NOT NULL DEFAULT false;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS max_api_keys           integer;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS api_rate_limit_per_min integer NOT NULL DEFAULT 60;

COMMENT ON COLUMN public.subscription_plans.max_api_keys IS
  'NULL means unlimited, matching the max_beds/max_staff convention on this table.';

COMMIT;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- RLS
--
-- Separate transaction so a policy failure does not roll back the table creation above.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.api_events            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_deliveries    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_request_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_idempotency_keys  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_rate_limits       ENABLE ROW LEVEL SECURITY;

-- api_events, webhook_deliveries and api_request_log are READ-ONLY to the tenant: the portal
-- shows them, nobody edits them. Writes come from triggers and the service-role dispatcher.
-- Granting only SELECT is what makes the delivery log trustworthy as evidence — an admin who
-- could edit it could hide a failed critical-result delivery.
--
-- Predicate wrapped in (SELECT ...) so the planner hoists it to an InitPlan rather than
-- re-evaluating per row (canonical form, Rule 3).
DROP POLICY IF EXISTS api_events_tenant_read ON public.api_events;
CREATE POLICY api_events_tenant_read ON public.api_events
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (hospital_id = (SELECT public.get_user_hospital_id()));

DROP POLICY IF EXISTS webhook_deliveries_tenant_read ON public.webhook_deliveries;
CREATE POLICY webhook_deliveries_tenant_read ON public.webhook_deliveries
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (hospital_id = (SELECT public.get_user_hospital_id()));

DROP POLICY IF EXISTS api_request_log_tenant_read ON public.api_request_log;
CREATE POLICY api_request_log_tenant_read ON public.api_request_log
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (hospital_id = (SELECT public.get_user_hospital_id()));

-- api_idempotency_keys and api_rate_limits get NO policies at all. Nothing in the browser reads
-- them, and idempotency rows hold cached response bodies which for a PHI route would be patient
-- data. RLS enabled with zero policies closes them to everyone except service_role.

REVOKE ALL ON public.api_events, public.webhook_deliveries, public.api_request_log,
              public.api_idempotency_keys, public.api_rate_limits
  FROM anon;

REVOKE ALL ON public.api_idempotency_keys, public.api_rate_limits FROM authenticated;

GRANT SELECT ON public.api_events, public.webhook_deliveries, public.api_request_log
  TO authenticated;

COMMIT;
