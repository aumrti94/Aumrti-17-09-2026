import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface FollowupRow {
  id: string;
  condition_label: string;
  next_followup: string;
  followup_tests: string[] | null;
  patient_name: string;
  patient_phone: string | null;
  patient_uhid: string;
  patient_id: string;
}

export function useChronicFollowups(hospitalId: string | null) {
  const [rows, setRows] = useState<FollowupRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchFollowups = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    
    const today = new Date().toISOString().split("T")[0];
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

    const { data } = await (supabase as any)
      .from("chronic_disease_programs")
      .select("id, condition_label, next_followup, followup_tests, patient_id, patient:patients(full_name, phone, uhid)")
      .eq("hospital_id", hospitalId)
      .eq("is_active", true)
      .lte("next_followup", sevenDaysFromNow.toISOString().split("T")[0])
      .order("next_followup", { ascending: true })
      .limit(50);

    if (!data) {
      setRows([]);
      setLoading(false);
      return;
    }

    const patientIds = data.map((d: any) => d.patient_id).filter(Boolean);
    let bookedPatientIds = new Set<string>();
    
    if (patientIds.length > 0) {
      const { data: appts } = await (supabase as any)
        .from("appointments")
        .select("patient_id")
        .eq("hospital_id", hospitalId)
        .in("patient_id", patientIds)
        .neq("status", "cancelled")
        .gte("appointment_date", today);
      (appts || []).forEach((a: any) => bookedPatientIds.add(a.patient_id));

      const { data: tokens } = await (supabase as any)
        .from("opd_tokens")
        .select("patient_id")
        .eq("hospital_id", hospitalId)
        .in("patient_id", patientIds)
        .neq("status", "cancelled")
        .gte("visit_date", today);
      (tokens || []).forEach((t: any) => bookedPatientIds.add(t.patient_id));
    }

    setRows(
      data
        .filter((d: any) => !bookedPatientIds.has(d.patient_id))
        .map((d: any) => ({
          id: d.id,
          condition_label: d.condition_label,
          next_followup: d.next_followup,
          followup_tests: d.followup_tests,
          patient_name: d.patient?.full_name || "Unknown",
          patient_phone: d.patient?.phone || null,
          patient_uhid: d.patient?.uhid || "",
          patient_id: d.patient_id,
        }))
    );
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => {
    fetchFollowups();
  }, [fetchFollowups]);

  return { rows, loading, refetch: fetchFollowups };
}
