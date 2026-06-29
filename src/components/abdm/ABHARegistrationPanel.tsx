import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import {
  ShieldCheck, AlertTriangle, CheckCircle2, ArrowLeft,
  Loader2, Smartphone, CreditCard, SkipForward, RefreshCw, Printer,
} from "lucide-react";
import ABHASearchPanel from "@/components/patients/ABHASearchPanel";
import { cn } from "@/lib/utils";

type Step =
  | "choice"
  | "link"
  | "mobile_input"
  | "aadhaar_input"
  | "otp"
  | "address"
  | "done";

interface AbhaResult {
  abhaNumber: string;
  abhaAddress: string;
  name: string;
}

interface ExistingAccount {
  ABHANumber?: string;
  healthId?: string;
  name?: string;
}

interface Props {
  patientId: string;
  patientName: string;
  patientMobile: string;
  onComplete: (abhaNumber: string, abhaAddress: string) => void;
  onSkip?: () => void;
}

function formatAbhaNumber(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `${d.slice(0, 2)}-${d.slice(2)}`;
  if (d.length <= 10) return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6)}`;
  return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6, 10)}-${d.slice(10)}`;
}

const ABHARegistrationPanel: React.FC<Props> = ({
  patientId,
  patientName,
  patientMobile,
  onComplete,
  onSkip,
}) => {
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();

  const [step, setStep] = useState<Step>("choice");
  const [flowType, setFlowType] = useState<"mobile" | "aadhaar">("mobile");

  // Inputs
  const [mobile, setMobile] = useState(patientMobile || "");
  const [aadhaar, setAadhaar] = useState("");
  const [aadhaarConsent, setAadhaarConsent] = useState(false);
  const [otp, setOtp] = useState("");
  const [abhaAddressInput, setAbhaAddressInput] = useState("");
  const [selectedExisting, setSelectedExisting] = useState<string>("");

  // Flow state
  const [txnId, setTxnId] = useState("");
  const [existingAccounts, setExistingAccounts] = useState<ExistingAccount[]>([]);
  const [result, setResult] = useState<AbhaResult | null>(null);

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendTimer, setResendTimer] = useState(0);
  const [showSkipWarning, setShowSkipWarning] = useState(false);

  // Countdown timer for OTP resend
  useEffect(() => {
    if (resendTimer <= 0) return;
    const t = setTimeout(() => setResendTimer((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendTimer]);

  // ── API call helper ────────────────────────────────────────────────────────
  const callCreate = async (
    action: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const { data, error: fnErr } = await supabase.functions.invoke(
      "abdm-abha-create",
      {
        body: {
          action,
          hospital_id: hospitalId,
          patient_id: patientId,
          ...body,
        },
      },
    );
    if (fnErr) throw new Error(fnErr.message || "Request failed");
    const d = data as Record<string, unknown>;
    if (d?.error) throw new Error(d.error as string);
    return d;
  };

  const withLoad = async (fn: () => Promise<void>) => {
    setError(null);
    setLoading(true);
    try {
      await fn();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      setError(msg);
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // ── Step handlers ──────────────────────────────────────────────────────────

  const handleInitiateMobile = () =>
    withLoad(async () => {
      if (!mobile || mobile.replace(/\D/g, "").length < 10) {
        throw new Error("Enter a valid 10-digit mobile number");
      }
      const d = await callCreate("initiate_mobile", { mobile });
      setTxnId(d.txnId as string);
      setFlowType("mobile");
      setOtp("");
      setResendTimer(60);
      setStep("otp");
    });

  const handleInitiateAadhaar = () =>
    withLoad(async () => {
      if (!aadhaarConsent) throw new Error("Consent is required before proceeding");
      const digits = aadhaar.replace(/\D/g, "");
      if (digits.length !== 12) throw new Error("Enter a valid 12-digit Aadhaar number");
      const d = await callCreate("initiate_aadhaar", { aadhaar: digits });
      setTxnId(d.txnId as string);
      setFlowType("aadhaar");
      setOtp("");
      setResendTimer(60);
      setStep("otp");
    });

  const handleVerifyOtp = () =>
    withLoad(async () => {
      if (otp.length !== 6) throw new Error("Enter the complete 6-digit OTP");
      if (flowType === "mobile") {
        const d = await callCreate("verify_mobile_otp", { txn_id: txnId, otp });
        setTxnId(d.txnId as string);
        const accs = (d.accounts as ExistingAccount[]) ?? [];
        setExistingAccounts(accs);
        if (accs.length > 0) setSelectedExisting(accs[0].ABHANumber ?? accs[0].healthId ?? "");
        setStep("address");
      } else {
        const d = await callCreate("verify_aadhaar_otp", {
          txn_id: txnId,
          otp,
          mobile: mobile || undefined,
        });
        setTxnId(d.txnId as string);
        setExistingAccounts([]);
        setStep("address");
      }
    });

  const handleResendOtp = () => {
    if (resendTimer > 0) return;
    if (flowType === "mobile") handleInitiateMobile();
    else handleInitiateAadhaar();
  };

  const handleCreateAddress = () =>
    withLoad(async () => {
      const addr = selectedExisting || abhaAddressInput.trim();
      if (!addr) throw new Error("Choose or enter an ABHA address");
      if (!selectedExisting) {
        if (addr.length < 8 || addr.length > 18)
          throw new Error("ABHA address must be 8–18 characters");
        if (!/^[a-zA-Z0-9._]+$/.test(addr))
          throw new Error("Only letters, digits, dots and underscores allowed");
      }
      const d = await callCreate("create_address", {
        txn_id: txnId,
        abha_address: addr,
        mobile: mobile || undefined,
      });
      setResult({
        abhaNumber: (d.abhaNumber as string) ?? "",
        abhaAddress: (d.abhaAddress as string) ?? addr,
        name: (d.name as string) ?? patientName,
      });
      setStep("done");
    });

  const handleDone = () => {
    if (result) onComplete(result.abhaNumber, result.abhaAddress);
  };

  const handlePrint = () => {
    const w = window.open("", "_blank", "width=400,height=300");
    if (!w || !result) return;
    const num = formatAbhaNumber(result.abhaNumber);
    w.document.write(`
      <html><head><title>ABHA Card</title>
      <style>
        body { font-family: sans-serif; padding: 24px; max-width: 360px; margin: auto; }
        .header { display:flex; align-items:center; gap:8px; margin-bottom:16px; }
        .logo { width:36px; height:36px; background:#1A2F5A; border-radius:50%; display:flex; align-items:center; justify-content:center; color:#fff; font-weight:bold; font-size:14px; }
        h1 { font-size:14px; color:#1A2F5A; margin:0; }
        p { font-size:12px; color:#555; margin:2px 0; }
        .number { font-size:18px; font-weight:bold; letter-spacing:2px; color:#1A2F5A; margin:8px 0; }
        .address { font-size:13px; color:#047857; }
        @media print { body { padding: 8px; } }
      </style></head><body>
      <div class="header">
        <div class="logo">A</div>
        <h1>Ayushman Bharat Health Account</h1>
      </div>
      <p><strong>Name:</strong> ${result.name || patientName}</p>
      <div class="number">${num}</div>
      <div class="address">${result.abhaAddress}</div>
      <p style="margin-top:12px;font-size:10px;color:#999">Generated via Aumrti HMS · Powered by NHA ABDM</p>
      </body></html>
    `);
    w.document.close();
    w.focus();
    w.print();
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const backToChoice = () => {
    setStep("choice");
    setError(null);
    setOtp("");
    setTxnId("");
    setExistingAccounts([]);
    setAbhaAddressInput("");
    setSelectedExisting("");
  };

  const StepHeader = ({ label, onBack }: { label: string; onBack?: () => void }) => (
    <div className="flex items-center gap-2 mb-4">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="h-7 w-7 rounded-full flex items-center justify-center hover:bg-muted transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      )}
      <span className="text-xs font-semibold text-foreground">{label}</span>
    </div>
  );

  const ErrorBox = () =>
    error ? (
      <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span>{error}</span>
      </div>
    ) : null;

  // ── STEP: choice ────────────────────────────────────────────────────────────
  if (step === "choice") {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-blue-600" />
          <span className="text-xs font-semibold text-foreground">
            Does this patient have an ABHA?
          </span>
          <Badge variant="secondary" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200 ml-auto">
            Recommended for ABDM
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-2">
          <button
            type="button"
            onClick={() => setStep("link")}
            className="flex items-center gap-3 px-4 py-3 rounded-lg border border-border bg-card hover:bg-muted/50 transition-colors text-left"
          >
            <div className="h-8 w-8 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
              <ShieldCheck className="h-4 w-4 text-emerald-700" />
            </div>
            <div>
              <p className="text-xs font-semibold">Yes — Link Existing ABHA</p>
              <p className="text-[11px] text-muted-foreground">Patient already has an ABHA number or @abdm address</p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => { setFlowType("mobile"); setStep("mobile_input"); }}
            className="flex items-center gap-3 px-4 py-3 rounded-lg border border-blue-200 bg-blue-50/50 hover:bg-blue-50 transition-colors text-left"
          >
            <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
              <Smartphone className="h-4 w-4 text-blue-700" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold">Create via Mobile OTP</p>
                <Badge className="text-[9px] px-1.5 py-0 bg-blue-600 hover:bg-blue-600">Recommended</Badge>
              </div>
              <p className="text-[11px] text-muted-foreground">Faster — OTP sent to patient's mobile number</p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => { setFlowType("aadhaar"); setStep("aadhaar_input"); }}
            className="flex items-center gap-3 px-4 py-3 rounded-lg border border-border bg-card hover:bg-muted/50 transition-colors text-left"
          >
            <div className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
              <CreditCard className="h-4 w-4 text-slate-600" />
            </div>
            <div>
              <p className="text-xs font-semibold">Create via Aadhaar OTP</p>
              <p className="text-[11px] text-muted-foreground">Verified with UIDAI — Aadhaar number not stored</p>
            </div>
          </button>
        </div>

        {!showSkipWarning ? (
          <button
            type="button"
            onClick={() => setShowSkipWarning(true)}
            className="w-full flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors py-1.5"
          >
            <SkipForward className="h-3 w-3" />
            Skip for now
          </button>
        ) : (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber-800">
                ABHA linkage is required for ABDM-compliant health record sharing. Patients without ABHA cannot participate in digital health record exchange.
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="h-7 text-xs flex-1" onClick={() => setShowSkipWarning(false)}>
                Link ABHA
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs flex-1 text-muted-foreground"
                onClick={onSkip}
              >
                Skip anyway
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── STEP: link existing (delegates to ABHASearchPanel) ─────────────────────
  if (step === "link") {
    return (
      <div className="space-y-3">
        <StepHeader label="Link Existing ABHA" onBack={backToChoice} />
        {hospitalId ? (
          <ABHASearchPanel
            patientId={patientId}
            hospitalId={hospitalId}
            onLinked={(abhaId) => onComplete(abhaId, "")}
          />
        ) : (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
          </div>
        )}
      </div>
    );
  }

  // ── STEP: mobile_input ─────────────────────────────────────────────────────
  if (step === "mobile_input") {
    return (
      <div className="space-y-3">
        <StepHeader label="Create ABHA via Mobile OTP" onBack={backToChoice} />
        <div>
          <Label className="text-xs">Mobile Number</Label>
          <Input
            type="tel"
            inputMode="numeric"
            maxLength={10}
            value={mobile}
            onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").slice(0, 10))}
            placeholder="10-digit mobile number"
            className="mt-1 h-9 text-sm"
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            OTP will be sent to this mobile number for verification.
          </p>
        </div>
        <ErrorBox />
        <Button
          size="sm"
          className="w-full h-9"
          onClick={handleInitiateMobile}
          disabled={loading || mobile.length < 10}
        >
          {loading
            ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Sending OTP…</>
            : <><Smartphone className="h-3.5 w-3.5 mr-1.5" />Send OTP to Mobile</>
          }
        </Button>
      </div>
    );
  }

  // ── STEP: aadhaar_input ────────────────────────────────────────────────────
  if (step === "aadhaar_input") {
    return (
      <div className="space-y-3">
        <StepHeader label="Create ABHA via Aadhaar" onBack={backToChoice} />

        <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-[11px] text-amber-800 leading-relaxed">
            <strong>Privacy notice:</strong> Aadhaar data is transmitted directly to UIDAI for OTP generation and is <strong>not stored</strong> by this system. Used only for identity verification as per ABDM guidelines.
          </p>
        </div>

        <div>
          <Label className="text-xs">Aadhaar Number</Label>
          <Input
            type="password"
            inputMode="numeric"
            maxLength={12}
            value={aadhaar}
            onChange={(e) => setAadhaar(e.target.value.replace(/\D/g, "").slice(0, 12))}
            placeholder="12-digit Aadhaar number"
            className="mt-1 h-9 font-mono text-sm tracking-widest"
            autoComplete="off"
          />
          {aadhaar.length > 0 && (
            <p className="text-[11px] text-muted-foreground mt-1 font-mono">
              {"*".repeat(Math.max(0, aadhaar.length - 4))}{aadhaar.slice(-4)}
            </p>
          )}
        </div>

        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={aadhaarConsent}
            onChange={(e) => setAadhaarConsent(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 rounded"
          />
          <span className="text-[11px] text-foreground leading-relaxed">
            I consent to share Aadhaar for ABHA creation as per{" "}
            <strong>ABDM guidelines</strong>. Patient has given verbal consent for this identity verification.
          </span>
        </label>

        <ErrorBox />
        <Button
          size="sm"
          className="w-full h-9"
          onClick={handleInitiateAadhaar}
          disabled={loading || aadhaar.length < 12 || !aadhaarConsent}
        >
          {loading
            ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Sending OTP…</>
            : <><CreditCard className="h-3.5 w-3.5 mr-1.5" />Send OTP to Aadhaar-linked Mobile</>
          }
        </Button>
      </div>
    );
  }

  // ── STEP: otp ──────────────────────────────────────────────────────────────
  if (step === "otp") {
    return (
      <div className="space-y-4">
        <StepHeader
          label="Enter OTP"
          onBack={() => setStep(flowType === "mobile" ? "mobile_input" : "aadhaar_input")}
        />

        <div className="text-center space-y-1">
          <p className="text-xs text-muted-foreground">
            OTP sent to{" "}
            <span className="font-semibold text-foreground">
              {flowType === "mobile"
                ? `+91 ${mobile.slice(0, 2)}****${mobile.slice(-2)}`
                : "Aadhaar-linked mobile"}
            </span>
          </p>
          <p className="text-[11px] text-muted-foreground">Enter the 6-digit code below</p>
        </div>

        <div className="flex justify-center">
          <InputOTP
            maxLength={6}
            value={otp}
            onChange={setOtp}
            autoFocus
          >
            <InputOTPGroup>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <InputOTPSlot key={i} index={i} className="h-11 w-11 text-base" />
              ))}
            </InputOTPGroup>
          </InputOTP>
        </div>

        <div className="text-center">
          {resendTimer > 0 ? (
            <p className="text-[11px] text-muted-foreground">
              Resend OTP in{" "}
              <span className="font-semibold text-foreground tabular-nums">{resendTimer}s</span>
            </p>
          ) : (
            <button
              type="button"
              onClick={handleResendOtp}
              disabled={loading}
              className="text-[11px] text-blue-600 hover:underline font-medium flex items-center gap-1 mx-auto"
            >
              <RefreshCw className="h-3 w-3" />
              Resend OTP
            </button>
          )}
        </div>

        <ErrorBox />
        <Button
          size="sm"
          className="w-full h-9"
          onClick={handleVerifyOtp}
          disabled={loading || otp.length < 6}
        >
          {loading
            ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Verifying…</>
            : <><CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />Verify OTP</>
          }
        </Button>
      </div>
    );
  }

  // ── STEP: address ──────────────────────────────────────────────────────────
  if (step === "address") {
    const hasExisting = existingAccounts.length > 0;
    return (
      <div className="space-y-3">
        <StepHeader label="Choose ABHA Address" onBack={() => setStep("otp")} />

        {hasExisting && (
          <div className="space-y-2">
            <p className="text-[11px] text-muted-foreground font-medium">
              Existing ABHA accounts found — select one to link:
            </p>
            {existingAccounts.map((acc, i) => {
              const val = acc.ABHANumber ?? acc.healthId ?? String(i);
              const label = acc.healthId || formatAbhaNumber(acc.ABHANumber ?? "");
              return (
                <label
                  key={val}
                  className={cn(
                    "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                    selectedExisting === val
                      ? "border-blue-500 bg-blue-50"
                      : "border-border bg-card hover:bg-muted/50",
                  )}
                >
                  <input
                    type="radio"
                    name="existing-abha"
                    value={val}
                    checked={selectedExisting === val}
                    onChange={() => { setSelectedExisting(val); setAbhaAddressInput(""); }}
                    className="h-3.5 w-3.5"
                  />
                  <div>
                    <p className="text-xs font-semibold font-mono">{label}</p>
                    {acc.name && <p className="text-[11px] text-muted-foreground">{acc.name}</p>}
                  </div>
                </label>
              );
            })}
            <p className="text-[11px] text-muted-foreground text-center">— or create a new address —</p>
          </div>
        )}

        <div>
          <Label className="text-xs">
            {hasExisting ? "New ABHA Address (optional)" : "Preferred ABHA Address"}
          </Label>
          <div className="flex items-center mt-1">
            <Input
              value={abhaAddressInput}
              onChange={(e) => {
                setAbhaAddressInput(e.target.value.toLowerCase().replace(/[^a-z0-9._]/g, ""));
                if (e.target.value) setSelectedExisting("");
              }}
              placeholder="e.g. ramesh.kumar"
              className="h-9 text-sm rounded-r-none border-r-0"
              maxLength={18}
            />
            <span className="h-9 px-3 flex items-center border border-input rounded-r-md bg-muted text-xs text-muted-foreground font-mono">
              @abdm
            </span>
          </div>
          {abhaAddressInput && (
            <p className="text-[11px] text-emerald-700 mt-1 font-mono">
              Preview: <strong>{abhaAddressInput}@abdm</strong>
            </p>
          )}
          <p className="text-[11px] text-muted-foreground mt-1">
            8–18 characters · letters, digits, dots, underscores only
          </p>
        </div>

        <ErrorBox />
        <Button
          size="sm"
          className="w-full h-9"
          onClick={handleCreateAddress}
          disabled={loading || (!selectedExisting && !abhaAddressInput.trim())}
        >
          {loading
            ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Creating ABHA…</>
            : <><ShieldCheck className="h-3.5 w-3.5 mr-1.5" />Create ABHA</>
          }
        </Button>
      </div>
    );
  }

  // ── STEP: done ─────────────────────────────────────────────────────────────
  if (step === "done" && result) {
    const formatted = formatAbhaNumber(result.abhaNumber);
    const qrData = encodeURIComponent(result.abhaNumber || result.abhaAddress);

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <span className="text-xs font-semibold text-emerald-700">ABHA Created Successfully</span>
        </div>

        {/* ABHA Card */}
        <div className="rounded-xl border-2 border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 p-4">
          <div className="flex gap-4">
            {/* QR Code */}
            <div className="shrink-0">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=80x80&data=${qrData}`}
                alt="ABHA QR code"
                width={80}
                height={80}
                className="rounded-lg border border-emerald-200"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            </div>
            {/* Details */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-1">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                  Ayushman Bharat Health Account
                </span>
              </div>
              <p className="text-sm font-semibold text-slate-800 truncate">{result.name || patientName}</p>
              {result.abhaNumber && (
                <p className="text-base font-bold text-emerald-800 font-mono tracking-wider mt-0.5">
                  {formatted}
                </p>
              )}
              {result.abhaAddress && (
                <p className="text-xs text-teal-700 font-mono mt-0.5">{result.abhaAddress}</p>
              )}
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="flex-1 h-9 text-xs gap-1.5"
            onClick={handlePrint}
          >
            <Printer className="h-3.5 w-3.5" />
            Print ABHA Card
          </Button>
          <Button
            size="sm"
            className="flex-1 h-9 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700"
            onClick={handleDone}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Done
          </Button>
        </div>
      </div>
    );
  }

  return null;
};

export default ABHARegistrationPanel;
