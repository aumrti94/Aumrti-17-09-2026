import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Bot, AlertTriangle, Loader2, Save, Shield } from "lucide-react";

interface AutoConfig {
  auto_intimate_enabled: boolean;
  auto_preauth_generate_enabled: boolean;
  auto_preauth_submit_enabled: boolean;
  auto_claim_submit_enabled: boolean;
  auto_claim_max_risk_score: number;
  auto_appeal_generate_enabled: boolean;
  auto_query_suggest_enabled: boolean;
  intimation_reminder_hours: number;
  pre_auth_expiry_alert_days: number;
  irdai_deadline_alert_days: number;
  high_value_claim_threshold: number;
}

const DEFAULTS: AutoConfig = {
  auto_intimate_enabled: true,
  auto_preauth_generate_enabled: true,
  auto_preauth_submit_enabled: false,
  auto_claim_submit_enabled: false,
  auto_claim_max_risk_score: 30,
  auto_appeal_generate_enabled: true,
  auto_query_suggest_enabled: true,
  intimation_reminder_hours: 6,
  pre_auth_expiry_alert_days: 3,
  irdai_deadline_alert_days: 7,
  high_value_claim_threshold: 500000,
};

const InsuranceAutomationSettings: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();
  const [config, setConfig] = useState<AutoConfig>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [configId, setConfigId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    const { data } = await (supabase as any)
      .from("insurance_automation_config")
      .select("*")
      .eq("hospital_id", hospitalId)
      .maybeSingle();
    if (data) {
      setConfigId(data.id);
      setConfig({
        auto_intimate_enabled: data.auto_intimate_enabled ?? DEFAULTS.auto_intimate_enabled,
        auto_preauth_generate_enabled: data.auto_preauth_generate_enabled ?? DEFAULTS.auto_preauth_generate_enabled,
        auto_preauth_submit_enabled: data.auto_preauth_submit_enabled ?? DEFAULTS.auto_preauth_submit_enabled,
        auto_claim_submit_enabled: data.auto_claim_submit_enabled ?? DEFAULTS.auto_claim_submit_enabled,
        auto_claim_max_risk_score: data.auto_claim_max_risk_score ?? DEFAULTS.auto_claim_max_risk_score,
        auto_appeal_generate_enabled: data.auto_appeal_generate_enabled ?? DEFAULTS.auto_appeal_generate_enabled,
        auto_query_suggest_enabled: data.auto_query_suggest_enabled ?? DEFAULTS.auto_query_suggest_enabled,
        intimation_reminder_hours: data.intimation_reminder_hours ?? DEFAULTS.intimation_reminder_hours,
        pre_auth_expiry_alert_days: data.pre_auth_expiry_alert_days ?? DEFAULTS.pre_auth_expiry_alert_days,
        irdai_deadline_alert_days: data.irdai_deadline_alert_days ?? DEFAULTS.irdai_deadline_alert_days,
        high_value_claim_threshold: data.high_value_claim_threshold ?? DEFAULTS.high_value_claim_threshold,
      });
    }
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!hospitalId) return;
    setSaving(true);
    const payload = { ...config, hospital_id: hospitalId, updated_at: new Date().toISOString() };
    let error;
    if (configId) {
      ({ error } = await (supabase as any).from("insurance_automation_config").update(payload).eq("id", configId));
    } else {
      const res = await (supabase as any).from("insurance_automation_config").insert(payload).select("id").maybeSingle();
      error = res.error;
      if (res.data?.id) setConfigId(res.data.id);
    }
    setSaving(false);
    if (!error) {
      toast({ title: "Automation settings saved ✓" });
    } else {
      toast({ title: "Failed to save settings", variant: "destructive" });
    }
  };

  const toggle = (key: keyof AutoConfig) => {
    setConfig(prev => ({ ...prev, [key]: !prev[key] }));
  };

  if (loading) return <div className="flex items-center justify-center h-full text-muted-foreground text-sm p-8"><Loader2 className="animate-spin mr-2" size={16} /> Loading automation settings...</div>;

  return (
    <div className="h-full overflow-auto p-5">
      <div className="max-w-2xl space-y-6">

        {/* Header */}
        <div className="flex items-center gap-3 pb-3 border-b border-border">
          <div className="w-9 h-9 rounded-lg bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
            <Bot size={18} className="text-violet-600" />
          </div>
          <div>
            <h2 className="text-base font-bold">Insurance Automation Settings</h2>
            <p className="text-xs text-muted-foreground">Control what the system handles automatically vs. what requires staff action</p>
          </div>
        </div>

        {/* Section: Admission Automation */}
        <section className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">On Admission</h3>
          <ToggleRow
            label="Auto-Intimate TPA"
            description="Automatically record intimation when a new insurance patient is admitted. Resolves the 24h/48h deadline without manual action."
            checked={config.auto_intimate_enabled}
            onChange={() => toggle("auto_intimate_enabled")}
          />
          <ToggleRow
            label="AI Pre-Auth Generation"
            description="Use AI to fill diagnosis codes, procedure codes, and estimated amount in the pre-auth form using admission data. Staff still reviews before submitting."
            checked={config.auto_preauth_generate_enabled}
            onChange={() => toggle("auto_preauth_generate_enabled")}
          />
          <ToggleRow
            label="Auto-Submit Pre-Auth"
            description="Automatically submit the AI-generated pre-auth to the TPA without staff review. Use with caution — only enable after AI-generation is stable."
            checked={config.auto_preauth_submit_enabled}
            onChange={() => toggle("auto_preauth_submit_enabled")}
            caution
          />
        </section>

        {/* Section: Claims Automation */}
        <section className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">On Discharge</h3>
          <ToggleRow
            label="Auto-Submit Claims (Low-Risk Only)"
            description={`Automatically submit claims on discharge when AI denial risk is below ${config.auto_claim_max_risk_score}% and all guards pass (pre-auth approved, not accident case, amount under threshold).`}
            checked={config.auto_claim_submit_enabled}
            onChange={() => toggle("auto_claim_submit_enabled")}
            caution
          />

          {config.auto_claim_submit_enabled && (
            <div className="pl-4 border-l-2 border-border space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label className="text-xs font-semibold">Max Denial Risk for Auto-Submit</Label>
                  <span className={`text-sm font-bold tabular-nums ${config.auto_claim_max_risk_score <= 25 ? "text-emerald-600" : "text-amber-600"}`}>
                    {config.auto_claim_max_risk_score}%
                  </span>
                </div>
                <Slider
                  min={10} max={50} step={5}
                  value={[config.auto_claim_max_risk_score]}
                  onValueChange={([v]) => setConfig(prev => ({ ...prev, auto_claim_max_risk_score: v }))}
                  className="w-full"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Only claims with AI denial risk below this threshold will be auto-submitted. Recommended: ≤25%
                </p>
              </div>
              <div>
                <Label className="text-xs font-semibold">High-Value Claim Gate (₹)</Label>
                <p className="text-[10px] text-muted-foreground mb-1">Claims above this amount always go to manual review, regardless of risk score</p>
                <input
                  type="number"
                  value={config.high_value_claim_threshold}
                  onChange={e => setConfig(prev => ({ ...prev, high_value_claim_threshold: Number(e.target.value) }))}
                  className="h-8 w-40 rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
            </div>
          )}
        </section>

        {/* Section: AI Features */}
        <section className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">AI Features</h3>
          <ToggleRow
            label="AI Appeal Letter Auto-Generation"
            description="Automatically suggest appeal letters for denied claims using AI."
            checked={config.auto_appeal_generate_enabled}
            onChange={() => toggle("auto_appeal_generate_enabled")}
          />
          <ToggleRow
            label="AI TPA Query Reply Suggestions"
            description="Show AI-suggested replies in the TPA Queries tab for staff to review and edit."
            checked={config.auto_query_suggest_enabled}
            onChange={() => toggle("auto_query_suggest_enabled")}
          />
        </section>

        {/* Section: Alert Thresholds */}
        <section className="space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Alert Thresholds</h3>
          <NumberField
            label="Intimation Reminder (hours before window closes)"
            description="Alert staff this many hours before the 24h/48h intimation deadline"
            value={config.intimation_reminder_hours}
            onChange={v => setConfig(prev => ({ ...prev, intimation_reminder_hours: v }))}
            min={1} max={24}
          />
          <NumberField
            label="Pre-Auth Expiry Alert (days before)"
            description="Alert when pre-auth validity is within this many days of expiry"
            value={config.pre_auth_expiry_alert_days}
            onChange={v => setConfig(prev => ({ ...prev, pre_auth_expiry_alert_days: v }))}
            min={1} max={14}
          />
          <NumberField
            label="IRDAI 45-Day Deadline Alert (days before)"
            description="Alert when a submitted claim is within this many days of the IRDAI 45-day settlement deadline"
            value={config.irdai_deadline_alert_days}
            onChange={v => setConfig(prev => ({ ...prev, irdai_deadline_alert_days: v }))}
            min={3} max={21}
          />
        </section>

        <Button onClick={save} disabled={saving} className="w-full gap-2">
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          Save Automation Settings
        </Button>
      </div>
    </div>
  );
};

