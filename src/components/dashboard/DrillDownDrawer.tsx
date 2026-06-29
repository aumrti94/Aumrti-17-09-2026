import React, { useEffect, useState } from "react";
import { X, ExternalLink, Sparkles, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { callAI } from "@/lib/aiProvider";
import { Skeleton } from "@/components/ui/skeleton";

export type KPIType = "revenue" | "beds" | "opd" | "alerts" | "doctors" | "discounts" | "followups";

export interface DrillDownConfig {
  type: KPIType;
  title: string;
  icon: string;
  period: string;
  currentValue: string;
  changeText?: string;
  changePositive?: boolean;
  aiPrompt: string;
  reportLink: string;
  reportLabel: string;
  hospitalId?: string;
}

interface DrillDownDrawerProps {
  open: boolean;
  onClose: () => void;
  config: DrillDownConfig | null;
  children?: React.ReactNode;
}

const DrillDownDrawer: React.FC<DrillDownDrawerProps> = ({
  open, onClose, config, children,
}) => {
  const navigate = useNavigate();
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(false);

  useEffect(() => {
    if (!open || !config) {
      setAiInsight(null);
      setAiError(false);
      return;
    }

    const fetchInsight = async () => {
      if (!config.hospitalId || !config.aiPrompt) {
        setAiError(true);
        return;
      }
      setAiLoading(true);
      setAiError(false);
      try {
        const res = await callAI({
          featureKey: "ai_digest",
          hospitalId: config.hospitalId,
          prompt: config.aiPrompt,
          maxTokens: 150,
        });
        if (res.error || !res.text) {
          setAiError(true);
        } else {
          setAiInsight(res.text);
        }
      } catch {
        setAiError(true);
      } finally {
        setAiLoading(false);
      }
    };

    fetchInsight();
  }, [open, config]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!config) return null;

  return (
    <>
      {/* Overlay */}
      <div
        className={cn(
          "fixed inset-0 bg-black/30 z-[199] transition-opacity duration-200",
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className={cn(
          "fixed top-0 right-0 h-full w-full max-w-[480px] z-[200] bg-card border-l border-border shadow-[-4px_0_20px_rgba(0,0,0,0.1)] flex flex-col transition-transform duration-200 ease-out",
          open ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Header */}
        <div className="h-[60px] bg-primary flex items-center justify-between px-5 shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="text-lg">{config.icon}</span>
            <span className="text-[15px] font-bold text-primary-foreground">{config.title}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] bg-primary-foreground/15 text-primary-foreground px-2.5 py-1 rounded-full">
              {config.period}
            </span>
            <button onClick={onClose} className="text-primary-foreground/80 hover:text-primary-foreground transition-colors">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Subheader */}
        <div className="h-[44px] bg-muted/50 border-b border-border flex items-center justify-between px-5 shrink-0">
          <span className="text-xl font-bold text-foreground">{config.currentValue}</span>
          {config.changeText && (
            <span className={cn(
              "text-xs font-medium",
              config.changePositive ? "text-[hsl(var(--success))]" : "text-destructive"
            )}>
              {config.changeText}
            </span>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* AI Insight */}
          <div className="bg-primary/5 rounded-[10px] p-3.5 border-l-[3px] border-l-primary">
            <div className="flex items-center gap-1.5 mb-2">
              <Sparkles size={13} className="text-primary" />
              <span className="text-[11px] font-bold text-primary uppercase tracking-wide">AI Insight</span>
            </div>
            {aiLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="h-3 w-3/5" />
              </div>
            ) : aiError || !aiInsight ? (
              <p className="text-[12px] text-muted-foreground leading-relaxed">
                {config.currentValue} — {config.period}. {config.changeText || ""}
              </p>
            ) : (
              <p className="text-[13px] text-foreground/80 leading-relaxed">{aiInsight}</p>
            )}
          </div>

          {/* KPI-specific content */}
          {children}
        </div>

        {/* Footer */}
        <div className="h-[56px] border-t border-border bg-card flex items-center px-5 shrink-0">
          <Button
            variant="outline"
            className="w-full gap-2"
            onClick={() => { navigate(config.reportLink); onClose(); }}
          >
            📊 {config.reportLabel}
            <ExternalLink size={14} />
          </Button>
        </div>
      </div>
    </>
  );
};

export default DrillDownDrawer;
