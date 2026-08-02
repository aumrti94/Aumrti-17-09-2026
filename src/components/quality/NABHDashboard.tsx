import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Sparkles, Loader2 } from "lucide-react";
import { callAI } from "@/lib/aiProvider";
import { useAIFeature } from "@/hooks/useAIFeature";
import { useHospitalId } from "@/hooks/useHospitalId";

interface Criterion {
  id: string;
  chapter_code: string;
  chapter_name: string;
  criterion_number: string;
  criterion_text: string;
  compliance_status: string;
  compliance_score: number;
  auto_collected: boolean;
  last_assessed: string | null;
}

interface AuditRecord {
  id: string;
  audit_title: string;
  audit_type: string;
  scheduled_date: string;
  chapters_covered: string[];
  status: string;
}

const scoreColor = (pct: number) => {
  if (pct < 50) return "hsl(var(--destructive))";
  if (pct < 75) return "hsl(38, 92%, 50%)";
  if (pct < 90) return "hsl(80, 60%, 45%)";
  return "hsl(142, 71%, 45%)";
};

// Criterion scoring and banding now live in SQL (public.qi_attainment /
// public.qi_band_status) so the dashboard and the stored compliance_status
// cannot drift apart. src/lib/qualityIndicators.ts mirrors them for the UI.

const statusBadge = (status: string) => {
  switch (status) {
    case "compliant": return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
    case "partially_compliant": return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
    case "non_compliant": return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
    default: return "bg-muted text-muted-foreground";
  }
};

