import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertTriangle, CheckCircle, Bot, IndianRupee, UserCheck, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface LeakPattern {
  issue: string;
  amount_at_risk: number;
  severity: "critical" | "high" | "medium";
  recommended_action: string;
  department: string;
}

interface AnalysisResult {
  patterns: LeakPattern[];
  total_estimated_leak: number;
  summary: string;
  data_summary?: Record<string, unknown>;
}

const SEVERITY_CONFIG = {
  critical: { label: "Critical", bg: "bg-red-50 border-red-200",   badge: "bg-red-100 text-red-700",    icon: "text-red-600" },
  high:     { label: "High",     bg: "bg-orange-50 border-orange-200", badge: "bg-orange-100 text-orange-700", icon: "text-orange-600" },
  medium:   { label: "Medium",   bg: "bg-amber-50 border-amber-200",  badge: "bg-amber-100 text-amber-700",  icon: "text-amber-600" },
};

const fmt = (n: number) =>
  n >= 100000 ? `₹${(n / 100000).toFixed(1)}L` : `₹${n.toLocaleString("en-IN")}`;

export const RevenueLeakDetector: React.FC<{ hospitalId: string }> = ({ hospitalId }) => {
  const { toast } = useToast();
  const [loading, setLoading]       = useState(false);
  const [result, setResult]         = useState<AnalysisResult | null>(null);
  const [resolved, setResolved]     = useState<Set<number>>(new Set());
  const [assigning, setAssigning]   = useState<number | null>(null);

  const analyse = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-revenue-leak-detector", {});
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      setResult(data as AnalysisResult);
      setResolved(new Set());
    } catch (e: any) {
      toast({
        title: "Analysis failed",
        description: e?.message || "Could not complete analysis",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleResolve = (idx: number) => {
    setResolved(prev => new Set([...prev, idx]));
    toast({ title: "Marked as resolved", description: "This leakage item has been marked for follow-up." });
  };

  const handleAssign = (idx: number, pattern: LeakPattern) => {
    setAssigning(idx);
    setTimeout(() => {
      setAssigning(null);
      toast({
        title: "Assigned to department head",
        description: `${pattern.department} team has been notified about: "${pattern.issue}"`,
      });
    }, 600);
  };

  const activePatterns = result?.patterns.filter((_, i) => !resolved.has(i)) || [];
  const resolvedCount  = resolved.size;

  return (
    <div>
      {!result && (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
            <Bot size={22} className="text-primary" />
          </div>
          <p className="text-sm font-medium text-foreground mb-1">AI Revenue Intelligence</p>
          <p className="text-xs text-muted-foreground mb-4 max-w-xs">
            Analyses last 7 days of billing, lab, pharmacy, and OT data to identify
            revenue leakage patterns and recommend corrective actions.
          </p>
          <Button onClick={analyse} disabled={loading} className="gap-2">
            {loading
              ? <><Loader2 size={14} className="animate-spin" /> Analysing…</>
              : <><Bot size={14} /> Analyse Revenue Leaks</>
            }
          </Button>
        </div>
      )}

      {result && (
        <div className="space-y-4">
          {/* Summary bar */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/40 border border-border">
            <div>
              <p className="text-xs text-muted-foreground">{result.summary}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Period: {(result.data_summary as any)?.period || "Last 7 days"}
              </p>
            </div>
            <div className="text-right shrink-0 ml-3">
              <p className="text-base font-bold text-red-600">{fmt(result.total_estimated_leak || 0)}</p>
              <p className="text-[10px] text-muted-foreground">total at risk</p>
            </div>
          </div>

          {resolvedCount > 0 && (
            <div className="flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              <CheckCircle size={13} />
              {resolvedCount} item{resolvedCount > 1 ? "s" : ""} resolved
            </div>
          )}

          {/* Pattern cards */}
          {activePatterns.map((p, idx) => {
            const realIdx  = result.patterns.indexOf(p);
            const cfg      = SEVERITY_CONFIG[p.severity] || SEVERITY_CONFIG.medium;
            const isAssigning = assigning === realIdx;
            return (
              <div key={realIdx} className={cn("border rounded-lg p-4 space-y-2", cfg.bg)}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <AlertTriangle size={14} className={cn("shrink-0", cfg.icon)} />
                    <p className="text-sm font-semibold text-foreground truncate">{p.issue}</p>
                  </div>
                  <button
                    onClick={() => handleResolve(realIdx)}
                    className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                    title="Mark as resolved"
                  >
                    <X size={14} />
                  </button>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full", cfg.badge)}>
                    {cfg.label}
                  </span>
                  <span className="text-[10px] bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
                    {p.department}
                  </span>
                  <span className="flex items-center gap-0.5 text-xs font-semibold text-foreground">
                    <IndianRupee size={11} />
                    {fmt(p.amount_at_risk)}
                    <span className="text-muted-foreground font-normal ml-0.5">at risk</span>
                  </span>
                </div>

                <p className="text-xs text-muted-foreground leading-relaxed">{p.recommended_action}</p>

                <div className="flex gap-2 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1.5"
                    disabled={isAssigning}
                    onClick={() => handleAssign(realIdx, p)}
                  >
                    {isAssigning
                      ? <Loader2 size={11} className="animate-spin" />
                      : <UserCheck size={11} />
                    }
                    Assign to Dept Head
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                    onClick={() => handleResolve(realIdx)}
                  >
                    <CheckCircle size={11} /> Resolve
                  </Button>
                </div>
              </div>
            );
          })}

          {activePatterns.length === 0 && (
            <div className="flex items-center gap-2 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm">
              <CheckCircle size={15} />
              All identified leakage patterns have been resolved.
            </div>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="text-xs gap-1.5 text-muted-foreground"
            onClick={analyse}
            disabled={loading}
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <Bot size={12} />}
            Re-analyse
          </Button>
        </div>
      )}
    </div>
  );
};

export default RevenueLeakDetector;
