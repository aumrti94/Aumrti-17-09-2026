import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ShieldAlert, Plus, X, CheckCircle2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  admissionId: string;
  hospitalId: string;
  patientName: string;
}

interface Restraint {
  id: string;
  restraint_type: "physical" | "chemical" | "environmental";
  reason: string;
  applied_at: string;
  removed_at: string | null;
  monitoring_frequency_min: number;
  patient_response: string | null;
  family_informed: boolean;
  notes: string | null;
}

const TYPE_OPTIONS = [
  { value: "physical", label: "Physical", desc: "Wrist, vest, mitt restraints" },
  { value: "chemical", label: "Chemical", desc: "Sedative/antipsychotic for behaviour" },
  { value: "environmental", label: "Environmental", desc: "Bed rails, locked door" },
] as const;

const MONITORING_OPTIONS = [
  { value: 15, label: "Every 15 min" },
  { value: 30, label: "Every 30 min" },
  { value: 60, label: "Every 1 hour" },
];

const RestraintRecordsTab: React.FC<Props> = ({ admissionId, hospitalId, patientName }) => {
  const { toast } = useToast();
  const [records, setRecords] = useState<Restraint[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [type, setType] = useState<"physical" | "chemical" | "environmental">("physical");
  const [reason, setReason] = useState("");
  const [monitoringFreq, setMonitoringFreq] = useState(15);
  const [familyInformed, setFamilyInformed] = useState(false);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Remove form state
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [patientResponse, setPatientResponse] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("restraint_records")
      .select("*")
      .eq("admission_id", admissionId)
      .order("applied_at", { ascending: false });
    setRecords(data || []);
    setLoading(false);
  }, [admissionId]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    if (!reason.trim()) { toast({ title: "Reason is required", variant: "destructive" }); return; }
    setSaving(true);
    const { error } = await (supabase as any).from("restraint_records").insert({
      hospital_id: hospitalId,
      admission_id: admissionId,
      restraint_type: type,
      reason: reason.trim(),
      monitoring_frequency_min: monitoringFreq,
      family_informed: familyInformed,
      notes: notes.trim() || null,
    });
    if (error) {
      toast({ title: "Failed to add restraint", variant: "destructive" });
    } else {
      toast({ title: "Restraint documented" });
      setShowForm(false);
      setReason(""); setNotes(""); setFamilyInformed(false); setMonitoringFreq(15);
      load();
    }
    setSaving(false);
  };

  const handleRemove = async (id: string) => {
    await (supabase as any).from("restraint_records").update({
      removed_at: new Date().toISOString(),
      patient_response: patientResponse.trim() || null,
    }).eq("id", id);
    toast({ title: "Restraint removed" });
    setRemovingId(null);
    setPatientResponse("");
    load();
  };

  const active = records.filter(r => !r.removed_at);
  const historical = records.filter(r => r.removed_at);

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="p-4 space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-orange-500" />
          <span className="text-sm font-semibold">Restraint Records — {patientName}</span>
        </div>
        <Button size="sm" onClick={() => setShowForm(v => !v)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Apply Restraint
        </Button>
      </div>

      {/* Add form */}
      {showForm && (
        <div className="border border-orange-200 rounded-lg p-4 bg-orange-50/40 space-y-3">
          <p className="text-xs font-semibold text-orange-700 uppercase">New Restraint Order</p>

          <div>
            <label className="text-[11px] text-muted-foreground font-medium block mb-1">Type *</label>
            <div className="flex gap-2">
              {TYPE_OPTIONS.map(o => (
                <button key={o.value} onClick={() => setType(o.value)}
                  className={cn("flex-1 py-2 px-2 rounded-lg border text-xs text-left transition-colors",
                    type === o.value ? "border-orange-400 bg-orange-100 font-semibold" : "border-border hover:bg-muted")}>
                  <p className="font-medium">{o.label}</p>
                  <p className="text-[10px] text-muted-foreground leading-tight">{o.desc}</p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[11px] text-muted-foreground font-medium block mb-1">Reason *</label>
            <Textarea value={reason} onChange={e => setReason(e.target.value)}
              placeholder="Clinical justification for restraint…" className="text-sm min-h-[60px]" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-muted-foreground font-medium block mb-1">Monitoring Frequency</label>
              <select value={monitoringFreq} onChange={e => setMonitoringFreq(Number(e.target.value))}
                className="w-full h-8 text-xs border border-border rounded-md px-2 bg-background">
                {MONITORING_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2 pt-4">
              <input type="checkbox" id="family" checked={familyInformed} onChange={e => setFamilyInformed(e.target.checked)} className="h-3 w-3" />
              <label htmlFor="family" className="text-xs text-muted-foreground cursor-pointer">Family informed</label>
            </div>
          </div>

          <div>
            <label className="text-[11px] text-muted-foreground font-medium block mb-1">Notes</label>
            <Input value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Any additional observations…" className="h-8 text-sm" />
          </div>

          <div className="flex gap-2">
            <Button size="sm" onClick={handleAdd} disabled={saving}>Document Restraint</Button>
            <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Active restraints */}
      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : active.length === 0 ? (
        <div className="border border-dashed rounded-lg p-6 text-center">
          <p className="text-sm text-muted-foreground">No active restraints for this patient.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase">Active Restraints ({active.length})</p>
          {active.map(r => (
            <div key={r.id} className="border border-red-200 rounded-lg p-3 bg-red-50/30">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold capitalize text-red-700">{r.restraint_type}</span>
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {formatTime(r.applied_at)}
                    </span>
                    {r.family_informed && <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded">Family informed</span>}
                  </div>
                  <p className="text-xs text-foreground mb-1">{r.reason}</p>
                  <p className="text-[10px] text-muted-foreground">Monitor every {r.monitoring_frequency_min} min</p>
                  {r.notes && <p className="text-[10px] text-muted-foreground mt-1 italic">{r.notes}</p>}
                </div>
                <Button size="sm" variant="outline" className="shrink-0 text-xs h-7"
                  onClick={() => setRemovingId(r.id)}>
                  Remove
                </Button>
              </div>

              {/* Remove inline form */}
              {removingId === r.id && (
                <div className="mt-3 pt-3 border-t border-red-200 space-y-2">
                  <label className="text-[11px] text-muted-foreground font-medium block">Patient response on removal</label>
                  <Input value={patientResponse} onChange={e => setPatientResponse(e.target.value)}
                    placeholder="e.g. Calm, cooperative…" className="h-7 text-xs" />
                  <div className="flex gap-2">
                    <Button size="sm" className="h-7 text-xs bg-red-600 hover:bg-red-700" onClick={() => handleRemove(r.id)}>
                      <CheckCircle2 className="h-3 w-3 mr-1" /> Confirm Remove
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setRemovingId(null)}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Historical */}
      {historical.length > 0 && (
        <details className="mt-2">
          <summary className="text-[11px] font-semibold text-muted-foreground uppercase cursor-pointer select-none py-1">
            Past Restraints ({historical.length})
          </summary>
          <div className="mt-2 space-y-2">
            {historical.map(r => (
              <div key={r.id} className="border border-border rounded-lg p-3 opacity-70">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold capitalize">{r.restraint_type}</span>
                  <CheckCircle2 className="h-3 w-3 text-green-500" />
                  <span className="text-[10px] text-muted-foreground">Removed {r.removed_at ? formatTime(r.removed_at) : ""}</span>
                </div>
                <p className="text-xs text-muted-foreground">{r.reason}</p>
                {r.patient_response && <p className="text-[10px] text-muted-foreground mt-1">Response: {r.patient_response}</p>}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
};

export default RestraintRecordsTab;
