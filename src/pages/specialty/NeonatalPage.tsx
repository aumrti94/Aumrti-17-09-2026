import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import NeonatalSheet from "@/components/specialty/NeonatalSheet";

export default function NeonatalPage() {
  const { hospitalId, loading } = useHospitalId();
  const navigate = useNavigate();
  const [patientId, setPatientId] = useState<string | null>(null);
  const [admissionId, setAdmissionId] = useState<string | null>(null);

  const { data: patients } = useQuery({
    queryKey: ["patients-neonatal", hospitalId],
    queryFn: async () => {
      const { data } = await supabase.from("patients").select("id, full_name, uhid").eq("hospital_id", hospitalId!).order("full_name").limit(200);
      return data ?? [];
    },
    enabled: !!hospitalId,
  });

  if (loading || !hospitalId) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col overflow-hidden">
      <div className="flex-shrink-0 px-6 py-3 border-b border-border flex items-center gap-3 bg-card">
        <button onClick={() => navigate(-1)} className="text-muted-foreground hover:text-foreground"><ArrowLeft size={18} /></button>
        <div>
          <h1 className="text-lg font-bold">Neonatal EMR</h1>
          <p className="text-xs text-muted-foreground">APGAR · Bhutani Nomogram · CCHD · Anthropometry — Specialty EMR</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
          <label className="text-[11px] font-semibold text-blue-700 uppercase tracking-wide mb-1 block">Neonate / Patient *</label>
          <select
            value={patientId || ""}
            onChange={(e) => setPatientId(e.target.value || null)}
            className="w-full h-10 rounded-md border border-blue-300 bg-white px-3 text-sm"
          >
            <option value="">— Choose patient —</option>
            {patients?.map((p) => <option key={p.id} value={p.id}>{p.full_name} · {p.uhid}</option>)}
          </select>
        </div>

        {patientId && (
          <NeonatalSheet
            patientId={patientId}
            hospitalId={hospitalId}
            admissionId={admissionId}
          />
        )}

        {!patientId && (
          <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
            Select a patient above to open the Neonatal EMR sheet.
          </div>
        )}
      </div>
    </div>
  );
}
