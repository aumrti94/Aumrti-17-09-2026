import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Mail, Eye, EyeOff, ArrowRight, Loader2 } from "lucide-react";
import { getErrorMessage } from "@/lib/errorMessage";
import ForgotPasswordModal from "./ForgotPasswordModal";
import MFAEnrollmentModal from "@/components/auth/MFAEnrollmentModal";
import MFAVerifyModal from "@/components/auth/MFAVerifyModal";
import { isTrustedDevice } from "@/lib/trustedDevice";
import { isPlatformAdmin } from "@/lib/postAuthRoute";
import AumrtiLogo from "@/components/brand/AumrtiLogo";

const ROLE_ROUTES: Record<string, string> = {
  super_admin: "/dashboard",
  hospital_admin: "/dashboard",
  doctor: "/opd",
  nurse: "/nursing",
  accountant: "/billing",
  billing_executive: "/billing",
  billing_staff: "/billing",
  cfo: "/accounts",
  pharmacist: "/pharmacy",
  lab_tech: "/lab",
  lab_technician: "/lab",
  radiologist: "/radiology",
  hr_manager: "/hr",
  receptionist: "/opd",
};


function getShift() {
  const h = new Date().getHours();
  if (h >= 6 && h < 14) return { emoji: "🌅", label: "Morning Shift" };
  if (h >= 14 && h < 22) return { emoji: "🌆", label: "Evening Shift" };
  return { emoji: "🌙", label: "Night Shift" };
}

function useCurrentTime() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

interface HospitalBrand {
  name: string;
  logo_url: string | null;
  primary_color: string | null;
}

