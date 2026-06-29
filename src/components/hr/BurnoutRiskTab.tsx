import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { callAI } from "@/lib/aiProvider";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { HeartHandshake, Loader2, RefreshCw, AlertTriangle, CheckCircle2, Brain, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, subDays, startOfMonth } from "date-fns";

interface BurnoutScore {
  id: string;
  user_id: string;
  score_date: string;
  burnout_score: number;
  risk_level: string;
  attendance_score: number | null;
  overtime_score: number | null;
  incident_score: number | null;
  training_score: number | null;
  risk_factors: string[] | null;
  recommendations: string | null;
  staff_name?: string;
  staff_role?: string;
}

interface StaffMember {
  id: string;
  full_name: string;
  role: string;
}

const RISK_CONFIG: Record<string, { label: string; bg: string; text: string; border: string; bar: string }> = {
  low:      { label: "Low",      bg: "bg-emerald-50",  text: "text-emerald-700", border: "border-emerald-200", bar: "bg-emerald-500" },
  medium:   { label: "Medium",   bg: "bg-amber-50",    text: "text-amber-700",   border: "border-amber-200",   bar: "bg-amber-500"   },
  high:     { label: "High",     bg: "bg-red-50",      text: "text-red-700",     border: "border-red-200",     bar: "bg-red-500"     },
  critical: { label: "Critical", bg: "bg-red-100",     text: "text-red-800",     border: "border-red-300",     bar: "bg-red-700"     },
};

const today = new Date().toISOString().split("T")[0];
const thirtyDaysAgo = subDays(new Date(), 30).toISOString().split("T")[0];
const monthStart = startOfMonth(new Date()).toISOString().split("T")[0];

