-- ============================================================================
-- D1, part 2 — move hospital_settings.notification_config into alert_escalation_rules
-- and retire the key.
--
-- THE SAFETY RULE THIS MIGRATION IS BUILT AROUND
-- ----------------------------------------------
-- alert_escalation_rules rows are LIVE: the cron'd alert-escalation function reads them
-- every five minutes and sends real SMS and email. notification_config rows are INERT:
-- nothing has ever read them.
--
-- So the merge is deliberately asymmetric. An existing rule is only ever WIDENED — its
-- channel list gains the channels the hospital picked in Settings, and nothing else about
-- it changes. Its escalate_after_minutes, is_active, notify_roles and recipients are left
-- exactly as they are, because those values are the ones currently paging real clinicians
-- and the config's equivalents have never been exercised against anything.
--
-- Rules that do not exist yet are created from the config.
--
-- The alternative — letting the inert config overwrite live routing — could lengthen an
-- SLA, deactivate a rule, or drop sms/email from a hospital that depends on them. Every
-- one of those is a silenced escalation, and this migration must not be able to cause one.
-- ============================================================================

DO $$
DECLARE
  setting        RECORD;
  alert          jsonb;
  cfg_type       text;
  cfg_channel    text;
  cfg_minutes    int;
  cfg_active     boolean;
  cfg_severity   text;
  mapped_type    text;
  mapped_sev     text;
  new_channels   text[];
  qh_enabled     boolean;
  qh_start       time;
  qh_end         time;
  created_count  int := 0;
  widened_count  int := 0;
  skipped_types  text[] := ARRAY[]::text[];
