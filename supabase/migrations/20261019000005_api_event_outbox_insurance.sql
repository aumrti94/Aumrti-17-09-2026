-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- API Platform — Phase 7: insurance / TPA outbox events
--
-- Reuses emit_api_event() from 20261019000003. Adding an event is adding a trigger; there is no
-- second emitter function to drift from the first.
--
-- ── Why these fire on column transitions, not on status ──────────────────────────────────────
-- Unlike appointments (validate_appointment constrains status to a known set) and bills
-- (payment_status has a small, consistent vocabulary), insurance_claims.status and
-- insurance_pre_auth.status carry NO check constraint, and the application writes a mixed
-- vocabulary across screens — 'submitted', 'approved', 'rejected', 'appeal_submitted', 'draft',
-- 'pending', 'active' and more, with no single authority.
--
-- A trigger keyed on a status string would therefore be guessing, and would silently stop firing
-- the day a screen writes a spelling nobody reconciled. Keying on a timestamp or amount column
-- becoming non-NULL is unambiguous: settlement_date is set when, and only when, the claim is
-- settled. Same approach as discharged_at, validated_at, dispensed_at and is_signed.
--
-- Contract: docs/api/EVENT_CATALOG.md
-- ═════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Pre-authorisation ────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_emit_pre_auth_submitted ON public.insurance_pre_auth;
CREATE TRIGGER trg_emit_pre_auth_submitted
  AFTER UPDATE ON public.insurance_pre_auth
  FOR EACH ROW
  WHEN (OLD.submitted_at IS NULL AND NEW.submitted_at IS NOT NULL)
  EXECUTE FUNCTION public.emit_api_event('insurance.pre_auth.submitted', '/v1/insurance/pre-authorisations');

DROP TRIGGER IF EXISTS trg_emit_pre_auth_approved ON public.insurance_pre_auth;
CREATE TRIGGER trg_emit_pre_auth_approved
  AFTER UPDATE ON public.insurance_pre_auth
  FOR EACH ROW
  WHEN (OLD.approved_at IS NULL AND NEW.approved_at IS NOT NULL)
  EXECUTE FUNCTION public.emit_api_event('insurance.pre_auth.approved', '/v1/insurance/pre-authorisations');

-- Either field may be the one the workflow populates on refusal, so the trigger accepts whichever
-- arrives first. emit_api_event is not idempotent per row, but these two are only ever set
-- together or singly on the same transition, so this fires once in practice.
DROP TRIGGER IF EXISTS trg_emit_pre_auth_rejected ON public.insurance_pre_auth;
CREATE TRIGGER trg_emit_pre_auth_rejected
  AFTER UPDATE ON public.insurance_pre_auth
  FOR EACH ROW
  WHEN (
    (OLD.rejection_reason IS NULL AND NEW.rejection_reason IS NOT NULL) OR
    (OLD.denial_reason    IS NULL AND NEW.denial_reason    IS NOT NULL)
  )
  EXECUTE FUNCTION public.emit_api_event('insurance.pre_auth.rejected', '/v1/insurance/pre-authorisations');

-- ── Claims ───────────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_emit_claim_submitted ON public.insurance_claims;
CREATE TRIGGER trg_emit_claim_submitted
  AFTER UPDATE ON public.insurance_claims
  FOR EACH ROW
  WHEN (OLD.submitted_at IS NULL AND NEW.submitted_at IS NOT NULL)
  EXECUTE FUNCTION public.emit_api_event('insurance.claim.submitted', '/v1/insurance/claims');

-- settlement_date, not settled_amount: a settlement of zero is still a settlement, and keying on
-- the amount would miss it.
DROP TRIGGER IF EXISTS trg_emit_claim_settled ON public.insurance_claims;
CREATE TRIGGER trg_emit_claim_settled
  AFTER UPDATE ON public.insurance_claims
  FOR EACH ROW
  WHEN (OLD.settlement_date IS NULL AND NEW.settlement_date IS NOT NULL)
  EXECUTE FUNCTION public.emit_api_event('insurance.claim.settled', '/v1/insurance/claims');

-- The most commercially urgent event in this set: a denial starts the appeal clock, and
-- appeal_deadline is frequently days away.
DROP TRIGGER IF EXISTS trg_emit_claim_denied ON public.insurance_claims;
CREATE TRIGGER trg_emit_claim_denied
  AFTER UPDATE ON public.insurance_claims
  FOR EACH ROW
  WHEN (
    (OLD.rejection_notice_date IS NULL AND NEW.rejection_notice_date IS NOT NULL) OR
    (OLD.denial_code           IS NULL AND NEW.denial_code           IS NOT NULL)
  )
  EXECUTE FUNCTION public.emit_api_event('insurance.claim.denied', '/v1/insurance/claims');

-- ── TPA queries ──────────────────────────────────────────────────────────────────────────────
-- An unanswered TPA query is one of the commonest causes of an otherwise valid claim being
-- rejected, and response_deadline is usually short. This is the event a revenue-cycle partner
-- most wants pushed rather than polled.
DROP TRIGGER IF EXISTS trg_emit_tpa_query_raised ON public.tpa_queries;
CREATE TRIGGER trg_emit_tpa_query_raised
  AFTER INSERT ON public.tpa_queries
  FOR EACH ROW EXECUTE FUNCTION public.emit_api_event('insurance.query.raised', '/v1/insurance/queries');

COMMIT;
