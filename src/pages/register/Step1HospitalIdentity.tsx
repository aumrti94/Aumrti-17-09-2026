import React from "react";
import { RegistrationData, INDIAN_STATES, HOSPITAL_TYPES, BED_COUNTS } from "./constants";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import PhoneOtpVerify from "./PhoneOtpVerify";

interface Props {
  data: RegistrationData;
  onChange: (d: Partial<RegistrationData>) => void;
  /** Whether the platform requires OTP phone verification at signup */
  otpRequired: boolean;
}

const Step1HospitalIdentity: React.FC<Props> = ({ data, onChange, otpRequired }) => {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[22px] font-bold text-foreground">Tell us about your hospital</h2>
        <p className="text-sm text-muted-foreground mt-1">This takes about 1 minute</p>
      </div>

      <div className="space-y-4 mt-8">
        <div>
          <Label>Hospital Name *</Label>
          <Input
            value={data.hospitalName}
            onChange={(e) => onChange({ hospitalName: e.target.value })}
            placeholder="e.g. Apollo General Hospital"
            className="mt-1.5"
          />
        </div>

        <div>
          <Label>Hospital Type *</Label>
          <Select value={data.hospitalType} onValueChange={(v) => onChange({ hospitalType: v })}>
            <SelectTrigger className="mt-1.5"><SelectValue placeholder="Select type" /></SelectTrigger>
            <SelectContent>
              {HOSPITAL_TYPES.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label>State *</Label>
          <Select value={data.state} onValueChange={(v) => onChange({ state: v })}>
            <SelectTrigger className="mt-1.5"><SelectValue placeholder="Select state" /></SelectTrigger>
            <SelectContent>
              {INDIAN_STATES.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label>Approximate Bed Count *</Label>
          <Select value={data.bedCount} onValueChange={(v) => onChange({ bedCount: v })}>
            <SelectTrigger className="mt-1.5"><SelectValue placeholder="Select range" /></SelectTrigger>
            <SelectContent>
              {BED_COUNTS.map((b) => (
                <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label>Your Mobile Number *</Label>
          <Input
            type="tel"
            value={data.phone}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
              onChange({ phone: digits, phoneVerified: false, phoneOtpToken: "" });
            }}
            placeholder="+91 98765 43210"
            maxLength={10}
            className="mt-1.5"
          />
          {otpRequired && (
            <PhoneOtpVerify
              phone={data.phone}
              verified={data.phoneVerified}
              onVerified={(token) => onChange({ phoneVerified: true, phoneOtpToken: token })}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default Step1HospitalIdentity;
