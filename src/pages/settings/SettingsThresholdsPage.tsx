import React, { useState, useEffect } from "react";
import SettingsPageWrapper from "@/components/settings/SettingsPageWrapper";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";

const defaults = {
  hrLow: 40, hrHigh: 150, spo2Critical: 90, tempLow: 35, tempHigh: 39,
  bpLow: 80, bpHigh: 180, glucoseLow: 70, glucoseHigh: 400,
  news2Alert: 5, news2Escalate: 7, dischargeTatAlert: 3, dischargeTatEscalate: 5,
};

const deviceDefaults = {
  central_line: 7,
  peripheral_line: 10,
  urinary_catheter: 7,
  ventilator: 14,
  tracheostomy: 30,
};

const SettingsThresholdsPage: React.FC = () => {
  const { toast } = useToast();
  const { hospitalId } = useHospitalId();
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState(defaults);
  const [deviceConfig, setDeviceConfig] = useState(deviceDefaults);

  useEffect(() => {
    if (!hospitalId) return;
    (supabase as any)
      .from("hospital_settings")
      .select("value")
      .eq("hospital_id", hospitalId)
      .eq("key", "device_thresholds")
      .maybeSingle()
      .then(({ data }: any) => {
        if (data?.value) setDeviceConfig({ ...deviceDefaults, ...data.value });
      });
  }, [hospitalId]);

  const set = (key: keyof typeof defaults, value: string) =>
    setConfig({ ...config, [key]: Number(value) || 0 });

  const setDevice = (key: keyof typeof deviceDefaults, value: string) =>
    setDeviceConfig({ ...deviceConfig, [key]: Number(value) || 0 });

  const handleSave = async () => {
    setSaving(true);
    if (hospitalId) {
      await (supabase as any)
        .from("hospital_settings")
        .upsert(
          { hospital_id: hospitalId, key: "device_thresholds", value: deviceConfig },
          { onConflict: "hospital_id,key" }
        );
    }
    setTimeout(() => { toast({ title: "Thresholds saved" }); setSaving(false); }, 300);
  };

  const restore = () => { setConfig(defaults); setDeviceConfig(deviceDefaults); };

  const Field = ({ label, k, unit }: { label: string; k: keyof typeof defaults; unit: string }) => (
    <div className="flex items-center gap-3">
      <Label className="w-52 text-sm">{label}</Label>
      <Input type="number" value={config[k]} onChange={(e) => set(k, e.target.value)} className="w-24 h-8" />
      <span className="text-xs text-muted-foreground">{unit}</span>
    </div>
  );

  const DevField = ({ label, k, unit }: { label: string; k: keyof typeof deviceDefaults; unit: string }) => (
    <div className="flex items-center gap-3">
      <Label className="w-52 text-sm">{label}</Label>
      <Input type="number" value={deviceConfig[k]} onChange={(e) => setDevice(k, e.target.value)} className="w-24 h-8" />
      <span className="text-xs text-muted-foreground">{unit}</span>
    </div>
  );

  return (
    <SettingsPageWrapper title="Alert Thresholds" onSave={handleSave} saving={saving}>
      <div className="space-y-8">
        <section>
          <h2 className="text-sm font-semibold text-foreground mb-4">Vital Signs Alerts</h2>
          <div className="space-y-3">
            <Field label="Heart Rate Low" k="hrLow" unit="bpm" />
            <Field label="Heart Rate High" k="hrHigh" unit="bpm" />
            <Field label="SpO₂ Critical (below)" k="spo2Critical" unit="%" />
            <Field label="Temperature Low" k="tempLow" unit="°C" />
            <Field label="Temperature High" k="tempHigh" unit="°C" />
            <Field label="Systolic BP Low" k="bpLow" unit="mmHg" />
            <Field label="Systolic BP High" k="bpHigh" unit="mmHg" />
            <Field label="Blood Glucose Low" k="glucoseLow" unit="mg/dL" />
            <Field label="Blood Glucose High" k="glucoseHigh" unit="mg/dL" />
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-foreground mb-4">NEWS2 Score</h2>
          <div className="space-y-3">
            <Field label="Alert at score ≥" k="news2Alert" unit="" />
            <Field label="Escalate at score ≥" k="news2Escalate" unit="" />
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-foreground mb-4">Discharge TAT</h2>
          <div className="space-y-3">
            <Field label="Alert if discharge >" k="dischargeTatAlert" unit="hours" />
            <Field label="Escalate if discharge >" k="dischargeTatEscalate" unit="hours" />
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-foreground mb-4">Device Safe-Use Thresholds (IPC)</h2>
          <p className="text-xs text-muted-foreground mb-3">
            Days after which an active device is flagged for overdue review / removal in the Nursing Kardex.
          </p>
          <div className="space-y-3">
            <DevField label="Central Line" k="central_line" unit="days" />
            <DevField label="Peripheral Line" k="peripheral_line" unit="days" />
            <DevField label="Urinary Catheter" k="urinary_catheter" unit="days" />
            <DevField label="Ventilator" k="ventilator" unit="days" />
            <DevField label="Tracheostomy" k="tracheostomy" unit="days" />
          </div>
        </section>

        <Button variant="link" onClick={restore} className="px-0 text-muted-foreground">
          Restore Defaults
        </Button>
      </div>
    </SettingsPageWrapper>
  );
};

export default SettingsThresholdsPage;
