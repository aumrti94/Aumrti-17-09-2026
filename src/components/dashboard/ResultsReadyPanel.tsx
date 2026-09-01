import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, FlaskConical, ScanLine, Microscope, Check, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRealtimeRefetch } from "@/hooks/useRealtimeRefetch";
import { formatIndianDateTime } from "@/lib/investigationDisplay";

/**
 * "Results Ready" — the doctor's own inbox of released reports they have not read.
 *
 * The per-patient Reports tab only helps a doctor who already has that patient open. This
 * panel answers the other half of the question: across all my patients, what has come back
 * that I have not looked at? It reads the result-ready alerts addressed to this clinician,
 * which is the same signal that drives the notification bell.
 *
 * Registered as dashboard tab key `panel_results_ready`, so a hospital can hide it per role.
 */

interface AlertRow {
  id: string;
  alert_type: string;
  alert_message: string;
  severity: string;
  created_at: string;
  patient_id: string | null;
  lab_order_id: string | null;
  radiology_order_id: string | null;
}

const ICON: Record<string, React.ElementType> = {
  lab_result_ready: FlaskConical,
  radiology_report_ready: ScanLine,
  pathology_report_ready: Microscope,
  external_lab_report_ready: FlaskConical,
};

const RESULT_ALERT_TYPES = [
  "lab_result_ready",
  "radiology_report_ready",
  "pathology_report_ready",
  "external_lab_report_ready",
];

const ResultsReadyPanel: React.FC<{ hospitalId: string | null }> = ({ hospitalId }) => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<AlertRow[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !alive) return;
      const { data } = await supabase
        .from("users").select("id").eq("auth_user_id", user.id).maybeSingle();
      if (alive) setUserId(data?.id ?? null);
    })();
    return () => { alive = false; };
  }, []);

  const load = useCallback(async () => {
    if (!hospitalId || !userId) { setLoading(false); return; }
    const { data } = await (supabase as any)
      .from("clinical_alerts")
      .select("id, alert_type, alert_message, severity, created_at, patient_id, lab_order_id, radiology_order_id")
      .eq("hospital_id", hospitalId)
      .eq("recipient_user_id", userId)
      .eq("is_acknowledged", false)
      .in("alert_type", RESULT_ALERT_TYPES)
      .order("created_at", { ascending: false })
      .limit(25);
    setRows(data || []);
    setLoading(false);
  }, [hospitalId, userId]);

  useEffect(() => { load(); }, [load]);

  useRealtimeRefetch({
    tables: ["clinical_alerts"],
    hospitalId,
    onChange: load,
    enabled: !!hospitalId && !!userId,
    channelName: "results-ready",
  });

  return (
    <div className="bg-card border border-border rounded-xl p-4 flex flex-col min-h-0">
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <h3 className="text-[14px] font-bold text-foreground">Results Ready</h3>
        {rows.length > 0 && (
          <span className="text-[12px] font-bold text-white bg-emerald-600 rounded-full px-2 py-0.5">
            {rows.length}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center flex-1">
          <Loader2 className="animate-spin text-muted-foreground" size={18} />
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 text-muted-foreground">
          <Check size={22} className="text-emerald-500 mb-1.5" />
          <p className="text-[13px]">No reports waiting</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto -mx-1 px-1 space-y-1.5">
          {rows.map((r) => {
            const Icon = ICON[r.alert_type] || FlaskConical;
            const critical = r.severity === "critical";
            return (
              <button
                key={r.id}
                onClick={() => r.patient_id && navigate(`/patients/${r.patient_id}/summary`)}
                className={cn(
                  "w-full text-left flex items-start gap-2 px-2.5 py-2 rounded-lg border transition-colors",
                  critical
                    ? "border-red-300 bg-red-50/60 hover:bg-red-50"
                    : "border-border hover:bg-muted/50",
                )}
              >
                {critical
                  ? <AlertTriangle size={14} className="mt-0.5 text-red-600 flex-shrink-0" />
                  : <Icon size={14} className="mt-0.5 text-muted-foreground flex-shrink-0" />}
                <div className="min-w-0 flex-1">
                  <p className={cn("text-[13px] leading-snug", critical && "font-semibold text-red-800")}>
                    {r.alert_message}
                  </p>
                  <p className="text-[12px] text-muted-foreground mt-0.5">
                    {formatIndianDateTime(r.created_at)}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ResultsReadyPanel;
