import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { callAI } from "@/lib/aiProvider";
import { useAIFeature } from "@/hooks/useAIFeature";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CalendarDays, Loader2, Bot, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, addDays } from "date-fns";

interface RosterGap {
  date: string;
  department: string;
  shift: string;
  required: number;
  scheduled: number;
  gap: number;
  suggestion: string;
}

interface RosterOptResult {
  coverage_score: number;
  critical_gaps: RosterGap[];
  recommendation: string;
}

interface Props {
  hospitalId: string;
}

const RosterOptimizerPanel: React.FC<Props> = ({ hospitalId }) => {
  const __aiOn = useAIFeature("roster_optimizer");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RosterOptResult | null>(null);
  const [rawText, setRawText] = useState<string | null>(null);

  const runOptimizer = async () => {
    if (!hospitalId) return;
    setLoading(true);
    setResult(null);
    setRawText(null);

    try {
      const today = new Date();
      const dateFrom = today.toISOString().split("T")[0];
      const dateTo = addDays(today, 7).toISOString().split("T")[0];

      // Fetch duty roster for next 7 days (join shift_master for timing/type)
      const { data: roster } = await (supabase as any)
        .from("duty_roster")
        .select("roster_date, user_id, shift_id, department_id, is_off, shift_master(shift_code, shift_type, start_time)")
        .eq("hospital_id", hospitalId)
        .gte("roster_date", dateFrom)
        .lte("roster_date", dateTo)
        .order("roster_date");

      // Fetch active staff count and roles
      const { data: staff } = await supabase
        .from("users")
        .select("id, full_name, role, department_id, departments(name)")
        .eq("hospital_id", hospitalId)
        .eq("is_active", true);

      // Fetch approved leave for next 7 days
      const { data: leaves } = await (supabase as any)
        .from("leave_requests")
        .select("user_id, from_date, to_date, leave_type")
        .eq("hospital_id", hospitalId)
        .eq("status", "approved")
        .gte("to_date", dateFrom)
        .lte("from_date", dateTo);

      const rosterData = roster || [];
      const staffData = staff || [];
      const leaveData = leaves || [];

      // Classify a roster entry as night shift (shift code "N" or starts 20:00–06:00)
      const isNightShift = (r: any): boolean => {
        const code = r.shift_master?.shift_code;
        if (code === "N") return true;
        const st = r.shift_master?.start_time as string | undefined;
        if (st) {
          const h = parseInt(st.slice(0, 2), 10);
          if (!Number.isNaN(h)) return h >= 20 || h < 6;
        }
        return false;
      };

      // Count staff on leave per date
      const onLeaveByDate: Record<string, number> = {};
      leaveData.forEach((l: any) => {
        const from = new Date(l.from_date);
        const to = new Date(l.to_date);
        for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
          const key = d.toISOString().split("T")[0];
          onLeaveByDate[key] = (onLeaveByDate[key] || 0) + 1;
        }
      });

      const next7Days = Array.from({ length: 7 }, (_, i) =>
        addDays(today, i).toISOString().split("T")[0]
      );

      const rosterContext = next7Days.map(date => {
        const dayRoster = rosterData.filter((r: any) => r.roster_date === date);
        const scheduled = dayRoster.filter((r: any) => r.shift_id && !r.is_off);
        const dayLeave = onLeaveByDate[date] || 0;
        const nightShift = scheduled.filter(isNightShift).length;
        const dayShift = scheduled.length - nightShift;
        const isWeekend = [0, 6].includes(new Date(date + "T00:00:00").getDay());
        return `${date} (${isWeekend ? "Weekend" : "Weekday"}): ${scheduled.length} scheduled, Day shift: ${dayShift}, Night shift: ${nightShift}, On leave: ${dayLeave}`;
      }).join("\n");

      const staffContext = `Total active staff: ${staffData.length}`;

      const response = await callAI({
        featureKey: "roster_optimizer",
        hospitalId,
        prompt: `You are an HR roster optimizer AI for an Indian hospital. Analyse the duty roster for the next 7 days and identify coverage gaps.

${staffContext}

DUTY ROSTER (next 7 days):
${rosterContext}

MINIMUM COVERAGE REQUIREMENTS (Indian hospital standards):
- Weekday day shift: minimum 60% of total ward staff
- Weekday night shift: minimum 30% of total ward staff
- Weekend: minimum 50% coverage
- At least 1 nurse per ward per shift

Identify: days with insufficient coverage, shift imbalances, high leave coinciding with low roster.

Return ONLY valid JSON:
{
  "coverage_score": 75,
  "critical_gaps": [
    {
      "date": "2026-06-25",
      "department": "ICU",
      "shift": "night",
      "required": 3,
      "scheduled": 1,
      "gap": 2,
      "suggestion": "Call in 2 on-call staff for Wednesday night ICU"
    }
  ],
  "recommendation": "Overall 1-2 sentence action plan for the HR manager"
}

coverage_score: 0-100 (100 = all shifts fully covered). Return [] for critical_gaps if no issues found.`,
        maxTokens: 600,
      });

      if (response.error || !response.text) {
        setRawText("AI service unavailable.");
        setLoading(false);
        return;
      }

      try {
        const clean = response.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        const parsed = JSON.parse(clean);
        setResult(parsed);
      } catch {
        setRawText(response.text);
      }
    } catch (err: any) {
      setRawText(`Optimization failed: ${err.message}`);
    }
    setLoading(false);
  };

  const criticalCount = result?.critical_gaps?.length ?? 0;
  const score = result?.coverage_score ?? null;

  if (!__aiOn) return null;
  return (
    <div className="border rounded-lg overflow-hidden mt-4">
      <div className="flex items-center justify-between px-4 py-2.5 bg-muted/40 border-b">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-primary" />
          <span className="text-[13px] font-bold">Roster Optimizer</span>
          {score !== null && (
            <Badge
              variant="outline"
              className={cn("text-[10px]", score >= 80 ? "border-emerald-400 text-emerald-700" : score >= 60 ? "border-amber-400 text-amber-700" : "border-red-400 text-red-700")}
            >
              Coverage: {score}%
            </Badge>
          )}
          {criticalCount > 0 && (
            <Badge className="bg-red-100 text-red-700 border-red-300 text-[10px]">
              <AlertTriangle className="h-3 w-3 mr-1" />{criticalCount} gap(s)
            </Badge>
          )}
        </div>
        <Button size="sm" className="h-7 text-xs gap-1.5" onClick={runOptimizer} disabled={loading || !hospitalId}>
          {loading
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Analyzing...</>
            : <><Bot className="h-3.5 w-3.5" /> Optimize 7-Day Roster</>}
        </Button>
      </div>

      <div className="p-4 space-y-3">
        {result === null && !rawText && !loading && (
          <p className="text-[12px] text-muted-foreground text-center py-3">
            Click "Optimize 7-Day Roster" to identify staffing gaps and get rebalancing suggestions for the next 7 days
          </p>
        )}

        {result && (
          <>
            <div className={cn(
              "rounded-lg border px-4 py-3 text-sm",
              score !== null && score >= 80 ? "bg-emerald-50 border-emerald-200" :
              score !== null && score >= 60 ? "bg-amber-50 border-amber-200" :
              "bg-red-50 border-red-200"
            )}>
              <div className="flex items-center gap-2 mb-2">
                {criticalCount === 0
                  ? <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  : <AlertTriangle className="h-4 w-4 text-amber-600" />}
                <span className="font-bold text-[13px]">
                  {score !== null && score >= 80 ? "Good Coverage" : score !== null && score >= 60 ? "Coverage Gaps Detected" : "Critical Staffing Gaps"}
                </span>
                {score !== null && (
                  <span className="text-muted-foreground text-[11px] ml-auto">Score: {score}/100</span>
                )}
              </div>
              <p className="text-[12px]">→ {result.recommendation}</p>
            </div>

            {result.critical_gaps?.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground mb-1.5">Coverage Gaps (Next 7 Days)</p>
                <div className="space-y-1.5">
                  {result.critical_gaps.map((g, i) => (
                    <div key={i} className="rounded border bg-red-50 border-red-200 px-3 py-2 text-xs space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-[10px] text-muted-foreground w-20">
                          {format(new Date(g.date + "T00:00:00"), "dd MMM EEE")}
                        </span>
                        <span className="font-semibold">{g.department}</span>
                        <Badge variant="outline" className="text-[9px] px-1.5">{g.shift} shift</Badge>
                        <span className="ml-auto text-red-700 font-bold text-[11px]">
                          {g.scheduled}/{g.required} ({g.gap} short)
                        </span>
                      </div>
                      <p className="text-[10px] text-red-700 pl-0.5">→ {g.suggestion}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="text-[10px] text-muted-foreground italic">
              AI roster analysis only. HR manager must review and approve all roster changes.
            </p>
          </>
        )}

        {rawText && (
          <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap rounded border p-2 max-h-32 overflow-auto">
            {rawText}
          </pre>
        )}
      </div>
    </div>
  );
};

export default RosterOptimizerPanel;
