import React, { useState, useMemo } from "react";
import { RegistrationData, DESIGNATIONS } from "./constants";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff } from "lucide-react";

interface Props {
  data: RegistrationData;
  onChange: (d: Partial<RegistrationData>) => void;
}

const strengthChecks = [
  { label: "8+ characters", test: (p: string) => p.length >= 8 },
  { label: "Uppercase", test: (p: string) => /[A-Z]/.test(p) },
  { label: "Number", test: (p: string) => /\d/.test(p) },
  { label: "Special char", test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

const strengthLabels = ["", "Weak", "Fair", "Strong", "Very Strong"];
const strengthColors = [
  "bg-border",
  "bg-destructive",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-emerald-600",
];

const Step2AdminAccount: React.FC<Props> = ({ data, onChange }) => {
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const strength = useMemo(
    () => strengthChecks.filter((c) => c.test(data.password)).length,
    [data.password]
  );

  // Enforced minimum (mirrors index.tsx canProceed + the register-hospital edge function):
  // at least 8 characters with a letter and a number.
  const meetsMinimum =
    data.password.length >= 8 && /[A-Za-z]/.test(data.password) && /\d/.test(data.password);
  const emailValid =
    !data.email || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[22px] font-bold text-foreground">Create your admin account</h2>
        <p className="text-sm text-muted-foreground mt-1">Set up your login credentials</p>
      </div>

      <div className="space-y-4 mt-8">
        <div>
          <Label>Your Full Name *</Label>
          <Input
            value={data.fullName}
            onChange={(e) => onChange({ fullName: e.target.value })}
            placeholder="Dr. Ramesh Kumar"
            className="mt-1.5"
          />
        </div>

        <div>
          <Label>Work Email Address *</Label>
          <Input
            type="email"
            value={data.email}
            onChange={(e) => onChange({ email: e.target.value })}
            placeholder="admin@apollohospital.com"
            className="mt-1.5"
            aria-invalid={!emailValid}
          />
          {!emailValid && (
            <p className="text-xs text-destructive mt-1">Enter a valid email address</p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label>Password *</Label>
            <div className="relative mt-1.5">
              <Input
                type={showPass ? "text" : "password"}
                value={data.password}
                onChange={(e) => onChange({ password: e.target.value })}
                placeholder="Min 8 characters"
                className="pr-10"
                aria-invalid={!!data.password && !meetsMinimum}
              />
              <button
                type="button"
                onClick={() => setShowPass(!showPass)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                tabIndex={-1}
              >
                {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div>
            <Label>Confirm Password *</Label>
            <div className="relative mt-1.5">
              <Input
                type={showConfirm ? "text" : "password"}
                value={data.confirmPassword}
                onChange={(e) => onChange({ confirmPassword: e.target.value })}
                placeholder="Re-enter password"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowConfirm(!showConfirm)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                tabIndex={-1}
              >
                {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {data.confirmPassword && data.password !== data.confirmPassword && (
              <p className="text-xs text-destructive mt-1">Passwords don't match</p>
            )}
          </div>
        </div>

        {/* Strength meter */}
        {data.password && (
          <div className="space-y-1.5">
            <div className="flex gap-1.5">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className={`h-1.5 flex-1 rounded-full transition-colors ${
                    i <= strength ? strengthColors[strength] : "bg-border"
                  }`}
                />
              ))}
            </div>
            <p className={`text-xs font-medium ${
              strength <= 1 ? "text-destructive" : strength === 2 ? "text-amber-600" : "text-emerald-600"
            }`}>
              {strengthLabels[strength]}
            </p>
            {!meetsMinimum && (
              <p className="text-xs text-muted-foreground">
                Must be at least 8 characters with a letter and a number.
              </p>
            )}
          </div>
        )}

        <div>
          <Label>Your Designation *</Label>
          <Select value={data.designation} onValueChange={(v) => onChange({ designation: v })}>
            <SelectTrigger className="mt-1.5"><SelectValue placeholder="Select designation" /></SelectTrigger>
            <SelectContent>
              {DESIGNATIONS.map((d) => (
                <SelectItem key={d} value={d}>{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label>Referral Code <span className="text-muted-foreground font-normal">(optional)</span></Label>
          <Input
            value={data.referralCode}
            onChange={(e) => onChange({ referralCode: e.target.value.toUpperCase().trim() })}
            placeholder="e.g. PARTNER2026"
            className="mt-1.5"
            maxLength={32}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Have a referral or partner code? Enter it to link your account.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Step2AdminAccount;