const BurnoutRiskTab: React.FC<{ hospitalId: string }> = ({ hospitalId }) => {
  const { toast } = useToast();
  const [scores, setScores] = useState<BurnoutScore[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [assessing, setAssessing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filterRisk, setFilterRisk] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    const [scoresRes, staffRes] = await Promise.all([
      (supabase as any).from("staff_burnout_scores")
        .select("*, u:users!staff_burnout_scores_user_id_fkey(full_name, role)")
        .eq("hospital_id", hospitalId)
        .eq("score_date", today)
        .order("burnout_score", { ascending: false }),
      supabase.from("users").select("id, full_name, role").eq("hospital_id", hospitalId).eq("is_active", true).order("full_name"),
    ]);
    setStaff(staffRes.data || []);
    setScores((scoresRes.data || []).map((s: any) => ({
      ...s,
      staff_name: s.u?.full_name,
      staff_role: s.u?.role,
      risk_factors: Array.isArray(s.risk_factors) ? s.risk_factors : [],
    })));
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);

  const runAssessment = async () => {
    if (staff.length === 0) { toast({ title: "No active staff found" }); return; }
    setAssessing(true);

    try {
      // Fetch raw data for all staff
      const staffIds = staff.map(s => s.id);

      const [attendRes, incidentRes, trainingRes] = await Promise.all([
        supabase.from("staff_attendance")
          .select("user_id, status, attendance_date")
          .eq("hospital_id", hospitalId)
          .gte("attendance_date", thirtyDaysAgo)
          .in("user_id", staffIds),
        (supabase as any).from("incident_reports")
          .select("reported_by, severity_level, incident_date")
          .eq("hospital_id", hospitalId)
          .gte("incident_date", thirtyDaysAgo),
        (supabase as any).from("staff_training_records")
          .select("user_id, completed, due_date")
          .eq("hospital_id", hospitalId)
          .in("user_id", staffIds)
          .eq("completed", false),
      ]);

      const attendData = attendRes.data || [];
      const incidentData = incidentRes.data || [];
      const overdueTraining = trainingRes.data || [];

      const upserts = [];
      for (const member of staff) {
        // Calculate component scores (0-100, higher = more burnout risk)
        const memberAttend = attendData.filter((a: any) => a.user_id === member.id);
        const workdays = memberAttend.length || 1;
        const absent = memberAttend.filter((a: any) => a.status === "absent").length;
        const sickLeave = memberAttend.filter((a: any) => a.status === "sick_leave").length;
        const attendanceScore = Math.min(100, Math.round(((absent + sickLeave * 1.5) / workdays) * 200));

        const memberIncidents = incidentData.filter((i: any) => i.reported_by === member.id).length;
        const sentinelInvolved = incidentData.filter((i: any) =>
          i.reported_by === member.id && i.severity_level === "sentinel"
        ).length;
        const incidentScore = Math.min(100, memberIncidents * 15 + sentinelInvolved * 40);

        const memberOverdue = overdueTraining.filter((t: any) => t.user_id === member.id).length;
        const trainingScore = Math.min(100, memberOverdue * 25);

        const overallScore = Math.round(
          (attendanceScore * 0.35) + (incidentScore * 0.35) + (trainingScore * 0.15) + 25 // base
        );

        const finalScore = Math.min(100, Math.max(0, overallScore));
        const riskLevel = finalScore >= 70 ? "critical" : finalScore >= 55 ? "high" : finalScore >= 35 ? "medium" : "low";

        // AI recommendations only for medium/high/critical
        let recommendations = null;
        let riskFactors: string[] = [];
        if (finalScore >= 35) {
          riskFactors = [
            ...(attendanceScore > 30 ? [`High absenteeism: ${absent} absences + ${sickLeave} sick days in 30 days`] : []),
            ...(memberIncidents > 0 ? [`Involved in ${memberIncidents} incident report(s) this month`] : []),
            ...(memberOverdue > 0 ? [`${memberOverdue} overdue training module(s)`] : []),
          ];
        }

        upserts.push({
          hospital_id: hospitalId,
          user_id: member.id,
          score_date: today,
          burnout_score: finalScore,
          risk_level: riskLevel,
          attendance_score: attendanceScore,
          overtime_score: null,
          incident_score: incidentScore,
          training_score: trainingScore,
          risk_factors: riskFactors,
          recommendations,
          assessed_by_ai: true,
        });
      }

      // For high/critical risk staff, get AI recommendations
      const highRisk = upserts.filter(u => u.risk_level === "high" || u.risk_level === "critical");
      if (highRisk.length > 0 && hospitalId) {
        for (const u of highRisk.slice(0, 5)) {
          const member = staff.find(s => s.id === u.user_id);
          if (!member) continue;
          const response = await callAI({
            featureKey: "staff_burnout",
            hospitalId,
            prompt: `Staff member "${member.full_name}" (${member.role}) has a burnout score of ${u.burnout_score}/100 (${u.risk_level} risk).
Risk factors: ${u.risk_factors?.join(", ") || "None identified"}.
Suggest 2-3 specific, empathetic support actions for the HR/nursing manager. Be practical and brief.
Respond with a single paragraph of 2-3 sentences.`,
            maxTokens: 200,
          });
          if (response.text && !response.error) {
            u.recommendations = response.text.trim();
          }
        }
      }

      const { error } = await (supabase as any)
        .from("staff_burnout_scores")
        .upsert(upserts, { onConflict: "hospital_id,user_id,score_date" });

      if (error) throw error;
      toast({ title: `Burnout assessment complete — ${highRisk.length} at-risk staff identified` });
      load();
    } catch (err: any) {
      toast({ title: "Assessment failed", description: err.message, variant: "destructive" });
    }
    setAssessing(false);
  };

  const filtered = filterRisk === "all" ? scores : scores.filter(s => s.risk_level === filterRisk);
  const atRiskCount = scores.filter(s => s.risk_level === "high" || s.risk_level === "critical").length;
  const criticalCount = scores.filter(s => s.risk_level === "critical").length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b flex items-center justify-between gap-3 shrink-0 flex-wrap">
        <div className="flex items-center gap-2">
          <HeartHandshake className="h-4 w-4 text-rose-500 shrink-0" />
          <span className="text-sm font-semibold">Staff Burnout Risk Monitor</span>
          <Badge variant="outline" className="text-[10px]">E5 — NABH Excellence</Badge>
          {criticalCount > 0 && (
            <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]">
              <AlertTriangle className="h-3 w-3 mr-1" />{criticalCount} Critical
            </Badge>
          )}
          {atRiskCount > 0 && (
            <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px]">
              {atRiskCount} At Risk
            </Badge>
          )}
          {scores.length > 0 && atRiskCount === 0 && (
            <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px]">
              <CheckCircle2 className="h-3 w-3 mr-1" />All Low Risk
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select value={filterRisk} onChange={e => setFilterRisk(e.target.value)}
            className="h-7 text-xs border border-input rounded px-2 bg-background">
            <option value="all">All Risk Levels</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <Button size="sm" onClick={runAssessment} disabled={assessing} className="h-7 text-xs gap-1.5">
            {assessing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Brain className="h-3 w-3" />}
            {scores.length > 0 ? "Re-assess All Staff" : "Run AI Assessment"}
          </Button>
        </div>
      </div>

      {/* Staff list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Loading…</span>
          </div>
        ) : assessing ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm">Analysing attendance, incident data, and training records for all staff…</p>
            <p className="text-xs">This may take 30–60 seconds for large teams.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center space-y-3">
            <HeartHandshake className="h-10 w-10 text-muted-foreground/30 mx-auto" />
            <p className="text-sm text-muted-foreground">
              {scores.length === 0
                ? "No burnout assessment run yet. Click 'Run AI Assessment' to analyse all active staff."
                : "No staff match the current filter."}
            </p>
            {scores.length === 0 && (
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                The AI will analyse attendance patterns, incident involvement, and training compliance
                for each staff member and generate personalised risk scores and recommendations.
              </p>
            )}
          </div>
        ) : filtered.map(s => {
          const cfg = RISK_CONFIG[s.risk_level] || RISK_CONFIG.low;
          const isOpen = expanded === s.id;
          const factors = s.risk_factors || [];
          return (
            <div key={s.id} className={cn("border rounded-xl overflow-hidden", cfg.border)}>
              <div
                className={cn("px-3 py-2.5 flex items-center gap-3 cursor-pointer hover:opacity-90 transition-opacity", cfg.bg, "dark:bg-opacity-20")}
                onClick={() => setExpanded(isOpen ? null : s.id)}
              >
                {/* Risk bar */}
                <div className="w-10 shrink-0 space-y-1 text-center">
                  <p className={cn("text-lg font-black leading-none", cfg.text)}>{s.burnout_score}</p>
                  <div className="h-1 bg-white/50 rounded-full overflow-hidden">
                    <div className={cn("h-full rounded-full", cfg.bar)} style={{ width: `${s.burnout_score}%` }} />
                  </div>
                  <p className="text-[9px] text-muted-foreground">/ 100</p>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{s.staff_name || "Unknown"}</span>
                    {s.staff_role && <span className="text-[10px] text-muted-foreground bg-white/50 px-1.5 py-px rounded">{s.staff_role.replace(/_/g, " ")}</span>}
                    <Badge className={cn("text-[10px] px-1.5 py-0 font-bold", cfg.bg, cfg.text, "border", cfg.border)}>
                      {cfg.label} Risk
                    </Badge>
                  </div>
                  {/* Component bars */}
                  <div className="flex items-center gap-4 mt-1.5">
                    {[
                      { label: "Attendance", val: s.attendance_score },
                      { label: "Incidents",  val: s.incident_score },
                      { label: "Training",   val: s.training_score },
                    ].map(c => c.val != null && (
                      <div key={c.label} className="text-center">
                        <p className="text-[9px] text-muted-foreground">{c.label}</p>
                        <p className={cn("text-[11px] font-semibold", c.val >= 60 ? cfg.text : "text-muted-foreground")}>{c.val}</p>
                      </div>
                    ))}
                  </div>
                </div>
                {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
              </div>

              {isOpen && (factors.length > 0 || s.recommendations) && (
                <div className="border-t border-border px-4 py-3 bg-card space-y-2">
                  {factors.length > 0 && (
                    <div>
                      <p className="text-[11px] font-semibold text-foreground mb-1">Risk Factors</p>
                      <ul className="space-y-0.5">
                        {factors.map((f, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                            <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />{f}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {s.recommendations && (
                    <div className="border border-emerald-200 bg-emerald-50/40 dark:bg-emerald-950/20 rounded-lg px-3 py-2">
                      <p className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-300 mb-1">
                        <Brain className="h-3 w-3 inline mr-1" />AI Recommendations for Manager
                      </p>
                      <p className="text-[11px] text-emerald-700 dark:text-emerald-400">{s.recommendations}</p>
                    </div>
                  )}
                  <p className="text-[10px] text-muted-foreground">
                    Score assessed {format(new Date(s.score_date), "dd MMM yyyy")} · Confidential — HR Manager only
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default BurnoutRiskTab;
