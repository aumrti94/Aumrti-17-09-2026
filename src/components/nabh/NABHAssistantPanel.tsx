import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, CheckCircle2, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import AIAttestationModal from "@/components/ai/AIAttestationModal";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

export type NABHContextType = "nabh_matrix" | "audit" | "ipc" | "psq" | "governance";

interface AssistantResult {
  summary: string;
  risks: string[];
  recommended_actions: string[];
}

interface Props {
  hospitalId: string;
  contextType: NABHContextType;
  contextFilter?: Record<string, unknown>;
  evidenceTitle: string;
  moduleReference: string;
  className?: string;
}

const NABHAssistantPanel: React.FC<Props> = ({
  hospitalId,
  contextType,
  contextFilter,
  evidenceTitle,
  moduleReference,
  className,
}) => {
  const { toast } = useToast();
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<AssistantResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attestOpen, setAttestOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleAsk = async () => {
    if (!hospitalId) return;
    setGenerating(true);
    setError(null);
    setSaved(false);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("ai-nabh-assistant", {
        body: {
          hospital_id: hospitalId,
          context_type: contextType,
          context_filter: contextFilter || {},
        },
      });
      if (fnError || (data as any)?.error) {
        const msg = fnError?.message || (data as any)?.error || "NABH Assistant failed";
        setError(msg);
        toast({ title: "NABH Assistant failed", description: msg, variant: "destructive" });
        return;
      }
      setResult(data as AssistantResult);
      setAttestOpen(true);
    } catch (e: any) {
      const msg = e.message || "Unknown error";
      setError(msg);
      toast({ title: "NABH Assistant error", description: msg, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const handleAccept = async (editedText: string) => {
    setAttestOpen(false);
    try {
      await (supabase as any).from("nabh_evidence_items").insert({
        hospital_id: hospitalId,
        title: `${evidenceTitle} – ${format(new Date(), "d MMM yyyy")}`,
        evidence_type: "Report",
        module_reference: moduleReference,
        notes: editedText,
      });
      setSaved(true);
      setResult(null);
      toast({ title: "NABH evidence saved", description: `"${evidenceTitle}" added to evidence repository.` });
    } catch (e: any) {
      toast({ title: "Failed to save evidence", description: e.message, variant: "destructive" });
    }
  };

  // Preview HTML for AIAttestationModal (read-only display)
  const previewContent = result
    ? `<strong style="font-size:13px">Summary</strong>
       <p style="margin:6px 0 14px">${result.summary}</p>` +
      (result.risks.length > 0
        ? `<strong style="font-size:13px">Key Risks</strong>
           <ul style="margin:6px 0 14px;padding-left:18px">${result.risks.map(r => `<li style="margin-bottom:4px">${r}</li>`).join("")}</ul>`
        : "") +
      (result.recommended_actions.length > 0
        ? `<strong style="font-size:13px">Recommended Actions</strong>
           <ul style="margin:6px 0;padding-left:18px">${result.recommended_actions.map(a => `<li style="margin-bottom:4px">${a}</li>`).join("")}</ul>`
        : "")
    : "";

  // Editable text the quality manager can revise before saving as evidence
  const editableText = result
    ? [
        `NABH Assessment – ${evidenceTitle}`,
        `Date: ${format(new Date(), "d MMM yyyy")}`,
        "",
        "SUMMARY",
        result.summary,
        "",
        "KEY RISKS",
        ...result.risks.map((r, i) => `${i + 1}. ${r}`),
        "",
        "RECOMMENDED ACTIONS",
        ...result.recommended_actions.map((a, i) => `${i + 1}. ${a}`),
      ].join("\n")
    : "";

  if (saved) {
    return (
      <div className={cn("flex items-center gap-1.5 text-xs text-emerald-600 font-medium", className)}>
        <CheckCircle2 className="h-3.5 w-3.5" />
        Evidence saved
        <button
          onClick={() => setSaved(false)}
          className="ml-1 text-muted-foreground hover:text-foreground text-[10px] underline"
        >
          Ask again
        </button>
      </div>
    );
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={handleAsk}
        disabled={generating || !hospitalId}
        className={cn(
          "gap-1.5 border-violet-200 text-violet-700 hover:bg-violet-50 dark:border-violet-800 dark:text-violet-400 dark:hover:bg-violet-950/30",
          className,
        )}
      >
        {generating
          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
          : <Sparkles className="h-3.5 w-3.5" />}
        {generating ? "Analysing…" : "Ask NABH Assistant"}
      </Button>

      {result && (
        <AIAttestationModal
          open={attestOpen}
          title="NABH Assistant — Expert Analysis"
          feature="nabh_assistant"
          hospitalId={hospitalId}
          aiOutput={result as unknown as Record<string, unknown>}
          previewContent={previewContent}
          initialEditableText={editableText}
          editableLabel="Review & Edit before saving as evidence"
          onAccept={handleAccept}
          onDiscard={() => { setAttestOpen(false); setResult(null); }}
        />
      )}
    </>
  );
};

export default NABHAssistantPanel;
