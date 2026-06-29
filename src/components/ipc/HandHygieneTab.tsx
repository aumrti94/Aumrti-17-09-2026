import React, { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Droplets, Plus, Loader2, X, AlertTriangle, CheckCircle2, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, parseISO, startOfMonth, endOfMonth } from "date-fns";

interface HHAudit {
  id: string;
  audit_date: string;
  area_name: string | null;
  m1_before_patient_contact_total: number;
  m1_before_patient_contact_done: number;
  m2_before_aseptic_total: number;
  m2_before_aseptic_done: number;
  m3_after_body_fluid_total: number;
  m3_after_body_fluid_done: number;
  m4_after_patient_contact_total: number;
  m4_after_patient_contact_done: number;
  m5_after_touching_surroundings_total: number;
  m5_after_touching_surroundings_done: number;
  total_opportunities: number;
  total_compliant: number;
  glove_use_appropriate: boolean;
  hand_rub_available: boolean;
  soap_available: boolean;
  observations: string | null;
  corrective_actions: string | null;
}

const MOMENTS = [
  { key: "m1", label: "Before Patient Contact",            who: "M1" },
  { key: "m2", label: "Before Aseptic Procedure",         who: "M2" },
  { key: "m3", label: "After Body Fluid Exposure Risk",   who: "M3" },
  { key: "m4", label: "After Patient Contact",             who: "M4" },
  { key: "m5", label: "After Touching Patient Surroundings", who: "M5" },
];

const today = new Date().toISOString().split("T")[0];

const FL: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <label className="text-[11px] font-medium text-muted-foreground block mb-1">{children}</label>
);

const pct = (done: number, total: number) =>
  total > 0 ? Math.round((done / total) * 100) : null;

const ComplianceChip: React.FC<{ value: number | null }> = ({ value }) => {
  if (value === null) return <span className="text-[10px] text-muted-foreground">—</span>;
  const cls = value >= 80 ? "bg-emerald-100 text-emerald-700 border-emerald-200"
    : value >= 60 ? "bg-amber-100 text-amber-700 border-amber-200"
    : "bg-red-100 text-red-700 border-red-200";
  return (
    <span className={cn("text-[11px] font-bold border rounded px-1.5 py-px", cls)}>
      {value}%
    </span>
  );
};

