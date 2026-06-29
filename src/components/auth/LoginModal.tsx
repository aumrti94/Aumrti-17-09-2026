import React, { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Mail, Smartphone, Lock, Eye, EyeOff } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const LoginModal: React.FC<Props> = ({ open, onOpenChange }) => {
  const navigate = useNavigate();
  const { toast } = useToast();

  // Password state
  const [passEmail, setPassEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passLoading, setPassLoading] = useState(false);

  // Email OTP state
  const [email, setEmail] = useState("");
  const [emailOtpSent, setEmailOtpSent] = useState(false);
  const [emailOtp, setEmailOtp] = useState(["", "", "", "", "", ""]);
  const [emailLoading, setEmailLoading] = useState(false);
  const emailRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Phone OTP state
  const [phone, setPhone] = useState("");
  const [phoneOtpSent, setPhoneOtpSent] = useState(false);
  const [phoneOtp, setPhoneOtp] = useState(["", "", "", "", "", ""]);
  const [phoneLoading, setPhoneLoading] = useState(false);
  const phoneRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setPassEmail("");
      setPassword("");
      setEmail("");
      setEmailOtpSent(false);
      setEmailOtp(["", "", "", "", "", ""]);
      setPhone("");
      setPhoneOtpSent(false);
      setPhoneOtp(["", "", "", "", "", ""]);
    }
  }, [open]);

  // Password sign-in
  const handlePasswordSignIn = async () => {
    if (!passEmail || !password) return;
    setPassLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: passEmail, password });
      if (error) throw error;
      toast({ title: "Welcome back! 🎉" });
      onOpenChange(false);
      navigate("/dashboard", { replace: true });
    } catch (err: any) {
      toast({ title: "Sign in failed", description: err.message, variant: "destructive" });
    } finally {
      setPassLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!passEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(passEmail)) {
      toast({ title: "Enter your email first", description: "We need your email to send a reset link.", variant: "destructive" });
      return;
    }
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(passEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      toast({ title: "Reset link sent!", description: `Check your inbox at ${passEmail}` });
    } catch (err: any) {
      toast({ title: "Failed to send reset link", description: err.message, variant: "destructive" });
    }
  };

  // Email OTP
  const handleSendEmailOtp = async () => {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast({ title: "Invalid email", description: "Please enter a valid email address.", variant: "destructive" });
      return;
    }
    setEmailLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({ email });
      if (error) throw error;
      setEmailOtpSent(true);
      toast({ title: "OTP sent!", description: `Check your inbox at ${email}` });
      setTimeout(() => emailRefs.current[0]?.focus(), 100);
    } catch (err: any) {
      toast({ title: "Failed to send OTP", description: err.message, variant: "destructive" });
    } finally {
      setEmailLoading(false);
    }
  };

  // Phone OTP
  const handleSendPhoneOtp = async () => {
    const cleaned = phone.replace(/\s/g, "");
    if (!cleaned || cleaned.length < 10) {
      toast({ title: "Invalid phone", description: "Please enter a valid mobile number.", variant: "destructive" });
      return;
    }
    const formatted = cleaned.startsWith("+") ? cleaned : `+91${cleaned}`;
    setPhoneLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({ phone: formatted });
      if (error) throw error;
      setPhoneOtpSent(true);
      toast({ title: "OTP sent!", description: `Check SMS on ${formatted}` });
      setTimeout(() => phoneRefs.current[0]?.focus(), 100);
    } catch (err: any) {
      toast({ title: "Failed to send OTP", description: err.message || "Phone OTP requires SMS provider (Twilio) to be configured.", variant: "destructive" });
    } finally {
      setPhoneLoading(false);
    }
  };

  const handleOtpInput = (
    otp: string[],
    setOtp: React.Dispatch<React.SetStateAction<string[]>>,
    refs: React.MutableRefObject<(HTMLInputElement | null)[]>,
    index: number,
    value: string
  ) => {
    if (!/^\d?$/.test(value)) return;
    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);
    if (value && index < 5) refs.current[index + 1]?.focus();
  };

  const handleOtpKeyDown = (
    otp: string[],
    refs: React.MutableRefObject<(HTMLInputElement | null)[]>,
    index: number,
    e: React.KeyboardEvent
  ) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      refs.current[index - 1]?.focus();
    }
  };

  const verifyEmailOtp = async () => {
    const token = emailOtp.join("");
    if (token.length !== 6) return;
    setEmailLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
      if (error) throw error;
      toast({ title: "Welcome back! 🎉" });
      onOpenChange(false);
      navigate("/dashboard", { replace: true });
    } catch (err: any) {
      toast({ title: "Invalid OTP", description: err.message, variant: "destructive" });
    } finally {
      setEmailLoading(false);
    }
  };

  const verifyPhoneOtp = async () => {
    const token = phoneOtp.join("");
    if (token.length !== 6) return;
    const cleaned = phone.replace(/\s/g, "");
    const formatted = cleaned.startsWith("+") ? cleaned : `+91${cleaned}`;
    setPhoneLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({ phone: formatted, token, type: "sms" });
      if (error) throw error;
      toast({ title: "Welcome back! 🎉" });
      onOpenChange(false);
      navigate("/dashboard", { replace: true });
    } catch (err: any) {
      toast({ title: "Invalid OTP", description: err.message, variant: "destructive" });
    } finally {
      setPhoneLoading(false);
    }
  };

  // Auto-verify when all 6 digits entered
  useEffect(() => {
    if (emailOtp.every((d) => d !== "") && emailOtpSent) verifyEmailOtp();
  }, [emailOtp]);

  useEffect(() => {
    if (phoneOtp.every((d) => d !== "") && phoneOtpSent) verifyPhoneOtp();
  }, [phoneOtp]);

  const renderOtpBoxes = (
    otp: string[],
    setOtp: React.Dispatch<React.SetStateAction<string[]>>,
    refs: React.MutableRefObject<(HTMLInputElement | null)[]>
  ) => (
    <div className="flex gap-2 justify-center mt-4">
      {otp.map((digit, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={digit}
          onChange={(e) => handleOtpInput(otp, setOtp, refs, i, e.target.value)}
          onKeyDown={(e) => handleOtpKeyDown(otp, refs, i, e)}
          className="w-11 h-12 text-center text-lg font-semibold border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-card text-foreground"
        />
      ))}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl">Sign in to Aumrti</DialogTitle>
          <DialogDescription>Choose your preferred sign-in method</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="password" className="mt-2">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="password" className="gap-2">
              <Lock size={16} /> Password
            </TabsTrigger>
            <TabsTrigger value="email" className="gap-2">
              <Mail size={16} /> Email OTP
            </TabsTrigger>
            <TabsTrigger value="phone" className="gap-2">
              <Smartphone size={16} /> Mobile OTP
            </TabsTrigger>
          </TabsList>

          {/* Password Tab */}
          <TabsContent value="password" className="mt-4 space-y-4">
            <div>
              <Label>Email Address</Label>
              <Input
                type="email"
                value={passEmail}
                onChange={(e) => setPassEmail(e.target.value)}
                placeholder="admin@yourhospital.com"
                className="mt-1.5"
                onKeyDown={(e) => e.key === "Enter" && handlePasswordSignIn()}
              />
            </div>
            <div>
              <Label>Password</Label>
              <div className="relative mt-1.5">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="pr-10"
                  onKeyDown={(e) => e.key === "Enter" && handlePasswordSignIn()}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <button
                onClick={handleForgotPassword}
                className="text-xs text-primary hover:underline mt-1.5 block"
              >
                Forgot password?
              </button>
            </div>
            <button
              onClick={handlePasswordSignIn}
              disabled={passLoading || !passEmail || !password}
              className="w-full bg-primary text-primary-foreground py-2.5 rounded-lg text-sm font-semibold hover:bg-[hsl(220,54%,16%)] transition-colors disabled:opacity-40 disabled:pointer-events-none active:scale-[0.97]"
            >
              {passLoading ? "Signing in..." : "Sign In"}
            </button>
          </TabsContent>

          {/* Email OTP Tab */}
          <TabsContent value="email" className="mt-4 space-y-4">
            {!emailOtpSent ? (
              <>
                <div>
                  <Label>Email Address</Label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@yourhospital.com"
                    className="mt-1.5"
                    onKeyDown={(e) => e.key === "Enter" && handleSendEmailOtp()}
                  />
                </div>
                <button
                  onClick={handleSendEmailOtp}
                  disabled={emailLoading || !email}
                  className="w-full bg-primary text-primary-foreground py-2.5 rounded-lg text-sm font-semibold hover:bg-[hsl(220,54%,16%)] transition-colors disabled:opacity-40 disabled:pointer-events-none active:scale-[0.97]"
                >
                  {emailLoading ? "Sending..." : "Send OTP to Email"}
                </button>
              </>
            ) : (
              <div className="text-center space-y-3">
                <p className="text-sm text-muted-foreground">
                  Enter the 6-digit code sent to <strong className="text-foreground">{email}</strong>
                </p>
                {renderOtpBoxes(emailOtp, setEmailOtp, emailRefs)}
                {emailLoading && <p className="text-xs text-muted-foreground animate-pulse">Verifying...</p>}
                <button
                  onClick={() => { setEmailOtpSent(false); setEmailOtp(["", "", "", "", "", ""]); }}
                  className="text-xs text-secondary hover:underline mt-2"
                >
                  Change email
                </button>
              </div>
            )}
          </TabsContent>

          {/* Phone OTP Tab */}
          <TabsContent value="phone" className="mt-4 space-y-4">
            {!phoneOtpSent ? (
              <>
                <div>
                  <Label>Mobile Number</Label>
                  <Input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91 98765 43210"
                    className="mt-1.5"
                    onKeyDown={(e) => e.key === "Enter" && handleSendPhoneOtp()}
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Requires SMS provider to be configured
                  </p>
                </div>
                <button
                  onClick={handleSendPhoneOtp}
                  disabled={phoneLoading || !phone}
                  className="w-full bg-primary text-primary-foreground py-2.5 rounded-lg text-sm font-semibold hover:bg-[hsl(220,54%,16%)] transition-colors disabled:opacity-40 disabled:pointer-events-none active:scale-[0.97]"
                >
                  {phoneLoading ? "Sending..." : "Send OTP to Mobile"}
                </button>
              </>
            ) : (
              <div className="text-center space-y-3">
                <p className="text-sm text-muted-foreground">
                  Enter the 6-digit code sent to <strong className="text-foreground">{phone}</strong>
                </p>
                {renderOtpBoxes(phoneOtp, setPhoneOtp, phoneRefs)}
                {phoneLoading && <p className="text-xs text-muted-foreground animate-pulse">Verifying...</p>}
                <button
                  onClick={() => { setPhoneOtpSent(false); setPhoneOtp(["", "", "", "", "", ""]); }}
                  className="text-xs text-secondary hover:underline mt-2"
                >
                  Change number
                </button>
              </div>
            )}
          </TabsContent>
        </Tabs>

        <div className="text-center mt-2 pt-3 border-t border-border">
          <p className="text-[13px] text-muted-foreground">
            New hospital?{" "}
            <button
              onClick={() => { onOpenChange(false); navigate("/register"); }}
              className="text-primary font-medium hover:underline"
            >
              Register here →
            </button>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default LoginModal;