// ── Sub-components ──────────────────────────

interface ToggleRowProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
  caution?: boolean;
}

const ToggleRow: React.FC<ToggleRowProps> = ({ label, description, checked, onChange, caution }) => (
  <div className="flex items-start justify-between gap-4 p-3 rounded-lg border border-border bg-background">
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{label}</span>
        {caution && (
          <Badge variant="outline" className="text-[9px] text-amber-700 border-amber-300 bg-amber-50 gap-0.5">
            <AlertTriangle size={9} /> Caution
          </Badge>
        )}
        {!caution && checked && (
          <Badge variant="outline" className="text-[9px] text-emerald-700 border-emerald-300 bg-emerald-50 gap-0.5">
            <Shield size={9} /> Active
          </Badge>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
    </div>
    <Switch checked={checked} onCheckedChange={onChange} />
  </div>
);

interface NumberFieldProps {
  label: string;
  description: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
}

const NumberField: React.FC<NumberFieldProps> = ({ label, description, value, onChange, min, max }) => (
  <div className="flex items-start justify-between gap-4 p-3 rounded-lg border border-border bg-background">
    <div className="flex-1">
      <span className="text-sm font-medium">{label}</span>
      <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>
    </div>
    <input
      type="number"
      value={value}
      onChange={e => onChange(Math.max(min, Math.min(max, Number(e.target.value))))}
      min={min} max={max}
      className="h-8 w-16 rounded-md border border-input bg-background px-2 text-sm text-center shrink-0"
    />
  </div>
);

export default InsuranceAutomationSettings;
