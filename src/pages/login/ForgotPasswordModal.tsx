import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { X, Mail, CheckCircle } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
}

const ForgotPasswordModal: React.FC<Props> = ({ open, onClose }) => {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  

  if (!open) return null;

  const handleSubmit = async () => {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) return;
    setLoading(true);
    try {
      await supabase.auth.resetPasswordForEmail(trimmedEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
    } catch (err) {
      // Silently ignore — show same message either way
      console.error("Reset password error (non-blocking):", err);
    } finally {
      setLoading(false);
      // ALWAYS show the same generic message — never reveal if email exists
      setSent(true);
    }
  };

  const handleClose = () => {
    setEmail("");
    setSent(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-card rounded-xl p-8 max-w-[360px] w-full mx-4 shadow-lg relative">
        <button
          onClick={handleClose}
          className="absolute right-4 top-4 text-muted-foreground hover:text-foreground transition-colors active:scale-95"
        >
          <X size={18} />
        </button>

        {!sent ? (
          <>
            <h3 className="text-lg font-bold text-foreground">Reset your password</h3>
            <p className="text-[13px] text-muted-foreground mt-1">
              Enter your email and we'll send a reset link
            </p>

            <div className="mt-6">
              <label className="text-[13px] font-medium text-foreground">Email Address</label>
              <div className="relative mt-1.5">
                <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                  placeholder="you@hospital.com"
                  className="w-full h-12 pl-10 pr-4 text-[15px] bg-background border-[1.5px] border-border rounded-lg focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/10 text-foreground placeholder:text-muted-foreground"
                />
              </div>
              <p className="text-[11px] text-muted-foreground mt-2">
                If you don't receive an email within 2 minutes, check your spam folder or contact your hospital administrator.
              </p>
            </div>

            <button
              onClick={handleSubmit}
              disabled={loading || !email}
              className="w-full h-12 mt-5 bg-primary text-primary-foreground rounded-lg text-[15px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 disabled:pointer-events-none active:scale-[0.97]"
            >
              {loading ? "Sending..." : "Send Reset Link"}
            </button>
          </>
        ) : (
          <div className="text-center py-4">
            <CheckCircle size={40} className="text-success mx-auto mb-3" />
            <h3 className="text-lg font-bold text-foreground">Check your email</h3>
            <p className="text-[13px] text-muted-foreground mt-2 leading-relaxed">
              If an account with this email exists, we've sent a password reset link.
              <br />
              Check your inbox and spam folder.
            </p>
            <button
              onClick={handleClose}
              className="mt-5 text-[13px] font-medium text-primary hover:underline"
            >
              Back to login
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ForgotPasswordModal;
