import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Shield, Loader2, CheckCircle2 } from "lucide-react";

interface Props {
  factorId: string;
  userId: string;
  userName: string;
  onVerified: () => void;
}

function getDeviceFingerprint(): string {
  const raw = [
    navigator.userAgent,
    navigator.language,
    screen.width,
    screen.height,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  ].join("|");
  // Simple hash — good enough for device recognition (not security-critical)
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = (Math.imul(31, hash) + raw.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

const TRUSTED_KEY = "aumrti_trusted_devices";

function isTrustedDevice(userId: string): boolean {
  try {
    const stored = localStorage.getItem(TRUSTED_KEY);
    if (!stored) return false;
    const map: Record<string, string> = JSON.parse(stored);
    const expiry = map[`${userId}_${getDeviceFingerprint()}`];
    if (!expiry) return false;
    return new Date(expiry) > new Date();
  } catch {
    return false;
  }
}

function trustDevice(userId: string) {
  try {
    const stored = localStorage.getItem(TRUSTED_KEY);
    const map: Record<string, string> = stored ? JSON.parse(stored) : {};
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 30);
    map[`${userId}_${getDeviceFingerprint()}`] = expiry.toISOString();
    localStorage.setItem(TRUSTED_KEY, JSON.stringify(map));
  } catch { /* ignore */ }
}

export { isTrustedDevice };

export default function MFAVerifyModal({ factorId, userId, userName, onVerified }: Props) {
  const { toast } = useToast();
  const [code, setCode]             = useState("");
  const [loading, setLoading]       = useState(false);
  const [remember, setRemember]     = useState(false);
  const [challengeId, setChallengeId] = useState("");
  const [attempts, setAttempts]     = useState(0);

  useEffect(() => {
    // Kick off a challenge as soon as the modal opens
    supabase.auth.mfa.challenge({ factorId }).then(({ data, error }) => {
      if (!error && data) setChallengeId(data.id);
    });
  }, [factorId]);

  const verify = async () => {
    if (code.length !== 6 || !challengeId) return;
    setLoading(true);
    try {
      const { error } = await supabase.auth.mfa.verify({ factorId, challengeId, code });
      if (error) throw error;

      if (remember) {
        trustDevice(userId);
        // Also persist to DB so device trust survives localStorage clear
        await supabase.from("user_trusted_devices" as any).upsert({
          user_id: userId,
          device_name: navigator.userAgent.substring(0, 80),
          fingerprint_hash: getDeviceFingerprint(),
          expires_at: (() => {
            const d = new Date();
            d.setDate(d.getDate() + 30);
            return d.toISOString();
          })(),
        }, { onConflict: "user_id,fingerprint_hash" });
      }

      onVerified();
    } catch {
      const next = attempts + 1;
      setAttempts(next);
      toast({
        title: "Invalid code",
        description: next >= 5 ? "Too many attempts. Please sign in again." : "The code did not match. Try again.",
        variant: "destructive",
      });
      setCode("");
      if (next >= 5) {
        await supabase.auth.signOut();
        window.location.href = "/login";
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-[380px]">
        {/* Header */}
        <div className="flex flex-col items-center gap-2 pt-8 px-6 pb-4">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
            <Shield size={22} className="text-primary" />
          </div>
          <h2 className="text-[16px] font-semibold text-foreground">Two-Factor Verification</h2>
          <p className="text-[13px] text-muted-foreground text-center">
            Hi <span className="font-medium text-foreground">{userName}</span>, enter the code from your authenticator app to continue.
          </p>
        </div>

        <div className="px-6 pb-6 space-y-5">
          {/* OTP input */}
          <div className="flex justify-center">
            <InputOTP
              maxLength={6}
              value={code}
              onChange={setCode}
              onComplete={verify}
              autoFocus
            >
              <InputOTPGroup>
                {Array.from({ length: 6 }).map((_, i) => (
                  <InputOTPSlot key={i} index={i} className="h-12 w-12 text-[20px]" />
                ))}
              </InputOTPGroup>
            </InputOTP>
          </div>

          {/* Remember device */}
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={remember}
              onChange={e => setRemember(e.target.checked)}
              className="w-4 h-4 rounded border-border text-primary focus:ring-primary/20"
            />
            <span className="text-[13px] text-foreground">Remember this device for 30 days</span>
          </label>

          {/* Verify button */}
          <button
            onClick={verify}
            disabled={loading || code.length !== 6 || !challengeId}
            className="w-full h-11 bg-primary text-primary-foreground rounded-lg text-[14px] font-semibold flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            {loading ? "Verifying…" : "Verify & Sign In"}
          </button>

          <p className="text-center text-[12px] text-muted-foreground">
            Open Google Authenticator, Authy, or your TOTP app to get the code.
          </p>

          <p className="text-center text-[11px] text-muted-foreground/70 border-t border-border pt-3">
            Lost access to your authenticator?{" "}
            <span className="font-medium text-muted-foreground">Ask your hospital admin to click <em>Reset MFA</em> next to your name in Settings → Staff.</span>
          </p>
        </div>
      </div>
    </div>
  );
}
