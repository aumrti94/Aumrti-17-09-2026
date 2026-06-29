import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useHospitalId } from "@/hooks/useHospitalId";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, CheckCircle2, Clock, Send, RefreshCw, X } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

interface IntimationRow {
  id: string;
  admission_id: string;
  patient_id: string;
  payer_type: string | null;
  admission_type: string | null;
  status: string;
  intimation_deadline: string | null;
  sent_at: string | null;
  acknowledged_at: string | null;
  reference_number_from_tpa: string | null;
  tpa_response_notes: string | null;
  failure_reason: string | null;
  retry_count: number;
  created_at: string;
  // joined
  patient_name: string;
  uhid: string;
  admission_number: string | null;
}

interface CriticalAlert {
  id: string;
  alert_type: string;
  alert_message: string;
  created_at: string;
}

const STATUS_STYLES: Record<string, string> = {
  pending:      "bg-amber-50 text-amber-700 border-amber-200",
  sent:         "bg-emerald-50 text-emerald-700 border-emerald-200",
  failed:       "bg-red-50 text-red-700 border-red-200",
  acknowledged: "bg-blue-50 text-blue-700 border-blue-200",
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  pending:      <Clock size={12} className="shrink-0" />,
  sent:         <Send size={12} className="shrink-0" />,
  failed:       <AlertTriangle size={12} className="shrink-0" />,
  acknowledged: <CheckCircle2 size={12} className="shrink-0" />,
};

function deadlineBadge(deadline: string | null, status: string): React.ReactNode {
  if (!deadline) return null;
  const dt = new Date(deadline);
  const now = new Date();
  const overdue = dt < now;
  if (status === "acknowledged" || status === "sent") {
    return (
      <span className="text-[11px] text-muted-foreground">
        {format(dt, "dd-MMM HH:mm")}
      </span>
    );
  }
  return (
    <span className={cn(
      "text-[11px] font-semibold",
      overdue ? "text-red-600" : dt.getTime() - now.getTime() < 4 * 3600 * 1000 ? "text-amber-600" : "text-foreground"
    )}>
      {overdue ? "OVERDUE " : ""}{format(dt, "dd-MMM HH:mm")}
    </span>
  );
}

