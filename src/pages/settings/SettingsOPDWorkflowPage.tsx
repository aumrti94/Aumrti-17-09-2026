import React, { useState, useEffect } from "react";
import SettingsPageWrapper from "@/components/settings/SettingsPageWrapper";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { Plus, Trash2, Tag } from "lucide-react";

interface RevisitRule {
  within_days: number;
  same_doctor: boolean;
  discount_type: "free" | "percent" | "fixed";
  amount: number;
}

const SettingsOPDWorkflowPage: React.FC = () => {
  const { toast } = useToast();
  const { hospitalId } = useHospitalId();
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState({
    queueType: "token",
    tokenPrefix: "A",
    tokenStart: 1,
    resetDaily: true,
    feeTimimg: "before",
    followUpDays: 14,
    nameFormat: "full",
    audioAnnounce: true,
    lateArrival: "wait",
  });

  // Revisit rules
  const [revisitEnabled, setRevisitEnabled] = useState(false);
  const [revisitRules, setRevisitRules] = useState<RevisitRule[]>([
    { within_days: 7, same_doctor: true, discount_type: "free", amount: 0 },
  ]);

  useEffect(() => {
    if (!hospitalId) return;
    (async () => {
      const [revisitRes, configRes] = await Promise.all([
        (supabase as any).from("hospital_settings").select("value").eq("hospital_id", hospitalId).eq("key", "opd_revisit_rules").maybeSingle(),
        (supabase as any).from("hospital_settings").select("value").eq("hospital_id", hospitalId).eq("key", "opd_workflow_config").maybeSingle(),
      ]);
      if (revisitRes.data?.value) {
        setRevisitEnabled(revisitRes.data.value.enabled ?? false);
        if (Array.isArray(revisitRes.data.value.rules)) setRevisitRules(revisitRes.data.value.rules);
      }
      if (configRes.data?.value) {
        setConfig((prev) => ({ ...prev, ...configRes.data.value }));
      }
    })();
  }, [hospitalId]);

  const addRule = () => {
    setRevisitRules(prev => [...prev, { within_days: 30, same_doctor: true, discount_type: "percent", amount: 50 }]);
  };

  const removeRule = (i: number) => {
    setRevisitRules(prev => prev.filter((_, idx) => idx !== i));
  };

  const updateRule = (i: number, partial: Partial<RevisitRule>) => {
    setRevisitRules(prev => prev.map((r, idx) => idx === i ? { ...r, ...partial } : r));
  };

  const handleSave = async () => {
    // A token is a number the receptionist calls out and the patient watches for on the
    // display board. Zero or negative starts break the queue's sort order and produce a
    // token nobody can announce, so refuse rather than store it.
    if (!Number.isFinite(config.tokenStart) || config.tokenStart < 1) {
      toast({
        title: "Starting number must be 1 or higher",
        description: "Tokens are announced to patients — a zero or negative token cannot be called.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    if (hospitalId) {
      await Promise.all([
        (supabase as any).from("hospital_settings").upsert({
          hospital_id: hospitalId,
          key: "opd_revisit_rules",
          value: { enabled: revisitEnabled, rules: revisitRules },
          updated_at: new Date().toISOString(),
        }, { onConflict: "hospital_id,key" }),
        (supabase as any).from("hospital_settings").upsert({
          hospital_id: hospitalId,
          key: "opd_workflow_config",
          value: config,
          updated_at: new Date().toISOString(),
        }, { onConflict: "hospital_id,key" }),
      ]);
    }
    setSaving(false);
    toast({ title: "OPD config saved" });
  };

  return (
    <SettingsPageWrapper title="OPD Queue Config" onSave={handleSave} saving={saving}>
      <div className="space-y-8">
        <section>
          <h2 className="text-sm font-semibold text-foreground mb-3">Queue Type</h2>
          <RadioGroup value={config.queueType} onValueChange={(v) => setConfig({ ...config, queueType: v })} className="space-y-2">
            {[{ v: "token", l: "Token-based" }, { v: "appointment", l: "Appointment-first" }, { v: "walkin", l: "Walk-in only" }].map((o) => (
              <div key={o.v} className="flex items-center gap-2"><RadioGroupItem value={o.v} id={`qt-${o.v}`} /><Label htmlFor={`qt-${o.v}`} className="font-normal">{o.l}</Label></div>
            ))}
          </RadioGroup>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-foreground mb-3">Token Format</h2>
          <div className="grid grid-cols-3 gap-4">
            <div><Label>Prefix</Label><Input value={config.tokenPrefix} onChange={(e) => setConfig({ ...config, tokenPrefix: e.target.value })} className="mt-1" /></div>
            <div><Label>Starting Number</Label><Input type="number" min={1} value={config.tokenStart} onChange={(e) => setConfig({ ...config, tokenStart: +e.target.value })} className="mt-1" /></div>
            <div className="flex items-end gap-2 pb-1"><Switch checked={config.resetDaily} onCheckedChange={(v) => setConfig({ ...config, resetDaily: v })} /><span className="text-sm">Reset daily</span></div>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-foreground mb-3">Consultation Fee Timing</h2>
          <RadioGroup value={config.feeTimimg} onValueChange={(v) => setConfig({ ...config, feeTimimg: v })} className="space-y-2">
            {[{ v: "before", l: "Collect before consultation" }, { v: "after", l: "Collect after consultation" }, { v: "choice", l: "Patient's choice" }].map((o) => (
              <div key={o.v} className="flex items-center gap-2"><RadioGroupItem value={o.v} id={`ft-${o.v}`} /><Label htmlFor={`ft-${o.v}`} className="font-normal">{o.l}</Label></div>
            ))}
          </RadioGroup>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-foreground mb-3">Free Follow-up</h2>
          <div className="flex items-center gap-2">
            <span className="text-sm">Free follow-up within</span>
            <Input type="number" value={config.followUpDays} onChange={(e) => setConfig({ ...config, followUpDays: +e.target.value })} className="w-20 h-8" />
            <span className="text-sm">days</span>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-foreground mb-3">OPD TV Display</h2>
          <div className="space-y-3">
            <div>
              <Label>Patient Name Format</Label>
              <RadioGroup value={config.nameFormat} onValueChange={(v) => setConfig({ ...config, nameFormat: v })} className="flex gap-4 mt-1">
                {[{ v: "full", l: "Full name" }, { v: "initial", l: "First name + initial" }, { v: "token", l: "Token only" }].map((o) => (
                  <div key={o.v} className="flex items-center gap-2"><RadioGroupItem value={o.v} id={`nf-${o.v}`} /><Label htmlFor={`nf-${o.v}`} className="font-normal">{o.l}</Label></div>
                ))}
              </RadioGroup>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={config.audioAnnounce} onCheckedChange={(v) => setConfig({ ...config, audioAnnounce: v })} />
              <span className="text-sm">Audio announcement</span>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-foreground mb-3">Walk-in Late Arrival</h2>
          <RadioGroup value={config.lateArrival} onValueChange={(v) => setConfig({ ...config, lateArrival: v })} className="space-y-2">
            {[{ v: "wait", l: "Wait in queue" }, { v: "end", l: "Move to end" }, { v: "cancel", l: "Cancel" }].map((o) => (
              <div key={o.v} className="flex items-center gap-2"><RadioGroupItem value={o.v} id={`la-${o.v}`} /><Label htmlFor={`la-${o.v}`} className="font-normal">{o.l}</Label></div>
            ))}
          </RadioGroup>
        </section>

        {/* Revisit Discount Rules */}
        <section>
          <div className="flex items-center gap-3 mb-3">
            <Tag size={15} className="text-emerald-600" />
            <h2 className="text-sm font-semibold text-foreground">Revisit Rules</h2>
            <Switch checked={revisitEnabled} onCheckedChange={setRevisitEnabled} />
            <span className="text-xs text-muted-foreground">{revisitEnabled ? "Enabled" : "Disabled"}</span>
          </div>
          {revisitEnabled && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                When a returning patient visits within the configured window, the consultation fee is automatically discounted.
              </p>
              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/40">
                      <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Within (days)</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Same Doctor</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Discount Type</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Amount / %</th>
                      <th className="px-3 py-2 w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {revisitRules.map((rule, i) => (
                      <tr key={i} className="border-t border-border/50">
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            value={rule.within_days}
                            onChange={e => updateRule(i, { within_days: Number(e.target.value) || 0 })}
                            className="h-7 w-20 text-sm"
                            min={1}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Switch
                            checked={rule.same_doctor}
                            onCheckedChange={v => updateRule(i, { same_doctor: v })}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={rule.discount_type}
                            onChange={e => updateRule(i, { discount_type: e.target.value as RevisitRule["discount_type"] })}
                            className="h-7 px-2 border border-border rounded-md text-xs bg-background"
                          >
                            <option value="free">Free (₹0)</option>
                            <option value="percent">Percent off (%)</option>
                            <option value="fixed">Fixed amount (₹)</option>
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          {rule.discount_type !== "free" && (
                            <Input
                              type="number"
                              value={rule.amount}
                              onChange={e => updateRule(i, { amount: Number(e.target.value) || 0 })}
                              className="h-7 w-24 text-sm"
                              min={0}
                              max={rule.discount_type === "percent" ? 100 : undefined}
                            />
                          )}
                          {rule.discount_type === "free" && <span className="text-xs text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-2">
                          <button onClick={() => removeRule(i)} className="text-muted-foreground hover:text-destructive">
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button size="sm" variant="outline" className="gap-1 text-xs h-8" onClick={addRule}>
                <Plus size={12} /> Add Rule
              </Button>
              <p className="text-[11px] text-muted-foreground">
                Rules are evaluated in order — first matching rule wins. "Within 7 days = Free" means returning patient within 7 days pays ₹0.
              </p>
            </div>
          )}
        </section>
      </div>
    </SettingsPageWrapper>
  );
};

export default SettingsOPDWorkflowPage;