const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const now = useCurrentTime();
  const shift = useMemo(getShift, [now.getHours()]);

  const [brand, setBrand] = useState<HospitalBrand | null>(null);

  // Form state
  const [credential, setCredential] = useState("");
  const [password, setPassword]     = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember]     = useState(false);
  const [loading, setLoading]       = useState(false);
  const [oauthLoading, setOauthLoading] = useState<string | null>(null);
  const [errorMsg, setErrorMsg]     = useState("");
  const [failCount, setFailCount]   = useState(0);
  const [forgotOpen, setForgotOpen] = useState(false);

  // Social login: which providers the platform admin has enabled (gates the buttons).
  const [enabledProviders, setEnabledProviders] = useState<Set<string>>(new Set());
  // Email verification: set when sign-in is blocked because the email isn't confirmed yet.
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [resending, setResending] = useState(false);

  // MFA state — set after successful password auth
  const [mfaUserId, setMfaUserId]       = useState("");
  const [mfaUserName, setMfaUserName]   = useState("");
  const [mfaFactorId, setMfaFactorId]   = useState("");
  const [mfaRole, setMfaRole]           = useState("");
  const [showMfaVerify, setShowMfaVerify]     = useState(false);
  const [showMfaEnroll, setShowMfaEnroll]     = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return;

      const uid = session.user.id;

      // Platform admins have no `users` row — sending them to /dashboard traps them
      // behind "Access denied". Check first, exactly like the sign-in handler below.
      if (await isPlatformAdmin(uid)) {
        navigate("/platform", { replace: true });
        return;
      }

      // Fetch user profile to honour per-user mfa_required flag
      const { data: userRow } = await supabase
        .from("users")
        .select("full_name, role, mfa_required")
        .eq("auth_user_id", uid)
        .maybeSingle();

      const mfaRequired = (userRow as any)?.mfa_required === true;

      if (!mfaRequired) {
        // Admin has disabled MFA for this user — go straight in
        navigate("/dashboard", { replace: true });
        return;
      }

      // MFA is required — check if Supabase AAL already satisfied
      const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

      if (aalData?.nextLevel === "aal2" && aalData?.currentLevel !== "aal2") {
        if (isTrustedDevice(uid)) {
          navigate("/dashboard", { replace: true });
          return;
        }

        const { data: factors } = await supabase.auth.mfa.listFactors();
        const totpFactor = (factors as any)?.totp?.[0];
        if (totpFactor) {
          setMfaUserId(uid);
          setMfaUserName((userRow as any)?.full_name || "");
          setMfaFactorId(totpFactor.id);
          setMfaRole((userRow as any)?.role || "receptionist");
          setShowMfaVerify(true);
          return;
        }
      }

      // AAL satisfied — go to dashboard
      navigate("/dashboard", { replace: true });
    });
  }, [navigate]);

  useEffect(() => {
    const hostname = window.location.hostname;
    const parts = hostname.split(".");
    const subdomain = parts.length >= 3 ? parts[0] : null;
    if (subdomain && subdomain !== "www" && subdomain !== "localhost") {
      (supabase
        .from("hospitals")
        .select("name, logo_url, primary_color")
        .eq("subdomain", subdomain as any)
        .eq("is_active", true)
        .maybeSingle() as any)
        .then(({ data }: { data: HospitalBrand | null }) => {
          if (data) setBrand(data);
        });
    }
  }, []);

  // Load which social-login providers are enabled (safe public read — never returns secrets).
  useEffect(() => {
    (supabase as any).rpc("get_enabled_oauth_providers").then(
      ({ data }: { data: Array<{ provider: string; enabled: boolean }> | null }) => {
        if (data) setEnabledProviders(new Set(data.filter((p) => p.enabled).map((p) => p.provider)));
      },
    );
  }, []);

  const resendVerification = async () => {
    if (!unverifiedEmail) return;
    setResending(true);
    try {
      await supabase.auth.resend({
        type: "signup",
        email: unverifiedEmail,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      toast({ title: "Verification email sent", description: "Check your inbox to confirm your email." });
    } catch (e: any) {
      toast({ title: "Could not resend", description: e?.message, variant: "destructive" });
    } finally {
      setResending(false);
    }
  };

  const panelColor = brand?.primary_color || "hsl(220, 54%, 23%)";

  const dateStr = now.toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  const timeStr = now.toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true,
  });

  const finalNavigate = (role: string, name: string) => {
    toast({ title: `Welcome back, ${name}! 👋` });
    navigate(ROLE_ROUTES[role] || "/dashboard", { replace: true });
  };

  const signInWithProvider = async (provider: "google" | "azure" | "facebook") => {
    setOauthLoading(provider);
    setErrorMsg("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setErrorMsg(error.message);
      setOauthLoading(null);
    }
    // On success, browser redirects to provider — no further action needed here
  };

  const handleSignIn = async () => {
    if (!credential || !password) {
      setErrorMsg("Please fill in all fields.");
      return;
    }
    if (failCount >= 5) {
      setErrorMsg("Account locked for 15 minutes. Contact your admin.");
      return;
    }

    setLoading(true);
    setErrorMsg("");
    setUnverifiedEmail(null);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: credential,
        password,
      });
      if (error) throw error;

      const uid = data.user.id;

      // Check platform admin first
      const { data: adminRow } = await (supabase as any)
        .from("aumrti_admins")
        .select("full_name")
        .eq("auth_user_id", uid)
        .eq("is_active", true)
        .maybeSingle();

      if (adminRow) {
        toast({ title: `Welcome, ${adminRow.full_name}! 🛡️` });
        navigate("/platform", { replace: true });
        return;
      }

      const { data: userRow } = await supabase
        .from("users")
        .select("full_name, role, mfa_required, is_active")
        .eq("auth_user_id", uid)
        .maybeSingle();

      // Deactivated staff must be rejected here, before any "welcome" state fires —
      // HospitalContext also enforces this post-navigation, but by then the toast
      // and route change have already happened.
      if ((userRow as any)?.is_active === false) {
        await supabase.auth.signOut();
        setErrorMsg("This account has been deactivated. Contact your administrator.");
        return;
      }

      const fullName   = (userRow as any)?.full_name || "there";
      const role       = (userRow as any)?.role || "receptionist";
      const mfaRequired = (userRow as any)?.mfa_required === true;

      // ── MFA check ────────────────────────────────────────────────────────────
      if (mfaRequired) {
        const { data: factors } = await supabase.auth.mfa.listFactors();
        const totpFactor = factors?.totp?.[0];

        if (!totpFactor || totpFactor.status !== "verified") {
          // MFA required but not yet enrolled — force enrollment
          setMfaUserId(uid);
          setMfaUserName(fullName);
          setMfaRole(role);
          setShowMfaEnroll(true);
          return;
        }

        // Factor enrolled — check if this device is already trusted
        if (!isTrustedDevice(uid)) {
          setMfaUserId(uid);
          setMfaUserName(fullName);
          setMfaFactorId(totpFactor.id);
          setMfaRole(role);
          setShowMfaVerify(true);
          return;
        }
      }

      // MFA not required or device already trusted — go straight in
      finalNavigate(role, fullName);
    } catch (err: any) {
      // Email not yet verified — offer to resend instead of counting as a credential failure.
      const isUnconfirmed =
        err?.code === "email_not_confirmed" || /email not confirmed/i.test(err?.message || "");
      if (isUnconfirmed) {
        setUnverifiedEmail(credential);
        setErrorMsg("");
        return;
      }
      const newFails = failCount + 1;
      setFailCount(newFails);
      // Wrong email/password stays generic on purpose (never leak which part is wrong).
      // Other failures (network, server, rate-limit) show the exact reason.
      const isCredentialError =
        err?.code === "invalid_credentials" ||
        /invalid login credentials|invalid credentials/i.test(err?.message || "");
      if (newFails >= 5) {
        setErrorMsg("Account locked for 15 minutes. Contact your admin.");
      } else if (isCredentialError) {
        setErrorMsg("Invalid credentials. Please try again.");
      } else {
        setErrorMsg(getErrorMessage(err));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* ── Left panel ────────────────────────────────────────────── */}
      <div
        className="hidden md:flex md:w-[42%] flex-col justify-between p-14"
        style={{ backgroundColor: panelColor }}
      >
        {/* Only the hospital's own logo goes on the navy panel. The Aumrti logo is
            artwork on a light ground, so it lives on the white side instead. */}
        <div>
          {brand?.logo_url && (
            <img src={brand.logo_url} alt={`${brand.name} logo`} className="max-h-16 object-contain" />
          )}
        </div>

        <div className="flex-1 flex flex-col justify-center">
          <h1 className="text-[32px] font-bold text-white leading-tight">
            {brand?.name || "Aumrti"}
          </h1>
          <p className="text-[15px] mt-2" style={{ color: "rgba(255,255,255,0.65)" }}>{dateStr}</p>
          <p className="text-2xl font-light mt-1 tabular-nums" style={{ color: "rgba(255,255,255,0.85)" }}>
            {timeStr}
          </p>
          <div className="w-12 my-8" style={{ borderTop: "1px solid rgba(255,255,255,0.15)" }} />
          <p className="text-[13px]" style={{ color: "rgba(255,255,255,0.6)" }}>
            {shift.emoji} {shift.label}
          </p>
          <p className="text-sm mt-4 italic leading-relaxed" style={{ color: "rgba(255,255,255,0.5)" }}>
            Every login matters.<br />Every patient counts.
          </p>
        </div>

        <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.3)" }}>Powered by Aumrti</p>
      </div>

      {/* ── Mobile top strip ──────────────────────────────────────── */}
      <div
        className="md:hidden fixed top-0 left-0 right-0 h-40 flex flex-col items-center justify-center z-10"
        style={{ backgroundColor: panelColor }}
      >
        {brand?.logo_url && (
          <img src={brand.logo_url} alt="logo" className="h-10 object-contain mb-2" />
        )}
        <h2 className="text-white font-bold text-lg">{brand?.name || "Aumrti"}</h2>
        <p className="text-[13px] mt-0.5" style={{ color: "rgba(255,255,255,0.65)" }}>{dateStr}</p>
      </div>

      {/* ── Right panel — login form ───────────────────────────────── */}
      <div className="flex-1 bg-background flex flex-col justify-center items-center md:pt-0 pt-40">
        <div className="w-full max-w-[400px] px-6 md:px-16">
          <AumrtiLogo variant="lockup" className="h-16 w-auto max-w-[200px] mb-8" />
          <p className="text-[13px] text-muted-foreground">Welcome back</p>
          <h2 className="text-2xl font-bold text-foreground mt-1">Sign in to continue</h2>

          <div className="mt-8 flex flex-col gap-5">
            {/* Email */}
            <div>
              <label className="text-[13px] font-medium text-foreground">Email Address</label>
              <div className="relative mt-1.5">
                <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="email"
                  value={credential}
                  onChange={e => setCredential(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleSignIn()}
                  placeholder="Enter your email"
                  className="w-full h-12 pl-11 pr-4 text-[15px] bg-card border-[1.5px] border-border rounded-lg focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/10 text-foreground placeholder:text-muted-foreground"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="text-[13px] font-medium text-foreground">Password</label>
              <div className="relative mt-1.5">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleSignIn()}
                  placeholder="Enter your password"
                  className="w-full h-12 pl-4 pr-11 text-[15px] bg-card border-[1.5px] border-border rounded-lg focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/10 text-foreground placeholder:text-muted-foreground"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Remember + Forgot */}
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={e => setRemember(e.target.checked)}
                  className="w-4 h-4 rounded border-border text-primary focus:ring-primary/20"
                />
                <span className="text-[13px] text-foreground">Remember me</span>
              </label>
              <button
                onClick={() => setForgotOpen(true)}
                className="text-[13px] text-secondary font-medium hover:underline"
              >
                Forgot password?
              </button>
            </div>

            {errorMsg && (
              <p className="text-[13px] text-destructive bg-destructive/10 px-3 py-2 rounded-lg">{errorMsg}</p>
            )}

            {unverifiedEmail && (
              <div className="text-[13px] bg-amber-50 border border-amber-200 text-amber-700 px-3 py-2 rounded-lg space-y-1.5">
                <p>
                  Please verify your email before signing in. We sent a confirmation link to{" "}
                  <strong>{unverifiedEmail}</strong>.
                </p>
                <button
                  type="button"
                  onClick={resendVerification}
                  disabled={resending}
                  className="font-semibold underline hover:no-underline disabled:opacity-50"
                >
                  {resending ? "Sending…" : "Resend verification email"}
                </button>
              </div>
            )}

            <button
              onClick={handleSignIn}
              disabled={loading || !credential || !password || failCount >= 5}
              className="w-full h-12 bg-primary text-primary-foreground rounded-lg text-[15px] font-semibold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-40 disabled:pointer-events-none active:scale-[0.97]"
            >
              {loading ? (
                <><Loader2 size={18} className="animate-spin" />Signing in…</>
              ) : (
                <>Sign In<ArrowRight size={16} /></>
              )}
            </button>

            {/* ── OAuth / SSO (only providers the platform admin has enabled) ── */}
            {enabledProviders.size > 0 && (
              <>
                <div className="relative mt-5">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-border" />
                  </div>
                  <div className="relative flex justify-center text-[11px] uppercase tracking-wider">
                    <span className="bg-card px-3 text-muted-foreground">or continue with</span>
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  {enabledProviders.has("google") && (
                    <button
                      type="button"
                      onClick={() => signInWithProvider("google")}
                      disabled={loading || !!oauthLoading}
                      className="flex-1 flex items-center justify-center gap-2 border border-border rounded-lg py-2.5 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-40 disabled:pointer-events-none"
                    >
                      {oauthLoading === "google" ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : (
                        <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                        </svg>
                      )}
                      Google
                    </button>
                  )}
                  {enabledProviders.has("azure") && (
                    <button
                      type="button"
                      onClick={() => signInWithProvider("azure")}
                      disabled={loading || !!oauthLoading}
                      className="flex-1 flex items-center justify-center gap-2 border border-border rounded-lg py-2.5 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-40 disabled:pointer-events-none"
                    >
                      {oauthLoading === "azure" ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : (
                        <svg width="15" height="15" viewBox="0 0 23 23" aria-hidden="true">
                          <path fill="#f35325" d="M1 1h10v10H1z"/>
                          <path fill="#81bc06" d="M12 1h10v10H12z"/>
                          <path fill="#05a6f0" d="M1 12h10v10H1z"/>
                          <path fill="#ffba08" d="M12 12h10v10H12z"/>
                        </svg>
                      )}
                      Microsoft
                    </button>
                  )}
                  {enabledProviders.has("facebook") && (
                    <button
                      type="button"
                      onClick={() => signInWithProvider("facebook")}
                      disabled={loading || !!oauthLoading}
                      className="flex-1 flex items-center justify-center gap-2 border border-border rounded-lg py-2.5 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-40 disabled:pointer-events-none"
                    >
                      {oauthLoading === "facebook" ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : (
                        <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
                          <path fill="#1877F2" d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.69.24 2.69.24v2.97h-1.52c-1.49 0-1.96.93-1.96 1.89v2.25h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07z"/>
                        </svg>
                      )}
                      Facebook
                    </button>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="mt-6 text-center">
            <p className="text-[13px] text-muted-foreground">
              Don't have an account?{" "}
              <button onClick={() => navigate("/register")} className="text-primary font-semibold hover:underline">
                Register your hospital →
              </button>
            </p>
          </div>
        </div>
      </div>

      <ForgotPasswordModal open={forgotOpen} onClose={() => setForgotOpen(false)} />

      {/* ── MFA Verify (enrolled users, untrusted device) ── */}
      {showMfaVerify && (
        <MFAVerifyModal
          factorId={mfaFactorId}
          userId={mfaUserId}
          userName={mfaUserName}
          onVerified={() => {
            setShowMfaVerify(false);
            finalNavigate(mfaRole, mfaUserName);
          }}
        />
      )}

      {/* ── MFA Enroll (mandatory roles without MFA) ── */}
      {showMfaEnroll && (
        <MFAEnrollmentModal
          canDismiss={false}
          onEnrolled={async () => {
            // After enrollment the session is already aal2 — navigate directly
            setShowMfaEnroll(false);
            finalNavigate(mfaRole, mfaUserName);
          }}
        />
      )}
    </div>
  );
};

export default LoginPage;
