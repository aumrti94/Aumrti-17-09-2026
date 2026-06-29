import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { format, subDays, subMonths, startOfMonth, endOfMonth } from "date-fns";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import {
  FlaskConical, AlertTriangle, CheckCircle2, Clock, TrendingDown,
  ShieldCheck, Loader2, RefreshCw, ChevronDown, ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { logNABHEvidence } from "@/lib/nabh-evidence";
import NABHAssistantPanel from "@/components/nabh/NABHAssistantPanel";

const COLOURS = ["#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6","#ec4899","#06b6d4","#84cc16"];

interface JustRow {
  id: string;
  drug_name: string;
  indication: string;
  empirical: boolean;
  culture_available: boolean;
  de_escalation_plan: string | null;
  review_date: string | null;
  iv_to_oral_plan: boolean;
  duration_days: number | null;
  approved: boolean | null;
  de_escalated: boolean | null;
  iv_to_oral_switched: boolean | null;
  created_at: string;
  patient_id: string | null;
  admission_id: string | null;
  patient?: { full_name: string; uhid: string } | null;
}

interface RestrictedDrug {
  id: string;
  drug_name: string;
  drug_class: string | null;
  restriction_level: string;
  requires_id_physician_approval: boolean;
  max_duration_days: number | null;
  alert_at_days: number | null;
  oral_equivalent: string | null;
  is_active: boolean;
}

// ── DDD approximation table (WHO DDDs for common antibiotics, grams)
const DDD_TABLE: Record<string, number> = {
  amoxicillin: 1.0, amoxyclav: 1.5, ampicillin: 2.0,
  piperacillin: 14.0, ceftriaxone: 2.0, cefotaxime: 4.0,
  cefepime: 2.0, meropenem: 3.0, imipenem: 2.0,
  vancomycin: 2.0, ciprofloxacin: 1.0, levofloxacin: 0.5,
  metronidazole: 1.5, cotrimoxazole: 1.92, gentamicin: 0.24,
  amikacin: 1.0, linezolid: 1.2, colistin: 3.0,
};

function getDDD(drugName: string): number {
  const lower = drugName.toLowerCase();
  for (const [key, val] of Object.entries(DDD_TABLE)) {
    if (lower.includes(key)) return val;
  }
  return 1.0; // default fallback
}

export default function ASPDashboardPage() {
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();
  const [justifications, setJustifications] = useState<JustRow[]>([]);
  const [restricted, setRestricted] = useState<RestrictedDrug[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("30");
  const [approving, setApproving] = useState<string | null>(null);
  const [showRestricted, setShowRestricted] = useState(false);
  const [newDrug, setNewDrug] = useState({ drug_name: "", drug_class: "", restriction_level: "restricted", max_duration_days: "", alert_at_days: "5", oral_equivalent: "" });
  const [addingDrug, setAddingDrug] = useState(false);
  const [showAddDrug, setShowAddDrug] = useState(false);

  const fetchData = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    const since = subDays(new Date(), parseInt(period)).toISOString();

    const [justRes, restrictRes] = await Promise.all([
      (supabase as any)
        .from("antibiotic_justifications")
        .select("*, patient:patients(full_name, uhid)")
        .eq("hospital_id", hospitalId)
        .eq("is_deleted", false)
        .gte("created_at", since)
        .order("created_at", { ascending: false }),
      (supabase as any)
        .from("antibiotic_restricted_list")
        .select("*")
        .eq("hospital_id", hospitalId)
        .order("drug_class, drug_name"),
    ]);

    setJustifications(justRes.data || []);
    setRestricted(restrictRes.data || []);
    setLoading(false);
  }, [hospitalId, period]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Analytics computations ──────────────────────────────────────────────────
  const total = justifications.length;
  const empiricalCount = justifications.filter(j => j.empirical).length;
  const deEscalatedCount = justifications.filter(j => j.de_escalated).length;
  const ivToOralCount = justifications.filter(j => j.iv_to_oral_switched).length;
  const withReviewDate = justifications.filter(j => j.review_date).length;
  const pending = justifications.filter(j => j.approved === null);

  const empiricalRate = total > 0 ? Math.round((empiricalCount / total) * 100) : 0;
  const deEscalationRate = empiricalCount > 0 ? Math.round((deEscalatedCount / empiricalCount) * 100) : 0;
  const ivToOralRate = total > 0 ? Math.round((ivToOralCount / total) * 100) : 0;
  const reviewSetRate = total > 0 ? Math.round((withReviewDate / total) * 100) : 0;

  // Drug class breakdown
  const drugClassMap: Record<string, number> = {};
  justifications.forEach(j => {
    const restricted_drug = restricted.find(r => j.drug_name.toLowerCase().includes(r.drug_name.toLowerCase()));
    const cls = restricted_drug?.drug_class || "Other";
    drugClassMap[cls] = (drugClassMap[cls] || 0) + 1;
  });
  const classData = Object.entries(drugClassMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

  // Top antibiotics
  const drugMap: Record<string, number> = {};
  justifications.forEach(j => { drugMap[j.drug_name] = (drugMap[j.drug_name] || 0) + 1; });
  const topDrugs = Object.entries(drugMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 8);

  const approve = async (id: string, approved: boolean) => {
    setApproving(id);
    await (supabase as any).from("antibiotic_justifications").update({ approved }).eq("id", id);
    if (approved) {
      await logNABHEvidence(hospitalId!, "HIC.2", `Restricted antibiotic approved by ID physician/microbiologist`);
    }
    setApproving(null);
    fetchData();
    toast({ title: approved ? "Approved" : "Rejected" });
  };

  const addRestrictedDrug = async () => {
    if (!newDrug.drug_name.trim() || !hospitalId) return;
    setAddingDrug(true);
    await (supabase as any).from("antibiotic_restricted_list").upsert({
      hospital_id: hospitalId,
      drug_name: newDrug.drug_name.trim(),
      drug_class: newDrug.drug_class || null,
      restriction_level: newDrug.restriction_level,
      max_duration_days: newDrug.max_duration_days ? parseInt(newDrug.max_duration_days) : null,
      alert_at_days: newDrug.alert_at_days ? parseInt(newDrug.alert_at_days) : 5,
      oral_equivalent: newDrug.oral_equivalent || null,
    }, { onConflict: "hospital_id,drug_name" });
    setAddingDrug(false);
    setShowAddDrug(false);
    setNewDrug({ drug_name: "", drug_class: "", restriction_level: "restricted", max_duration_days: "", alert_at_days: "5", oral_equivalent: "" });
    fetchData();
    toast({ title: "Drug added to restricted list" });
  };

  const kpis = [
    { label: "Total Prescriptions", value: String(total), icon: FlaskConical, color: "text-blue-600" },
    { label: "Empirical Rate", value: `${empiricalRate}%`, icon: AlertTriangle, color: empiricalRate > 70 ? "text-amber-600" : "text-green-600" },
    { label: "De-escalation Rate", value: `${deEscalationRate}%`, icon: TrendingDown, color: deEscalationRate < 30 ? "text-red-600" : "text-green-600" },
    { label: "IV→Oral Switch", value: `${ivToOralRate}%`, icon: CheckCircle2, color: "text-emerald-600" },
    { label: "Review Date Set", value: `${reviewSetRate}%`, icon: Clock, color: reviewSetRate < 60 ? "text-amber-600" : "text-green-600" },
    { label: "Pending Approval", value: String(pending.length), icon: ShieldCheck, color: pending.length > 0 ? "text-red-600" : "text-green-600" },
  ];

  const levelColours: Record<string, string> = {
    reserve: "bg-red-50 text-red-700 border-red-200",
    restricted: "bg-amber-50 text-amber-700 border-amber-200",
    watch: "bg-blue-50 text-blue-700 border-blue-200",
  };

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FlaskConical size={16} className="text-primary" />
          <h1 className="text-[16px] font-bold text-foreground">Antibiotic Stewardship Programme</h1>
          <Badge variant="outline" className="text-[11px]">NABH HIC.2</Badge>
        </div>
        <div className="flex items-center gap-3">
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="h-8 w-28 text-[12px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={fetchData} className="h-8 gap-1.5">
            <RefreshCw size={12} /> Refresh
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-5">
        {/* KPI strip */}
        <div className="grid grid-cols-6 gap-3">
          {kpis.map(k => (
            <div key={k.label} className="bg-card border border-border rounded-xl p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <k.icon size={12} className={k.color} />
                <span className="text-[10px] text-muted-foreground font-medium">{k.label}</span>
              </div>
              <p className={`text-[22px] font-bold ${k.color}`}>{k.value}</p>
            </div>
          ))}
        </div>

        <Tabs defaultValue="pending">
          <TabsList className="h-9">
            <TabsTrigger value="pending" className="text-[12px] gap-1.5">
              Pending Approvals {pending.length > 0 && <span className="bg-red-500 text-white rounded-full w-4 h-4 text-[10px] flex items-center justify-center">{pending.length}</span>}
            </TabsTrigger>
            <TabsTrigger value="analytics" className="text-[12px]">Analytics</TabsTrigger>
            <TabsTrigger value="history" className="text-[12px]">All Justifications</TabsTrigger>
            <TabsTrigger value="restricted" className="text-[12px]">Restricted List</TabsTrigger>
          </TabsList>

          {/* ── TAB: PENDING APPROVALS ── */}
          <TabsContent value="pending" className="mt-4">
            {loading ? (
              <div className="flex items-center justify-center py-12"><Loader2 size={22} className="animate-spin text-muted-foreground" /></div>
            ) : pending.length === 0 ? (
              <div className="text-center py-12">
                <CheckCircle2 size={32} className="text-green-500 mx-auto mb-2" />
                <p className="text-[14px] text-foreground font-medium">No pending approvals</p>
                <p className="text-[12px] text-muted-foreground mt-1">All antibiotic prescriptions are reviewed.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {pending.map(j => (
                  <div key={j.id} className="border border-amber-200 bg-amber-50 rounded-xl p-4 flex items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-[14px] font-semibold text-foreground">{j.drug_name}</p>
                        <Badge variant="outline" className="text-[10px]">{j.empirical ? "Empirical" : "Culture-Guided"}</Badge>
                        {j.duration_days && <span className="text-[11px] text-muted-foreground">{j.duration_days} days</span>}
                      </div>
                      <p className="text-[12px] text-foreground">{j.indication}</p>
                      {j.patient && <p className="text-[11px] text-muted-foreground mt-0.5">{j.patient.full_name} · {j.patient.uhid}</p>}
                      {j.de_escalation_plan && <p className="text-[11px] text-blue-700 mt-1">De-escalation: {j.de_escalation_plan}</p>}
                      {j.review_date && <p className="text-[11px] text-muted-foreground">Review: {format(new Date(j.review_date), "dd/MM/yyyy")}</p>}
                    </div>
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <Button size="sm" className="h-8 gap-1.5 bg-green-600 hover:bg-green-700 text-white" onClick={() => approve(j.id, true)} disabled={approving === j.id}>
                        {approving === j.id ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}Approve
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 gap-1.5 border-red-300 text-red-600 hover:bg-red-50" onClick={() => approve(j.id, false)} disabled={approving === j.id}>
                        Reject
                      </Button>
                    </div>
                    <p className="text-[10px] text-muted-foreground shrink-0 pt-1">{format(new Date(j.created_at), "dd/MM HH:mm")}</p>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── TAB: ANALYTICS ── */}
          <TabsContent value="analytics" className="mt-4">
            <div className="grid grid-cols-2 gap-5">
              {/* Empirical vs Culture-Guided pie */}
              <div className="bg-card border border-border rounded-xl p-4">
                <p className="text-[13px] font-semibold text-foreground mb-4">Empirical vs Culture-Guided</p>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={[{ name: "Empirical", value: empiricalCount }, { name: "Culture-Guided", value: total - empiricalCount }]}
                      cx="50%" cy="50%" outerRadius={65} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                      <Cell fill="#f59e0b" />
                      <Cell fill="#10b981" />
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* Top antibiotics bar */}
              <div className="bg-card border border-border rounded-xl p-4">
                <p className="text-[13px] font-semibold text-foreground mb-4">Top 8 Antibiotics by Prescriptions</p>
                {topDrugs.length === 0 ? (
                  <p className="text-[12px] text-muted-foreground text-center py-8">No data for this period.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={topDrugs} layout="vertical" margin={{ left: 60 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={60} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#3b82f6" radius={[0, 2, 2, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* ASP KPI summary cards */}
              <div className="bg-card border border-border rounded-xl p-4">
                <p className="text-[13px] font-semibold text-foreground mb-3">Stewardship Metrics</p>
                <div className="space-y-3">
                  {[
                    { label: "De-escalation rate (empirical → targeted)", value: `${deEscalationRate}%`, target: "Target: > 50%", ok: deEscalationRate >= 50 },
                    { label: "IV-to-oral switch rate", value: `${ivToOralRate}%`, target: "Target: > 30%", ok: ivToOralRate >= 30 },
                    { label: "Review date compliance", value: `${reviewSetRate}%`, target: "Target: 100%", ok: reviewSetRate >= 80 },
                    { label: "Prescriptions with ID/Micro approval", value: `${total > 0 ? Math.round(((total - pending.length) / total) * 100) : 100}%`, target: "Target: 100%", ok: pending.length === 0 },
                  ].map(m => (
                    <div key={m.label} className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[12px] text-foreground truncate">{m.label}</p>
                        <p className="text-[10px] text-muted-foreground">{m.target}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={cn("text-[14px] font-bold", m.ok ? "text-green-600" : "text-red-600")}>{m.value}</span>
                        {m.ok ? <CheckCircle2 size={14} className="text-green-500" /> : <AlertTriangle size={14} className="text-amber-500" />}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Drug class breakdown */}
              {classData.length > 0 && (
                <div className="bg-card border border-border rounded-xl p-4">
                  <p className="text-[13px] font-semibold text-foreground mb-4">Prescriptions by Drug Class</p>
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie data={classData} cx="50%" cy="50%" outerRadius={65} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                        {classData.map((_, i) => <Cell key={i} fill={COLOURS[i % COLOURS.length]} />)}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </TabsContent>

          {/* ── TAB: ALL JUSTIFICATIONS ── */}
          <TabsContent value="history" className="mt-4">
            <div className="border border-border rounded-xl overflow-hidden">
              <table className="w-full text-[12px]">
                <thead className="bg-muted/50">
                  <tr>
                    {["Date","Patient","Drug","Indication","Type","Duration","De-escalated","IV→Oral","Approved","Review"].map(h => (
                      <th key={h} className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {loading ? (
                    <tr><td colSpan={10} className="py-8 text-center"><Loader2 size={18} className="animate-spin text-muted-foreground mx-auto" /></td></tr>
                  ) : justifications.length === 0 ? (
                    <tr><td colSpan={10} className="py-8 text-center text-muted-foreground text-[12px]">No antibiotic justifications in this period.</td></tr>
                  ) : justifications.map(j => (
                    <tr key={j.id} className="hover:bg-muted/30">
                      <td className="px-3 py-2 whitespace-nowrap">{format(new Date(j.created_at), "dd/MM/yyyy")}</td>
                      <td className="px-3 py-2">{j.patient?.full_name || "—"}</td>
                      <td className="px-3 py-2 font-medium">{j.drug_name}</td>
                      <td className="px-3 py-2 max-w-[200px] truncate">{j.indication}</td>
                      <td className="px-3 py-2">
                        <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium", j.empirical ? "bg-amber-50 text-amber-700" : "bg-green-50 text-green-700")}>
                          {j.empirical ? "Empirical" : "Culture"}
                        </span>
                      </td>
                      <td className="px-3 py-2">{j.duration_days ? `${j.duration_days}d` : "—"}</td>
                      <td className="px-3 py-2">
                        {j.de_escalated === null ? <span className="text-muted-foreground">—</span> : j.de_escalated ? <CheckCircle2 size={13} className="text-green-500" /> : <span className="text-amber-500 text-[10px]">No</span>}
                      </td>
                      <td className="px-3 py-2">
                        {j.iv_to_oral_switched ? <CheckCircle2 size={13} className="text-green-500" /> : j.iv_to_oral_plan ? <span className="text-[10px] text-blue-600">Planned</span> : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        {j.approved === null ? <span className="bg-amber-50 text-amber-700 text-[10px] px-1.5 py-0.5 rounded font-medium">Pending</span>
                          : j.approved ? <span className="bg-green-50 text-green-700 text-[10px] px-1.5 py-0.5 rounded font-medium">Approved</span>
                          : <span className="bg-red-50 text-red-700 text-[10px] px-1.5 py-0.5 rounded font-medium">Rejected</span>}
                      </td>
                      <td className="px-3 py-2">{j.review_date ? format(new Date(j.review_date), "dd/MM") : <span className="text-muted-foreground">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>

          {/* ── TAB: RESTRICTED LIST ── */}
          <TabsContent value="restricted" className="mt-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[13px] text-muted-foreground">{restricted.length} antibiotics on restricted list</p>
              <Button size="sm" onClick={() => setShowAddDrug(!showAddDrug)} className="h-8 gap-1.5">
                {showAddDrug ? "Cancel" : "+ Add Drug"}
              </Button>
            </div>

            {showAddDrug && (
              <div className="border border-border rounded-xl p-4 mb-4 bg-muted/30">
                <p className="text-[12px] font-medium text-foreground mb-3">Add Restricted Antibiotic</p>
                <div className="grid grid-cols-3 gap-3 items-end">
                  <div>
                    <label className="text-[11px] text-muted-foreground">Drug Name *</label>
                    <Input value={newDrug.drug_name} onChange={e => setNewDrug(p => ({ ...p, drug_name: e.target.value }))} className="h-9 mt-1 text-[12px]" placeholder="e.g. Vancomycin" />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">Drug Class</label>
                    <Input value={newDrug.drug_class} onChange={e => setNewDrug(p => ({ ...p, drug_class: e.target.value }))} className="h-9 mt-1 text-[12px]" placeholder="Glycopeptide" />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">WHO AWaRe Level</label>
                    <Select value={newDrug.restriction_level} onValueChange={v => setNewDrug(p => ({ ...p, restriction_level: v }))}>
                      <SelectTrigger className="h-9 mt-1 text-[12px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="watch">Watch</SelectItem>
                        <SelectItem value="restricted">Restricted</SelectItem>
                        <SelectItem value="reserve">Reserve</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">Max Duration (days)</label>
                    <Input type="number" value={newDrug.max_duration_days} onChange={e => setNewDrug(p => ({ ...p, max_duration_days: e.target.value }))} className="h-9 mt-1 text-[12px]" />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">Alert at Day</label>
                    <Input type="number" value={newDrug.alert_at_days} onChange={e => setNewDrug(p => ({ ...p, alert_at_days: e.target.value }))} className="h-9 mt-1 text-[12px]" />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">Oral Equivalent</label>
                    <Input value={newDrug.oral_equivalent} onChange={e => setNewDrug(p => ({ ...p, oral_equivalent: e.target.value }))} className="h-9 mt-1 text-[12px]" placeholder="e.g. Linezolid oral" />
                  </div>
                  <div className="col-span-3 flex justify-end">
                    <Button onClick={addRestrictedDrug} disabled={addingDrug || !newDrug.drug_name.trim()} size="sm">
                      {addingDrug ? <Loader2 size={12} className="animate-spin mr-1" /> : null}Add to List
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <div className="border border-border rounded-xl overflow-hidden">
              <table className="w-full text-[12px]">
                <thead className="bg-muted/50">
                  <tr>
                    {["Drug","Class","WHO AWaRe Level","Max Days","Alert Day","Oral Equivalent","Approval Req."].map(h => (
                      <th key={h} className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {restricted.map(r => (
                    <tr key={r.id} className="hover:bg-muted/30">
                      <td className="px-3 py-2 font-medium">{r.drug_name}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.drug_class || "—"}</td>
                      <td className="px-3 py-2">
                        <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-medium border", levelColours[r.restriction_level] || "")}>
                          {r.restriction_level.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-3 py-2">{r.max_duration_days ? `${r.max_duration_days}d` : "—"}</td>
                      <td className="px-3 py-2">{r.alert_at_days ? `Day ${r.alert_at_days}` : "—"}</td>
                      <td className="px-3 py-2">{r.oral_equivalent || "—"}</td>
                      <td className="px-3 py-2">
                        {r.requires_id_physician_approval
                          ? <ShieldCheck size={13} className="text-amber-500" />
                          : <span className="text-muted-foreground text-[11px]">No</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>

        {/* NABH AI Assistant */}
        {hospitalId && <NABHAssistantPanel hospitalId={hospitalId} pageContext="Antibiotic Stewardship Programme — HIC chapter, de-escalation rate, empirical prescribing" />}
      </div>
    </div>
  );
}