const NABHDashboard: React.FC = () => {
  const __aiOn = useAIFeature("nabh_criteria_mapper");
  const { toast } = useToast();
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [audits, setAudits] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [collecting, setCollecting] = useState(false);
  const [aiMapping, setAiMapping] = useState(false);
  const [aiMappingResult, setAiMappingResult] = useState<string | null>(null);
  const [selectedChapter, setSelectedChapter] = useState<string | null>(null);
  const [raisingCapaFor, setRaisingCapaFor] = useState<string | null>(null);
  const { hospitalId } = useHospitalId();

  useEffect(() => {
    if (hospitalId) loadData();
  }, [hospitalId]);

  const loadData = async () => {
    const [criteriaRes, auditsRes] = await Promise.all([
      supabase.from("nabh_criteria").select("*").eq("hospital_id", hospitalId).order("chapter_code"),
      supabase.from("audit_records").select("*").eq("hospital_id", hospitalId).eq("status", "scheduled").order("scheduled_date").limit(3),
    ]);
    setCriteria((criteriaRes.data as any) || []);
    setAudits((auditsRes.data as any) || []);
    setLoading(false);
  };

  // Chapter aggregation
  const chapters = criteria.reduce<Record<string, { code: string; name: string; scores: number[]; count: number }>>((acc, c) => {
    if (!acc[c.chapter_code]) acc[c.chapter_code] = { code: c.chapter_code, name: c.chapter_name, scores: [], count: 0 };
    acc[c.chapter_code].scores.push(c.compliance_score);
    acc[c.chapter_code].count++;
    return acc;
  }, {});

  const chapterList = Object.values(chapters)
    .map((ch) => ({
      ...ch,
      avg: ch.scores.length ? Math.round(ch.scores.reduce((a, b) => a + b, 0) / ch.scores.length) : 0,
    }))
    .sort((a, b) => a.avg - b.avg);

  const overallScore = criteria.length
    ? Math.round(criteria.reduce((sum, c) => sum + c.compliance_score, 0) / criteria.length)
    : 0;

  const nonCompliant = criteria.filter((c) => c.compliance_status === "non_compliant");

  // Selected chapter criteria
  const selectedCriteria = selectedChapter
    ? criteria.filter((c) => c.chapter_code === selectedChapter)
    : [];
  const selectedChapterInfo = selectedChapter ? chapters[selectedChapter] : null;

  // There is no score-history table, so there is no honest trend to draw here.
  // What the data does support is assessment coverage — how much of the standard
  // has actually been looked at, which is the question before an accreditation
  // visit. Buckets are mutually exclusive: compliance_status is a single enum.
  const coverage = [
    { label: "Compliant",     count: criteria.filter((c) => c.compliance_status === "compliant").length,           color: "hsl(142, 71%, 45%)" },
    { label: "Partial",       count: criteria.filter((c) => c.compliance_status === "partially_compliant").length, color: "hsl(38, 92%, 50%)" },
    { label: "Non-compliant", count: nonCompliant.length,                                                          color: "hsl(var(--destructive))" },
    { label: "Not assessed",  count: criteria.filter((c) => c.compliance_status === "not_assessed").length,        color: "hsl(var(--muted-foreground))" },
  ];

  // Live counts, not hardcoded labels. The previous version rendered four fixed
  // strings with green ticks — two of them (COP.2, MOM.3) had no collector behind
  // them at all, so they claimed evidence that was never gathered.
  const autoScored = criteria.filter((c) => c.auto_collected);
  const autoByChapter = Object.entries(
    autoScored.reduce<Record<string, number>>((acc, c) => {
      acc[c.chapter_code] = (acc[c.chapter_code] || 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);

  // Runs the whole indicator engine, then scores every criterion that has a
  // mapped indicator. Criteria with no indicator stay not_assessed by design.
  const runAutoCollection = async () => {
    if (!hospitalId) return;
    setCollecting(true);
    try {
      const periodStart = new Date();
      periodStart.setDate(1);
      const { data, error } = await (supabase as any).rpc("run_quality_indicator_collection", {
        p_hospital_id: hospitalId,
        p_period_start: periodStart.toISOString().slice(0, 10),
      });
      if (error) throw error;

      toast({
        title: "Auto-collection complete",
        description: `${data ?? 0} indicators collected from source modules; criteria rescored`,
      });
      loadData();
    } catch (e: any) {
      toast({
        title: "Error during auto-collection",
        description: e?.message,
        variant: "destructive",
      });
    } finally {
      setCollecting(false);
    }
  };

  const raiseCAPA = async (criterion: Criterion) => {
    if (!hospitalId) return;
    setRaisingCapaFor(criterion.id);
    try {
      const { error } = await (supabase as any).from("capa_records").insert({
        hospital_id: hospitalId,
        capa_number: `CAPA-${Date.now().toString(36).toUpperCase()}`,
        trigger_type: "nabh_gap",
        trigger_ref_id: criterion.id,
        problem_statement: `${criterion.criterion_number} — ${criterion.criterion_text}`,
        status: "open",
        due_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      });
      if (error) throw error;
      toast({
        title: "CAPA raised",
        description: `Tracking ${criterion.criterion_number} in the CAPA tab`,
      });
    } catch (e: any) {
      toast({ title: "Could not raise CAPA", description: e?.message, variant: "destructive" });
    } finally {
      setRaisingCapaFor(null);
    }
  };

  const runAIMapping = async () => {
    setAiMapping(true);
    setAiMappingResult(null);
    try {
      // Gather clinical metrics from the system
      const today = new Date().toISOString().split("T")[0];
      const [
        { count: totalPatients },
        { count: admittedCount },
        { count: labOrdersToday },
        { count: incidentCount },
        { count: capaOpen },
        { data: tatRows },
      ] = await Promise.all([
        supabase.from("patients").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId),
        supabase.from("admissions").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId).eq("status", "active"),
        supabase.from("lab_orders").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId).eq("order_date", today),
        (supabase as any).from("incident_reports").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId).eq("status", "open"),
        // capa_actions does not exist; the real table is capa_records.
        (supabase as any).from("capa_records").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId).eq("status", "open"),
        // Read the measured TAT instead of inventing one. The old version queried
        // lab_orders.updated_at (a column that does not exist) and then fed the
        // model the literal string "within acceptable range" regardless.
        (supabase as any)
          .from("quality_indicators_current")
          .select("value, unit")
          .eq("hospital_id", hospitalId)
          .eq("indicator_code", "cop.lab_tat_avg_hrs")
          .maybeSingle(),
      ]);

      const avgTAT =
        tatRows?.value != null ? `${Number(tatRows.value).toFixed(1)} hours average` : "not yet measured";
      const nonCompliantCount = criteria.filter((c) => c.compliance_status === "non_compliant").length;
      const partialCount = criteria.filter((c) => c.compliance_status === "partially_compliant").length;

      const response = await callAI({
        featureKey: "nabh_criteria_mapper",
        hospitalId: hospitalId || "",
        prompt: `You are a NABH accreditation expert for Indian hospitals. Analyse the following system metrics and map them to NABH 5th Edition criteria compliance evidence.

System Metrics:
- Total registered patients: ${totalPatients || 0}
- Currently admitted patients: ${admittedCount || 0}
- Lab orders today: ${labOrdersToday || 0}
- Open incident reports: ${incidentCount || 0}
- Open CAPA actions: ${capaOpen || 0}
- Lab TAT status: ${avgTAT}
- Non-compliant criteria: ${nonCompliantCount}
- Partially compliant criteria: ${partialCount}

Current overall NABH compliance score: ${overallScore}%

Based on these metrics, identify which NABH criteria chapters are showing evidence of compliance or non-compliance. Use chapter codes: AAC (Access, Assessment & Continuity), COP (Care of Patients), MOM (Management of Medication), PRE (Patient Rights & Education), HIC (Hospital Infection Control), TRM (Training & Education), MRD (Medical Records), QPS (Quality & Patient Safety), FMS (Facility Management).

Return a brief assessment (max 150 words) covering:
1. Strongest compliance areas based on the data
2. Areas needing immediate attention
3. Specific corrective action for the weakest chapter
4. Expected timeline to reach 85% overall score`,
        maxTokens: 400,
      });

      if (response.text) {
        setAiMappingResult(response.text);
        toast({ title: "AI NABH mapping complete" });
      }
    } catch (e: any) {
      toast({ title: "AI mapping failed", description: e?.message, variant: "destructive" });
    } finally {
      setAiMapping(false);
    }
  };

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Loading NABH data…</div>;
  }

  const donutData = [
    { name: "Score", value: overallScore },
    { name: "Remaining", value: 100 - overallScore },
  ];

  return (
    <div className="flex-1 grid grid-cols-3 gap-0 overflow-hidden">
      {/* LEFT: Donut + Chapter Progress */}
      <div className="border-r border-border p-4 flex flex-col overflow-y-auto">
        <div className="flex items-center justify-center mb-4">
          <div className="relative w-[160px] h-[160px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={donutData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={75}
                  startAngle={90}
                  endAngle={-270}
                  dataKey="value"
                  stroke="none"
                >
                  <Cell fill={scoreColor(overallScore)} />
                  <Cell fill="hsl(var(--muted))" />
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold text-foreground">{overallScore}%</span>
              <span className="text-[10px] text-muted-foreground">NABH Compliance</span>
            </div>
          </div>
        </div>

        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Chapter Progress</p>
        <div className="space-y-2">
          {chapterList.map((ch) => (
            <button
              key={ch.code}
              type="button"
              onClick={() => setSelectedChapter(selectedChapter === ch.code ? null : ch.code)}
              className={cn(
                "w-full text-left rounded-lg p-2 transition-all",
                selectedChapter === ch.code
                  ? "bg-primary/10 ring-1 ring-primary"
                  : "hover:bg-muted/50"
              )}
            >
              <div className="flex items-center justify-between text-xs mb-0.5">
                <span className="font-medium text-foreground truncate">{ch.code} — {ch.name}</span>
                <span className="font-semibold ml-2" style={{ color: scoreColor(ch.avg) }}>{ch.avg}%</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${ch.avg}%`, backgroundColor: scoreColor(ch.avg) }}
                />
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* CENTER: Trend + Auto Evidence OR Chapter Detail */}
      <div className="border-r border-border p-4 flex flex-col overflow-y-auto">
        {selectedChapter && selectedChapterInfo ? (
          <>
            <div className="flex items-center gap-2 mb-3">
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setSelectedChapter(null)}>
                <ArrowLeft className="h-3.5 w-3.5" />
              </Button>
              <div>
                <p className="text-sm font-semibold text-foreground">{selectedChapterInfo.code} — {selectedChapterInfo.name}</p>
                <p className="text-[10px] text-muted-foreground">{selectedCriteria.length} criteria</p>
              </div>
            </div>
            <div className="space-y-2">
              {selectedCriteria.map((c) => (
                <div key={c.id} className="border border-border rounded-lg p-3">
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <span className="text-xs font-semibold text-foreground">{c.criterion_number}</span>
                    <Badge variant="secondary" className={cn("text-[9px] shrink-0", statusBadge(c.compliance_status))}>
                      {c.compliance_status.replace("_", " ")}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">{c.criterion_text}</p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${c.compliance_score}%`, backgroundColor: scoreColor(c.compliance_score) }}
                      />
                    </div>
                    <span className="text-[10px] font-semibold" style={{ color: scoreColor(c.compliance_score) }}>
                      {c.compliance_score}%
                    </span>
                  </div>
                  {c.last_assessed && (
                    <p className="text-[9px] text-muted-foreground mt-1">
                      Last assessed: {new Date(c.last_assessed).toLocaleDateString()}
                      {c.auto_collected && " (auto)"}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Assessment Coverage</p>
            <div className="mb-4">
              <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
                {coverage.map((b) => (
                  b.count > 0 && (
                    <div
                      key={b.label}
                      className="h-full"
                      style={{ width: `${(b.count / criteria.length) * 100}%`, backgroundColor: b.color }}
                      title={`${b.label}: ${b.count}`}
                    />
                  )
                ))}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                {coverage.map((b) => (
                  <div key={b.label} className="flex items-center gap-1.5 text-[10px]">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: b.color }} />
                    <span className="text-muted-foreground">{b.label}</span>
                    <span className="ml-auto font-semibold text-foreground">{b.count}</span>
                  </div>
                ))}
              </div>
            </div>

            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Auto-Evidence Collected</p>
            <p className="text-[11px] text-muted-foreground mb-2">
              <span className="font-semibold text-foreground">{autoScored.length}</span> of {criteria.length} criteria
              auto-scored from quality indicators; {criteria.length - autoScored.length} require manual assessment.
            </p>
            <div className="space-y-1.5 mb-4">
              {autoByChapter.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nothing auto-scored yet — run auto-collection to score criteria from module data.
                </p>
              ) : (
                autoByChapter.map(([code, count]) => (
                  <div key={code} className="flex items-center gap-2 text-xs">
                    <span className="text-green-500">✓</span>
                    <span className="text-foreground font-medium">{code}</span>
                    <span className="text-muted-foreground">
                      — {count} criteri{count === 1 ? "on" : "a"} scored from module data
                    </span>
                  </div>
                ))
              )}
            </div>

            <Button size="sm" variant="outline" onClick={runAutoCollection} disabled={collecting} className="w-full">
              {collecting ? "Running…" : "Run Full Auto-Collection"}
            </Button>
          </>
        )}
      </div>

      {/* RIGHT: Critical Gaps + Upcoming Audits */}
      <div className="p-4 flex flex-col overflow-y-auto">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">🔴 Critical Gaps</p>
        {nonCompliant.length === 0 ? (
          <div className="bg-green-50 dark:bg-green-950/20 rounded-lg p-3 mb-4 text-xs text-green-700 dark:text-green-400">
            ✓ No critical gaps — great work!
          </div>
        ) : (
          <div className="space-y-2 mb-4">
            {nonCompliant.slice(0, 5).map((c) => (
              <div key={c.id} className="bg-destructive/5 rounded-lg p-2.5 text-xs">
                <div className="font-medium text-foreground">{c.criterion_number}</div>
                <p className="text-muted-foreground line-clamp-2 mt-0.5">{c.criterion_text}</p>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-[10px] mt-1 text-destructive hover:text-destructive"
                  disabled={raisingCapaFor === c.id}
                  onClick={() => raiseCAPA(c)}
                >
                  {raisingCapaFor === c.id ? "Raising…" : "Raise CAPA"}
                </Button>
              </div>
            ))}
          </div>
        )}

        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Upcoming Audits</p>
        {audits.length === 0 ? (
          <p className="text-xs text-muted-foreground">No upcoming audits scheduled</p>
        ) : (
          <div className="space-y-2">
            {audits.map((a) => (
              <div key={a.id} className="border border-border rounded-lg p-2.5 text-xs">
                <div className="font-medium text-foreground">{a.audit_title}</div>
                <div className="flex items-center gap-2 mt-1 text-muted-foreground">
                  <span>{new Date(a.scheduled_date).toLocaleDateString()}</span>
                  <span className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-medium">{a.audit_type}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 pt-4 border-t border-border">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            <Sparkles size={11} className="inline mr-1 text-primary" />
            AI NABH Criteria Mapper
          </p>
          <p className="text-[10px] text-muted-foreground mb-2">Analyses system data and maps it to NABH 5th Edition criteria chapters.</p>
          <Button hidden={!__aiOn} size="sm" variant="outline" onClick={runAIMapping} disabled={aiMapping} className="w-full text-xs gap-1.5 mb-2">
            {aiMapping ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} className="text-primary" />}
            {aiMapping ? "Mapping criteria..." : "Run AI Criteria Mapping"}
          </Button>
          {aiMappingResult && (
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 text-xs text-foreground leading-relaxed">
              <p className="font-semibold text-primary flex items-center gap-1 mb-1.5"><Sparkles size={10} /> AI Assessment</p>
              <p className="whitespace-pre-line">{aiMappingResult}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default NABHDashboard;