BEGIN
  -- The screen's alert types are display strings ("Code Blue"); clinical_alerts.alert_type
  -- is a controlled vocabulary (20261008000035). Only the types that correspond to an alert
  -- the product actually emits are migrated. A rule keyed on an alert_type that nothing
  -- raises would be a silent no-op — precisely the defect class D1 exists to remove — so
  -- unmappable types are reported and dropped rather than written as dead rows.
  --
  -- Mapped:    Critical Lab Value, NEWS2 Score Alert, Medication Due,
  --            Discharge TAT Alert, Code Blue
  -- Unmapped:  Bed Occupancy > 90%, Drug Stockout, Large Bill (> ₹50,000),
  --            New Admission, OT Starting in 30 min
  --            — none of these raise a clinical_alerts row today.

  FOR setting IN
    SELECT hospital_id, value
    FROM public.hospital_settings
    WHERE key = 'notification_config'
      AND value IS NOT NULL
  LOOP
    -- Hospital-wide quiet hours from the old config.
    qh_enabled := COALESCE((setting.value -> 'quietHours' ->> 'enabled')::boolean, false);
    qh_start   := NULLIF(setting.value -> 'quietHours' ->> 'from', '')::time;
    qh_end     := NULLIF(setting.value -> 'quietHours' ->> 'to', '')::time;

    -- The CHECK added in 20261106000005 requires both bounds when enabled.
    IF qh_enabled AND (qh_start IS NULL OR qh_end IS NULL) THEN
      qh_enabled := false;
    END IF;

    FOR alert IN SELECT * FROM jsonb_array_elements(COALESCE(setting.value -> 'alerts', '[]'::jsonb))
    LOOP
      cfg_type    := alert ->> 'type';
      cfg_channel := COALESCE(alert ->> 'channel', 'in_app');
      cfg_minutes := COALESCE((alert ->> 'escalationMin')::int, 30);
      cfg_active  := COALESCE((alert ->> 'active')::boolean, true);
      cfg_severity := COALESCE(alert ->> 'severity', 'medium');

      mapped_type := CASE cfg_type
        WHEN 'Critical Lab Value'   THEN 'critical_lab_value'
        WHEN 'NEWS2 Score Alert'    THEN 'high_news2'
        WHEN 'Medication Due'       THEN 'mar_overdue'
        WHEN 'Discharge TAT Alert'  THEN 'discharge_delay'
        WHEN 'Code Blue'            THEN 'code_blue'
        ELSE NULL
      END;

      IF mapped_type IS NULL THEN
        IF NOT (cfg_type = ANY(skipped_types)) THEN
          skipped_types := skipped_types || cfg_type;
        END IF;
        CONTINUE;
      END IF;

      -- clinical_alerts.severity is CHECKed to low|medium|high|critical. The settings
      -- screen shipped 'normal', which is not one of them — a rule carrying it would
      -- filter clinical_alerts on a severity no row can hold and escalate nothing.
      mapped_sev := CASE cfg_severity
        WHEN 'normal' THEN 'medium'
        WHEN 'critical' THEN 'critical'
        WHEN 'high' THEN 'high'
        WHEN 'low' THEN 'low'
        WHEN 'medium' THEN 'medium'
        ELSE 'medium'
      END;

      new_channels := CASE cfg_channel
        WHEN 'in_app'   THEN ARRAY['in_app']
        WHEN 'whatsapp' THEN ARRAY['whatsapp']
        WHEN 'both'     THEN ARRAY['in_app', 'whatsapp']
        ELSE ARRAY['in_app']
      END;

      -- Widen an existing live rule: union the channels, touch nothing else.
      UPDATE public.alert_escalation_rules r
         SET escalation_channels = ARRAY(
               SELECT DISTINCT unnest(COALESCE(r.escalation_channels, ARRAY[]::text[]) || new_channels)
               ORDER BY 1
             ),
             updated_at = now()
       WHERE r.hospital_id = setting.hospital_id
         AND COALESCE(r.alert_type, '*') = mapped_type
         AND r.severity = mapped_sev
         AND NOT (COALESCE(r.escalation_channels, ARRAY[]::text[]) @> new_channels);

      IF FOUND THEN
        widened_count := widened_count + 1;
        CONTINUE;
      END IF;

      -- Nothing to widen: either the rule already covers these channels, or it does not
      -- exist. ON CONFLICT DO NOTHING distinguishes the two without a second SELECT.
      INSERT INTO public.alert_escalation_rules (
        hospital_id, alert_type, severity, escalate_after_minutes,
        escalation_channels, notify_roles, is_active,
        quiet_hours_enabled, quiet_hours_start, quiet_hours_end
      )
      VALUES (
        setting.hospital_id,
        mapped_type,
        mapped_sev,
        GREATEST(cfg_minutes, 1),   -- 0 meant "no escalation" on the old screen; is_active carries that now
        new_channels,
        ARRAY['doctor', 'admin'],   -- the shipped default; the old recipient names are display roles, not user roles
        cfg_active AND cfg_minutes > 0,
        -- Quiet hours never apply to a critical rule. Setting the flag false rather than
        -- relying on the dispatcher's severity check means a future reader of this table
        -- cannot conclude that Code Blue is silenced overnight.
        CASE WHEN mapped_sev = 'critical' THEN false ELSE qh_enabled END,
        CASE WHEN mapped_sev = 'critical' THEN NULL ELSE qh_start END,
        CASE WHEN mapped_sev = 'critical' THEN NULL ELSE qh_end END
      )
      ON CONFLICT (hospital_id, COALESCE(alert_type, '*'), severity) DO NOTHING;

      IF FOUND THEN
        created_count := created_count + 1;
      END IF;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'D1 notification_config migration: % rules created, % widened. Unmapped display types (no clinical_alerts.alert_type equivalent, dropped): %',
    created_count, widened_count, COALESCE(array_to_string(skipped_types, ', '), 'none');
END $$;

-- ── Retire the key ──────────────────────────────────────────────────────────
-- Renamed, not deleted. CLAUDE.md forbids destroying data in a production migration, and
-- the original JSONB is the only record of what a hospital picked on a screen that never
-- did anything — worth keeping until D1 is ratified and the unmapped alert types above
-- have somewhere to go.
--
-- Guarded so a re-run cannot collide with the archived key from the first run.
UPDATE public.hospital_settings
   SET key = 'notification_config_retired_d1'
 WHERE key = 'notification_config'
   AND NOT EXISTS (
     SELECT 1 FROM public.hospital_settings s2
      WHERE s2.hospital_id = public.hospital_settings.hospital_id
        AND s2.key = 'notification_config_retired_d1'
   );

DELETE FROM public.hospital_settings WHERE key = 'notification_config';
