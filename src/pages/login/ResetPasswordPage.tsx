import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Eye, EyeOff, Lock, CheckCircle, AlertCircle, Loader2 } from "lucide-react";

const ResetPasswordPage: React.FC = () => {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [done, setDone] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Supabase sends the recovery token via URL hash and fires PASSWORD_RECOVERY
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setReady(true);
      }
    });
    // Also check if there's already a session (e.g. user navigated here from email link)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleReset = async () => {
    setErrorMsg("");
    if (password.length < 8) {
      setErrorMsg("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setErrorMsg("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setDone(true);
      setTimeout(() => navigate("/login", { replace: true }), 3000);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to reset password. The link may have expired.");
    } finally {
      setLoading(false);
    }
  };

  const strength = (() => {
    if (password.length === 0) return 0;
    let s = 0;
    if (password.length >= 8) s++;
    if (/[A-Z]/.test(password)) s++;
    if (/[0-9]/.test(password)) s++;
    if (/[^A-Za-z0-9]/.test(password)) s++;
    return s;
  })();

  const strengthLabel = ["", "Weak", "Fair", "Good", "Strong"][strength];
  const strengthColor = ["", "bg-destructive", "bg-amber-400", "bg-blue-500", "bg-emerald-500"][strength];

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-[400px]">
        {done ? (
          <div className="text-center py-8">
            <CheckCircle size={48} className="text-emerald-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-foreground">Password updated</h2>
            <p className="text-sm text-muted-foreground mt-2">
              Redirecting you to login...
            </p>
          </div>
        ) : !ready ? (
          <div className="text-center py-8">
            <AlertCircle size={48} className="text-amber-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-foreground">Invalid or expired link</h2>
            <p className="text-sm text-muted-foreground mt-2 mb-6">
              This password reset link has expired or is invalid. Please request a new one.
            </p>
            <button
              onClick={() => navigate("/login")}
              className="px-5 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity"
            >
              Back to Login
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 mb-8">
              <div className="p-2 rounded-lg bg-primary/10">
                <Lock size={20} className="text-primary" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-foreground">Set new password</h2>
                <p className="text-[13px] text-muted-foreground">Choose a strong password for your account</p>
              </div>
            </div>

            <div className="flex flex-col gap-5">
              <div>
                <label className="text-[13px] font-medium text-foreground">New Password</label>
                <div className="relative mt-1.5">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleReset()}
                    placeholder="At least 8 characters"
                    className="w-full h-12 pl-4 pr-11 text-[15px] bg-card border-[1.5px] border-border rounded-lg focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/10 text-foreground placeholder:text-muted-foreground"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {password.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <div className="flex gap-1">
                      {[1, 2, 3, 4].map((i) => (
                        <div
                          key={i}
                          className={`h-1 flex-1 rounded-full transition-colors ${i <= strength ? strengthColor : "bg-muted"}`}
                        />
                      ))}
                    </div>
                    <p className="text-[11px] text-muted-foreground">{strengthLabel} password</p>
                  </div>
                )}
              </div>

              <div>
                <label className="text-[13px] font-medium text-foreground">Confirm Password</label>
                <div className="relative mt-1.5">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleReset()}
                    placeholder="Repeat your new password"
                    className="w-full h-12 pl-4 pr-4 text-[15px] bg-card border-[1.5px] border-border rounded-lg focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/10 text-foreground placeholder:text-muted-foreground"
                  />
                </div>
                {confirm.length > 0 && password !== confirm && (
                  <p className="text-[11px] text-destructive mt-1">Passwords do not match</p>
                )}
              </div>

              {errorMsg && (
                <p className="text-[13px] text-destructive bg-destructive/10 px-3 py-2 rounded-lg">
                  {errorMsg}
                </p>
              )}

              <button
                onClick={handleReset}
                disabled={loading || password.length < 8 || password !== confirm}
                className="w-full h-12 bg-primary text-primary-foreground rounded-lg text-[15px] font-semibold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-40 disabled:pointer-events-none active:scale-[0.97]"
              >
                {loading ? (
                  <><Loader2 size={18} className="animate-spin" /> Updating...</>
                ) : (
                  "Update Password"
                )}
              </button>

              <button
                onClick={() => navigate("/login")}
                className="text-[13px] text-center text-muted-foreground hover:text-foreground transition-colors"
              >
                Back to Login
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ResetPasswordPage;
