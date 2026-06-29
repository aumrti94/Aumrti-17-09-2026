import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalContext } from "@/contexts/HospitalContext";
import { useToast } from "@/hooks/use-toast";
import { logNABHEvidence } from "@/lib/nabh-evidence";
import { sofa, apacheII } from "@/lib/clinicalCalculators";
import { format, subHours, startOfDay } from "date-fns";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Activity, Droplets, Wind, Brain, Target, Shield, ArrowLeft,
  Plus, CheckCircle2, AlertTriangle, Loader2, RefreshCw, TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────
interface AdmissionInfo {
  id: string;
  patient_name: string;
  admission_number: string;
  ward_name: string;
  admitting_diagnosis: string;
  admitted_at: string;
  doctor_name: string;
}

// ── SOFA auto-score banner ────────────────────────────────────────────────────
function SOFABanner({ admissionId }: { admissionId: string }) {
  const [score, setScore] = useState<number | null>(null);
  useEffect(() => {
    // Fetch latest lab + vitals to auto-calc SOFA
    // For now show last recorded manual SOFA if available
    setScore(null);
  }, [admissionId]);
  return null; // Expanded in production when auto-calc data is wired
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 1: HOURLY FLOWSHEET
// ─────────────────────────────────────────────────────────────────────────────
function FlowsheetTab({ admissionId, hospitalId, userId }: { admissionId: string; hospitalId: string; userId: string }) {
  const { toast } = useToast();
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    hr: "", sbp: "", dbp: "", spo2: "", rr: "", temp: "", gcs_total: "",
    urine_ml: "", fio2_pct: "", peep: "", tv: "", pip: "", notes: "",
  });

  const fetchEntries = useCallback(async () => {
    const since = subHours(new Date(), 72).toISOString();
    const { data } = await (supabase as any)
      .from("icu_flowsheet_entries")
      .select("*")
      .eq("hospital_id", hospitalId)
      .eq("admission_id", admissionId)
      .gte("recorded_at", since)
      .order("recorded_at", { ascending: false });
    setEntries(data || []);
    setLoading(false);
  }, [admissionId, hospitalId]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const n = (v: string) => v !== "" ? parseFloat(v) : null;
  const i = (v: string) => v !== "" ? parseInt(v) : null;

  const save = async () => {
    setSaving(true);
    const { error } = await (supabase as any).from("icu_flowsheet_entries").insert({
      hospital_id: hospitalId, admission_id: admissionId, recorded_by: userId,
      hr: i(form.hr), sbp: i(form.sbp), dbp: i(form.dbp),
      spo2: n(form.spo2), rr: i(form.rr), temp: n(form.temp), gcs_total: i(form.gcs_total),
      urine_ml: i(form.urine_ml), fio2_pct: n(form.fio2_pct), peep: n(form.peep),
      tv: i(form.tv), pip: i(form.pip), notes: form.notes || null,
    });
    setSaving(false);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Flowsheet entry recorded" });
    setForm({ hr: "", sbp: "", dbp: "", spo2: "", rr: "", temp: "", gcs_total: "", urine_ml: "", fio2_pct: "", peep: "", tv: "", pip: "", notes: "" });
    fetchEntries();
  };

  return (
    <div className="h-full flex flex-col gap-3 p-4 overflow-hidden">
      {/* Entry form */}
      <div className="flex-shrink-0 bg-blue-50 border border-blue-200 rounded-xl p-4">
        <p className="text-[12px] font-semibold text-blue-800 mb-3">New Flowsheet Entry</p>
        <div className="grid grid-cols-6 gap-2">
          {[
            { id: "hr", label: "HR", unit: "/min" }, { id: "sbp", label: "SBP", unit: "mmHg" },
            { id: "dbp", label: "DBP", unit: "mmHg" }, { id: "spo2", label: "SpO₂", unit: "%" },
            { id: "rr", label: "RR", unit: "/min" }, { id: "temp", label: "Temp", unit: "°C" },
            { id: "gcs_total", label: "GCS", unit: "/15" }, { id: "urine_ml", label: "Urine", unit: "mL/hr" },
            { id: "fio2_pct", label: "FiO₂", unit: "%" }, { id: "peep", label: "PEEP", unit: "cmH₂O" },
            { id: "tv", label: "TV", unit: "mL" }, { id: "pip", label: "PIP", unit: "cmH₂O" },
          ].map(f => (
            <div key={f.id}>
              <label className="text-[10px] text-muted-foreground">{f.label} <span className="opacity-60">{f.unit}</span></label>
              <Input
                type="number"
                value={(form as any)[f.id]}
                onChange={e => setForm(prev => ({ ...prev, [f.id]: e.target.value }))}
                className="h-8 text-[12px] mt-0.5"
                placeholder="—"
              />
            </div>
          ))}
          <div className="col-span-4">
            <label className="text-[10px] text-muted-foreground">Notes</label>
            <Input value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} className="h-8 text-[12px] mt-0.5" placeholder="Optional note" />
          </div>
          <div className="col-span-2 flex items-end">
            <Button onClick={save} disabled={saving} size="sm" className="w-full h-8 text-[12px] gap-1.5">
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}Record
            </Button>
          </div>
        </div>
      </div>

      {/* Flowsheet grid */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
        ) : entries.length === 0 ? (
          <p className="text-[13px] text-muted-foreground text-center py-8">No flowsheet entries in the last 72 hours.</p>
        ) : (
          <table className="w-full text-[12px] border-collapse">
            <thead className="sticky top-0 bg-card z-10">
              <tr className="border-b border-border">
                {["Time","HR","SBP","DBP","MAP","SpO₂","RR","Temp","GCS","Urine","FiO₂","PEEP","TV"].map(h => (
                  <th key={h} className="px-2 py-1.5 text-left text-[11px] font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {entries.map(e => (
                <tr key={e.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-2 py-1.5 font-medium whitespace-nowrap">{format(new Date(e.recorded_at), "dd/MM HH:mm")}</td>
                  <td className="px-2 py-1.5">{e.hr ?? "—"}</td>
                  <td className="px-2 py-1.5">{e.sbp ?? "—"}</td>
                  <td className="px-2 py-1.5">{e.dbp ?? "—"}</td>
                  <td className="px-2 py-1.5 font-medium text-blue-700">{e.map_calc ?? "—"}</td>
                  <td className={cn("px-2 py-1.5 font-medium", e.spo2 && e.spo2 < 90 ? "text-red-600" : "")}>{e.spo2 ?? "—"}</td>
                  <td className="px-2 py-1.5">{e.rr ?? "—"}</td>
                  <td className={cn("px-2 py-1.5", e.temp && (e.temp >= 38.5 || e.temp < 35) ? "text-amber-600 font-medium" : "")}>{e.temp ?? "—"}</td>
                  <td className={cn("px-2 py-1.5 font-medium", e.gcs_total && e.gcs_total <= 8 ? "text-red-600" : "")}>{e.gcs_total ?? "—"}</td>
                  <td className="px-2 py-1.5">{e.urine_ml ?? "—"}</td>
                  <td className="px-2 py-1.5">{e.fio2_pct ?? "—"}</td>
                  <td className="px-2 py-1.5">{e.peep ?? "—"}</td>
                  <td className="px-2 py-1.5">{e.tv ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 2: I/O BALANCE
// ─────────────────────────────────────────────────────────────────────────────
const INTAKE_TYPES = ["IV Fluid","Blood","TPN","Enteral Feed","Oral","Drug Flush","Other"];
const OUTPUT_TYPES = ["Urine","NG Drain","Chest Drain","Surgical Drain","Stool","Insensible","Vomitus","Other"];

function IOBalanceTab({ admissionId, hospitalId, userId }: { admissionId: string; hospitalId: string; userId: string }) {
  const { toast } = useToast();
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ category: "intake", io_type: "IV Fluid", volume_ml: "", description: "" });

  const fetchRecords = useCallback(async () => {
    const since = startOfDay(new Date()).toISOString();
    const { data } = await (supabase as any)
      .from("io_balance_records")
      .select("*")
      .eq("hospital_id", hospitalId)
      .eq("admission_id", admissionId)
      .gte("recorded_at", since)
      .order("recorded_at", { ascending: false });
    setRecords(data || []);
    setLoading(false);
  }, [admissionId, hospitalId]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  const totalIntake = records.filter(r => r.category === "intake").reduce((s, r) => s + (r.volume_ml || 0), 0);
  const totalOutput = records.filter(r => r.category === "output").reduce((s, r) => s + (r.volume_ml || 0), 0);
  const balance = totalIntake - totalOutput;

  const save = async () => {
    if (!form.volume_ml) return;
    setSaving(true);
    const { error } = await (supabase as any).from("io_balance_records").insert({
      hospital_id: hospitalId, admission_id: admissionId, recorded_by: userId,
      category: form.category, io_type: form.io_type,
      volume_ml: parseInt(form.volume_ml), description: form.description || null,
    });
    setSaving(false);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: `${form.category === "intake" ? "Intake" : "Output"} recorded` });
    setForm(p => ({ ...p, volume_ml: "", description: "" }));
    fetchRecords();
  };

  return (
    <div className="h-full flex flex-col gap-3 p-4">
      {/* Balance summary */}
      <div className="flex-shrink-0 grid grid-cols-3 gap-3">
        {[
          { label: "Total Intake (today)", value: `${totalIntake.toLocaleString("en-IN")} mL`, color: "text-blue-700 bg-blue-50 border-blue-200" },
          { label: "Total Output (today)", value: `${totalOutput.toLocaleString("en-IN")} mL`, color: "text-amber-700 bg-amber-50 border-amber-200" },
          { label: "Fluid Balance", value: `${balance >= 0 ? "+" : ""}${balance.toLocaleString("en-IN")} mL`, color: balance > 1000 ? "text-red-700 bg-red-50 border-red-200" : balance < -500 ? "text-orange-700 bg-orange-50 border-orange-200" : "text-green-700 bg-green-50 border-green-200" },
        ].map(s => (
          <div key={s.label} className={`border rounded-xl p-4 ${s.color}`}>
            <p className="text-[11px] font-medium opacity-70">{s.label}</p>
            <p className="text-[20px] font-bold mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Add record form */}
      <div className="flex-shrink-0 bg-muted/30 border border-border rounded-xl p-4">
        <div className="grid grid-cols-4 gap-3 items-end">
          <div>
            <label className="text-[11px] font-medium text-muted-foreground">Category</label>
            <Select value={form.category} onValueChange={v => setForm(p => ({ ...p, category: v, io_type: v === "intake" ? "IV Fluid" : "Urine" }))}>
              <SelectTrigger className="h-9 mt-1 text-[12px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="intake">Intake</SelectItem>
                <SelectItem value="output">Output</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[11px] font-medium text-muted-foreground">Type</label>
            <Select value={form.io_type} onValueChange={v => setForm(p => ({ ...p, io_type: v }))}>
              <SelectTrigger className="h-9 mt-1 text-[12px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(form.category === "intake" ? INTAKE_TYPES : OUTPUT_TYPES).map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[11px] font-medium text-muted-foreground">Volume (mL)</label>
            <Input type="number" value={form.volume_ml} onChange={e => setForm(p => ({ ...p, volume_ml: e.target.value }))} className="h-9 mt-1 text-[12px]" placeholder="0" />
          </div>
          <Button onClick={save} disabled={saving || !form.volume_ml} size="sm" className="h-9 gap-1.5">
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}Add
          </Button>
        </div>
      </div>

      {/* Records list */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-24"><Loader2 size={18} className="animate-spin text-muted-foreground" /></div>
        ) : (
          <table className="w-full text-[12px]">
            <thead><tr className="border-b border-border text-left">
              {["Time","Category","Type","Volume","Description"].map(h => <th key={h} className="px-3 py-2 text-[11px] text-muted-foreground font-medium">{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-border/40">
              {records.map(r => (
                <tr key={r.id} className="hover:bg-muted/30">
                  <td className="px-3 py-1.5 whitespace-nowrap">{format(new Date(r.recorded_at), "HH:mm")}</td>
                  <td className="px-3 py-1.5">
                    <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-medium", r.category === "intake" ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700")}>
                      {r.category}
                    </span>
                  </td>
                  <td className="px-3 py-1.5">{r.io_type}</td>
                  <td className="px-3 py-1.5 font-medium">{r.volume_ml} mL</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{r.description || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 3: VENTILATOR
// ─────────────────────────────────────────────────────────────────────────────
const VENT_MODES = ["AC/VC","AC/PC","SIMV","PSV","CPAP","APRV","PRVC","BiPAP","HFNC","Room Air / Off Vent"];

function VentilatorTab({ admissionId, hospitalId, userId }: { admissionId: string; hospitalId: string; userId: string }) {
  const { toast } = useToast();
  const [params, setParams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ vent_mode: "AC/VC", fio2: "", peep: "", tv_set: "", rr_set: "", pip: "", pplat: "", compliance: "", ie_ratio: "", ps_above_peep: "", notes: "" });

  const fetch = useCallback(async () => {
    const { data } = await (supabase as any).from("ventilator_params")
      .select("*").eq("hospital_id", hospitalId).eq("admission_id", admissionId)
      .order("recorded_at", { ascending: false }).limit(48);
    setParams(data || []); setLoading(false);
  }, [admissionId, hospitalId]);

  useEffect(() => { fetch(); }, [fetch]);

  const save = async () => {
    setSaving(true);
    const nf = (v: string) => v !== "" ? parseFloat(v) : null;
    const ni = (v: string) => v !== "" ? parseInt(v) : null;
    const { error } = await (supabase as any).from("ventilator_params").insert({
      hospital_id: hospitalId, admission_id: admissionId, recorded_by: userId,
      vent_mode: form.vent_mode, fio2: nf(form.fio2), peep: nf(form.peep),
      tv_set: ni(form.tv_set), rr_set: ni(form.rr_set),
      pip: nf(form.pip), pplat: nf(form.pplat), compliance: nf(form.compliance),
      ie_ratio: form.ie_ratio || null, ps_above_peep: nf(form.ps_above_peep),
      notes: form.notes || null,
    });
    setSaving(false);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Ventilator parameters recorded" });
    fetch();
  };

  const latest = params[0];

  return (
    <div className="h-full flex flex-col gap-3 p-4">
      {/* Latest settings banner */}
      {latest && (
        <div className="flex-shrink-0 bg-cyan-50 border border-cyan-200 rounded-xl p-4">
          <p className="text-[11px] font-medium text-cyan-700 mb-2">Current Settings — {format(new Date(latest.recorded_at), "dd/MM HH:mm")}</p>
          <div className="flex gap-6 flex-wrap">
            {[
              { label: "Mode", value: latest.vent_mode },
              { label: "FiO₂", value: latest.fio2 ? `${latest.fio2}%` : "—" },
              { label: "PEEP", value: latest.peep ? `${latest.peep} cmH₂O` : "—" },
              { label: "TV", value: latest.tv_set ? `${latest.tv_set} mL` : "—" },
              { label: "RR", value: latest.rr_set ? `${latest.rr_set}/min` : "—" },
              { label: "PIP", value: latest.pip ? `${latest.pip} cmH₂O` : "—" },
              { label: "Pplat", value: latest.pplat ? `${latest.pplat} cmH₂O` : "—" },
              { label: "Compliance", value: latest.compliance ? `${latest.compliance} mL/cmH₂O` : "—" },
            ].map(s => (
              <div key={s.label}>
                <p className="text-[10px] text-cyan-600 font-medium">{s.label}</p>
                <p className="text-[14px] font-bold text-cyan-900">{s.value ?? "—"}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Entry form */}
      <div className="flex-shrink-0 border border-border rounded-xl p-4">
        <p className="text-[12px] font-semibold text-foreground mb-3">Record Ventilator Parameters</p>
        <div className="grid grid-cols-5 gap-3">
          <div className="col-span-2">
            <label className="text-[11px] text-muted-foreground">Mode</label>
            <Select value={form.vent_mode} onValueChange={v => setForm(p => ({ ...p, vent_mode: v }))}>
              <SelectTrigger className="h-9 mt-1 text-[12px]"><SelectValue /></SelectTrigger>
              <SelectContent>{VENT_MODES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {[
            { id: "fio2", label: "FiO₂ (%)" }, { id: "peep", label: "PEEP" },
            { id: "tv_set", label: "TV (mL)" }, { id: "rr_set", label: "RR Set" },
            { id: "pip", label: "PIP" }, { id: "pplat", label: "Pplat" },
            { id: "compliance", label: "Compliance" }, { id: "ps_above_peep", label: "PS" },
          ].map(f => (
            <div key={f.id}>
              <label className="text-[11px] text-muted-foreground">{f.label}</label>
              <Input type="number" value={(form as any)[f.id]} onChange={e => setForm(p => ({ ...p, [f.id]: e.target.value }))} className="h-9 mt-1 text-[12px]" />
            </div>
          ))}
          <div className="col-span-3">
            <label className="text-[11px] text-muted-foreground">Notes</label>
            <Input value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} className="h-9 mt-1 text-[12px]" />
          </div>
          <div className="col-span-2 flex items-end">
            <Button onClick={save} disabled={saving} size="sm" className="w-full h-9">
              {saving ? <Loader2 size={12} className="animate-spin mr-1" /> : null}Save Parameters
            </Button>
          </div>
        </div>
      </div>

      {/* History */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-[12px]">
          <thead><tr className="border-b border-border">
            {["Time","Mode","FiO₂","PEEP","TV","RR","PIP","Pplat","Compliance"].map(h =>
              <th key={h} className="px-2 py-1.5 text-left text-[11px] text-muted-foreground">{h}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-border/40">
            {params.map(p => (
              <tr key={p.id} className="hover:bg-muted/30">
                <td className="px-2 py-1.5 whitespace-nowrap">{format(new Date(p.recorded_at), "dd/MM HH:mm")}</td>
                <td className="px-2 py-1.5 font-medium">{p.vent_mode}</td>
                <td className="px-2 py-1.5">{p.fio2 ?? "—"}</td>
                <td className="px-2 py-1.5">{p.peep ?? "—"}</td>
                <td className="px-2 py-1.5">{p.tv_set ?? "—"}</td>
                <td className="px-2 py-1.5">{p.rr_set ?? "—"}</td>
                <td className="px-2 py-1.5">{p.pip ?? "—"}</td>
                <td className="px-2 py-1.5">{p.pplat ?? "—"}</td>
                <td className="px-2 py-1.5">{p.compliance ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 4: SEDATION & DELIRIUM
// ─────────────────────────────────────────────────────────────────────────────
const RASS_LABELS: Record<number, { label: string; color: string }> = {
  4:  { label: "+4 Combative",      color: "text-red-700 bg-red-50" },
  3:  { label: "+3 Very Agitated",  color: "text-red-600 bg-red-50" },
  2:  { label: "+2 Agitated",       color: "text-orange-600 bg-orange-50" },
  1:  { label: "+1 Restless",       color: "text-amber-600 bg-amber-50" },
  0:  { label: "0 Alert & Calm",    color: "text-green-700 bg-green-50" },
  "-1": { label: "-1 Drowsy",       color: "text-blue-600 bg-blue-50" },
  "-2": { label: "-2 Light Sedation", color: "text-blue-600 bg-blue-100" },
  "-3": { label: "-3 Moderate Sedation", color: "text-indigo-600 bg-indigo-50" },
  "-4": { label: "-4 Deep Sedation", color: "text-purple-600 bg-purple-50" },
  "-5": { label: "-5 Unarousable",  color: "text-gray-700 bg-gray-100" },
};

function SedationTab({ admissionId, hospitalId, userId }: { admissionId: string; hospitalId: string; userId: string }) {
  const { toast } = useToast();
  const [scores, setScores] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ rass_score: "0", cpot_score: "", cam_icu_positive: "", target_rass: "-2", notes: "" });

  const fetch = useCallback(async () => {
    const { data } = await (supabase as any).from("sedation_scores")
      .select("*").eq("hospital_id", hospitalId).eq("admission_id", admissionId)
      .order("recorded_at", { ascending: false }).limit(24);
    setScores(data || []); setLoading(false);
  }, [admissionId, hospitalId]);

  useEffect(() => { fetch(); }, [fetch]);

  const save = async () => {
    setSaving(true);
    const { error } = await (supabase as any).from("sedation_scores").insert({
      hospital_id: hospitalId, admission_id: admissionId, recorded_by: userId,
      rass_score: parseInt(form.rass_score),
      cpot_score: form.cpot_score !== "" ? parseInt(form.cpot_score) : null,
      cam_icu_positive: form.cam_icu_positive === "true" ? true : form.cam_icu_positive === "false" ? false : null,
      target_rass: parseInt(form.target_rass),
      notes: form.notes || null,
    });
    setSaving(false);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Sedation scores recorded" });
    fetch();
  };

  const latest = scores[0];
  const rassInfo = latest ? RASS_LABELS[latest.rass_score as keyof typeof RASS_LABELS] : null;

  return (
    <div className="h-full flex flex-col gap-3 p-4">
      {/* Latest RASS banner */}
      {latest && rassInfo && (
        <div className={`flex-shrink-0 border rounded-xl p-4 flex items-center gap-4 ${rassInfo.color} border-current/20`}>
          <div>
            <p className="text-[10px] font-medium opacity-70">Current RASS ({format(new Date(latest.recorded_at), "HH:mm")})</p>
            <p className="text-[18px] font-bold">{rassInfo.label}</p>
          </div>
          {latest.cam_icu_positive !== null && (
            <div className={`ml-6 border rounded-xl p-3 ${latest.cam_icu_positive ? "bg-red-50 border-red-200 text-red-700" : "bg-green-50 border-green-200 text-green-700"}`}>
              <p className="text-[10px] font-medium opacity-70">CAM-ICU</p>
              <p className="text-[14px] font-bold">{latest.cam_icu_positive ? "POSITIVE — Delirium" : "Negative"}</p>
            </div>
          )}
          <div className="ml-6">
            <p className="text-[10px] font-medium opacity-70">Target RASS</p>
            <p className="text-[14px] font-bold">{latest.target_rass}</p>
          </div>
        </div>
      )}

      {/* Entry form */}
      <div className="flex-shrink-0 border border-border rounded-xl p-4">
        <p className="text-[12px] font-semibold text-foreground mb-3">Record Sedation Assessment</p>
        <div className="grid grid-cols-4 gap-3 items-end">
          <div>
            <label className="text-[11px] text-muted-foreground">RASS Score</label>
            <Select value={form.rass_score} onValueChange={v => setForm(p => ({ ...p, rass_score: v }))}>
              <SelectTrigger className="h-9 mt-1 text-[12px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(RASS_LABELS).sort((a, b) => parseInt(b[0]) - parseInt(a[0])).map(([v, l]) =>
                  <SelectItem key={v} value={v}>{l.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">Target RASS</label>
            <Select value={form.target_rass} onValueChange={v => setForm(p => ({ ...p, target_rass: v }))}>
              <SelectTrigger className="h-9 mt-1 text-[12px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[-5,-4,-3,-2,-1,0,1].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">CPOT (0–8)</label>
            <Input type="number" min={0} max={8} value={form.cpot_score} onChange={e => setForm(p => ({ ...p, cpot_score: e.target.value }))} className="h-9 mt-1 text-[12px]" />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">CAM-ICU</label>
            <Select value={form.cam_icu_positive} onValueChange={v => setForm(p => ({ ...p, cam_icu_positive: v }))}>
              <SelectTrigger className="h-9 mt-1 text-[12px]"><SelectValue placeholder="Not assessed" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="false">Negative</SelectItem>
                <SelectItem value="true">Positive (Delirium)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-3">
            <label className="text-[11px] text-muted-foreground">Notes</label>
            <Input value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} className="h-9 mt-1 text-[12px]" />
          </div>
          <Button onClick={save} disabled={saving} size="sm" className="h-9">
            {saving ? <Loader2 size={12} className="animate-spin mr-1" /> : null}Record
          </Button>
        </div>
      </div>

      {/* History */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-[12px]">
          <thead><tr className="border-b border-border">
            {["Time","RASS","Target","CPOT","CAM-ICU","Notes"].map(h => <th key={h} className="px-3 py-1.5 text-left text-[11px] text-muted-foreground">{h}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-border/40">
            {scores.map(s => {
              const ri = RASS_LABELS[s.rass_score as keyof typeof RASS_LABELS];
              return (
                <tr key={s.id} className="hover:bg-muted/30">
                  <td className="px-3 py-1.5 whitespace-nowrap">{format(new Date(s.recorded_at), "dd/MM HH:mm")}</td>
                  <td className="px-3 py-1.5"><span className={`px-2 py-0.5 rounded text-[10px] font-medium ${ri?.color || ""}`}>{ri?.label || s.rass_score}</span></td>
                  <td className="px-3 py-1.5">{s.target_rass ?? "—"}</td>
                  <td className="px-3 py-1.5">{s.cpot_score ?? "—"}</td>
                  <td className="px-3 py-1.5">
                    {s.cam_icu_positive === null ? "—" : (
                      <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${s.cam_icu_positive ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
                        {s.cam_icu_positive ? "Positive" : "Negative"}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">{s.notes || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 5: DAILY GOALS
// ─────────────────────────────────────────────────────────────────────────────
const DAILY_GOAL_ITEMS = [
  { id: "weaning_trial", label: "Ventilator weaning trial assessed" },
  { id: "sbt_candidate", label: "Spontaneous breathing trial candidate?" },
  { id: "sedation_holiday", label: "Sedation holiday considered" },
  { id: "vte_prophylaxis", label: "VTE prophylaxis ordered (LMWH / stockings)" },
  { id: "stress_ulcer", label: "Stress ulcer prophylaxis ordered" },
  { id: "nutrition_adequate", label: "Enteral / parenteral nutrition adequate" },
  { id: "lines_reviewed", label: "Central lines reviewed — day count noted" },
  { id: "foley_reviewed", label: "Foley catheter reviewed — necessary?" },
  { id: "mobility_plan", label: "Mobility / physiotherapy plan in place" },
  { id: "family_communication", label: "Family communication done today" },
  { id: "pain_assessed", label: "Pain / sedation goals re-evaluated" },
  { id: "discharge_plan", label: "Step-down / ICU discharge plan discussed" },
];

function DailyGoalsTab({ admissionId, hospitalId, userId }: { admissionId: string; hospitalId: string; userId: string }) {
  const { toast } = useToast();
  const [goals, setGoals] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const today = format(new Date(), "yyyy-MM-dd");

  useEffect(() => {
    (supabase as any).from("icu_daily_goals")
      .select("goals").eq("hospital_id", hospitalId).eq("admission_id", admissionId)
      .eq("goal_date", today).maybeSingle()
      .then(({ data }: any) => {
        if (data?.goals) setGoals(data.goals as Record<string, boolean>);
        setLoading(false);
      });
  }, [admissionId, hospitalId, today]);

  const toggle = (id: string) => setGoals(prev => ({ ...prev, [id]: !prev[id] }));

  const save = async () => {
    setSaving(true);
    const completedCount = Object.values(goals).filter(Boolean).length;
    const { error } = await (supabase as any).from("icu_daily_goals").upsert({
      hospital_id: hospitalId, admission_id: admissionId,
      goal_date: today, goals, updated_by: userId, updated_at: new Date().toISOString(),
    }, { onConflict: "hospital_id,admission_id,goal_date" });
    setSaving(false);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    await logNABHEvidence(hospitalId, "COP.2", `ICU Daily Goals completed for ${today}: ${completedCount}/${DAILY_GOAL_ITEMS.length} items`, completedCount >= 8 ? "compliant" : "partial");
    toast({ title: `Daily goals saved — ${completedCount}/${DAILY_GOAL_ITEMS.length} completed` });
  };

  const completedCount = Object.values(goals).filter(Boolean).length;

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <p className="text-[13px] font-semibold text-foreground">ICU Daily Goals — {format(new Date(), "dd/MM/yyyy")}</p>
          <p className="text-[12px] text-muted-foreground">{completedCount} of {DAILY_GOAL_ITEMS.length} goals achieved today</p>
        </div>
        <Button onClick={save} disabled={saving} size="sm" className="gap-1.5">
          {saving ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}Save Goals
        </Button>
      </div>

      {/* Progress bar */}
      <div className="flex-shrink-0 h-2 bg-muted rounded-full overflow-hidden">
        <div className="h-full bg-green-500 transition-all rounded-full" style={{ width: `${(completedCount / DAILY_GOAL_ITEMS.length) * 100}%` }} />
      </div>

      <div className="flex-1 overflow-auto space-y-1.5">
        {loading ? (
          <div className="flex items-center justify-center h-32"><Loader2 size={18} className="animate-spin text-muted-foreground" /></div>
        ) : DAILY_GOAL_ITEMS.map(item => (
          <label key={item.id} className="flex items-center gap-3 p-3 rounded-xl border border-border cursor-pointer hover:bg-muted/40 transition-colors">
            <input
              type="checkbox"
              checked={!!goals[item.id]}
              onChange={() => toggle(item.id)}
              className="w-4 h-4 rounded border-border text-green-600 focus:ring-green-500/20"
            />
            <span className={cn("text-[13px]", goals[item.id] ? "line-through text-muted-foreground" : "text-foreground")}>
              {item.label}
            </span>
            {goals[item.id] && <CheckCircle2 size={13} className="ml-auto text-green-500 shrink-0" />}
          </label>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 6: CARE BUNDLES
// ─────────────────────────────────────────────────────────────────────────────
const BUNDLE_ITEMS: Record<string, { id: string; label: string }[]> = {
  vap: [
    { id: "hob_30", label: "Head of bed elevation 30–45°" },
    { id: "oral_care", label: "Oral care with chlorhexidine every 6 hours" },
    { id: "sbt_sedation_holiday", label: "Daily sedation holiday + SBT assessment" },
    { id: "peptic_prophylaxis", label: "Peptic ulcer disease prophylaxis" },
    { id: "dvt_prophylaxis", label: "DVT prophylaxis" },
  ],
  clabsi: [
    { id: "hand_hygiene", label: "Hand hygiene before CVC access" },
    { id: "maximal_barrier", label: "Maximal sterile barrier precautions at insertion" },
    { id: "chlorhexidine_skin", label: "Chlorhexidine skin antisepsis used" },
    { id: "optimal_site", label: "Optimal CVC site selection (avoid femoral)" },
    { id: "daily_review", label: "Daily review of CVC necessity (day count: ___)" },
  ],
  cauti: [
    { id: "indication_reviewed", label: "Foley catheter indication reviewed today" },
    { id: "closed_system", label: "Closed drainage system maintained" },
    { id: "bag_below_bladder", label: "Drainage bag maintained below bladder level" },
    { id: "meatal_care", label: "Perineal / meatal care performed" },
    { id: "remove_if_unnecessary", label: "Catheter removed if no longer necessary" },
  ],
  sepsis_6: [
    { id: "blood_cultures", label: "Blood cultures drawn before antibiotics" },
    { id: "lactate", label: "Serum lactate measured" },
    { id: "antibiotics_1hr", label: "IV antibiotics administered within 1 hour" },
    { id: "iv_fluids", label: "IV fluid bolus given (30 mL/kg if hypotensive / lactate ≥ 4)" },
    { id: "vasopressors", label: "Vasopressors started if MAP < 65 after fluids" },
    { id: "urine_output", label: "Urine output monitoring established (target > 0.5 mL/kg/hr)" },
  ],
};

const BUNDLE_LABELS: Record<string, string> = { vap: "VAP Bundle", clabsi: "CLABSI Bundle", cauti: "CAUTI Bundle", sepsis_6: "Sepsis 6 Bundle" };

function CareBundlesTab({ admissionId, hospitalId, userId }: { admissionId: string; hospitalId: string; userId: string }) {
  const { toast } = useToast();
  const [activeBundle, setActiveBundle] = useState("vap");
  const [items, setItems] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const today = format(new Date(), "yyyy-MM-dd");

  useEffect(() => {
    setItems({});
    (supabase as any).from("care_bundle_checks")
      .select("items").eq("hospital_id", hospitalId).eq("admission_id", admissionId)
      .eq("bundle_type", activeBundle).eq("check_date", today).maybeSingle()
      .then(({ data }: any) => { if (data?.items) setItems(data.items as Record<string, boolean>); });
  }, [activeBundle, admissionId, hospitalId, today]);

  const toggle = (id: string) => setItems(prev => ({ ...prev, [id]: !prev[id] }));

  const save = async () => {
    setSaving(true);
    const total = BUNDLE_ITEMS[activeBundle].length;
    const done = Object.values(items).filter(Boolean).length;
    const pct = (done / total) * 100;
    const { error } = await (supabase as any).from("care_bundle_checks").upsert({
      hospital_id: hospitalId, admission_id: admissionId, bundle_type: activeBundle,
      check_date: today, items, compliance_pct: pct, recorded_by: userId,
    }, { onConflict: "hospital_id,admission_id,bundle_type,check_date" });
    setSaving(false);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    await logNABHEvidence(hospitalId, "HIC.3", `${BUNDLE_LABELS[activeBundle]} compliance: ${done}/${total} (${pct.toFixed(0)}%) on ${today}`, pct >= 80 ? "compliant" : "partial");
    toast({ title: `${BUNDLE_LABELS[activeBundle]} saved — ${pct.toFixed(0)}% compliance` });
  };

  const bundleItems = BUNDLE_ITEMS[activeBundle];
  const done = bundleItems.filter(i => items[i.id]).length;

  return (
    <div className="h-full flex flex-col p-4 gap-3">
      {/* Bundle selector */}
      <div className="flex-shrink-0 flex gap-2">
        {Object.entries(BUNDLE_LABELS).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveBundle(key)}
            className={cn("px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-colors", activeBundle === key ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted/50")}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Compliance bar */}
      <div className="flex-shrink-0 flex items-center gap-3">
        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
          <div className={cn("h-full rounded-full transition-all", done / bundleItems.length >= 0.8 ? "bg-green-500" : "bg-amber-500")} style={{ width: `${(done / bundleItems.length) * 100}%` }} />
        </div>
        <span className="text-[12px] font-semibold text-foreground shrink-0">{done}/{bundleItems.length}</span>
        <Button onClick={save} disabled={saving} size="sm" className="shrink-0 h-8 text-[12px] gap-1.5">
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Shield size={12} />}Save
        </Button>
      </div>

      {/* Checklist */}
      <div className="flex-1 overflow-auto space-y-1.5">
        {bundleItems.map(item => (
          <label key={item.id} className="flex items-center gap-3 p-3 rounded-xl border border-border cursor-pointer hover:bg-muted/40 transition-colors">
            <input
              type="checkbox"
              checked={!!items[item.id]}
              onChange={() => toggle(item.id)}
              className="w-4 h-4 rounded border-border text-primary focus:ring-primary/20"
            />
            <span className={cn("text-[13px]", items[item.id] ? "line-through text-muted-foreground" : "text-foreground")}>{item.label}</span>
            {items[item.id] && <CheckCircle2 size={13} className="ml-auto text-green-500 shrink-0" />}
          </label>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────
export default function ICUWorkspacePage() {
  const { admissionId } = useParams<{ admissionId: string }>();
  const navigate = useNavigate();
  const { hospitalId, userId } = useHospitalContext();
  const [admission, setAdmission] = useState<AdmissionInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!admissionId || !hospitalId) return;
    (supabase as any)
      .from("admissions")
      .select(`
        id, admission_number, admitting_diagnosis, admitted_at,
        patient:patients(full_name),
        ward:wards(name),
        doctor:users!admissions_admitting_doctor_id_fkey(full_name)
      `)
      .eq("id", admissionId)
      .eq("hospital_id", hospitalId)
      .maybeSingle()
      .then(({ data }: any) => {
        if (data) {
          setAdmission({
            id: data.id,
            patient_name: data.patient?.full_name || "Unknown",
            admission_number: data.admission_number,
            ward_name: data.ward?.name || "ICU",
            admitting_diagnosis: data.admitting_diagnosis || "—",
            admitted_at: data.admitted_at,
            doctor_name: data.doctor?.full_name || "—",
          });
        }
        setLoading(false);
      });
  }, [admissionId, hospitalId]);

  if (!admissionId || !hospitalId) return null;

  const tabProps = { admissionId, hospitalId, userId: userId || "" };

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 h-14 bg-slate-900 text-white flex items-center gap-3 px-4 border-b border-slate-700">
        <button onClick={() => navigate(-1)} className="text-slate-400 hover:text-white transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-[14px] font-bold">ICU Workspace</span>
        </div>
        {admission && (
          <div className="flex items-center gap-4 ml-3 text-[13px]">
            <span className="text-white font-semibold">{admission.patient_name}</span>
            <span className="text-slate-400">{admission.admission_number}</span>
            <span className="text-slate-400">{admission.ward_name}</span>
            <span className="text-slate-400 hidden lg:block truncate max-w-xs">{admission.admitting_diagnosis}</span>
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] text-slate-400">{format(new Date(), "dd/MM/yyyy HH:mm")}</span>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={28} className="animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Tabs defaultValue="flowsheet" className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="flex-shrink-0 h-11 w-full justify-start rounded-none bg-slate-800 border-b border-slate-700 px-2 gap-0">
            {[
              { v: "flowsheet", l: "Hourly Flowsheet",  icon: Activity },
              { v: "io",        l: "I/O Balance",        icon: Droplets },
              { v: "ventilator",l: "Ventilator",          icon: Wind },
              { v: "sedation",  l: "Sedation & Delirium", icon: Brain },
              { v: "goals",     l: "Daily Goals",         icon: Target },
              { v: "bundles",   l: "Care Bundles",        icon: Shield },
            ].map(({ v, l, icon: Icon }) => (
              <TabsTrigger key={v} value={v} className="flex items-center gap-1.5 text-[12px] text-slate-400 data-[state=active]:text-white data-[state=active]:bg-slate-700 rounded-md px-3 h-8">
                <Icon size={12} />{l}
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="flex-1 overflow-hidden">
            <TabsContent value="flowsheet" className="h-full m-0"><FlowsheetTab {...tabProps} /></TabsContent>
            <TabsContent value="io"        className="h-full m-0"><IOBalanceTab {...tabProps} /></TabsContent>
            <TabsContent value="ventilator"className="h-full m-0"><VentilatorTab {...tabProps} /></TabsContent>
            <TabsContent value="sedation"  className="h-full m-0"><SedationTab {...tabProps} /></TabsContent>
            <TabsContent value="goals"     className="h-full m-0"><DailyGoalsTab {...tabProps} /></TabsContent>
            <TabsContent value="bundles"   className="h-full m-0"><CareBundlesTab {...tabProps} /></TabsContent>
          </div>
        </Tabs>
      )}
    </div>
  );
}
