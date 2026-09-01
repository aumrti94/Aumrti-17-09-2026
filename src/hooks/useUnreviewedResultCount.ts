import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeRefetch } from "@/hooks/useRealtimeRefetch";

/**
 * How many released reports in this scope has the clinician not acknowledged yet?
 *
 * Drives the count badge on the OPD/IPD "Reports" tab. It has to work while the tab is
 * CLOSED — that is the whole point: the doctor should see that a result has landed without
 * having opened the tab to look — so it cannot simply read the panel's own state.
 *
 * Deliberately counts only RELEASED reports. A sample sitting in the analyser is not
 * something the doctor can act on, and badging it would train them to ignore the badge.
 *
 * Columns queried are ids only; the four requests are small enough to re-run on every
 * realtime event.
 */

interface Options {
  hospitalId: string | null | undefined;
  patientId: string | null | undefined;
  encounterId?: string | null;
  admissionId?: string | null;
  enabled?: boolean;
}

export function useUnreviewedResultCount({
  hospitalId, patientId, encounterId, admissionId, enabled = true,
}: Options): number {
  const [count, setCount] = useState(0);

  const load = useCallback(async () => {
    if (!enabled || !hospitalId || !patientId) return;

    // Scope: the visit if we have one, otherwise the patient. Matches
    // InvestigationResultsPanel, which falls back the same way when an OPD encounter has
    // not been created yet.
    const scoped = (q: any) => {
      if (admissionId) return q.eq("admission_id", admissionId);
      if (encounterId) return q.eq("encounter_id", encounterId);
      return q.eq("patient_id", patientId);
    };

    const [labRes, radRes, extRes] = await Promise.all([
      scoped(
        (supabase as any)
          .from("lab_orders")
          .select("id")
          .eq("hospital_id", hospitalId)
          .eq("status", "completed")
          .is("results_reviewed_at", null),
      ).limit(100),

      scoped(
        (supabase as any)
          .from("radiology_orders")
          .select("id, radiology_reports!inner(id)")
          .eq("hospital_id", hospitalId)
          .eq("radiology_reports.is_signed", true)
          .is("radiology_reports.results_reviewed_at", null),
      ).limit(100),

      scoped(
        (supabase as any)
          .from("external_lab_referrals")
          .select("id")
          .eq("hospital_id", hospitalId)
          .not("report_received_at", "is", null)
          .is("results_reviewed_at", null),
      ).limit(100),
    ]);

    const labIds: string[] = (labRes.data || []).map((r: any) => r.id);

    // Histopathology is signed out independently of its parent order, so it is counted
    // separately rather than inferred from the lab order's own review stamp.
    let pathCount = 0;
    if (labIds.length > 0) {
      const { data } = await (supabase as any)
        .from("pathology_cases")
        .select("id")
        .eq("hospital_id", hospitalId)
        .in("lab_order_id", labIds)
        .in("status", ["signed_off", "amended"])
        .is("results_reviewed_at", null)
        .limit(100);
      pathCount = (data || []).length;
    }

    setCount(labIds.length + (radRes.data || []).length + (extRes.data || []).length + pathCount);
  }, [enabled, hospitalId, patientId, encounterId, admissionId]);

  useEffect(() => { load(); }, [load]);

  useRealtimeRefetch({
    tables: ["lab_orders", "radiology_reports", "pathology_cases", "external_lab_referrals"],
    hospitalId,
    onChange: load,
    enabled: enabled && !!hospitalId && !!patientId,
    channelName: "unreviewed-results",
  });

  return count;
}

export default useUnreviewedResultCount;