const HandHygieneTab: React.FC<{ hospitalId: string }> = ({ hospitalId }) => {
  const { toast } = useToast();
  const { userId } = useHospitalId();
  const [audits, setAudits] = useState<HHAudit[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    audit_date: today,
    area_name: "",
    m1_total: "", m1_done: "",
    m2_total: "", m2_done: "",
    m3_total: "", m3_done: "",
    m4_total: "", m4_done: "",
    m5_total: "", m5_done: "",
    glove_use_appropriate: true,
    hand_rub_available: true,
    soap_available: true,
    observations: "",
    corrective_actions: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("hand_hygiene_audits")
      .select("*")
      .eq("hospital_id", hospitalId)
      .order("audit_date", { ascending: false })
      .limit(200);
    setAudits(data || []);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!form.audit_date) return;
    setSaving(true);
    const { error } = await (supabase as any).from("hand_hygiene_audits").insert({
      hospital_id: hospitalId,
      audit_date: form.audit_date,
      area_name: form.area_name || null,
      auditor_id: userId || null,
      m1_before_patient_contact_total: parseInt(form.m1_total) || 0,
      m1_before_patient_contact_done:  parseInt(form.m1_done)  || 0,
      m2_before_aseptic_total: parseInt(form.m2_total) || 0,
      m2_before_aseptic_done:  parseInt(form.m2_done)  || 0,
      m3_after_body_fluid_total: parseInt(form.m3_total) || 0,
      m3_after_body_fluid_done:  parseInt(form.m3_done)  || 0,
      m4_after_patient_contact_total: parseInt(form.m4_total) || 0,
      m4_after_patient_contact_done:  parseInt(form.m4_done)  || 0,
      m5_after_touching_surroundings_total: parseInt(form.m5_total) || 0,
      m5_after_touching_surroundings_done:  parseInt(form.m5_done)  || 0,
      glove_use_appropriate: form.glove_use_appropriate,
      hand_rub_available: form.hand_rub_available,
      soap_available: form.soap_available,
      observations: form.observations || null,
      corrective_actions: form.corrective_actions || null,
    });
    if (error) toast({ title: "Failed to save", description: error.message, variant: "destructive" });
    else {
      toast({ title: "Hand hygiene audit saved" });
      setShowAdd(false);
      setForm({ audit_date: today, area_name: "", m1_total: "", m1_done: "", m2_total: "", m2_done: "", m3_total: "", m3_done: "", m4_total: "", m4_done: "", m5_total: "", m5_done: "", glove_use_appropriate: true, hand_rub_available: true, soap_available: true, observations: "", corrective_actions: "" });
      load();
    }
    setSaving(false);
  };

  // This-month KPI
  const monthlyPct = useMemo(() => {
    const ms = startOfMonth(new Date()).toISOString().split("T")[0];
    const me = endOfMonth(new Date()).toISOString().split("T")[0];
    const thisMonth = audits.filter(a => a.audit_date >= ms && a.audit_date <= me);
    const tot = thisMonth.reduce((s, a) => s + (a.total_opportunities || 0), 0);
    const done = thisMonth.reduce((s, a) => s + (a.total_compliant || 0), 0);
    return pct(done, tot);
  }, [audits]);

  const belowTarget = monthlyPct !== null && monthlyPct < 80;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="p-4 border-b flex items-center justify-between gap-3 shrink-0 flex-wrap">
        <div className="flex items-center gap-2">
          <Droplets className="h-4 w-4 text-blue-500 shrink-0" />
          <span className="text-sm font-semibold">Hand Hygiene Compliance Audits</span>
          <span className="text-[10px] text-muted-foreground bg-muted px-2 py-px rounded">WHO Five Moments</span>
          {monthlyPct !== null && (
            <Badge className={cn("text-[10px]", belowTarget
              ? "bg-red-100 text-red-700 border-red-200"
              : "bg-emerald-100 text-emerald-700 border-emerald-200"
            )}>
              {belowTarget ? <AlertTriangle className="h-3 w-3 mr-1" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
              This month: {monthlyPct}% {belowTarget ? "— below 80% target" : "— on target"}
            </Badge>
          )}
        </div>
        <Button size="sm" onClick={() => setShowAdd(s => !s)} className="h-7 text-xs gap-1">
          <Plus className="h-3 w-3" /> Record Audit
        </Button>
      </div>

      {showAdd && (
        <div className="border-b p-4 bg-muted/40 space-y-4 shrink-0">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <FL>Audit Date *</FL>
              <Input type="date" value={form.audit_date} onChange={e => setForm(f => ({ ...f, audit_date: e.target.value }))} className="h-8 text-sm" />
            </div>
            <div>
              <FL>Ward / Area</FL>
              <Input value={form.area_name} onChange={e => setForm(f => ({ ...f, area_name: e.target.value }))} placeholder="e.g. ICU, Ward 3" className="h-8 text-sm" />
            </div>
          </div>

          {/* Five Moments table */}
          <div>
            <p className="text-xs font-semibold text-foreground mb-2">WHO Five Moments — Observed Opportunities</p>
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/60">
                  <tr>
                    <th className="text-left px-3 py-2 text-[11px] font-semibold text-muted-foreground">Moment</th>
                    <th className="px-3 py-2 text-[11px] font-semibold text-muted-foreground w-24 text-center">Opportunities</th>
                    <th className="px-3 py-2 text-[11px] font-semibold text-muted-foreground w-24 text-center">Compliant</th>
                    <th className="px-3 py-2 text-[11px] font-semibold text-muted-foreground w-20 text-center">%</th>
                  </tr>
                </thead>
                <tbody>
                  {MOMENTS.map((m, i) => {
                    const totalKey = `m${i + 1}_total` as keyof typeof form;
                    const doneKey  = `m${i + 1}_done`  as keyof typeof form;
                    const totalVal = parseInt(form[totalKey] as string) || 0;
                    const doneVal  = parseInt(form[doneKey]  as string) || 0;
                    const p = pct(doneVal, totalVal);
                    return (
                      <tr key={m.key} className="border-t border-border/50">
                        <td className="px-3 py-1.5">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="text-[10px] font-bold text-muted-foreground bg-muted w-6 h-6 rounded-full flex items-center justify-center shrink-0">{m.who}</span>
                            <span className="text-xs">{m.label}</span>
                          </span>
                        </td>
                        <td className="px-3 py-1.5">
                          <Input type="number" min="0" value={form[totalKey] as string}
                            onChange={e => setForm(f => ({ ...f, [totalKey]: e.target.value }))}
                            className="h-7 text-xs text-center" placeholder="0" />
                        </td>
                        <td className="px-3 py-1.5">
                          <Input type="number" min="0" max={totalVal || 9999} value={form[doneKey] as string}
                            onChange={e => setForm(f => ({ ...f, [doneKey]: e.target.value }))}
                            className="h-7 text-xs text-center" placeholder="0" />
                        </td>
                        <td className="px-3 py-1.5 text-center"><ComplianceChip value={p} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Technique checks */}
          <div className="flex items-center gap-6">
            {[
              { id: "glove", label: "Glove use appropriate", key: "glove_use_appropriate" },
              { id: "rub",   label: "Hand rub available at POC", key: "hand_rub_available" },
              { id: "soap",  label: "Soap & water available", key: "soap_available" },
            ].map(item => (
              <div key={item.id} className="flex items-center gap-2">
                <input type="checkbox" id={item.id} checked={form[item.key as keyof typeof form] as boolean}
                  onChange={e => setForm(f => ({ ...f, [item.key]: e.target.checked }))} className="h-4 w-4" />
                <label htmlFor={item.id} className="text-xs">{item.label}</label>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <FL>Observations</FL>
              <textarea value={form.observations} onChange={e => setForm(f => ({ ...f, observations: e.target.value }))} placeholder="Key observations…" className="w-full text-sm border border-input rounded px-3 py-1.5 bg-background min-h-[52px] resize-none" />
            </div>
            <div>
              <FL>Corrective Actions</FL>
              <textarea value={form.corrective_actions} onChange={e => setForm(f => ({ ...f, corrective_actions: e.target.value }))} placeholder="Actions to improve compliance…" className="w-full text-sm border border-input rounded px-3 py-1.5 bg-background min-h-[52px] resize-none" />
            </div>
          </div>

          <div className="flex gap-2">
            <Button size="sm" onClick={handleSave} disabled={saving || !form.audit_date} className="h-7 text-xs flex-1">
              {saving && <Loader2 className="h-3 w-3 animate-spin mr-1" />} Save Audit
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)} className="h-7 text-xs">Cancel</Button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-8"><Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Loading…</span></div>
        ) : audits.length === 0 ? (
          <div className="py-10 text-center space-y-2">
            <Droplets className="h-8 w-8 text-muted-foreground/40 mx-auto" />
            <p className="text-sm text-muted-foreground">No hand hygiene audits recorded.</p>
            <p className="text-xs text-muted-foreground">NABH HIC.9 requires monthly hand hygiene compliance audits using the WHO Five Moments framework. Target: ≥80% compliance.</p>
          </div>
        ) : audits.map(a => {
          const compliance = pct(a.total_compliant, a.total_opportunities);
          const belowThreshold = compliance !== null && compliance < 80;
          return (
            <div key={a.id} className={cn("border rounded-lg p-3 bg-card",
              belowThreshold ? "border-red-200 bg-red-50/30 dark:bg-red-950/20" :
              compliance !== null && compliance < 60 ? "border-amber-200" : "border-border"
            )}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{format(parseISO(a.audit_date), "dd MMM yyyy")}</span>
                    {a.area_name && <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-px rounded">{a.area_name}</span>}
                    <span className="text-[11px] text-muted-foreground">{a.total_opportunities} opportunities</span>
                    <ComplianceChip value={compliance} />
                    {belowThreshold && <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]">Below 80% target</Badge>}
                  </div>

                  {/* Per-moment breakdown */}
                  <div className="grid grid-cols-5 gap-1">
                    {MOMENTS.map((m, i) => {
                      const totals = [a.m1_before_patient_contact_total, a.m2_before_aseptic_total, a.m3_after_body_fluid_total, a.m4_after_patient_contact_total, a.m5_after_touching_surroundings_total];
                      const dones  = [a.m1_before_patient_contact_done,  a.m2_before_aseptic_done,  a.m3_after_body_fluid_done,  a.m4_after_patient_contact_done,  a.m5_after_touching_surroundings_done];
                      const p = pct(dones[i], totals[i]);
                      return (
                        <div key={m.key} className="text-center">
                          <p className="text-[9px] text-muted-foreground font-bold">{m.who}</p>
                          <ComplianceChip value={p} />
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-4 text-[10px] text-muted-foreground flex-wrap">
                    {!a.hand_rub_available && <span className="text-red-600">Hand rub unavailable</span>}
                    {!a.soap_available && <span className="text-red-600">Soap unavailable</span>}
                    {!a.glove_use_appropriate && <span className="text-amber-600">Glove misuse observed</span>}
                  </div>

                  {a.observations && <p className="text-[11px] text-muted-foreground">{a.observations}</p>}
                  {a.corrective_actions && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-400">
                      <span className="font-medium">Actions:</span> {a.corrective_actions}
                    </p>
                  )}
                </div>
                <button onClick={() => (supabase as any).from("hand_hygiene_audits").delete().eq("id", a.id).then(() => { toast({ title: "Deleted" }); load(); })}
                  className="p-1 text-muted-foreground hover:text-destructive shrink-0">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default HandHygieneTab;
