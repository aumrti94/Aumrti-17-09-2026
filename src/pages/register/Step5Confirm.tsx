import React from "react";
import { RegistrationData, BED_COUNTS } from "./constants";
import { Checkbox } from "@/components/ui/checkbox";

interface Props {
  data: RegistrationData;
  onChange: (d: Partial<RegistrationData>) => void;
  onEditStep: (step: number) => void;
  loading: boolean;
  onLaunch: () => void;
}

const planLabels: Record<string, string> = {
  starter: "Starter — ₹8,999/mo",
  professional: "Professional — ₹18,999/mo",
  enterprise: "Enterprise — Custom",
};

const Step5Confirm: React.FC<Props> = ({ data, onChange, onEditStep, loading, onLaunch }) => {
  const bedLabel = BED_COUNTS.find((b) => b.value === data.bedCount)?.label || data.bedCount;

  const rows = [
    { label: "Hospital Name", value: data.hospitalName, step: 0 },
    { label: "Hospital Type", value: data.hospitalType, step: 0 },
    { label: "State", value: data.state, step: 0 },
    { label: "Beds", value: bedLabel, step: 0 },
    { label: "Admin Name", value: data.fullName, step: 1 },
    { label: "Admin Email", value: data.email, step: 1 },
    { label: "Mobile", value: data.phone, step: 0 },
    { label: "Plan", value: planLabels[data.plan] || data.plan, step: 3 },
    { label: "NABH", value: data.nabhAccredited ? `Yes — ${data.nabhNumber || "N/A"}` : "No", step: 2 },
    { label: "GSTIN", value: data.gstin || "Not provided", step: 2 },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[22px] font-bold text-foreground">You're almost live! 🎉</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Review your details before we create your hospital account
        </p>
      </div>

      <div className="bg-muted/50 rounded-xl border border-border p-5 mt-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
          {rows.map((row) => (
            <div key={row.label}>
              <p className="text-xs text-muted-foreground">{row.label}</p>
              <p className="text-sm font-medium text-foreground mt-0.5">{row.value}</p>
              <button
                onClick={() => onEditStep(row.step)}
                className="text-[11px] text-primary font-medium hover:underline mt-0.5"
              >
                Edit
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-start gap-2 mt-6">
        <Checkbox
          id="terms"
          checked={data.termsAccepted}
          onCheckedChange={(v) => onChange({ termsAccepted: !!v })}
          className="mt-0.5"
        />
        <label htmlFor="terms" className="text-[13px] text-foreground leading-snug cursor-pointer">
          I agree to the{" "}
          <a href="/terms" target="_blank" className="text-primary hover:underline">Terms of Service</a>
          {" "}and{" "}
          <a href="/privacy" target="_blank" className="text-primary hover:underline">Privacy Policy</a>
        </label>
      </div>

      <div className="flex items-start gap-2 mt-3">
        <Checkbox
          id="dpdp"
          checked={data.dpdpConsent}
          onCheckedChange={(v) => onChange({ dpdpConsent: !!v })}
          className="mt-0.5"
        />
        <label htmlFor="dpdp" className="text-[13px] text-foreground leading-snug cursor-pointer">
          I consent, under the Digital Personal Data Protection Act, 2023, to Aumrti
          processing the personal data entered here for the purpose of creating and
          operating my hospital account.
        </label>
      </div>

      <button
        onClick={onLaunch}
        disabled={!data.termsAccepted || !data.dpdpConsent || loading}
        className="w-full mt-4 bg-primary text-primary-foreground py-3.5 rounded-lg text-base font-bold hover:bg-[hsl(220,54%,16%)] transition-colors disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98]"
      >
        {loading ? "Creating your account..." : "🚀 Launch My Hospital Account"}
      </button>
    </div>
  );
};

export default Step5Confirm;
