import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { callAI } from "@/lib/aiProvider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Loader2, ChevronDown, ChevronUp, AlertTriangle, TrendingUp, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateForQuery } from "@/pages/ot/OTPage";
import type { OTSchedule } from "@/pages/ot/OTPage";

interface Suggestion {
  type: "gap" | "conflict" | "optimization" | "resource";
  message: string;
  impact: string;
  severity: "high" | "medium" | "low";
}

interface Props {
  schedules: OTSchedule[];
  hospitalId: string | null;
  selectedDate: Date;
}

const SEVERITY_STYLES: Record<string, string> = {
  high: "bg-red-50 border-red-200 text-red-800 dark:bg-red-950/20 dark:border-red-800 dark:text-red-300",
  medium: "bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/20 dark:border-amber-800 dark:text-amber-300",
  low: "bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-950/20 dark:border-blue-800 dark:text-blue-300",
};

const TYPE_ICON: Record<string, React.ReactNode> = {
  gap: <Clock className="h-3 w-3 shrink-0" />,
  conflict: <AlertTriangle className="h-3 w-3 shrink-0" />,
  optimization: <TrendingUp className="h-3 w-3 shrink-0" />,
  resource: <Sparkles className="h-3 w-3 shrink-0" />,
};

const OTOptimizerPanel: React.FC<Props> = ({ schedules, hospitalId, selectedDate }) => {
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [utilizationScore, setUtilizationScore] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [ran, setRan] = useState(false);

  const runOptimizer = async () => {
    if (!hospitalId) return;
    setLoading(true);

    try {
      const dateStr = formatDateForQuery(selectedDate);

      // Fetch next 7 days of schedules for broader context
      const sevenDaysLater = new Date(selectedDate);
      sevenDaysLater.setDate(sevenDaysLater.getDate() + 6);

      const { data: weekSchedules } = await supabase
        .from("ot_schedules")
        .select("surgery_name, surgery_category, scheduled_date, scheduled_start_time, scheduled_end_time, estimated_duration_minutes, status, surgeon_id, ot_room_id, ot_room:ot_rooms(name, type)")
        .eq("hospital_id", hospitalId)
        .gte("scheduled_date", dateStr)
        .lte("scheduled_date", formatDateForQuery(sevenDaysLater))
        .in("status", ["scheduled", "confirmed"])
        .order("scheduled_date")
        .order("scheduled_start_time");

      const { data: rooms } = await supabase
        .from("ot_rooms")
        .select("id, name, type")
        .eq("is_active", true);

      const scheduleContext = (weekSchedules || []).map((s: any) =>
        `${s.scheduled_date} ${s.scheduled_start_time}-${s.scheduled_end_time} | ${(s.ot_room as any)?.name || "Room?"} | ${s.surgery_name} (${s.estimated_duration_minutes}min) [${s.status}]`
      ).join("\n") || "No surgeries scheduled";

      const roomList = (rooms || []).map((r: any) => `${r.name} (${r.type})`).join(", ");

      const todaySchedules = schedules.filter(s => s.status !== "cancelled" && s.status !== "completed");
      const totalScheduledMin = todaySchedules.reduce((sum, s) => sum + (s.estimated_duration_minutes || 0), 0);
      const otHoursAvailable = (rooms?.length || 3) * 14 * 60;
      const currentUtilization = Math.round((totalScheduledMin / otHoursAvailable) * 100);

      const response = await callAI({
        featureKey: "ot_optimizer",
        hospitalId,
        prompt: `You are an OT scheduling expert for an Indian hospital. Analyse this operation theatre schedule and provide concrete optimisation suggestions.

OT Rooms available: ${roomList}
Current day utilization: ${currentUtilization}% (${totalScheduledMin}min scheduled of ${otHoursAvailable}min available)

Schedule for next 7 days:
${scheduleContext}

Identify: scheduling gaps > 60 min, surgeon double-booking, room type mismatches (minor procedure in major OT), consecutive emergency cases without buffer, and opportunities to fit additional elective cases.

Return ONLY valid JSON:
{
  "utilization_score": ${currentUtilization},
  "suggestions": [
    {
      "type": "gap|conflict|optimization|resource",
      "message": "Specific actionable recommendation",
      "impact": "Estimated time saved or revenue recovered",
      "severity": "high|medium|low"
    }
  ]
}

Provide 3-6 suggestions. Be specific to the actual schedule data.`,
        maxTokens: 600,
      });

      if (response.error || !response.text) {
        setSuggestions([{
          type: "optimization",
          message: "Could not connect to AI. Check your AI provider config in Settings → API Hub.",
          impact: "",
          severity: "low",
        }]);
        setRan(true);
        return;
      }

      let parsed: any;
      try {
        const clean = response.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        parsed = JSON.parse(clean);
      } catch {
        setSuggestions([{ type: "optimization", message: response.text.slice(0, 200), impact: "", severity: "low" }]);
        setRan(true);
        return;
      }

      setSuggestions(parsed.suggestions || []);
      setUtilizationScore(parsed.utilization_score ?? currentUtilization);
      setRan(true);

      await (supabase as any).from("ai_feature_logs").insert({
        hospital_id: hospitalId,
        module: "ot",
        feature_key: "ot_optimizer",
        success: true,
        input_summary: `${todaySchedules.length} cases | ${rooms?.length || 0} rooms`,
        output_summary: `${parsed.suggestions?.length || 0} suggestions | ${parsed.utilization_score}% utilization`,
        tokens_used: (response as any).tokens_used ?? null,
      });
    } catch (err) {
      console.error("OT optimizer error:", err);
    }

    setLoading(false);
  };

  return (
    <div className="border-t border-border bg-background">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          AI Schedule Optimizer
        </span>
        {collapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
      </button>

      {!collapsed && (
        <div className="px-3 pb-3 space-y-2">
          {utilizationScore !== null && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Today's utilization</span>
              <Badge variant={utilizationScore >= 70 ? "default" : utilizationScore >= 40 ? "secondary" : "destructive"} className="text-xs">
                {utilizationScore}%
              </Badge>
            </div>
          )}

          {!ran ? (
            <Button
              size="sm"
              variant="outline"
              className="w-full text-xs h-7"
              onClick={runOptimizer}
              disabled={loading}
            >
              {loading ? (
                <><Loader2 className="h-3 w-3 animate-spin mr-1.5" /> Analysing schedule...</>
              ) : (
                <><Sparkles className="h-3 w-3 mr-1.5 text-primary" /> Optimise Schedule</>
              )}
            </Button>
          ) : (
            <div className="space-y-1.5">
              {suggestions.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-2">No issues found — schedule looks optimal.</p>
              )}
              {suggestions.map((s, i) => (
                <div key={i} className={cn("rounded border p-2 text-xs space-y-0.5", SEVERITY_STYLES[s.severity])}>
                  <div className="flex items-start gap-1.5 font-medium">
                    {TYPE_ICON[s.type]}
                    <span>{s.message}</span>
                  </div>
                  {s.impact && (
                    <p className="text-xs opacity-75 pl-4">{s.impact}</p>
                  )}
                </div>
              ))}
              <Button
                size="sm"
                variant="ghost"
                className="w-full text-xs h-6"
                onClick={() => { setRan(false); setSuggestions([]); setUtilizationScore(null); runOptimizer(); }}
                disabled={loading}
              >
                {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Refresh"}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default OTOptimizerPanel;
