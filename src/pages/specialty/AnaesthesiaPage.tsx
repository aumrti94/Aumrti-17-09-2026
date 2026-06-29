import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import AnaesthesiaSheet from "@/components/specialty/AnaesthesiaSheet";

export default function AnaesthesiaPage() {
  const { hospitalId, loading } = useHospitalId();
  const navigate = useNavigate();
  const [patientId, setPatientId] = useState<string | null>(null);
  const [admissionId, setAdmissionId] = useState<string | null>(null);
  const [encounterId, setEncounterId] = useState<string | null>(null);

  const { data: patients } = useQuery({
    queryKey: ["patients-anaesthesia", hospitalId],
    queryFn: async () => {
      const { data } = await supabase.from("patients").select("id, full_name, uhid").eq("hospital_id", hospitalId!).order("full_name").limit(200);
      return data ?? [];
    },
    enabled: !!hospitalId,
  });

  const { data: admissions } = useQuery({
    queryKey: ["admissions-anaesthesia", hospitalId, patientId],
    queryFn: async () => {
      const { data } = await supabase.from("admissions").select("id, admission_number, admission_date").eq("hospital_id", hospitalId!).eq("patient_id", patientId!).in("status", ["admitted", "under_surgery"]).order("admission_date", { ascending: false }).limit(20);
      return data ?? [];
    },
    enabled: !!hospitalId && !!patientId,
  });

  if (loading || !hospitalId) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col overflow-hidden">
      <div className="flex-shrink-0 px-6 py-3 border-b border-border flex items-center gap-3 bg-card">
        <button onClick={() => navigate(-1)} className="text-muted-foreground hover:text-foreground"><ArrowLeft size={18} /></button>
        <div>
          <h1 className="text-lg font-bold">Anaesthesia EMR</h1>
          <p className="text-xs text-muted-foreground">PAC · Intraoperative Chart · PACU Aldrete Score — Specialty EMR</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        <div className="p-4 bg-purple-50 border border-purple-200 rounded-xl space-y-3">
          <div>
            <label className="text-[11px] font-semibold text-purple-700 uppercase tracking-wide mb-1 block">Patient *</label>
            <select
              value={patientId || ""}
              onChange={(e) => { setPatientId(e.target.value || null); setAdmissionId(null); }}
              className="w-full h-10 rounded-md border border-purple-300 bg-white px-3 text-sm"
            >
              <option value="">— Choose patient —</option>
              {patients?.map((p) => <option key={p.id} value={p.id}>{p.full_name} · {p.uhid}</option>)}
            </select>
          </div>
          {patientId && admissions && admissions.length > 0 && (
            <div>
              <label className="text-[11px] font-semibold text-purple-700 uppercase tracking-wide mb-1 block">Admission (optional)</label>
              <select
                value={admissionId || ""}
                onChange={(e) => setAdmissionId(e.target.value || null)}
                className="w-full h-10 rounded-md border border-purple-300 bg-white px-3 text-sm"
              >
                <option value="">— All (not linked to admission) —</option>
                {admissions.map((a: any) => <option key={a.id} value={a.id}>{a.admission_number} · {a.admission_date}</option>)}
              </select>
            </div>
          )}
        </div>

        {patientId && (
          <AnaesthesiaSheet
            patientId={patientId}
            hospitalId={hospitalId}
            encounterId={encounterId}
            admissionId={admissionId}
          />
        )}

        {!patientId && (
          <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
            Select a patient above to open the Anaesthesia EMR sheet.
          </div>
        )}
      </div>
    </div>
  );
}
