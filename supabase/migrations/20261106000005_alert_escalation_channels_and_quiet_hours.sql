-- ============================================================================
-- D1 — alert_escalation_rules becomes the single source of truth for alert routing.
--
-- WHY. Two configurations described "who gets told when a critical alert is not
-- acknowledged", and only one of them did anything:
--
--   * hospital_settings.notification_config — written by Settings › Notifications,
--     carrying per-alert-type channel (in_app | whatsapp | both), escalation minutes
--     and hospital-wide quiet hours. READ BY NOTHING. No dispatcher has ever consumed
--     it. A hospital that routed Code Blue to WhatsApp got a green "saved" toast and
--     no WhatsApp message, ever.
--
--   * alert_escalation_rules — read every 5 minutes by the cron'd alert-escalation
--     edge function, which sends real SMS and email.
--
-- The second is canonical. Before the first can be retired, this table has to be able
-- to express what that screen configured, or repointing the screen would silently drop
-- the in-app and WhatsApp choices AND quiet hours. So this migration extends the
-- canonical table first; 20261106000006 migrates the data and the edge function gains
-- in_app + whatsapp dispatch in the same change.
--
-- CODE BLUE MUST NOT REGRESS. Quiet hours added below deliberately CANNOT suppress a
-- critical alert — see the column comment on quiet_hours_enabled. That is the one hard
-- constraint on this whole piece of work.
--
-- RATIFICATION OUTSTANDING: D1's named ratifiers are clinical-pod + Vikram (CTO). The
-- product decisions encoded here (in-app escalation writes an audit row rather than a
-- second clinical_alert; quiet hours never suppress critical) are documented in
-- docs/testing/PHASE_0_COMPLETION.md and are NOT yet signed off.
-- ============================================================================

-- ── 1. Columns ──────────────────────────────────────────────────────────────
-- alert_escalation_rules was created twice with different shapes — 20260531000004
-- (escalation_channels DEFAULT ARRAY['sms','email'], has notify_user_ids, no updated_at)
-- and 20260607000001 (DEFAULT ARRAY['whatsapp'], no notify_user_ids, has updated_at).
-- Both are CREATE TABLE IF NOT EXISTS, so whichever ran first won and a live database
-- may have either. Every column below is therefore added defensively.

ALTER TABLE public.alert_escalation_rules
  ADD COLUMN IF NOT EXISTS notify_user_ids uuid[],
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  -- Quiet hours, hospital-wide in the old config and kept per-rule here so a hospital
  -- can silence Medication Due overnight without touching Code Blue.
  ADD COLUMN IF NOT EXISTS quiet_hours_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quiet_hours_start time,
  ADD COLUMN IF NOT EXISTS quiet_hours_end time;

COMMENT ON COLUMN public.alert_escalation_rules.quiet_hours_enabled IS
  'Suppress escalation between quiet_hours_start and quiet_hours_end. NEVER applies to '
  'severity = ''critical'' — the alert-escalation function checks severity before quiet '
  'hours, so Code Blue and every other critical alert escalates at 3am regardless. A '
  'quiet-hours rule that could silence a critical alert is a silenced clinical alert, '
  'which CLAUDE.md forbids outright.';

COMMENT ON COLUMN public.alert_escalation_rules.escalation_channels IS
  'Subset of sms | email | in_app | whatsapp. in_app and whatsapp were accepted as data '
  'long before anything dispatched them (20260607000001 even DEFAULTed to whatsapp), so '
  'existing rows may already name a channel that never fired.';

-- ── 2. Channel vocabulary ───────────────────────────────────────────────────
-- Constrain the array elements. Without this the column accepts any text, which is how
-- 'whatsapp' came to be a default for a channel with no dispatcher.
ALTER TABLE public.alert_escalation_rules
  DROP CONSTRAINT IF EXISTS alert_escalation_rules_channels_check;

ALTER TABLE public.alert_escalation_rules
  ADD CONSTRAINT alert_escalation_rules_channels_check
  CHECK (
    escalation_channels IS NULL
    OR escalation_channels <@ ARRAY['sms', 'email', 'in_app', 'whatsapp']::text[]
  )
  NOT VALID;

-- NOT VALID above, VALIDATE separately: existing rows are checked without holding an
-- ACCESS EXCLUSIVE lock over the whole validation. If a legacy row names something
-- outside the vocabulary, this raises here rather than silently accepting it.
ALTER TABLE public.alert_escalation_rules
  VALIDATE CONSTRAINT alert_escalation_rules_channels_check;

-- ── 3. Quiet-hours sanity ───────────────────────────────────────────────────
-- An enabled window with no bounds would suppress either everything or nothing
-- depending on how the reader handles NULL. Require both bounds when enabled.
ALTER TABLE public.alert_escalation_rules
  DROP CONSTRAINT IF EXISTS alert_escalation_rules_quiet_hours_check;

ALTER TABLE public.alert_escalation_rules
  ADD CONSTRAINT alert_escalation_rules_quiet_hours_check
  CHECK (
    quiet_hours_enabled = false
    OR (quiet_hours_start IS NOT NULL AND quiet_hours_end IS NOT NULL)
  );

-- ── 4. One rule per (hospital, alert type, severity) ────────────────────────
-- Settings › Notifications upserts one row per alert type. Without a unique key the
-- screen would append a duplicate rule on every save, and the escalation function
-- iterates rules — so N saves would mean N SMS per unacknowledged alert.
--
-- COALESCE because alert_type is nullable and means "all types"; NULLs do not conflict
-- with each other in a plain unique index, so two "all types" rules could coexist.
CREATE UNIQUE INDEX IF NOT EXISTS alert_escalation_rules_hospital_type_sev_key
  ON public.alert_escalation_rules (hospital_id, COALESCE(alert_type, '*'), severity);

-- ── 5. RLS — close the write side ───────────────────────────────────────────
-- Both historical policies were declared with USING only. USING governs read/update/
-- delete; WITH CHECK governs insert and the post-image of update. With no WITH CHECK,
-- an authenticated user of hospital A can INSERT a rule carrying hospital B's id —
-- a cross-tenant write on the table that decides who gets paged about hospital B's
-- unacknowledged critical alerts.
DROP POLICY IF EXISTS "alert_escalation_rules_hospital" ON public.alert_escalation_rules;
DROP POLICY IF EXISTS "Hospital isolation" ON public.alert_escalation_rules;

CREATE POLICY "alert_escalation_rules_hospital_isolation"
  ON public.alert_escalation_rules
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- Same gap on the log table.
DROP POLICY IF EXISTS "alert_escalation_log_hospital" ON public.alert_escalation_log;
DROP POLICY IF EXISTS "Hospital isolation" ON public.alert_escalation_log;

CREATE POLICY "alert_escalation_log_hospital_isolation"
  ON public.alert_escalation_log
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- ── 6. Channel coverage on the log ──────────────────────────────────────────
-- alert_escalation_log.channel is free text ('sms' | 'email' by comment only). The
-- function now writes in_app and whatsapp rows too; leave it unconstrained rather than
-- adding a CHECK that a concurrently-deploying old function version would violate.
COMMENT ON COLUMN public.alert_escalation_log.channel IS
  'sms | email | in_app | whatsapp. Deliberately unconstrained: a CHECK here would make '
  'the table reject writes from an older deployed copy of alert-escalation during a roll.';

CREATE INDEX IF NOT EXISTS idx_alert_escalation_rules_active
  ON public.alert_escalation_rules (hospital_id, is_active)
  WHERE is_active = true;
