import React, { useState } from "react";
import { Bot, CheckCircle2, AlertTriangle, XCircle, ChevronDown, ChevronUp, Flag, Check, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useAIAudit, type AIAuditAction, type AIAuditEntry } from "@/hooks/useAIAudit";
import { toast } from "sonner";

interface AISuggestionCardProps {
  featureKey: string;
  hospitalId: string;
  patientId?: string;
  aiOutput: Record<string, unknown>;
  confidence?: number;
  reasoning?: string;
  renderContent: React.ReactNode;
  onAccept?: () => void;
  onOverride?: (value: string) => void;
  onReject?: () => void;
  allowOverride?: boolean;
  overrideLabel?: string;
  className?: string;
}

const AISuggestionCard: React.FC<AISuggestionCardProps> = ({
  featureKey,
  hospitalId,
  patientId,
  aiOutput,
  confidence = 1,
  reasoning,
  renderContent,
  onAccept,
  onOverride,
  onReject,
  allowOverride = false,
  overrideLabel = "Enter your value...",
  className,
}) => {
  const { logAudit } = useAIAudit();
  const [overrideMode, setOverrideMode] = useState(false);
  const [overrideText, setOverrideText] = useState("");
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const [actioned, setActioned] = useState(false);

  const confidencePercent = Math.round(confidence * 100);

  const entry: AIAuditEntry = { hospitalId, patientId, featureKey, aiOutput, confidence, reasoning };

  const { label, colorClass, icon } = (() => {
    if (confidence >= 0.8) return {
      label: `${confidencePercent}% confidence`,
      colorClass: "bg-emerald-100 text-emerald-700 border-emerald-200",
      icon: <CheckCircle2 className="h-3 w-3" />,
    };
    if (confidence >= 0.6) return {
      label: `${confidencePercent}% — review suggested`,
      colorClass: "bg-amber-100 text-amber-700 border-amber-200",
      icon: <AlertTriangle className="h-3 w-3" />,
    };
    return {
      label: `${confidencePercent}% — manual entry required`,
      colorClass: "bg-red-100 text-red-700 border-red-200",
      icon: <XCircle className="h-3 w-3" />,
    };
  })();

  const borderColor = confidence >= 0.8 ? "border-l-emerald-500" : confidence >= 0.6 ? "border-l-amber-400" : "border-l-red-400";
  const bgColor = confidence >= 0.8 ? "bg-emerald-50/60" : confidence >= 0.6 ? "bg-amber-50/60" : "bg-red-50/40";

  const handleAction = async (action: AIAuditAction, override?: string) => {
    await logAudit(entry, action, override ? { value: override } : undefined);
    if (action === "accepted") { onAccept?.(); toast.success("AI suggestion accepted"); }
    else if (action === "overridden") { onOverride?.(override!); toast.success("Override applied and logged"); }
    else if (action === "rejected") { onReject?.(); }
    else if (action === "flagged") { toast.info("Flagged for clinical review"); }
    setActioned(true);
    setOverrideMode(false);
  };

  if (actioned) return null;

  return (
    <div className={cn("rounded-lg border-l-[3px] p-3 space-y-2", borderColor, bgColor, className)}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-slate-500 shrink-0" />
          <span className="text-sm font-semibold text-slate-700">AI Suggestion</span>
          <Badge variant="outline" className={cn("text-[10px] gap-1 px-1.5 py-0.5", colorClass)}>
            {icon}{label}
          </Badge>
        </div>
        {reasoning && (
          <button
            onClick={() => setReasoningOpen(v => !v)}
            className="text-[10px] text-slate-500 hover:text-slate-700 flex items-center gap-0.5 shrink-0"
          >
            Why? {reasoningOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        )}
      </div>

      {reasoningOpen && reasoning && (
        <p className="text-xs italic text-slate-500 bg-white/60 rounded px-2 py-1.5 border border-slate-100">
          {reasoning}
        </p>
      )}

      <div>{renderContent}</div>

      {overrideMode ? (
        <div className="space-y-1.5">
          <Textarea
            autoFocus
            rows={2}
            value={overrideText}
            onChange={(e) => setOverrideText(e.target.value)}
            placeholder={overrideLabel}
            className="text-xs resize-none"
          />
          <div className="flex gap-1.5">
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={() => handleAction("overridden", overrideText)}
              disabled={!overrideText.trim()}
            >
              <Check className="h-3 w-3 mr-1" /> Save Override
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setOverrideMode(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-1.5 flex-wrap">
          <Button
            size="sm"
            className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700"
            onClick={() => handleAction("accepted")}
          >
            <Check className="h-3 w-3 mr-1" /> Accept
          </Button>
          {allowOverride && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => setOverrideMode(true)}
            >
              <Pencil className="h-3 w-3 mr-1" /> Override
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-amber-600 hover:text-amber-700 hover:bg-amber-50"
            onClick={() => handleAction("flagged")}
          >
            <Flag className="h-3 w-3 mr-1" /> Flag
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-red-500 hover:text-red-600 hover:bg-red-50"
            onClick={() => handleAction("rejected")}
          >
            <XCircle className="h-3 w-3 mr-1" /> Reject
          </Button>
        </div>
      )}
    </div>
  );
};

export default AISuggestionCard;
