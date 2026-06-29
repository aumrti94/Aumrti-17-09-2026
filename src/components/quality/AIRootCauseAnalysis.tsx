import React, { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { callAI } from "@/lib/aiProvider";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Brain, Loader2, ChevronDown, ChevronRight, AlertTriangle, GitBranch, Target, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

interface RCAOutput {
  immediate_cause: string;
  contributing_factors: string[];
  root_causes: string[];
  system_failures: string[];
  five_whys: string[];
  preventive_actions: string[];
  similar_patterns: string;
}

interface Incident {
  id: string;
  incident_date: string;
  incident_type: string;
  severity_level: string;
  description: string;
  location?: string;
  outcome?: string;
}

interface Props {
  incident: Incident;
  hospitalId: string;
}

const Section: React.FC<{ icon: React.ReactNode; title: string; items: string[]; color?: string }> = ({ icon, title, items, color }) => {
  const [open, setOpen] = useState(true);
  if (!items.length) return null;
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2.5 bg-muted/30 hover:bg-muted/50 text-left transition-colors">
        {icon}
        <span className="text-xs font-semibold text-foreground flex-1">{title}</span>
        <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{items.length}</span>
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>
      {open && (
        <ul className="px-3 py-2 space-y-1.5">
          {items.map((item, i) => (
            <li key={i} className={cn("flex items-start gap-2 text-[11px]", color || "text-foreground")}>
              <span className="mt-0.5 shrink-0 font-bold text-muted-foreground">{i + 1}.</span>
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const AIRootCauseAnalysis: React.FC<Props> = ({ incident, hospitalId }) => {
  const { toast } = useToast();
  const [rca, setRca] = useState<RCAOutput | null>(null);
  const [loading, setLoading] = useState(false);
  const [extraContext, setExtraContext] = useState("");
  const [showContext, setShowContext] = useState(false);

  const runRCA = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch similar past incidents for pattern recognition
      const { data: similar } = await (supabase as any)
        .from("incident_reports")
        .select("incident_type, description, severity_level, incident_date")
        .eq("hospital_id", hospitalId)
        .eq("incident_type", incident.incident_type)
        .neq("id", incident.id)
        .order("incident_date", { ascending: false })
        .limit(5);

      const similarText = similar?.length
        ? `SIMILAR PAST INCIDENTS (last ${similar.length}):\n${(similar as any[]).map((s: any) =>
          `- [${s.incident_date}] ${s.severity_level}: ${s.description?.substring(0, 100)}`).join("\n")}`
        : "No similar past incidents found.";

      const prompt = `You are a NABH-certified Patient Safety Officer conducting a structured Root Cause Analysis (RCA) using the 5 Whys and Fishbone (Ishikawa) methodology.

INCIDENT DETAILS:
- Type: ${incident.incident_type}
- Severity: ${incident.severity_level}
- Date: ${incident.incident_date}
- Location: ${incident.location || "Not specified"}
- Description: ${incident.description}
- Outcome: ${incident.outcome || "Not recorded"}
${extraContext ? `\nADDITIONAL CONTEXT PROVIDED:\n${extraContext}` : ""}

${similarText}

Conduct a thorough RCA. Respond ONLY with this exact JSON structure:
{
  "immediate_cause": "The direct event or act that caused the incident",
  "contributing_factors": ["3-5 factors that contributed (equipment, environment, communication, training, workload)"],
  "root_causes": ["2-4 underlying systemic root causes — the WHY behind the contributing factors"],
  "system_failures": ["1-3 system-level failures — policy gaps, process design flaws, organisational issues"],
  "five_whys": ["Why 1: ...", "Why 2: ...", "Why 3: ...", "Why 4: ...", "Why 5: ..."],
  "preventive_actions": ["3-5 specific, actionable CAPA items with owner type (e.g. Nursing Head, Pharmacy, IT)"],
  "similar_patterns": "One sentence describing whether this is an isolated event or part of a recurring pattern"
}`;

      const response = await callAI({
        featureKey: "ai_rca",
        hospitalId,
        prompt,
        maxTokens: 1000,
      });

      if (response.error || !response.text) throw new Error(response.error || "No AI response");

      const match = response.text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("Invalid response format");
      const parsed: RCAOutput = JSON.parse(match[0]);
      setRca(parsed);
      toast({ title: "AI RCA complete" });
    } catch (err: any) {
      toast({ title: "RCA failed", description: err.message, variant: "destructive" });
    }
    setLoading(false);
  }, [incident, hospitalId, extraContext]);

  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">AI-Assisted Root Cause Analysis</span>
          <Badge variant="outline" className="text-[10px]">E3 — NABH Excellence</Badge>
          <Badge className="text-[10px] bg-amber-100 text-amber-700 border-amber-200">
            {incident.severity_level}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setShowContext(s => !s)} className="h-7 text-xs">
            + Add context
          </Button>
          <Button size="sm" onClick={runRCA} disabled={loading} className="h-7 text-xs gap-1.5">
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Brain className="h-3 w-3" />}
            {rca ? "Re-run RCA" : "Run AI RCA"}
          </Button>
        </div>
      </div>

      {/* Extra context input */}
      {showContext && (
        <div className="px-4 py-3 border-b border-border bg-muted/10">
          <p className="text-[11px] text-muted-foreground mb-1.5">Additional context (witness statements, environmental conditions, staff feedback):</p>
          <Textarea rows={3} value={extraContext} onChange={e => setExtraContext(e.target.value)}
            placeholder="Enter any additional information about the incident that may inform the RCA…"
            className="text-xs resize-none" />
        </div>
      )}

      <div className="p-4 space-y-3">
        {!rca && !loading && (
          <div className="text-center py-8 space-y-2">
            <GitBranch className="h-8 w-8 text-muted-foreground/30 mx-auto" />
            <p className="text-sm text-muted-foreground">Click "Run AI RCA" to generate a structured root cause analysis.</p>
            <p className="text-xs text-muted-foreground">Uses 5 Whys + Fishbone methodology. Analyses past similar incidents for pattern recognition.</p>
          </div>
        )}

        {loading && (
          <div className="text-center py-8 flex flex-col items-center gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Analysing incident patterns and generating RCA…</p>
          </div>
        )}

        {rca && !loading && (
          <div className="space-y-3">
            {/* Immediate cause highlight */}
            <div className="border border-red-200 bg-red-50/40 dark:bg-red-950/20 rounded-lg px-3 py-2.5">
              <p className="text-[10px] font-bold text-red-600 uppercase tracking-wide mb-1">Immediate Cause</p>
              <p className="text-sm text-foreground">{rca.immediate_cause}</p>
            </div>

            {/* Similar patterns */}
            {rca.similar_patterns && (
              <div className={cn("border rounded-lg px-3 py-2.5",
                rca.similar_patterns.toLowerCase().includes("recurring") || rca.similar_patterns.toLowerCase().includes("pattern")
                  ? "border-amber-200 bg-amber-50/30" : "border-border bg-muted/20"
              )}>
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-1">Pattern Analysis</p>
                <p className="text-xs text-foreground">{rca.similar_patterns}</p>
              </div>
            )}

            {/* Five Whys */}
            <Section
              icon={<Target className="h-3.5 w-3.5 text-purple-500" />}
              title="Five Whys Analysis"
              items={rca.five_whys}
              color="text-purple-700 dark:text-purple-400"
            />

            {/* Contributing factors */}
            <Section
              icon={<AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
              title="Contributing Factors"
              items={rca.contributing_factors}
              color="text-amber-700 dark:text-amber-400"
            />

            {/* Root causes */}
            <Section
              icon={<GitBranch className="h-3.5 w-3.5 text-red-500" />}
              title="Root Causes"
              items={rca.root_causes}
              color="text-red-700 dark:text-red-400"
            />

            {/* System failures */}
            <Section
              icon={<AlertTriangle className="h-3.5 w-3.5 text-orange-500" />}
              title="System Failures"
              items={rca.system_failures}
              color="text-orange-700 dark:text-orange-400"
            />

            {/* Preventive actions */}
            <Section
              icon={<Wrench className="h-3.5 w-3.5 text-emerald-500" />}
              title="Recommended Preventive Actions (CAPA)"
              items={rca.preventive_actions}
              color="text-emerald-700 dark:text-emerald-400"
            />

            <p className="text-[10px] text-muted-foreground text-center pt-1">
              AI-generated RCA — NABH E3 Evidence. Must be reviewed and signed off by Patient Safety Officer.
              Do not use as final RCA without clinical verification.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default AIRootCauseAnalysis;
