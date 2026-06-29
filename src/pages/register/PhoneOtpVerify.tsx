import React, { useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { FunctionsError } from "@supabase/supabase-js";

interface SendOtpResponse {
  success?: boolean;
  channel?: "whatsapp" | "sms" | "dev";
  devCode?: string;
  error?: string;
}

interface VerifyOtpResponse {
  success?: boolean;
  verificationToken?: string;
  error?: string;
}

/** Extract a human-readable error from a supabase functions.invoke result. */
async function readFnError(
  fnError: FunctionsError | null,
  data: { error?: string } | null,
): Promise<string> {
  if (fnError) {
    const ctx = (fnError as unknown as { context?: { json?: () => Promise<{ error?: string }> } }).context;
    try {
      const body = await ctx?.json?.();
      return body?.error || fnError.message;
    } catch {
      return fnError.message;
    }
  }
  return data?.error ?? "";
}

interface Props {
  /** Raw phone value from the form (may contain +91, spaces, etc.) */
  phone: string;
  /** Whether the phone has already been verified in this session */
  verified: boolean;
  /** Called once the entered OTP is verified server-side; receives the single-use token */
  onVerified: (token: string) => void;
}

/**
 * Phone verification for the /register wizard.
 *
 * A real 6-digit OTP is generated and verified SERVER-SIDE by the send-signup-otp /
 * verify-signup-otp edge functions and delivered to the registrant's WhatsApp (Meta
 * Cloud API authentication template) with an SMS fallback. The browser never sees the
 * code. On success the edge function returns a single-use verification token that is
 * later validated by register-hospital, so the verified state cannot be forged.
 *
 * If no delivery provider is configured AND the ALLOW_OTP_DEV_FALLBACK secret is "true",
 * the edge function returns the code in `devCode` for local testing only.
 */
const PhoneOtpVerify: React.FC<Props> = ({ phone, verified, onVerified }) => {
  const [sent, setSent] = useState(false);
  const [channel, setChannel] = useState<"whatsapp" | "sms" | "dev">("whatsapp");
  const [devCode, setDevCode] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [resendTimer, setResendTimer] = useState(0);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const tenDigit = (phone || "").replace(/\D/g, "").slice(-10);
  const phoneValid = /^[6-9]\d{9}$/.test(tenDigit);

  useEffect(() => {
    if (resendTimer <= 0) return;
    const t = setTimeout(() => setResendTimer((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [resendTimer]);

  const sendCode = async () => {
    if (!phoneValid) {
      setError("Enter a valid 10-digit Indian mobile number first");
      return;
    }
    setSending(true);
    setError("");
    setOtp(["", "", "", "", "", ""]);
    setDevCode("");

    try {
      const { data, error: fnError } = await supabase.functions.invoke<SendOtpResponse>("send-signup-otp", {
        body: { phone: tenDigit },
      });

      const errMsg = await readFnError(fnError, data);
      if (errMsg || !data?.success) {
        setError(errMsg || "Could not send the code. Please try again.");
        setSending(false);
        return;
      }

      setChannel(data.channel || "whatsapp");
      if (data.devCode) setDevCode(data.devCode);
      setSent(true);
      setResendTimer(30);
      setTimeout(() => refs.current[0]?.focus(), 100);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the code. Please try again.");
    } finally {
      setSending(false);
    }
  };

  const verifyCode = async (joined: string) => {
    setVerifying(true);
    setError("");
    try {
      const { data, error: fnError } = await supabase.functions.invoke<VerifyOtpResponse>("verify-signup-otp", {
        body: { phone: tenDigit, code: joined },
      });

      const errMsg = await readFnError(fnError, data);
      if (errMsg || !data?.success || !data.verificationToken) {
        setError(errMsg || "Incorrect code. Please try again.");
        setOtp(["", "", "", "", "", ""]);
        setTimeout(() => refs.current[0]?.focus(), 50);
        return;
      }

      onVerified(data.verificationToken);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed. Please try again.");
    } finally {
      setVerifying(false);
    }
  };

  const handleChange = (i: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const next = [...otp];
    next[i] = value.slice(-1);
    setOtp(next);
    if (value && i < 5) refs.current[i + 1]?.focus();

    const joined = next.join("");
    if (joined.length === 6 && next.every((d) => d) && !verifying) {
      verifyCode(joined);
    }
  };

  const handleKeyDown = (i: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !otp[i] && i > 0) refs.current[i - 1]?.focus();
  };

  if (verified) {
    return (
      <div className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-[hsl(160,84%,39%)]">
        <Check size={14} /> Mobile number verified
      </div>
    );
  }

  if (!sent) {
    return (
      <div className="mt-2">
        <button
          type="button"
          onClick={sendCode}
          disabled={!phoneValid || sending}
          className="text-[13px] font-medium text-primary hover:underline disabled:opacity-40 disabled:no-underline inline-flex items-center gap-1.5"
        >
          {sending ? <Loader2 size={13} className="animate-spin" /> : null}
          {sending ? "Sending code…" : "Verify this number"}
        </button>
        {error && <p className="text-xs text-destructive mt-1">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      <p className="text-[13px] text-muted-foreground">
        {channel === "sms"
          ? `We sent a 6-digit code by SMS to +91 ${tenDigit}`
          : channel === "dev"
          ? `Enter the 6-digit code for +91 ${tenDigit}`
          : `We sent a 6-digit code to your WhatsApp on +91 ${tenDigit}`}
      </p>
      <div className="flex gap-2">
        {otp.map((digit, i) => (
          <input
            key={i}
            ref={(el) => { refs.current[i] = el; }}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={digit}
            disabled={verifying}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            aria-label={`Verification code digit ${i + 1}`}
            className="w-11 h-12 text-center text-lg font-bold rounded-md border-2 border-border bg-background text-foreground outline-none focus:border-primary transition-colors disabled:opacity-50"
          />
        ))}
      </div>
      {verifying && (
        <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
          <Loader2 size={12} className="animate-spin" /> Verifying…
        </p>
      )}
      {devCode && (
        <p className="text-xs text-amber-600">
          Dev mode (no provider configured): <span className="font-mono font-bold">{devCode}</span>
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div>
        {resendTimer > 0 ? (
          <span className="text-xs text-muted-foreground">Resend in {resendTimer}s</span>
        ) : (
          <button type="button" onClick={sendCode} disabled={sending} className="text-xs font-medium text-primary hover:underline disabled:opacity-40">
            Resend code
          </button>
        )}
      </div>
    </div>
  );
};

export default PhoneOtpVerify;
