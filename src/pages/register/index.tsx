import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Check } from "lucide-react";
import { RegistrationData, initialData } from "./constants";
import { getInvokeError } from "@/lib/errorMessage";
import { FormError } from "@/components/ui/FormError";
import Step1HospitalIdentity from "./Step1HospitalIdentity";
import Step2AdminAccount from "./Step2AdminAccount";
import Step3HospitalDetails from "./Step3HospitalDetails";
import Step4ChoosePlan from "./Step4ChoosePlan";
import Step5Confirm from "./Step5Confirm";

const steps = [
  "Hospital Identity",
  "Admin Account",
  "Hospital Details",
  "Choose Plan",
  "Confirm & Launch",
];

const Register: React.FC = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [data, setData] = useState<RegistrationData>(initialData);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  // After a successful signup we show a "verify your email" screen instead of signing in.
  const [verifySent, setVerifySent] = useState(false);
  const [resending, setResending] = useState(false);
  // Exact, persistent error shown inline at the Confirm step (in addition to the toast).
  const [formError, setFormError] = useState<string | null>(null);
  // Whether the platform admin requires phone OTP verification at signup
  // (Platform → Settings master toggle). Defaults off while loading.
  const [otpRequired, setOtpRequired] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) navigate("/dashboard", { replace: true });
      else setChecking(false);
    });
  }, [navigate]);

  useEffect(() => {
    (supabase as any).rpc("get_signup_otp_enabled").then(({ data: enabled }: { data: boolean | null }) => {
      setOtpRequired(enabled === true);
    });
  }, []);

  const update = (partial: Partial<RegistrationData>) =>
    setData((prev) => ({ ...prev, ...partial }));

  const canProceed = (s: number): boolean => {
    switch (s) {
      case 0:
        return !!(data.hospitalName && data.hospitalType && data.state && data.bedCount && data.phone && (!otpRequired || data.phoneVerified));
      case 1:
        return !!(
          data.fullName &&
          data.email &&
          /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email) &&
          data.designation &&
          data.password.length >= 8 &&
          /[A-Za-z]/.test(data.password) &&
          /\d/.test(data.password) &&
          data.password === data.confirmPassword
        );
      case 2:
        return !!(data.address1 && data.pincode?.length === 6 && data.city);
      case 3:
        return !!data.plan;
      case 4:
        return data.termsAccepted && data.dpdpConsent;
      default:
        return false;
    }
  };

  const nextLabels = [
    "Next: Admin Account →",
    "Next: Hospital Details →",
    "Next: Choose Plan →",
    "Next: Confirm →",
  ];

  const handleLaunch = async () => {
    if (!data.termsAccepted || !data.dpdpConsent || (otpRequired && !data.phoneVerified)) return;
    setLoading(true);
    setFormError(null);
    try {
      // Use register-hospital edge function which creates auth user + hospital server-side
      const res = await supabase.functions.invoke("register-hospital", {
        body: {
          hospital: {
            name: data.hospitalName,
            type: data.hospitalType,
            state: data.state,
            bedCount: data.bedCount,
            address1: data.address1,
            address2: data.address2,
            city: data.city || null,
            pincode: data.pincode,
            gstin: data.gstin || null,
            nabhNumber: data.nabhAccredited ? data.nabhNumber : null,
            website: data.website || null,
            referralCode: data.referralCode || null,
            plan: data.plan,
          },
          admin: {
            full_name: data.fullName,
            email: data.email,
            password: data.password,
            phone: data.phone,
            designation: data.designation || null,
          },
          consent: {
            terms_accepted: data.termsAccepted,
            dpdp_consent: data.dpdpConsent,
          },
          phoneOtpToken: data.phoneOtpToken,
        },
      });

      const invokeErr = await getInvokeError(res);
      if (invokeErr) {
        const lower = invokeErr.toLowerCase();
        if (lower.includes("already been registered") || lower.includes("already registered") || lower.includes("user already registered")) {
          throw new Error("This email is already registered. Please sign in or use a different email address.");
        }
        if (lower.includes("too many registration")) {
          throw new Error("Too many registration attempts. Please wait an hour and try again.");
        }
        throw new Error(invokeErr);
      }

      // Email verification is required — trigger Supabase's confirmation email and show the
      // "check your email" screen. We do NOT sign in until the admin has confirmed their email.
      await supabase.auth.resend({
        type: "signup",
        email: data.email,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });

      setVerifySent(true);
    } catch (err: any) {
      setFormError(err.message);
      toast({ title: "Registration failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const resendVerification = async () => {
    setResending(true);
    try {
      await supabase.auth.resend({
        type: "signup",
        email: data.email,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      toast({ title: "Verification email sent", description: "Check your inbox (and spam folder)." });
    } catch (err: any) {
      toast({ title: "Could not resend", description: err.message, variant: "destructive" });
    } finally {
      setResending(false);
    }
  };

  if (checking) return null;

  if (verifySent) {
    return (
      <div className="h-screen w-screen overflow-hidden flex items-center justify-center bg-background px-6">
        <div className="max-w-md text-center space-y-5">
          <div className="mx-auto w-14 h-14 rounded-full bg-[hsl(160,84%,39%)]/10 flex items-center justify-center">
            <Check size={26} className="text-[hsl(160,84%,39%)]" />
          </div>
          <h2 className="text-[22px] font-bold text-foreground">Verify your email to continue</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            We've sent a confirmation link to <strong className="text-foreground">{data.email}</strong>.
            Click the link in that email to activate your account and sign in. The link opens Aumrti
            and takes you straight to setup.
          </p>
          <div className="flex items-center justify-center gap-4 pt-2">
            <button
              onClick={resendVerification}
              disabled={resending}
              className="text-sm font-semibold text-primary hover:underline disabled:opacity-50"
            >
              {resending ? "Sending…" : "Resend email"}
            </button>
            <button
              onClick={() => navigate("/")}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Go to Sign In →
            </button>
          </div>
          <p className="text-xs text-muted-foreground pt-2">
            Didn't get it? Check your spam folder, or resend after a minute.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden flex bg-background">
      {/* LEFT PANEL */}
      <div className="hidden lg:flex w-[40%] shrink-0 bg-primary flex-col p-10 text-primary-foreground">
        <div className="flex items-center gap-2.5">
          <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
            <rect x="2" y="2" width="28" height="28" rx="6" fill="white" fillOpacity="0.15" />
            <path d="M14 9h4v14h-4z" fill="white" />
            <path d="M9 14h14v4H9z" fill="white" />
          </svg>
          <span className="font-bold text-lg">Aumrti</span>
        </div>

        <div className="flex-1 flex flex-col justify-center">
          <h2 className="text-[28px] font-bold leading-[1.3]">
            Your hospital.
            <br />
            Your system.
          </h2>
          <p className="text-sm text-[hsl(215,20%,65%)] mt-3 leading-relaxed">
            Get live in under 30 minutes.
          </p>

          <div className="mt-12 space-y-5">
            {steps.map((label, i) => {
              const done = i < step;
              const active = i === step;
              return (
                <div key={label} className="flex items-center gap-3">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-colors ${
                      done
                        ? "bg-[hsl(160,84%,39%)] text-white"
                        : active
                        ? "bg-white text-primary"
                        : "bg-[hsl(220,40%,32%)] text-[hsl(215,20%,65%)]"
                    }`}
                  >
                    {done ? <Check size={14} /> : i + 1}
                  </div>
                  <span
                    className={`text-sm transition-colors ${
                      active ? "text-white font-semibold" : "text-[hsl(215,20%,65%)]"
                    }`}
                  >
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="text-[13px] text-muted-foreground">
          Already registered?{" "}
          <button onClick={() => navigate("/")} className="text-secondary font-medium hover:underline">
            Sign In →
          </button>
        </div>
      </div>

      {/* RIGHT PANEL */}
      <div className="flex-1 bg-card flex flex-col overflow-hidden">
        <div className="h-1 bg-border shrink-0">
          <div
            className="h-full bg-primary transition-[width] duration-400 ease-out rounded-r-sm"
            style={{ width: `${((step + 1) / steps.length) * 100}%` }}
          />
        </div>

        <div className="flex-1 overflow-y-auto px-8 md:px-14 py-8">
          {step === 0 && <Step1HospitalIdentity data={data} onChange={update} otpRequired={otpRequired} />}
          {step === 1 && <Step2AdminAccount data={data} onChange={update} />}
          {step === 2 && <Step3HospitalDetails data={data} onChange={update} />}
          {step === 3 && <Step4ChoosePlan data={data} onChange={update} />}
          {step === 4 && (
            <>
              <Step5Confirm
                data={data}
                onChange={update}
                onEditStep={setStep}
                loading={loading}
                onLaunch={handleLaunch}
              />
              <FormError message={formError} className="mt-4" />
            </>
          )}
        </div>

        {step < 4 && (
          <div className="shrink-0 flex items-center justify-between px-8 md:px-14 py-4 border-t border-border">
            {step > 0 ? (
              <button
                onClick={() => setStep(step - 1)}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                ← Back
              </button>
            ) : (
              <div />
            )}
            <button
              onClick={() => setStep(step + 1)}
              disabled={!canProceed(step)}
              className="bg-primary text-primary-foreground px-7 py-2.5 rounded-lg text-sm font-semibold hover:bg-[hsl(220,54%,16%)] transition-colors disabled:opacity-40 disabled:pointer-events-none active:scale-[0.97]"
            >
              {nextLabels[step]}
            </button>
          </div>
        )}
        {step === 4 && (
          <div className="shrink-0 flex items-center px-8 md:px-14 py-4 border-t border-border">
            <button
              onClick={() => setStep(3)}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              ← Back
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Register;
