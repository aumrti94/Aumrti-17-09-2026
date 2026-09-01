-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- API Platform — Phase 6: manual webhook replay
--
-- webhook_deliveries is SELECT-only for authenticated users by design: an admin who could edit
-- the delivery log could erase the record of a failed critical-result delivery, which is exactly
-- the evidence the log exists to preserve. So replay cannot be an UPDATE from the browser.
--
-- This RPC is the one sanctioned way to ask for a redelivery. It APPENDS a fresh attempt rather
-- than rewriting the failed one, for the same reason: history stays intact and the log shows
-- both what happened and that someone asked for another try.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.replay_webhook_delivery(p_delivery_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hospital_id  uuid := public.get_user_hospital_id();
  v_delivery     public.webhook_deliveries%ROWTYPE;
  v_endpoint     public.webhook_endpoints%ROWTYPE;
  v_new_id       uuid;
BEGIN
  IF v_hospital_id IS NULL THEN
    RAISE EXCEPTION 'No hospital context for the current user.';
  END IF;

  -- Replaying a webhook re-sends patient and billing events to a third party. That is an admin
  -- action, matching the RLS on api_keys and the route role for /settings/api-portal.
  IF NOT (public.has_role(auth.uid(), 'hospital_admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Only a hospital administrator may replay a webhook delivery.';
  END IF;

  SELECT * INTO v_delivery
    FROM public.webhook_deliveries
   WHERE id = p_delivery_id
     -- Tenant predicate inside the function: SECURITY DEFINER bypasses RLS, so without this a
     -- guessed uuid would replay another hospital's event to this hospital's endpoint.
     AND hospital_id = v_hospital_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such delivery.';
  END IF;

  SELECT * INTO v_endpoint
    FROM public.webhook_endpoints
   WHERE id = v_delivery.endpoint_id
     AND hospital_id = v_hospital_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The endpoint for this delivery no longer exists.';
  END IF;

  -- Replaying into a disabled endpoint would fail immediately and count as another consecutive
  -- failure. Re-enable it first — that ordering is what makes the failure counter meaningful.
  IF NOT v_endpoint.is_active THEN
    RAISE EXCEPTION 'This endpoint is disabled. Re-enable it before replaying.';
  END IF;

  -- Appended as due-now, so the next dispatcher tick picks it up through the ordinary retry path
  -- rather than needing a second code path that could behave differently.
  INSERT INTO public.webhook_deliveries (
    hospital_id, endpoint_id, event_id, attempt, status, next_retry_at, error_message
  )
  VALUES (
    v_hospital_id, v_delivery.endpoint_id, v_delivery.event_id, 1, 'failed', now(),
    'Manual replay requested by a hospital administrator.'
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

COMMENT ON FUNCTION public.replay_webhook_delivery IS
  'Queues a fresh delivery attempt for a past webhook event. Appends to webhook_deliveries '
  'rather than editing it, so the log remains tamper-evident.';

REVOKE ALL ON FUNCTION public.replay_webhook_delivery(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.replay_webhook_delivery(uuid) TO authenticated;
