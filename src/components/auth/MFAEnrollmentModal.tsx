import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Shield, QrCode, Copy, CheckCircle2, Loader2, KeyRound } from "lucide-react";

interface Props {
  /** When false the user cannot dismiss — used for mandatory-role enforcement */
  canDismiss?: boolean;
  onEnrolled: () => void;
  onDismiss?: () => void;
}

type Step = "qr" | "verify" | "backup";

export default function MFAEnrollmentModal({ canDismiss = true, onEnrolled, onDismiss }: Props) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("qr");
  const [factorId, setFactorId]     = useState("");
  const [qrUrl, setQrUrl]           = useState("");
  const [secret, setSecret]         = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [code, setCode]             = useState("");
  const [loading, setLoading]       = useState(false);
  const [enrolling, setEnrolling]   = useState(false);
  const [copied, setCopied]         = useState(false);
  const [copiedBackup, setCopiedBackup] = useState(false);

  // Step 1: call Supabase mfa.enroll to get QR code
  const startEnrollment = async () => {
    setEnrolling(true);
    try {
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
      if (error) throw error;
      setFactorId(data.id);
      setQrUrl(data.totp.qr_code);
      setSecret(data.totp.secret);
    } catch (err: any) {
      toast({ title: "Could not start MFA setup", description: err.message, variant: "destructive" });
    } finally {
      setEnrolling(false);
    }
  };

  // Step 2: verify the 6-digit code from authenticator app
  const verifyCode = async () => {
    if (code.length !== 6) return;
    setLoading(true);
    try {
      const { data: challengeData, error: challengeErr } = await supabase.auth.mfa.challenge({ factorId });
      if (challengeErr) throw challengeErr;

      const { error: verifyErr } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challengeData.id,
        code,
      });
      if (verifyErr) throw verifyErr;

      // Generate 8 backup codes (random alphanumeric)
      const codes = Array.from({ length: 8 }, () =>
        Math.random().toString(36).substring(2, 7).toUpperCase() +
        "-" +
        Math.random().toString(36).substring(2, 7).toUpperCase()
      );
      setBackupCodes(codes);
      setStep("backup");
    } catch (err: any) {
      toast({ title: "Invalid code", description: "The code did not match. Try again.", variant: "destructive" });
      setCode("");
    } finally {
      setLoading(false);
    }
  };

  const copySecret = () => {
    navigator.clipboard.writeText(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyBackupCodes = () => {
    navigator.clipboard.writeText(backupCodes.join("\n"));
    setCopiedBackup(true);
    setTimeout(() => setCopiedBackup(false), 2000);
  };

  const finish = () => {
    toast({ title: "MFA enabled", description: "Your account is now protected with two-factor authentication." });
    onEnrolled();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center gap-3 p-6 border-b border-border">
          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Shield size={18} className="text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[15px] font-semibold text-foreground">Set Up Two-Factor Authentication</h2>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              {!canDismiss ? "Required for your role" : "Secure your account with an authenticator app"}
            </p>
          </div>
          {canDismiss && (
            <button onClick={onDismiss} className="text-muted-foreground hover:text-foreground transition-colors text-[18px] leading-none">✕</button>
          )}
        </div>

        <div className="p-6">
          {/* ── Step: QR ── */}
          {step === "qr" && (
            <div className="space-y-5">
              {!qrUrl ? (
                <>
                  <p className="text-[13px] text-muted-foreground leading-relaxed">
                    Use Google Authenticator, Authy, or any TOTP app to scan a QR code and generate time-based one-time passwords on your phone.
                  </p>
                  <div className="bg-muted/40 rounded-xl p-4 flex items-start gap-3">
                    <KeyRound size={15} className="text-primary mt-0.5 shrink-0" />
                    <p className="text-[12px] text-muted-foreground">
                      Each login will require a 6-digit code from your authenticator app in addition to your password.
                    </p>
                  </div>
                  <button
                    onClick={startEnrollment}
                    disabled={enrolling}
                    className="w-full h-11 bg-primary text-primary-foreground rounded-lg text-[14px] font-semibold flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50"
                  >
                    {enrolling ? <Loader2 size={16} className="animate-spin" /> : <QrCode size={16} />}
                    {enrolling ? "Generating QR Code…" : "Get QR Code"}
                  </button>
                </>
              ) : (
                <>
                  <p className="text-[13px] text-muted-foreground">
                    Open your authenticator app and scan this QR code:
                  </p>
                  <div className="flex justify-center">
                    <div className="bg-white p-3 rounded-xl inline-block">
                      <img src={qrUrl} alt="MFA QR Code" className="w-44 h-44" />
                    </div>
                  </div>
                  <div className="bg-muted/40 rounded-lg p-3">
                    <p className="text-[11px] text-muted-foreground mb-1.5">Can't scan? Enter this key manually:</p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-[12px] font-mono text-foreground break-all">{secret}</code>
                      <button onClick={copySecret} className="shrink-0 text-muted-foreground hover:text-primary transition-colors">
                        {copied ? <CheckCircle2 size={14} className="text-green-500" /> : <Copy size={14} />}
                      </button>
                    </div>
                  </div>
                  <button
                    onClick={() => setStep("verify")}
                    className="w-full h-11 bg-primary text-primary-foreground rounded-lg text-[14px] font-semibold hover:opacity-90"
                  >
                    I've scanned it — Continue
                  </button>
                </>
              )}
            </div>
          )}

          {/* ── Step: Verify ── */}
          {step === "verify" && (
            <div className="space-y-5">
              <div className="text-center">
                <p className="text-[13px] text-muted-foreground">
                  Enter the 6-digit code from your authenticator app to confirm setup:
                </p>
              </div>
              <div className="flex justify-center">
                <InputOTP
                  maxLength={6}
                  value={code}
                  onChange={setCode}
                  onComplete={verifyCode}
                >
                  <InputOTPGroup>
                    {Array.from({ length: 6 }).map((_, i) => (
                      <InputOTPSlot key={i} index={i} className="h-12 w-12 text-[18px]" />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </div>
              <button
                onClick={verifyCode}
                disabled={loading || code.length !== 6}
                className="w-full h-11 bg-primary text-primary-foreground rounded-lg text-[14px] font-semibold flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                {loading ? "Verifying…" : "Confirm Code"}
              </button>
              <button onClick={() => setStep("qr")} className="w-full text-[13px] text-muted-foreground hover:text-foreground transition-colors">
                ← Back to QR code
              </button>
            </div>
          )}

          {/* ── Step: Backup codes ── */}
          {step === "backup" && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-green-600">
                <CheckCircle2 size={18} />
                <p className="text-[14px] font-semibold">Authenticator app linked!</p>
              </div>
              <p className="text-[13px] text-muted-foreground leading-relaxed">
                Save these backup codes in a safe place. Each code can be used once if you lose access to your authenticator app.
              </p>
              <div className="bg-muted/40 rounded-xl p-4 grid grid-cols-2 gap-2">
                {backupCodes.map(c => (
                  <code key={c} className="text-[12px] font-mono text-foreground text-center">{c}</code>
                ))}
              </div>
              <button
                onClick={copyBackupCodes}
                className="w-full h-9 border border-border rounded-lg text-[13px] font-medium text-foreground flex items-center justify-center gap-2 hover:bg-muted/40 transition-colors"
              >
                {copiedBackup ? <CheckCircle2 size={14} className="text-green-500" /> : <Copy size={14} />}
                {copiedBackup ? "Copied!" : "Copy All Codes"}
              </button>
              <button
                onClick={finish}
                className="w-full h-11 bg-primary text-primary-foreground rounded-lg text-[14px] font-semibold hover:opacity-90"
              >
                I've saved my backup codes — Finish
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
