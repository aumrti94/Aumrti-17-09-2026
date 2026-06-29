-- Signup phone OTP verification store (platform-level, pre-tenant).
--
-- Used by the /register wizard to deliver a real OTP to the registrant's WhatsApp
-- (or SMS fallback) and verify it server-side. There is no hospital yet at signup,
-- so this is a PLATFORM table: it has no hospital_id and is touched ONLY by the
-- send-signup-otp / verify-signup-otp / register-hospital edge functions using the
-- service-role key. RLS is enabled with NO policy so the anon/auth client can never
-- read codes, tokens, or attempt counts directly.
--
-- The plaintext OTP is never stored — only a SHA-256 hash. On successful verification
-- a single-use verification_token is issued, which register-hospital validates before
-- creating the account (so the client-side phoneVerified flag cannot be forged).

CREATE TABLE IF NOT EXISTS public.signup_otp_verifications (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  phone               text NOT NULL,                 -- bare 10-digit Indian mobile
  otp_hash            text NOT NULL,                 -- SHA-256 of the 6-digit code
  channel             text,                          -- 'whatsapp' | 'sms' | 'dev'
  provider            text,                          -- 'msg91' | 'meta' | 'twilio' | 'dev'
  attempts            integer NOT NULL DEFAULT 0,    -- failed verify attempts
  send_count          integer NOT NULL DEFAULT 1,    -- number of (re)sends for this phone window
  verified            boolean NOT NULL DEFAULT false,
  verification_token  text,                          -- single-use token issued on success
  token_consumed      boolean NOT NULL DEFAULT false,
  expires_at          timestamptz NOT NULL,          -- code expiry (10 min)
  token_expires_at    timestamptz,                   -- token expiry (15 min after verify)
  request_ip          text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signup_otp_phone       ON public.signup_otp_verifications (phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signup_otp_token       ON public.signup_otp_verifications (verification_token);
CREATE INDEX IF NOT EXISTS idx_signup_otp_expires     ON public.signup_otp_verifications (expires_at);

-- Enable RLS with NO policy: only the service-role key (which bypasses RLS) may access.
ALTER TABLE public.signup_otp_verifications ENABLE ROW LEVEL SECURITY;
