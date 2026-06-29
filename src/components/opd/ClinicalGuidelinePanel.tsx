import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertCircle, AlertTriangle, CheckCircle2, BookOpen, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Flag {
  type: string;
  severity: "critical" | "warning" | "info";
  message: string;
}

interface GuidelineResult {
  matched: boolean;
  guideline?: {
    id: string;
    condition_name: string;
    source: string;
    mandatory_investigations: string[];
    red_flags: string[];
    first_line_treatment: string;
    monitoring_parameters: string[];
    review_frequency: string;
  };
  adherence_flags: Flag[];
  missing_investigations: string[];
}

interface Props {
  diagnosis: string;
  icd10Code?: string;
  encounterId?: string;
  patientId: string;
  hospitalId: string;
  encounterData?: Record<string, any>;
}

const ClinicalGuidelinePanel: React.FC<Props> = ({
  diagnosis, icd10Code, encounterId, patientId, hospitalId, encounterData,
}) => {
  const [result, setResult] = useState<GuidelineResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [acknowledged, setAcknowledged] = useState<string[]>([]);

  useEffect(() => {
    if (!diagnosis && !icd10Code) return;
    const t = setTimeout(check, 600);
    return () => clearTimeout(t);
  }, [diagnosis, icd10Code]);

  const check = async () => {
    if (!diagnosis && !icd10Code) return;
    setLoading(true);
    const { data } = await supabase.functions.invoke("ai-clinical-guidelines", {
      body: {
        diagnosis, icd10_code: icd10Code,
        encounter_data: encounterData || {},
        hospital_id: hospitalId, patient_id: patientId,
        encounter_id: encounterId,
      },
    });
    setResult(data || null);
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground border rounded-lg bg-muted/30">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Checking clinical guidelines...
      </div>
    );
  }

  if (!result || !result.matched) return null;

  const { guideline, adherence_flags } = result;
  const hasCritical = adherence_flags.some(f => f.severity === "critical");
  const hasWarning = adherence_flags.some(f => f.severity === "warning");
  const unacknowledged = adherence_flags.filter(f => !acknowledged.includes(f.message));

  return (
    <div className={cn(
      "border rounded-lg overflow-hidden",
      hasCritical ? "border-red-300 bg-red-50/50" :
      hasWarning ? "border-amber-300 bg-amber-50/50" :
      "border-emerald-300 bg-emerald-50/50"
    )}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 cursor-pointer" onClick={() => setExpanded(v => !v)}>
        <BookOpen className={cn("h-4 w-4 shrink-0",
          hasCritical ? "text-red-600" : hasWarning ? "text-amber-600" : "text-emerald-600"
        )} />
        <div className="flex-1 min-w-0">
          <span className="text-xs font-semibold">
            {guideline?.condition_name} — {guideline?.source}
          </span>
          {unacknowledged.length > 0 && (
            <span className={cn(
              "ml-2 text-[10px] px-1.5 py-0.5 rounded font-medium",
              hasCritical ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
            )}>
              {unacknowledged.length} flag{unacknowledged.length > 1 ? "s" : ""}
            </span>
          )}
          {unacknowledged.length === 0 && adherence_flags.length > 0 && (
            <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded font-medium bg-emerald-100 text-emerald-700">
              All acknowledged
            </span>
          )}
        </div>
        {expanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
      </div>

      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t">
          {/* Flags */}
          {unacknowledged.length > 0 && (
            <div className="space-y-1.5 pt-2">
              {unacknowledged.map((f, i) => (
                <div key={i} className="flex items-start gap-2">
                  {f.severity === "critical"
                    ? <AlertCircle className="h-3.5 w-3.5 text-red-600 shrink-0 mt-0.5" />
                    : <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs">{f.message}</p>
                  </div>
                  <button
                    onClick={() => setAcknowledged(prev => [...prev, f.message])}
                    className="text-[10px] text-muted-foreground hover:text-foreground shrink-0"
                  >
                    ✓ OK
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Treatment summary */}
          {guideline?.first_line_treatment && (
            <div className="pt-1">
              <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-1">First-Line Treatment</p>
              <p className="text-xs">{guideline.first_line_treatment}</p>
            </div>
          )}

          {/* Monitoring */}
          {guideline?.monitoring_parameters && guideline.monitoring_parameters.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-1">
                Monitoring · {guideline.review_frequency}
              </p>
              <div className="flex flex-wrap gap-1">
                {guideline.monitoring_parameters.map((m, i) => (
                  <Badge key={i} variant="secondary" className="text-[9px]">{m}</Badge>
                ))}
              </div>
            </div>
          )}

          {/* All clear */}
          {unacknowledged.length === 0 && adherence_flags.length === 0 && (
            <div className="flex items-center gap-1.5 pt-1 text-xs text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Guideline adherent — no flags
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ClinicalGuidelinePanel;
