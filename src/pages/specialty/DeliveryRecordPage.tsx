import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// Same combined mode/outcome enum as the dead partograph_records.outcome column (no reason to
// invent a second vocabulary) and the live validate_obstetric_record() trigger.
const OUTCOMES = [
  { value: "svd", label: "SVD (Spontaneous Vaginal Delivery)" },
  { value: "lscs", label: "LSCS (Caesarean)" },
  { value: "forceps", label: "Forceps" },
  { value: "vacuum", label: "Vacuum" },
  { value: "still_born", label: "Stillbirth" },
];

function nowLocal() {
  return new Date().toISOString().slice(0, 16);
}

export default function DeliveryRecordPage() {
  const { hospitalId, loading } = useHospitalId();
  const navigate = useNavigate();
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [patientId, setPatientId] = useState<string | null>(null);
  const [admissionId, setAdmissionId] = useState<string | null>(null);
  const [deliveryDate, setDeliveryDate] = useState(nowLocal());
  const [outcome, setOutcome] = useState("");
  const [complications, setComplications] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from("users").select("id").eq("auth_user_id", user.id).maybeSingle();
      if (data) setCurrentUserId(data.id);
    })();
  }, []);

  const { data: patients } = useQuery({
    queryKey: ["patients-delivery", hospitalId],
    queryFn: async () => {
      const { data } = await supabase.from("patients").select("id, full_name, uhid, gender").eq("hospital_id", hospitalId!).eq("gender", "female").order("full_name").limit(200);
      return data ?? [];
    },
    enabled: !!hospitalId,
  });

  const { data: admissions } = useQuery({
    queryKey: ["admissions-delivery", hospitalId, patientId],
    queryFn: async () => {
      const { data } = await supabase.from("admissions").select("id, admission_number, admitted_at").eq("hospital_id", hospitalId!).eq("patient_id", patientId!).eq("status", "active").order("admitted_at", { ascending: false }).limit(10);
      return data ?? [];
    },
    enabled: !!hospitalId && !!patientId,
  });

  // Read-only context — the labour observations already recorded for this admission, if any.
  const { data: partographEntries } = useQuery({
    queryKey: ["partograph-entries-delivery", hospitalId, admissionId],
    queryFn: async () => {
      const { data } = await (supabase as any).from("partograph_entries")
        .select("time_hour, cervical_dilation, fhr")
        .eq("hospital_id", hospitalId!).eq("admission_id", admissionId!)
        .order("time_hour", { ascending: true });
      return data ?? [];
    },
    enabled: !!hospitalId && !!admissionId,
  });

  const canSave = !!patientId && !!admissionId && !!outcome && !saving;

  const handleSave = async () => {
    if (!hospitalId || !patientId || !admissionId || !outcome) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("obstetric_records").insert({
        hospital_id: hospitalId,
        patient_id: patientId,
        admission_id: admissionId,
        record_type: "delivery",
        delivery_date: new Date(deliveryDate).toISOString(),
        outcome,
        delivery_conducted_by: currentUserId,
        complications: complications || null,
      });
      if (error) throw error;

      if (outcome === "still_born") {
        await supabase.from("clinical_alerts").insert([{
          hospital_id: hospitalId,
          patient_id: patientId,
          alert_type: "obstetric_risk",
          alert_message: "Stillbirth recorded — delivery outcome",
          severity: "critical",
        }]);
      }

      toast.success("Delivery record saved");
      setOutcome("");
      setComplications("");
    } catch (err) {
      toast.error("Failed to save delivery record");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !hospitalId) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col overflow-hidden">
      <div className="flex-shrink-0 px-6 py-3 border-b border-border flex items-center gap-3 bg-card">
        <button onClick={() => navigate(-1)} className="text-muted-foreground hover:text-foreground"><ArrowLeft size={18} /></button>
        <div>
          <h1 className="text-lg font-bold">Delivery Record</h1>
          <p className="text-xs text-muted-foreground">Mode, outcome & complications — Specialty EMR</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl space-y-3">
          <div>
            <label className="text-[11px] font-semibold text-rose-700 uppercase tracking-wide mb-1 block">Patient (Female) *</label>
            <select
              value={patientId || ""}
              onChange={(e) => { setPatientId(e.target.value || null); setAdmissionId(null); }}
              className="w-full h-10 rounded-md border border-rose-300 bg-white px-3 text-sm"
            >
              <option value="">— Choose patient —</option>
              {patients?.map((p) => <option key={p.id} value={p.id}>{p.full_name} · {p.uhid}</option>)}
            </select>
          </div>
          {patientId && admissions && admissions.length > 0 && (
            <div>
              <label className="text-[11px] font-semibold text-rose-700 uppercase tracking-wide mb-1 block">Admission *</label>
              <select
                value={admissionId || ""}
                onChange={(e) => setAdmissionId(e.target.value || null)}
                className="w-full h-10 rounded-md border border-rose-300 bg-white px-3 text-sm"
              >
                <option value="">— Choose admission —</option>
                {admissions.map((a: any) => <option key={a.id} value={a.id}>{a.admission_number} · {a.admitted_at?.split("T")[0]}</option>)}
              </select>
            </div>
          )}
        </div>

        {patientId && admissionId && (
          <>
            {partographEntries && partographEntries.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Labour Progress (Partograph — read-only reference)</h3>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="text-left py-1">Time</th>
                      <th className="text-left py-1">Dilation (cm)</th>
                      <th className="text-left py-1">FHR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {partographEntries.map((e: any, i: number) => (
                      <tr key={i} className="border-b border-border/50">
                        <td className="py-1">{e.time_hour}</td>
                        <td className="py-1">{e.cervical_dilation ?? "—"}</td>
                        <td className="py-1">{e.fhr ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Delivery Details</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs">Delivery Date/Time</Label>
                  <Input type="datetime-local" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} className="h-9 text-sm" />
                </div>
              </div>
              <div>
                <Label className="text-xs mb-1 block">Mode / Outcome *</Label>
                <div className="flex flex-wrap gap-2">
                  {OUTCOMES.map((o) => (
                    <button key={o.value} onClick={() => setOutcome(o.value)}
                      className={cn("text-xs px-3 py-1.5 rounded-full border transition-colors",
                        outcome === o.value
                          ? o.value === "still_born" ? "bg-destructive text-destructive-foreground border-destructive" : "bg-primary text-primary-foreground border-primary"
                          : "border-border text-muted-foreground hover:bg-muted"
                      )}>{o.label}</button>
                  ))}
                </div>
              </div>
              <div>
                <Label className="text-xs">Complications</Label>
                <textarea value={complications} onChange={(e) => setComplications(e.target.value)}
                  rows={3} placeholder="PPH, perineal tear, shoulder dystocia, etc. — leave blank if none"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none" />
              </div>
            </div>

            <Button onClick={handleSave} disabled={!canSave} className="bg-rose-600 hover:bg-rose-700">
              {saving ? "Saving..." : "Save Delivery Record"}
            </Button>
          </>
        )}

        {(!patientId || !admissionId) && (
          <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
            Select a patient and their active admission above to record a delivery.
          </div>
        )}
      </div>
    </div>
  );
}
