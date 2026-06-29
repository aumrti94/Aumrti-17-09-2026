import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { differenceInHours, differenceInDays, addDays, format } from "date-fns";
import {
  Bot, User, Clock, CheckCircle2, XCircle, AlertTriangle,
  ChevronRight, RefreshCw, Loader2, Info
} from "lucide-react";

interface PipelineRow {
  admission_id: string;
  patient_name: string;
  uhid: string | null;
  insurance_type: string;
  tpa_name: string | null;
  admitted_at: string;
  discharged_at: string | null;
  // pre-auth
  pre_auth_id: string | null;
  pre_auth_status: string | null;
  intimation_sent_at: string | null;
  is_emergency_admission: boolean;
  ai_pre_auth_generated: boolean;
  automation_mode: string | null;
  pre_auth_submitted_at: string | null;
  valid_until: string | null;
  // claim
  claim_id: string | null;
  claim_status: string | null;
  claim_submitted_at: string | null;
  automation_submitted: boolean;
  ai_denial_risk_score: number | null;
  settled_amount: number | null;
  claimed_amount: number | null;
}

type StepState = "done_auto" | "done_human" | "pending" | "overdue" | "skipped" | "error";

interface Step {
  label: string;
  state: StepState;
  detail?: string;
}

function intimationState(row: PipelineRow): StepState {
  if (row.intimation_sent_at) return "done_auto";
  const windowHours = row.is_emergency_admission ? 24 : 48;
  const elapsed = differenceInHours(new Date(), new Date(row.admitted_at));
  if (elapsed > windowHours) return "overdue";
  return "pending";
}

function buildSteps(row: PipelineRow): Step[] {
  const intimState = intimationState(row);
  const windowHours = row.is_emergency_admission ? 24 : 48;
  const hoursElapsed = differenceInHours(new Date(), new Date(row.admitted_at));
  const hoursLeft = windowHours - hoursElapsed;

  const steps: Step[] = [
    {
      label: "Admitted",
      state: "done_human",
      detail: format(new Date(row.admitted_at), "dd/MM HH:mm"),
    },
    {
      label: "TPA Resolved",
      state: row.tpa_name ? "done_auto" : "pending",
      detail: row.tpa_name || "Pending",
    },
    {
      label: "Intimated",
      state: intimState,
      detail: row.intimation_sent_at
        ? `${format(new Date(row.intimation_sent_at), "dd/MM HH:mm")} (auto)`
        : intimState === "overdue"
        ? `${Math.abs(Math.round(hoursLeft))}h overdue`
        : `${Math.max(0, Math.round(hoursLeft))}h remaining`,
    },
    {
      label: "Pre-Auth AI Fill",
      state: row.ai_pre_auth_generated ? "done_auto" : row.pre_auth_id ? "pending" : "skipped",
      detail: row.ai_pre_auth_generated ? "AI generated" : "Not yet",
    },
    {
      label: "Pre-Auth Submitted",
      state: row.pre_auth_submitted_at
        ? (row.ai_pre_auth_generated ? "done_auto" : "done_human")
        : row.pre_auth_id ? "pending" : "skipped",
      detail: row.pre_auth_submitted_at ? format(new Date(row.pre_auth_submitted_at), "dd/MM") : "—",
    },
    {
      label: "Pre-Auth Approved",
      state: row.pre_auth_status === "approved"
        ? "done_human"
        : row.pre_auth_status === "rejected"
        ? "error"
        : row.pre_auth_status === "under_review"
        ? "pending"
        : "skipped",
      detail: row.pre_auth_status
        ? row.pre_auth_status.replace("_", " ")
        : "—",
    },
    {
      label: "Discharged",
      state: row.discharged_at ? "done_human" : "pending",
      detail: row.discharged_at ? format(new Date(row.discharged_at), "dd/MM") : "Still admitted",
    },
    {
      label: "Claim Submitted",
      state: row.claim_submitted_at
        ? (row.automation_submitted ? "done_auto" : "done_human")
        : row.discharged_at ? "pending" : "skipped",
      detail: row.claim_submitted_at
        ? `${format(new Date(row.claim_submitted_at), "dd/MM")}${row.automation_submitted ? " (auto)" : ""}`
        : row.claim_status === "draft" ? "Draft — needs review" : "—",
    },
    {
      label: "Settled",
      state: row.claim_status === "settled"
        ? "done_human"
        : row.claim_status === "rejected"
        ? "error"
        : row.claim_status === "approved" || row.claim_status === "partially_approved"
        ? "pending"
        : "skipped",
      detail: row.settled_amount
        ? `₹${Number(row.settled_amount).toLocaleString("en-IN")}`
        : row.claim_status
        ? row.claim_status.replace("_", " ")
        : "—",
    },
  ];

  return steps;
}

const STEP_ICONS: Record<StepState, React.ReactNode> = {
  done_auto: <Bot size={13} className="text-violet-600" />,
  done_human: <CheckCircle2 size={13} className="text-emerald-600" />,
  pending: <Clock size={13} className="text-amber-500" />,
  overdue: <AlertTriangle size={13} className="text-red-600" />,
  skipped: <div className="w-3 h-3 rounded-full bg-muted-foreground/20" />,
  error: <XCircle size={13} className="text-red-600" />,
};

