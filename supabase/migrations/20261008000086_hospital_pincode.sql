-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: hospital_pincode
-- Purpose  : Add hospitals.pincode so the e-invoice (NIC IRP) SellerDtls.Pin can
--            use the hospital's real 6-digit PIN instead of a hardcoded value.
--            state_code already exists (20261008000077_gst_split); this completes
--            the seller address needed for a valid IRN payload.
-- Idempotent: ADD COLUMN IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.hospitals ADD COLUMN IF NOT EXISTS pincode text;

COMMENT ON COLUMN public.hospitals.pincode IS '6-digit PIN code of the hospital, used for GST e-invoice SellerDtls.Pin.';
