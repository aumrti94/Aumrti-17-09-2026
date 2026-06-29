import React, { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Activity, Plus, Loader2, X, TrendingUp, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, parseISO, startOfMonth, endOfMonth } from "date-fns";

interface PainAudit {
  id: string;
  audit_date: string;
  area_name: string | null;
  total_patients_audited: number;
  pain_assessed_on_admission: number;
  pain_reassessed_4hourly: number;
  pain_scale_used_correctly: number;
  analgesic_given_within_30min: number;
  non_pharma_used: number;
  observations: string | null;
  corrective_actions: string | null;
}

const today = new Date().toISOString().split("T")[0];

const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 100) : null);

const IndicatorBar: React.FC<{ label: string; value: number | null; target?: number }> = ({ label, value, target = 80 }) => {
  if (value === null) return null;
  const ok = value >= target;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">{label}</span>
        <span className={cn("text-[11px] font-bold", ok ? "text-emerald-600" : "text-red-600")}>{value}%</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", ok ? "bg-emerald-500" : "bg-red-500")}
          style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
    </div>
  );
};

const FL: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <label className="text-[11px] font-medium text-muted-foreground block mb-1">{children}</label>
);

const PainManagementTab: React.FC<{ hospitalId: string }> = ({ hospitalId }) => {
  const { toast } = useToast();
  const { userId } = useHospitalId();
  const [audits, setAudits] = useState<PainAudit[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    audit_date: today, area_name: "",
    total_patients_audited: "",
    pain_assessed_on_admission: "",
    pain_reassessed_4hourly: "",
    pain_scale_used_correctly: "",
    analgesic_given_within_30min: "",
    non_pharma_used: "",
    observations: "", corrective_actions: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("pain_audit_records")
      .select("*")
      .eq("hospital_id", hospitalId)
      .order("audit_date", { ascending: false })
      .limit(200);
    setAudits(data || []);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!form.audit_date || !form.total_patients_audited) return;
    setSaving(true);
    const { error } = await (supabase as any).from("pain_audit_records").insert({
      hospital_id: hospitalId,
      audit_date: form.audit_date,
      area_name: form.area_name || null,
      auditor_id: userId || null,
      total_patients_audited:      parseInt(form.total_patients_audited) || 0,
      pain_assessed_on_admission:  parseInt(form.pain_assessed_on_admission) || 0,
      pain_reassessed_4hourly:     parseInt(form.pain_reassessed_4hourly) || 0,
      pain_scale_used_correctly:   parseInt(form.pain_scale_used_correctly) || 0,
      analgesic_given_within_30min: parseInt(form.analgesic_given_within_30min) || 0,
      non_pharma_used:             parseInt(form.non_pharma_used) || 0,
      observations: form.observations || null,
      corrective_actions: form.corrective_actions || null,
    });
    if (error) toast({ title: "Failed to save", description: error.message, variant: "destructive" });
    else {
      toast({ title: "Pain management audit saved" });
      setShowAdd(false);
      setForm({ audit_date: today, area_name: "", total_patients_audited: "", pain_assessed_on_admission: "", pain_reassessed_4hourly: "", pain_scale_used_correctly: "", analgesic_given_within_30min: "", non_pharma_used: "", observations: "", corrective_actions: "" });
      load();
    }
    setSaving(false);
  };

  // Monthly aggregated KPIs
  const monthlyKpis = useMemo(() => {
    const ms = startOfMonth(new Date()).toISOString().split("T")[0];
    const me = endOfMonth(new Date()).toISOString().split("T")[0];
    const thisMonth = audits.filter(a => a.audit_date >= ms && a.audit_date <= me);
    const total = thisMonth.reduce((s, a) => s + a.total_patients_audited, 0);
    return {
      assessed:    pct(thisMonth.reduce((s, a) => s + a.pain_assessed_on_admission, 0),  total),
      reassessed:  pct(thisMonth.reduce((s, a) => s + a.pain_reassessed_4hourly, 0),     total),
      scaleCorrect: pct(thisMonth.reduce((s, a) => s + a.pain_scale_used_correctly, 0),  total),
      analgesia30: pct(thisMonth.reduce((s, a) => s + a.analgesic_given_within_30min, 0), total),
      nonPharma:   pct(thisMonth.reduce((s, a) => s + a.non_pharma_used, 0),             total),
      total,
    };
  }, [audits]);

  const numNI = Object.values(monthlyKpis).filter((v, i) => i < 5 && v !== null && (v as number) < 80).length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="p-4 border-b flex items-center justify-between gap-3 shrink-0 flex-wrap">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-rose-500 shrink-0" />
          <span className="text-sm font-semibold">Pain Management Audits</span>
          <Badge variant="outline" className="text-[10px]">COP — NABH</Badge>
          {numNI > 0 && (
            <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]">
              <AlertTriangle className="h-3 w-3 mr-1" />{numNI} indicator{numNI > 1 ? "s" : ""} below target this month
            </Badge>
          )}
          {numNI === 0 && monthlyKpis.total > 0 && (
            <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px]">
              <CheckCircle2 className="h-3 w-3 mr-1" />All indicators on target
            </Badge>
          )}
        </div>
        <Button size="sm" onClick={() => setShowAdd(s => !s)} className="h-7 text-xs gap-1">
          <Plus className="h-3 w-3" /> Record Audit
        </Button>
      </div>

      {/* Monthly KPI strip */}
      {monthlyKpis.total > 0 && (
        <div className="border-b bg-card px-5 py-3 shrink-0">
          <p className="text-[11px] font-semibold text-muted-foreground mb-2">This Month — {monthlyKpis.total} patients audited</p>
          <div className="grid grid-cols-5 gap-4">
            <IndicatorBar label="Pain assessed on admission" value={monthlyKpis.assessed} />
            <IndicatorBar label="Reassessed 4-hourly" value={monthlyKpis.reassessed} />
            <IndicatorBar label="Pain scale used correctly" value={monthlyKpis.scaleCorrect} />
            <IndicatorBar label="Analgesia given ≤30 mins" value={monthlyKpis.analgesia30} />
            <IndicatorBar label="Non-pharma measures used" value={monthlyKpis.nonPharma} target={60} />
          </div>
        </div>
      )}

      {showAdd && (
        <div className="border-b p-4 bg-muted/40 space-y-3 shrink-0">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <FL>Audit Date *</FL>
              <Input type="date" value={form.audit_date} onChange={e => setForm(f => ({ ...f, audit_date: e.target.value }))} className="h-8 text-sm" />
            </div>
            <div>
              <FL>Ward / Area</FL>
              <Input value={form.area_name} onChange={e => setForm(f => ({ ...f, area_name: e.target.value }))} placeholder="e.g. Surgical Ward, ICU" className="h-8 text-sm" />
            </div>
            <div>
              <FL>Total Patients Audited *</FL>
              <Input type="number" min="0" value={form.total_patients_audited} onChange={e => setForm(f => ({ ...f, total_patients_audited: e.target.value }))} placeholder="0" className="h-8 text-sm" />
            </div>
          </div>
          <p className="text-xs font-semibold text-foreground">Compliance Counts (of total patients audited)</p>
          <div className="grid grid-cols-3 gap-3">
            {[
              { key: "pain_assessed_on_admission",  label: "Pain assessed on admission" },
              { key: "pain_reassessed_4hourly",      label: "Reassessed every 4 hours" },
              { key: "pain_scale_used_correctly",    label: "Pain scale used correctly" },
              { key: "analgesic_given_within_30min", label: "Analgesic given within 30 mins of reporting" },
              { key: "non_pharma_used",              label: "Non-pharmacological measures documented" },
            ].map(item => (
              <div key={item.key}>
                <FL>{item.label}</FL>
                <Input type="number" min="0" value={form[item.key as keyof typeof form] as string}
                  onChange={e => setForm(f => ({ ...f, [item.key]: e.target.value }))}
                  placeholder="0" className="h-8 text-sm" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FL>Observations</FL>
              <textarea value={form.observations} onChange={e => setForm(f => ({ ...f, observations: e.target.value }))} placeholder="Key findings…" className="w-full text-sm border border-input rounded px-3 py-1.5 bg-background min-h-[48px] resize-none" />
            </div>
            <div>
              <FL>Corrective Actions</FL>
              <textarea value={form.corrective_actions} onChange={e => setForm(f => ({ ...f, corrective_actions: e.target.value }))} placeholder="Actions to improve pain management compliance…" className="w-full text-sm border border-input rounded px-3 py-1.5 bg-background min-h-[48px] resize-none" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSave} disabled={saving || !form.audit_date || !form.total_patients_audited} className="h-7 text-xs flex-1">
              {saving && <Loader2 className="h-3 w-3 animate-spin mr-1" />} Save Audit
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)} className="h-7 text-xs">Cancel</Button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-8"><Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Loading…</span></div>
        ) : audits.length === 0 ? (
          <div className="py-10 text-center space-y-2">
            <Activity className="h-8 w-8 text-muted-foreground/40 mx-auto" />
            <p className="text-sm text-muted-foreground">No pain management audits recorded.</p>
            <p className="text-xs text-muted-foreground">NABH COP requires monthly audits of pain assessment, reassessment timeliness, and analgesic administration compliance. Target: ≥80%.</p>
          </div>
        ) : audits.map(a => {
          const indicators = [
            { label: "Assessed on admission", value: pct(a.pain_assessed_on_admission, a.total_patients_audited) },
            { label: "Reassessed 4-hourly",   value: pct(a.pain_reassessed_4hourly, a.total_patients_audited) },
            { label: "Scale used correctly",   value: pct(a.pain_scale_used_correctly, a.total_patients_audited) },
            { label: "Analgesia ≤30 min",      value: pct(a.analgesic_given_within_30min, a.total_patients_audited) },
            { label: "Non-pharma",             value: pct(a.non_pharma_used, a.total_patients_audited) },
          ];
          const hasIssue = indicators.some(i => i.value !== null && i.value < 80);
          return (
            <div key={a.id} className={cn("border rounded-lg px-3 py-3 bg-card",
              hasIssue ? "border-amber-200 bg-amber-50/30 dark:bg-amber-950/20" : "border-border"
            )}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{format(parseISO(a.audit_date), "dd MMM yyyy")}</span>
                    {a.area_name && <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-px rounded">{a.area_name}</span>}
                    <span className="text-[11px] text-muted-foreground">{a.total_patients_audited} patients</span>
                    {hasIssue && <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px]">Below target</Badge>}
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    {indicators.map(i => (
                      <div key={i.label} className="text-center">
                        <p className="text-[9px] text-muted-foreground">{i.label}</p>
                        <span className={cn("text-[11px] font-bold",
                          i.value === null ? "text-muted-foreground" :
                          i.value >= 80 ? "text-emerald-600" : "text-red-600"
                        )}>{i.value !== null ? `${i.value}%` : "—"}</span>
                      </div>
                    ))}
                  </div>
                  {a.observations && <p className="text-[11px] text-muted-foreground">{a.observations}</p>}
                  {a.corrective_actions && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-400">
                      <span className="font-medium">Actions:</span> {a.corrective_actions}
                    </p>
                  )}
                </div>
                <button onClick={() => (supabase as any).from("pain_audit_records").delete().eq("id", a.id).then(() => { toast({ title: "Deleted" }); load(); })}
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

export default PainManagementTab;
