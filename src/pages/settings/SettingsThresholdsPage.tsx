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
  news2Alert: 5, news2Escalate: 7,
  // Matches DischargeTATTimer.tsx's own hardcoded fallback exactly (2h warning colour /
  // alert fire, 3h critical colour) — was previously 3/5 here with no relation to the real
  // component, so the value shown on this screen for a hospital that never saved anything
  // did not describe what was actually happening. Wiring these up (KNOWN-BUG-141) means this
  // default now has to be the truth, not an arbitrary placeholder.
  dischargeTatAlert: 2, dischargeTatEscalate: 3,
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
    // clinical_thresholds (config) was previously never saved anywhere — see KNOWN-BUG-141.
    (supabase as any)
      .from("hospital_settings")
      .select("value")
      .eq("hospital_id", hospitalId)
      .eq("key", "clinical_thresholds")
      .maybeSingle()
      .then(({ data }: any) => {
        if (data?.value) setConfig({ ...defaults, ...data.value });
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
      // Previously this screen only ever saved deviceConfig — every field above it (vitals,
      // NEWS2, discharge TAT) lived in `config` state and handleSave never referenced it, so
      // "Thresholds saved" was true for one section of the page and silently false for the
      // rest. See KNOWN-BUG-141.
      await (supabase as any)
        .from("hospital_settings")
        .upsert(
          { hospital_id: hospitalId, key: "clinical_thresholds", value: config },
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
          <h2 className="text-sm font-semibold text-foreground mb-1">Vital Signs Alerts</h2>
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
            Saved, but not yet read by the nursing vitals-alerting code — it currently uses its
            own fixed thresholds (in Fahrenheit for temperature; these fields are in Celsius).
            Wiring this up needs the alerting code's threshold structure reconciled with this
            screen's, not just a value copied across two mismatched units. Treat these as
            recorded intent until that reconciliation ships.
          </p>
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
          <h2 className="text-sm font-semibold text-foreground mb-1">NEWS2 Score</h2>
          <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">
            NEWS2's 0–4 / 5–6 / 7 / ≥8 risk bands are the published Royal College of Physicians
            standard, adopted as-is by NABH 6th Edition (see <code>src/lib/news2.ts</code>) — they
            are not meant to vary by hospital, and this screen's fields are not wired to the
            scoring code. A hospital lowering "Escalate at score" to reduce alert volume would be
            weakening a validated early-warning score, not a legitimate customization. These
            fields are saved but intentionally not read by anything; whether they should exist on
            this screen at all is a clinical-governance question, not an engineering one.
          </p>
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
