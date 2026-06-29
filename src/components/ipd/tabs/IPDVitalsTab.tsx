import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { runSepsisCheck, type SepsisResult } from "@/lib/clinicalPredictions";
import { checkVitalsThresholds, calculateNEWS2, vitalSeverityClass } from "@/lib/vitalsAlerts";

interface Props {
  admissionId: string;
  hospitalId: string | null;
  userId: string | null;
  patientId?: string;
}

interface VitalRecord {
  id: string;
  bp_systolic: number | null;
  bp_diastolic: number | null;
  pulse: number | null;
  temperature: number | null;
  spo2: number | null;
  respiratory_rate: number | null;
  pain_score: number | null;
  news2_score: number | null;
  recorded_at: string;
  recorded_by: string;
}

const IPDVitalsTab: React.FC<Props> = ({ admissionId, hospitalId, userId, patientId }) => {
  const [vitals, setVitals] = useState<VitalRecord[]>([]);
  const [form, setForm] = useState({ bp_s: "", bp_d: "", pulse: "", temp: "", spo2: "", rr: "", pain: "" });
  const [saving, setSaving] = useState(false);
  const [sepsisResult, setSepsisResult] = useState<SepsisResult | null>(null);
  const [sepsisChecking, setSepsisChecking] = useState(false);

  const fetchVitals = useCallback(() => {
    if (!admissionId) return;
    supabase.from("ipd_vitals")
      .select("*")
      .eq("admission_id", admissionId)
      .order("recorded_at", { ascending: false })
      .limit(10)
      .then(({ data }) => setVitals((data as unknown as VitalRecord[]) || []));
  }, [admissionId]);

  useEffect(() => { fetchVitals(); }, [fetchVitals]);

  // Check for active sepsis alert
  useEffect(() => {
    if (!admissionId) return;
    supabase.from("sepsis_alerts")
      .select("*")
      .eq("admission_id", admissionId)
      .eq("resolved", false)
      .order("alert_fired_at", { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (data && data.length > 0) {
          const alert = data[0] as any;
          setSepsisResult({
            score: alert.news2_score,
            riskLevel: alert.risk_level,
            clinicalNote: alert.clinical_interpretation ? {
              clinical_interpretation: alert.clinical_interpretation,
              urgent_actions: alert.urgent_actions || [],
              escalate_immediately: alert.risk_level === "critical",
            } : null,
          });
        }
      });
  }, [admissionId]);

  const calcNEWS2 = () => {
    return calculateNEWS2({
      respiratory_rate: form.rr ? parseInt(form.rr) : undefined,
      spo2: form.spo2 ? parseInt(form.spo2) : undefined,
      bp_systolic: form.bp_s ? parseInt(form.bp_s) : undefined,
      pulse: form.pulse ? parseInt(form.pulse) : undefined,
      temperature: form.temp ? parseFloat(form.temp) : undefined,
    });
  };

  const handleSave = async () => {
    if (!hospitalId || !userId) {
      toast({ title: "Session Error", description: "Hospital or User ID missing. Please reload.", variant: "destructive" });
      return;
    }
    setSaving(true);
    const news2 = calcNEWS2();
    const { error } = await supabase.from("ipd_vitals").insert({
      admission_id: admissionId,
      hospital_id: hospitalId,
      recorded_by: userId,
      bp_systolic: form.bp_s ? parseInt(form.bp_s) : null,
      bp_diastolic: form.bp_d ? parseInt(form.bp_d) : null,
      pulse: form.pulse ? parseInt(form.pulse) : null,
      temperature: form.temp ? parseFloat(form.temp) : null,
      spo2: form.spo2 ? parseInt(form.spo2) : null,
      respiratory_rate: form.rr ? parseInt(form.rr) : null,
      pain_score: form.pain ? parseInt(form.pain) : null,
      news2_score: news2,
    });
    setSaving(false);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }

    // Threshold-based alerts
    const thresholdAlerts = checkVitalsThresholds({
      bp_systolic: form.bp_s ? parseInt(form.bp_s) : undefined,
      spo2: form.spo2 ? parseInt(form.spo2) : undefined,
      pulse: form.pulse ? parseInt(form.pulse) : undefined,
      temperature: form.temp ? parseFloat(form.temp) : undefined,
      respiratory_rate: form.rr ? parseInt(form.rr) : undefined,
    });
    const criticals = thresholdAlerts.filter((a) => a.severity === "critical");
    if (criticals.length > 0) {
      toast({ title: `⚠️ CRITICAL: ${criticals.map((a) => a.message).join("; ")}`, variant: "destructive" });
      if (hospitalId && patientId) {
        await supabase.from("clinical_alerts").insert({
          hospital_id: hospitalId,
          patient_id: patientId,
          alert_type: "vitals_critical",
          severity: "critical",
          alert_message: criticals.map((a) => `${a.parameter}: ${a.value} — ${a.message}`).join("; "),
        });
      }
    } else {
      toast({ title: `Vitals recorded — NEWS2: ${news2}` });
    }

    // Run sepsis check if NEWS2 >= 3
    if (news2 >= 3 && patientId) {
      setSepsisChecking(true);
      const result = await runSepsisCheck(
        {
          rr: form.rr ? parseInt(form.rr) : undefined,
          spo2: form.spo2 ? parseInt(form.spo2) : undefined,
          temperature: form.temp ? parseFloat(form.temp) : undefined,
          bp_systolic: form.bp_s ? parseInt(form.bp_s) : undefined,
          bp_diastolic: form.bp_d ? parseInt(form.bp_d) : undefined,
          pulse: form.pulse ? parseInt(form.pulse) : undefined,
        },
        hospitalId,
        patientId,
        admissionId
      );
      setSepsisChecking(false);
      if (result) {
        setSepsisResult(result);
        if (result.riskLevel === "critical") {
          toast({ title: "🚨 CRITICAL: Sepsis Risk Detected", description: `NEWS2 Score: ${result.score} — Urgent escalation recommended`, variant: "destructive" });
        } else if (result.riskLevel === "high") {
          toast({ title: "⚠️ High Sepsis Risk", description: `NEWS2 Score: ${result.score} — Clinical review required` });
        }
      }
    }

    setForm({ bp_s: "", bp_d: "", pulse: "", temp: "", spo2: "", rr: "", pain: "" });
    fetchVitals();
  };

  const handleAcknowledgeSepsis = async () => {
    if (!admissionId || !userId) return;
    await supabase.from("sepsis_alerts")
      .update({ acknowledged: true, acknowledged_by: userId, acknowledged_at: new Date().toISOString() } as any)
      .eq("admission_id", admissionId)
      .eq("resolved", false);
    toast({ title: "Sepsis alert acknowledged" });
  };

  const latestNEWS2 = vitals[0]?.news2_score ?? null;

  return (
    <div className="h-full flex flex-col overflow-hidden p-4">
      {/* Sepsis Alert Banner */}
      {sepsisResult && sepsisResult.riskLevel !== "low" && (
        <div className={cn(
          "flex-shrink-0 border-l-[3px] p-3 rounded-r mb-3",
          sepsisResult.riskLevel === "critical" ? "bg-red-50 border-red-600" : "bg-amber-50 border-amber-500"
        )}>
          <div className="flex items-center justify-between mb-1">
            <span className={cn("text-sm font-bold", sepsisResult.riskLevel === "critical" ? "text-red-700" : "text-amber-700")}>
              {sepsisResult.riskLevel === "critical" ? "🚨 CRITICAL SEPSIS RISK" : "⚠️ HIGH SEPSIS RISK"} — NEWS2: {sepsisResult.score}
            </span>
            <Button size="sm" variant="outline" onClick={handleAcknowledgeSepsis}
              className={cn("text-[11px] h-6", sepsisResult.riskLevel === "critical" ? "border-red-300 text-red-600" : "border-amber-300 text-amber-600")}>
              ✓ Acknowledge
            </Button>
          </div>
          {sepsisResult.clinicalNote && (
            <>
              <p className="text-xs text-slate-700 mb-1">{sepsisResult.clinicalNote.clinical_interpretation}</p>
              {sepsisResult.clinicalNote.urgent_actions.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {sepsisResult.clinicalNote.urgent_actions.map((a, i) => (
                    <span key={i} className="text-[10px] bg-white border border-slate-200 px-2 py-0.5 rounded-full text-slate-700">{a}</span>
                  ))}
                </div>
              )}
            </>
          )}
          {sepsisChecking && <p className="text-[10px] text-slate-500 mt-1">🔄 Running AI clinical assessment...</p>}
        </div>
      )}

      {/* NEWS2 warning (legacy, show if no sepsis alert but high score) */}
      {!sepsisResult && latestNEWS2 !== null && latestNEWS2 >= 5 && (
        <div className="flex-shrink-0 bg-red-50 border-l-[3px] border-red-500 p-2.5 rounded-r mb-3 flex items-center justify-between">
          <span className="text-xs text-red-700 font-medium">⚠️ High NEWS2 Score ({latestNEWS2}) — Consider escalation protocol</span>
          <Button size="sm" variant="outline" className="text-[11px] h-6 border-red-300 text-red-600">Notify Senior</Button>
        </div>
      )}

      {/* Add vitals form */}
      <div className="flex-shrink-0 bg-white rounded-lg border border-slate-200 p-3 mb-3">
        <p className="text-xs font-bold text-slate-600 mb-2 uppercase tracking-wider">Record Vitals</p>
        <div className="grid grid-cols-7 gap-2">
          <VInput label="BP Sys" value={form.bp_s} onChange={(v) => setForm({ ...form, bp_s: v })} placeholder="120" />
          <VInput label="BP Dia" value={form.bp_d} onChange={(v) => setForm({ ...form, bp_d: v })} placeholder="80" />
          <VInput label="Pulse" value={form.pulse} onChange={(v) => setForm({ ...form, pulse: v })} placeholder="72" />
          <VInput label="Temp °F" value={form.temp} onChange={(v) => setForm({ ...form, temp: v })} placeholder="98.6" />
          <VInput label="SpO2 %" value={form.spo2} onChange={(v) => setForm({ ...form, spo2: v })} placeholder="98" />
          <VInput label="RR" value={form.rr} onChange={(v) => setForm({ ...form, rr: v })} placeholder="16" />
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-400 font-bold uppercase mb-1">Pain</span>
            <div className="flex gap-1 items-end flex-1">
              <Input value={form.pain} onChange={(e) => setForm({ ...form, pain: e.target.value })}
                placeholder="0-10" className="h-8 text-xs flex-1" type="number" min={0} max={10} />
            </div>
          </div>
        </div>
        <div className="flex justify-end mt-2">
          <Button size="sm" onClick={handleSave} disabled={saving} className="bg-[#1A2F5A] hover:bg-[#152647] text-xs h-8">
            {saving ? "Saving..." : "Record Vitals"}
          </Button>
        </div>
      </div>

      {/* Vitals history */}
      <div className="flex-1 overflow-y-auto bg-white rounded-lg border border-slate-200">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 sticky top-0">
            <tr>
              {["Time", "BP", "Pulse", "Temp", "SpO2", "RR", "Pain", "NEWS2"].map((h) => (
                <th key={h} className="text-left px-3 py-2 text-[11px] font-bold text-slate-500 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {vitals.map((v, i) => {
              const n2Color = (v.news2_score ?? 0) >= 5 ? "text-red-600 bg-red-50" : (v.news2_score ?? 0) >= 3 ? "text-amber-600 bg-amber-50" : "text-emerald-600 bg-emerald-50";
              return (
                <tr key={v.id} className={i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                  <td className="px-3 py-2 text-slate-600">{new Date(v.recorded_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</td>
                  <td className={cn("px-3 py-2 font-medium", vitalSeverityClass("bp_systolic", v.bp_systolic))}>{v.bp_systolic || "—"}/{v.bp_diastolic || "—"}</td>
                  <td className={cn("px-3 py-2", vitalSeverityClass("pulse", v.pulse))}>{v.pulse || "—"}</td>
                  <td className={cn("px-3 py-2", vitalSeverityClass("temperature", v.temperature))}>{v.temperature || "—"}</td>
                  <td className={cn("px-3 py-2", vitalSeverityClass("spo2", v.spo2))}>{v.spo2 || "—"}</td>
                  <td className={cn("px-3 py-2", vitalSeverityClass("respiratory_rate", v.respiratory_rate))}>{v.respiratory_rate || "—"}</td>
                  <td className="px-3 py-2">{v.pain_score ?? "—"}</td>
                  <td className="px-3 py-2"><span className={cn("px-1.5 py-0.5 rounded text-[11px] font-bold", n2Color)}>{v.news2_score ?? "—"}</span></td>
                </tr>
              );
            })}
            {vitals.length === 0 && (
              <tr><td colSpan={8} className="text-center py-8 text-slate-400">No vitals recorded yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const VInput = ({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) => (
  <div className="flex flex-col">
    <span className="text-[10px] text-slate-400 font-bold uppercase mb-1">{label}</span>
    <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-8 text-xs" type="number" />
  </div>
);

export default IPDVitalsTab;
