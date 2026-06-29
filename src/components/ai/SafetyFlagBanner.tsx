import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, AlertCircle, Info, ShieldCheck, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export interface SafetyFlag {
  severity: "critical" | "warning" | "info";
  field: string;
  message: string;
}

interface Props {
  flags: SafetyFlag[];
  flagRecordId?: string;
  onAcknowledged?: () => void;
  onOverride?: (reason: string) => void;
  className?: string;
}

const SEVERITY_STYLES = {
  critical: {
    wrapper: "bg-red-50 border-red-300",
    icon: AlertCircle,
    iconClass: "text-red-600",
    badge: "bg-red-100 text-red-700",
    label: "Critical",
  },
  warning: {
    wrapper: "bg-amber-50 border-amber-300",
    icon: AlertTriangle,
    iconClass: "text-amber-600",
    badge: "bg-amber-100 text-amber-700",
    label: "Warning",
  },
  info: {
    wrapper: "bg-blue-50 border-blue-200",
    icon: Info,
    iconClass: "text-blue-500",
    badge: "bg-blue-100 text-blue-700",
    label: "Info",
  },
};

const SafetyFlagBanner: React.FC<Props> = ({ flags, flagRecordId, onAcknowledged, onOverride, className }) => {
  const [expanded, setExpanded] = useState(true);
  const [overrideMode, setOverrideMode] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [saving, setSaving] = useState(false);

  if (!flags || flags.length === 0) return null;

  const hasCritical = flags.some(f => f.severity === "critical");
  const hasWarning = flags.some(f => f.severity === "warning");

  const topSeverity = hasCritical ? "critical" : hasWarning ? "warning" : "info";
  const style = SEVERITY_STYLES[topSeverity];

  const handleOverride = async () => {
    if (!overrideReason.trim()) {
      toast.error("Please provide a reason for overriding the safety flag.");
      return;
    }
    setSaving(true);
    if (flagRecordId) {
      await (supabase as any).from("ai_safety_flags").update({
        was_overridden: true,
        override_reason: overrideReason,
      }).eq("id", flagRecordId);
    }
    onOverride?.(overrideReason);
    setSaving(false);
    setOverrideMode(false);
    toast.success("Override recorded.");
  };

  return (
    <div className={cn("border rounded-lg overflow-hidden", style.wrapper, className)}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <style.icon className={cn("h-4 w-4 shrink-0", style.iconClass)} />
        <div className="flex-1 min-w-0">
          <span className={cn("text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded", style.badge)}>
            {flags.length} Safety {flags.length === 1 ? "Flag" : "Flags"} · {style.label}
          </span>
          {hasCritical && (
            <span className="ml-2 text-xs text-red-700 font-medium">Action required before saving</span>
          )}
        </div>
        <button onClick={() => setExpanded(v => !v)} className="text-muted-foreground hover:text-foreground">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {expanded && (
        <div className="px-3 pb-3 space-y-1.5">
          {flags.map((f, i) => {
            const s = SEVERITY_STYLES[f.severity];
            return (
              <div key={i} className="flex items-start gap-2 text-xs">
                <s.icon className={cn("h-3.5 w-3.5 shrink-0 mt-0.5", s.iconClass)} />
                <span>{f.message}</span>
              </div>
            );
          })}

          <div className="flex gap-2 mt-2">
            {!hasCritical && onAcknowledged && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onAcknowledged}>
                <ShieldCheck className="h-3 w-3 mr-1" /> Acknowledge & Proceed
              </Button>
            )}
            {onOverride && (
              <Button
                size="sm"
                variant={hasCritical ? "destructive" : "outline"}
                className="h-7 text-xs"
                onClick={() => setOverrideMode(v => !v)}
              >
                Override with Reason
              </Button>
            )}
          </div>

          {overrideMode && (
            <div className="mt-2 space-y-1.5">
              <Textarea
                value={overrideReason}
                onChange={e => setOverrideReason(e.target.value)}
                placeholder="Document clinical justification for override (required)..."
                rows={2}
                className="text-xs resize-none"
              />
              <div className="flex gap-2">
                <Button size="sm" className="h-7 text-xs" onClick={handleOverride} disabled={saving}>
                  {saving ? "Saving..." : "Confirm Override"}
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setOverrideMode(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SafetyFlagBanner;
