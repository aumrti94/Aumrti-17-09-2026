import React from "react";
import { RegistrationData } from "./constants";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface Props {
  data: RegistrationData;
  onChange: (d: Partial<RegistrationData>) => void;
}

const Step3HospitalDetails: React.FC<Props> = ({ data, onChange }) => {
  const gstinValid = !data.gstin || /^[A-Z0-9]{15}$/.test(data.gstin.toUpperCase());

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[22px] font-bold text-foreground">Hospital details</h2>
        <p className="text-sm text-muted-foreground mt-1">Help us set up your compliance & billing settings</p>
      </div>

      <div className="space-y-4 mt-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label>Address Line 1 *</Label>
            <Input
              value={data.address1}
              onChange={(e) => onChange({ address1: e.target.value })}
              placeholder="Street address"
              className="mt-1.5"
            />
          </div>
          <div>
            <Label>Address Line 2</Label>
            <Input
              value={data.address2}
              onChange={(e) => onChange({ address2: e.target.value })}
              placeholder="Suite, floor, etc."
              className="mt-1.5"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label>Pincode *</Label>
            <Input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={data.pincode}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                onChange({ pincode: v });
              }}
              placeholder="400001"
              className="mt-1.5"
            />
            {data.pincode && data.pincode.length > 0 && data.pincode.length < 6 && (
              <p className="text-xs text-destructive mt-1">Pincode must be 6 digits</p>
            )}
          </div>
          <div>
            <Label>City / District *</Label>
            <Input
              value={data.city}
              onChange={(e) => onChange({ city: e.target.value })}
              placeholder="Mumbai"
              className="mt-1.5"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label>GSTIN</Label>
            <Input
              value={data.gstin}
              onChange={(e) => onChange({ gstin: e.target.value.toUpperCase() })}
              placeholder="27AABCU9603R1ZM"
              maxLength={15}
              className={`mt-1.5 ${!gstinValid ? "border-destructive" : ""}`}
            />
            {!gstinValid && (
              <p className="text-xs text-destructive mt-1">GSTIN must be 15 alphanumeric characters</p>
            )}
            {gstinValid && (
              <p className="text-xs text-muted-foreground mt-1">Leave blank if not GST registered</p>
            )}
          </div>
          <div>
            <Label>NABH Accreditation</Label>
            <div className="flex items-center gap-3 mt-3">
              <Switch
                checked={data.nabhAccredited}
                onCheckedChange={(v) => onChange({ nabhAccredited: v, nabhNumber: v ? data.nabhNumber : "" })}
              />
              <span className="text-sm text-foreground">NABH Accredited?</span>
            </div>
            {data.nabhAccredited && (
              <Input
                value={data.nabhNumber}
                onChange={(e) => onChange({ nabhNumber: e.target.value })}
                placeholder="NABH Certificate Number"
                className="mt-2"
              />
            )}
          </div>
        </div>

        <div>
          <Label>Hospital Website</Label>
          <Input
            type="url"
            value={data.website}
            onChange={(e) => onChange({ website: e.target.value })}
            placeholder="https://www.yourhospital.com"
            className="mt-1.5"
          />
        </div>
      </div>
    </div>
  );
};

export default Step3HospitalDetails;