const IntimationsTab: React.FC = () => {
  const [rows, setRows] = useState<IntimationRow[]>([]);
  const [alerts, setAlerts] = useState<CriticalAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState<string | null>(null);
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();

  const loadData = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);

    const [intimRes, alertRes] = await Promise.all([
      (supabase as any)
        .from("insurance_intimations")
        .select("*")
        .eq("hospital_id", hospitalId)
        .order("created_at", { ascending: false })
        .limit(200),
      (supabase as any)
        .from("clinical_alerts")
        .select("id, alert_type, alert_message, created_at")
        .eq("hospital_id", hospitalId)
        .eq("is_acknowledged", false)
        .in("alert_type", ["intimation_send_failure", "intimation_deadline_approaching"])
        .order("created_at", { ascending: false }),
    ]);

    const intimations: any[] = intimRes.data || [];
    setAlerts(alertRes.data || []);

    if (!intimations.length) { setRows([]); setLoading(false); return; }

    const admissionIds = [...new Set(intimations.map((i: any) => i.admission_id))];
    const patientIds  = [...new Set(intimations.map((i: any) => i.patient_id))];

    const [admRes, patRes] = await Promise.all([
      supabase.from("admissions").select("id, admission_number").in("id", admissionIds),
      supabase.from("patients").select("id, full_name, uhid").in("id", patientIds),
    ]);

    const admMap = Object.fromEntries((admRes.data || []).map((a: any) => [a.id, a]));
    const patMap = Object.fromEntries((patRes.data || []).map((p: any) => [p.id, p]));

    setRows(intimations.map((i: any) => ({
      ...i,
      patient_name:     patMap[i.patient_id]?.full_name || "—",
      uhid:             patMap[i.patient_id]?.uhid || "—",
      admission_number: admMap[i.admission_id]?.admission_number || null,
    })));
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { loadData(); }, [loadData]);

  const dismissAlert = async (alertId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    await (supabase as any).from("clinical_alerts").update({
      is_acknowledged: true,
      acknowledged_by: user?.id,
      acknowledged_at: new Date().toISOString(),
    }).eq("id", alertId);
    setAlerts(prev => prev.filter(a => a.id !== alertId));
  };

  // Mark a failed/pending intimation as manually confirmed sent.
  // Updates insurance_intimations AND insurance_pre_auth (if pre-auth exists).
  const markConfirmed = async (row: IntimationRow) => {
    setConfirming(row.id);
    const now = new Date().toISOString();

    const { error } = await (supabase as any)
      .from("insurance_intimations")
      .update({ status: "sent", sent_at: now })
      .eq("id", row.id);

    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      setConfirming(null);
      return;
    }

    // Mirror to insurance_pre_auth so ActiveAdmissions shows intimated status
    await (supabase as any)
      .from("insurance_pre_auth")
      .update({ intimation_sent_at: now, intimation_method: "manual_confirm" })
      .eq("admission_id", row.admission_id)
      .eq("hospital_id", hospitalId);

    // Acknowledge any related CRITICAL alerts for this admission
    await (supabase as any)
      .from("clinical_alerts")
      .update({ is_acknowledged: true, acknowledged_at: now })
      .eq("hospital_id", hospitalId)
      .in("alert_type", ["intimation_send_failure", "intimation_deadline_approaching"])
      .eq("is_acknowledged", false);

    toast({ title: "Intimation confirmed ✓", description: `${row.patient_name} — marked as sent` });
    setConfirming(null);
    loadData();
  };

  // Retry: re-invoke the edge function for a failed/stuck row.
  const retryIntimation = async (row: IntimationRow) => {
    setConfirming(row.id);

    // Reset to pending so the cron doesn't double-alert while edge fn runs
    await (supabase as any)
      .from("insurance_intimations")
      .update({ status: "pending", failure_reason: null, retry_count: (row.retry_count || 0) + 1 })
      .eq("id", row.id);

    const { error } = await supabase.functions.invoke("insurance-automation", {
      body: {
        action: "auto_intimate",
        admission_id: row.admission_id,
        hospital_id: hospitalId,
        patient_id: row.patient_id,
        payer_type: row.payer_type,
        admission_type: row.admission_type,
        insurance_type: row.payer_type,
        intimation_deadline: row.intimation_deadline,
      },
    });

    if (error) {
      toast({ title: "Retry failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Retry triggered", description: "The edge function was re-invoked. Status will update shortly." });
    }
    setConfirming(null);
    setTimeout(loadData, 3000);
  };

  const failedCount  = rows.filter(r => r.status === "failed").length;
  const pendingCount = rows.filter(r => r.status === "pending").length;

  return (
    <div className="h-full overflow-auto p-4 space-y-4">

      {/* ── CRITICAL alerts banner ───────────────────────────────────── */}
      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map(a => (
            <div key={a.id} className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              <AlertTriangle size={16} className="text-red-600 shrink-0 mt-0.5 animate-pulse" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-red-700 uppercase tracking-wide">
                  {a.alert_type.replace(/_/g, " ")}
                </p>
                <p className="text-sm text-red-800 mt-0.5">{a.alert_message}</p>
                <p className="text-[11px] text-red-500 mt-1">
                  {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
                </p>
              </div>
              <button
                onClick={() => dismissAlert(a.id)}
                className="text-red-400 hover:text-red-600 transition-colors shrink-0"
                title="Dismiss alert"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Summary KPIs ─────────────────────────────────────────────── */}
      <div className="flex gap-3">
        {failedCount > 0 && (
          <span className="text-xs px-3 py-1.5 rounded-full bg-red-50 text-red-700 font-semibold border border-red-200">
            {failedCount} failed
          </span>
        )}
        {pendingCount > 0 && (
          <span className="text-xs px-3 py-1.5 rounded-full bg-amber-50 text-amber-700 font-semibold border border-amber-200">
            {pendingCount} pending
          </span>
        )}
        {failedCount === 0 && pendingCount === 0 && (
          <span className="text-xs px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200">
            All intimations sent ✓
          </span>
        )}
        <button onClick={loadData} className="ml-auto text-muted-foreground hover:text-foreground transition-colors">
          <RefreshCw size={14} />
        </button>
      </div>

      {/* ── Intimations table ────────────────────────────────────────── */}
      <div className="bg-background rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Patient</TableHead>
              <TableHead className="text-xs">Admission</TableHead>
              <TableHead className="text-xs">Payer</TableHead>
              <TableHead className="text-xs">Type</TableHead>
              <TableHead className="text-xs">Status</TableHead>
              <TableHead className="text-xs">Deadline</TableHead>
              <TableHead className="text-xs">Sent At</TableHead>
              <TableHead className="text-xs">TPA Ref</TableHead>
              <TableHead className="text-xs">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground text-sm py-8">
                  Loading…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground text-sm py-8">
                  No intimation records yet
                </TableCell>
              </TableRow>
            ) : rows.map(r => (
              <TableRow key={r.id} className={r.status === "failed" ? "bg-red-50/40" : ""}>
                <TableCell>
                  <div className="text-sm font-medium">{r.patient_name}</div>
                  <div className="text-[11px] text-muted-foreground font-mono">{r.uhid}</div>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {r.admission_number || r.admission_id.slice(0, 8)}
                </TableCell>
                <TableCell className="text-xs capitalize">
                  {(r.payer_type || "—").replace(/_/g, " ")}
                </TableCell>
                <TableCell className="text-xs capitalize">
                  {r.admission_type || "—"}
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={cn("text-xs gap-1 flex items-center w-fit", STATUS_STYLES[r.status] || "")}
                  >
                    {STATUS_ICON[r.status]}
                    {r.status}
                  </Badge>
                  {r.failure_reason && (
                    <p className="text-[10px] text-red-600 mt-1 max-w-[160px] truncate" title={r.failure_reason}>
                      {r.failure_reason}
                    </p>
                  )}
                </TableCell>
                <TableCell>{deadlineBadge(r.intimation_deadline, r.status)}</TableCell>
                <TableCell className="text-[11px] text-muted-foreground">
                  {r.sent_at ? format(new Date(r.sent_at), "dd-MMM HH:mm") : "—"}
                </TableCell>
                <TableCell className="text-[11px] font-mono">
                  {r.reference_number_from_tpa || "—"}
                </TableCell>
                <TableCell>
                  {(r.status === "failed" || r.status === "pending") && (
                    <div className="flex gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs h-7 border-emerald-400 text-emerald-700 hover:bg-emerald-50"
                        onClick={() => markConfirmed(r)}
                        disabled={confirming === r.id}
                      >
                        Mark Sent
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs h-7"
                        onClick={() => retryIntimation(r)}
                        disabled={confirming === r.id}
                      >
                        <RefreshCw size={11} className="mr-1" />
                        Retry
                      </Button>
                    </div>
                  )}
                  {r.status === "sent" && !r.reference_number_from_tpa && (
                    <span className="text-[11px] text-muted-foreground italic">Awaiting TPA ref</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default IntimationsTab;