const STEP_COLORS: Record<StepState, string> = {
  done_auto: "border-violet-200 bg-violet-50/50 dark:bg-violet-950/20",
  done_human: "border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/20",
  pending: "border-amber-200 bg-amber-50/50 dark:bg-amber-950/20",
  overdue: "border-red-300 bg-red-50/50 dark:bg-red-950/20",
  skipped: "border-border bg-muted/20",
  error: "border-red-300 bg-red-50/50",
};

const AutomationStatusPipeline: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const [rows, setRows] = useState<PipelineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"active" | "all">("active");

  const load = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);

    // Fetch insurance admissions
    const admQuery = supabase
      .from("admissions")
      .select("id, insurance_type, tpa_name, admitted_at, discharged_at, status, patients(full_name, uhid)")
      .eq("hospital_id", hospitalId)
      .neq("insurance_type", "self_pay")
      .order("admitted_at", { ascending: false })
      .limit(filter === "active" ? 50 : 200);

    if (filter === "active") {
      admQuery.eq("status", "active");
    }

    const { data: admissions } = await admQuery;
    if (!admissions?.length) { setRows([]); setLoading(false); return; }

    const admissionIds = admissions.map(a => a.id);

    const [preAuthsRes, claimsRes] = await Promise.all([
      (supabase as any)
        .from("insurance_pre_auth")
        .select("admission_id, id, status, intimation_sent_at, is_emergency_admission, ai_pre_auth_generated, automation_mode, submitted_at, valid_until")
        .in("admission_id", admissionIds)
        .order("created_at", { ascending: false }),
      supabase
        .from("insurance_claims")
        .select("id, claimed_amount, settled_amount, status, submitted_at, automation_submitted, ai_denial_risk_score")
        .in("status", ["draft", "submitted", "under_review", "approved", "partially_approved", "rejected", "settled"])
        .limit(200),
    ]);

    // Build maps
    const preAuthMap: Record<string, any> = {};
    for (const pa of preAuthsRes.data || []) {
      if (!preAuthMap[pa.admission_id]) preAuthMap[pa.admission_id] = pa;
    }

    // Match claims via bills → admissions (simplified: use claim-admission_id if available, else match by pre_auth)
    const claimByPreAuth: Record<string, any> = {};
    for (const cl of claimsRes.data || []) {
      if (cl.pre_auth_id) claimByPreAuth[cl.pre_auth_id] = cl;
    }

    const result: PipelineRow[] = admissions.map(a => {
      const pa = preAuthMap[a.id];
      const claim = pa ? claimByPreAuth[pa.id] : null;
      const patient = a.patients as any;
      return {
        admission_id: a.id,
        patient_name: patient?.full_name || "Unknown",
        uhid: patient?.uhid || null,
        insurance_type: a.insurance_type,
        tpa_name: (a as any).tpa_name || null,
        admitted_at: a.admitted_at || new Date().toISOString(),
        discharged_at: a.discharged_at || null,
        pre_auth_id: pa?.id || null,
        pre_auth_status: pa?.status || null,
        intimation_sent_at: pa?.intimation_sent_at || null,
        is_emergency_admission: pa?.is_emergency_admission || false,
        ai_pre_auth_generated: pa?.ai_pre_auth_generated || false,
        automation_mode: pa?.automation_mode || "auto",
        pre_auth_submitted_at: pa?.submitted_at || null,
        valid_until: pa?.valid_until || null,
        claim_id: claim?.id || null,
        claim_status: claim?.status || null,
        claim_submitted_at: claim?.submitted_at || null,
        automation_submitted: claim?.automation_submitted || false,
        ai_denial_risk_score: claim?.ai_denial_risk_score || null,
        settled_amount: claim?.settled_amount || null,
        claimed_amount: claim?.claimed_amount || null,
      };
    });

    setRows(result);
    setLoading(false);
  }, [hospitalId, filter]);

  useEffect(() => { load(); }, [load]);

  // Realtime subscriptions
  useEffect(() => {
    if (!hospitalId) return;
    const channels = [
      supabase.channel("pipeline-pre-auth").on("postgres_changes",
        { event: "*", schema: "public", table: "insurance_pre_auth" }, () => load()),
      supabase.channel("pipeline-claims").on("postgres_changes",
        { event: "*", schema: "public", table: "insurance_claims" }, () => load()),
      supabase.channel("pipeline-auto-log").on("postgres_changes",
        { event: "INSERT", schema: "public", table: "insurance_automation_log" }, () => load()),
    ];
    channels.forEach(c => c.subscribe());
    return () => { channels.forEach(c => supabase.removeChannel(c)); };
  }, [hospitalId, load]);

  if (loading) return (
    <div className="flex items-center justify-center h-full text-muted-foreground text-sm p-8">
      <Loader2 className="animate-spin mr-2" size={16} /> Loading pipeline...
    </div>
  );

  return (
    <div className="h-full overflow-auto p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h2 className="text-sm font-bold flex items-center gap-2">
            <Bot size={16} className="text-violet-600" /> Automation Status Pipeline
          </h2>
          <p className="text-[11px] text-muted-foreground">Live view of every insurance admission through the workflow</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {(["active", "all"] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "px-3 py-1 rounded-full text-[11px] font-semibold capitalize transition-colors",
                  filter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                )}
              >
                {f === "active" ? "Active" : "All"}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={load} className="h-8 w-8 p-0">
            <RefreshCw size={13} />
          </Button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex gap-3 flex-wrap">
        {[
          { icon: <Bot size={11} className="text-violet-600" />, label: "Done by AI/Auto", color: "text-violet-600" },
          { icon: <CheckCircle2 size={11} className="text-emerald-600" />, label: "Done by Staff", color: "text-emerald-600" },
          { icon: <Clock size={11} className="text-amber-500" />, label: "Pending", color: "text-amber-500" },
          { icon: <AlertTriangle size={11} className="text-red-600" />, label: "Overdue", color: "text-red-600" },
          { icon: <XCircle size={11} className="text-red-600" />, label: "Error/Rejected", color: "text-red-600" },
        ].map(({ icon, label }) => (
          <div key={label} className="flex items-center gap-1">
            {icon}
            <span className="text-[10px] text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Bot size={40} className="mb-3 opacity-20" />
          <p className="text-sm">No {filter === "active" ? "active insurance admissions" : "insurance admissions"}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map(row => {
            const steps = buildSteps(row);
            const overdueCount = steps.filter(s => s.state === "overdue" || s.state === "error").length;
            return (
              <div
                key={row.admission_id}
                className={cn(
                  "rounded-lg border bg-background p-3 space-y-2.5",
                  overdueCount > 0 ? "border-red-200" : "border-border"
                )}
              >
                {/* Row header */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[13px] font-semibold truncate">{row.patient_name}</span>
                    {row.uhid && (
                      <Badge variant="outline" className="text-[9px] font-mono shrink-0">{row.uhid}</Badge>
                    )}
                    <Badge variant="outline" className="text-[9px] shrink-0 capitalize">{row.insurance_type.replace("_", " ")}</Badge>
                    {row.tpa_name && (
                      <span className="text-[11px] text-muted-foreground truncate">{row.tpa_name}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {overdueCount > 0 && (
                      <Badge variant="destructive" className="text-[10px]">
                        {overdueCount} issue{overdueCount > 1 ? "s" : ""}
                      </Badge>
                    )}
                    {row.automation_mode === "manual" && (
                      <Badge variant="outline" className="text-[9px] text-muted-foreground">
                        Manual Mode
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Pipeline steps */}
                <div className="flex items-center gap-0.5 flex-wrap">
                  {steps.map((step, i) => (
                    <React.Fragment key={step.label}>
                      <div
                        className={cn(
                          "flex items-center gap-1 px-2 py-1 rounded border text-[10px] transition-all",
                          STEP_COLORS[step.state]
                        )}
                        title={step.detail}
                      >
                        {STEP_ICONS[step.state]}
                        <span className={cn(
                          "font-medium",
                          step.state === "skipped" ? "text-muted-foreground/50" : "text-foreground"
                        )}>
                          {step.label}
                        </span>
                        {step.detail && step.state !== "skipped" && (
                          <span className="text-muted-foreground text-[9px]">· {step.detail}</span>
                        )}
                      </div>
                      {i < steps.length - 1 && (
                        <ChevronRight size={10} className="text-muted-foreground/40 shrink-0" />
                      )}
                    </React.Fragment>
                  ))}
                </div>

                {/* Claim amount if available */}
                {row.claimed_amount && (
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                    <span>Claimed: <strong className="text-foreground">₹{Number(row.claimed_amount).toLocaleString("en-IN")}</strong></span>
                    {row.ai_denial_risk_score !== null && (
                      <span>AI Risk: <strong className={row.ai_denial_risk_score > 50 ? "text-red-600" : row.ai_denial_risk_score > 30 ? "text-amber-600" : "text-emerald-600"}>
                        {row.ai_denial_risk_score}%
                      </strong></span>
                    )}
                    {row.settled_amount && (
                      <span>Settled: <strong className="text-emerald-700">₹{Number(row.settled_amount).toLocaleString("en-IN")}</strong></span>
                    )}
                    {row.valid_until && row.pre_auth_status === "approved" && (() => {
                      const daysLeft = differenceInDays(new Date(row.valid_until), new Date());
                      if (daysLeft <= 3) return <span className="text-red-600 font-medium">⚠ Pre-auth expires in {daysLeft}d</span>;
                      return null;
                    })()}
                    {row.claim_submitted_at && (row.claim_status === "submitted" || row.claim_status === "under_review") && (() => {
                      const deadline = addDays(new Date(row.claim_submitted_at), 45);
                      const daysLeft = differenceInDays(deadline, new Date());
                      if (daysLeft <= 7) return <span className={daysLeft <= 3 ? "text-red-600 font-medium" : "text-amber-600"}>IRDAI: {daysLeft}d left</span>;
                      return null;
                    })()}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AutomationStatusPipeline;
