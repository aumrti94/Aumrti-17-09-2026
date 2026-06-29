import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalContext } from "@/contexts/HospitalContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { RefreshCw, Link2, CheckCircle2, Clock, AlertCircle, Unlink, FileCode } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface CareContext {
  id: string;
  reference: string;
  display: string;
  context_type: string;
  link_status: "linked" | "pending" | "unlinked" | "failed";
  linked_at: string | null;
  created_at: string;
  source_id: string;
}

interface Props {
  patientId: string;
  hospitalId: string;
  className?: string;
}

const STATUS_META: Record<
  CareContext["link_status"],
  { label: string; icon: React.ReactNode; cls: string }
> = {
  linked: {
    label: "Linked",
    icon: <CheckCircle2 className="h-3 w-3" />,
    cls: "bg-emerald-100 text-emerald-700 border-emerald-200",
  },
  pending: {
    label: "Pending",
    icon: <Clock className="h-3 w-3" />,
    cls: "bg-amber-100 text-amber-700 border-amber-200",
  },
  unlinked: {
    label: "Not linked",
    icon: <Unlink className="h-3 w-3" />,
    cls: "bg-slate-100 text-slate-500 border-slate-200",
  },
  failed: {
    label: "Failed",
    icon: <AlertCircle className="h-3 w-3" />,
    cls: "bg-red-100 text-red-600 border-red-200",
  },
};

const CONTEXT_TYPE_LABEL: Record<string, string> = {
  OPDRecord: "OPD Visit",
  DischargeSummaryRecord: "IPD Discharge",
  DiagnosticReportRecord: "Diagnostic Report",
  PrescriptionRecord: "Prescription",
  ImmunizationRecord: "Immunization",
  HealthDocumentRecord: "Health Document",
};

const ABDMCareContextsPanel: React.FC<Props> = ({ patientId, hospitalId, className }) => {
  const { toast } = useToast();
  const { role } = useHospitalContext();
  const isAdmin = role === "hospital_admin" || role === "super_admin";

  const [contexts, setContexts] = useState<CareContext[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);

  const fetchContexts = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("abdm_care_contexts")
      .select("id, reference, display, context_type, link_status, linked_at, created_at, source_id")
      .eq("patient_id", patientId)
      .eq("hospital_id", hospitalId)
      .order("created_at", { ascending: false });

    if (!error) setContexts((data ?? []) as CareContext[]);
    setLoading(false);
  }, [patientId, hospitalId]);

  useEffect(() => { fetchContexts(); }, [fetchContexts]);

  const handleRetry = async (ctx: CareContext) => {
    setRetrying(ctx.id);
    try {
      const { error } = await supabase.functions.invoke("abdm-hip-link-init", {
        body: {
          hospital_id: hospitalId,
          patient_id: patientId,
          care_context_ids: [ctx.id],
        },
      });
      if (error) throw error;
      toast({ title: "Link retry initiated", description: "Patient will receive a notification." });
      await fetchContexts();
    } catch {
      toast({ title: "Retry failed", description: "Could not initiate link. Check ABDM configuration.", variant: "destructive" });
    }
    setRetrying(null);
  };

  const handleViewFhir = async (ctx: CareContext) => {
    try {
      const { data, error } = await supabase.functions.invoke("abdm-fhir-package", {
        body: {
          hospital_id: hospitalId,
          care_context_reference: ctx.reference,
          context_type: ctx.context_type,
          source_id: ctx.source_id,
        },
      });
      if (error) throw error;
      const win = window.open("", "_blank");
      if (win) {
        win.document.write(`<pre style="font-family:monospace;font-size:12px;padding:16px">${JSON.stringify(data, null, 2)}</pre>`);
        win.document.title = `FHIR Bundle — ${ctx.reference}`;
      }
    } catch {
      toast({ title: "FHIR preview failed", variant: "destructive" });
    }
  };

  const linked = contexts.filter((c) => c.link_status === "linked").length;
  const total = contexts.length;

  return (
    <div className={cn("space-y-3", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[13px] font-semibold text-foreground">
            ABHA Care Contexts
          </p>
          <p className="text-[11px] text-muted-foreground">
            {loading ? "Loading…" : total === 0 ? "No records yet" : `${linked} of ${total} record${total !== 1 ? "s" : ""} linked to ABHA`}
          </p>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={fetchContexts} disabled={loading}>
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      {/* List */}
      {!loading && total === 0 && (
        <div className="rounded-lg border border-dashed border-slate-200 p-4 text-center">
          <Link2 className="h-6 w-6 text-slate-300 mx-auto mb-1.5" />
          <p className="text-xs text-muted-foreground">
            Care contexts are created automatically when OPD, lab, or radiology records are completed.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {contexts.map((ctx) => {
          const meta = STATUS_META[ctx.link_status] ?? STATUS_META.unlinked;
          const canRetry = ctx.link_status === "failed" || ctx.link_status === "unlinked";

          return (
            <div
              key={ctx.id}
              className="rounded-lg border border-border bg-card px-3 py-2.5 flex items-start gap-3"
            >
              {/* Status icon */}
              <div className={cn("mt-0.5 flex-shrink-0 rounded-full p-1", meta.cls)}>
                {meta.icon}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-medium text-foreground leading-snug truncate">
                  {ctx.display}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                  <span className="text-[10px] text-muted-foreground">
                    {CONTEXT_TYPE_LABEL[ctx.context_type] ?? ctx.context_type}
                  </span>
                  <span className="text-[10px] text-muted-foreground">·</span>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(ctx.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                  </span>
                  {ctx.linked_at && (
                    <>
                      <span className="text-[10px] text-muted-foreground">·</span>
                      <span className="text-[10px] text-emerald-600">
                        Linked {new Date(ctx.linked_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Badges + actions */}
              <div className="flex-shrink-0 flex items-center gap-1.5">
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-medium",
                    meta.cls,
                  )}
                >
                  {meta.icon}
                  {meta.label}
                </span>

                {canRetry && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[10px] text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                    disabled={retrying === ctx.id}
                    onClick={() => handleRetry(ctx)}
                  >
                    {retrying === ctx.id ? (
                      <RefreshCw className="h-3 w-3 animate-spin" />
                    ) : (
                      "Retry"
                    )}
                  </Button>
                )}

                {isAdmin && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-slate-400 hover:text-slate-600"
                    title="View FHIR Bundle (admin)"
                    onClick={() => handleViewFhir(ctx)}
                  >
                    <FileCode className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary bar */}
      {total > 0 && (
        <div className="rounded-md bg-slate-50 border border-slate-100 px-3 py-2 flex items-center gap-4 text-[11px] text-muted-foreground">
          {(["linked", "pending", "unlinked", "failed"] as CareContext["link_status"][]).map((s) => {
            const count = contexts.filter((c) => c.link_status === s).length;
            if (count === 0) return null;
            return (
              <span key={s} className={cn("inline-flex items-center gap-1", STATUS_META[s].cls.split(" ")[1])}>
                {STATUS_META[s].icon}
                {count} {STATUS_META[s].label.toLowerCase()}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ABDMCareContextsPanel;
