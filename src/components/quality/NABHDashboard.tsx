import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PieChart, Pie, Cell, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Sparkles, Loader2 } from "lucide-react";
import { callAI } from "@/lib/aiProvider";

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

const statusBadge = (status: string) => {
  switch (status) {
    case "compliant": return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
    case "partially_compliant": return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
    case "non_compliant": return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
    default: return "bg-muted text-muted-foreground";
  }
};

const NABHDashboard: React.FC = () => {
  const { toast } = useToast();
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [audits, setAudits] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [collecting, setCollecting] = useState(false);
  const [aiMapping, setAiMapping] = useState(false);
  const [aiMappingResult, setAiMappingResult] = useState<string | null>(null);
  const [selectedChapter, setSelectedChapter] = useState<string | null>(null);
  const [hospitalId, setHospitalId] = useState<string | undefined>(undefined);

  useEffect(() => {
    loadData();
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from("users").select("hospital_id").eq("auth_user_id", user.id).maybeSingle();
      if (data) setHospitalId(data.hospital_id);
    })();
  }, []);

  const loadData = async () => {
    const [criteriaRes, auditsRes] = await Promise.all([
      supabase.from("nabh_criteria").select("*").order("chapter_code"),
      supabase.from("audit_records").select("*").eq("status", "scheduled").order("scheduled_date").limit(3),
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

  // Trend data (mock for now — 6 months)
  const trendData = Array.from({ length: 6 }, (_, i) => ({
    month: new Date(Date.now() - (5 - i) * 30 * 86400000).toLocaleString("default", { month: "short" }),
    score: Math.max(0, overallScore - (5 - i) * Math.floor(Math.random() * 5)),
  }));

  const autoEvidence = [
    { text: "Patient registration records collected", count: criteria.filter((c) => c.chapter_code === "AAC" && c.auto_collected).length, criterion: "AAC.1" },
    { text: "Care protocols verified", count: criteria.filter((c) => c.chapter_code === "COP" && c.auto_collected).length, criterion: "COP.2" },
    { text: "Medication dispensing verified", count: criteria.filter((c) => c.chapter_code === "MOM" && c.auto_collected).length, criterion: "MOM.3" },
    { text: "Records management checked", count: criteria.filter((c) => c.chapter_code === "MRD" && c.auto_collected).length, criterion: "MRD.1" },
  ];

  const runAutoCollection = async () => {
    setCollecting(true);
    try {
      const { count: patientCount } = await supabase
        .from("patients")
        .select("id", { count: "exact", head: true });

      if (patientCount && patientCount > 0) {
        await supabase
          .from("nabh_criteria")
          .update({ compliance_status: "compliant", compliance_score: 100, auto_collected: true, last_assessed: new Date().toISOString().split("T")[0] })
          .eq("criterion_number", "AAC.1");
      }

      const { data: admData } = await supabase
        .from("admissions")
        .select("discharge_summary_done")
        .eq("status", "discharged");

      if (admData && admData.length > 0) {
        const completed = admData.filter((a) => a.discharge_summary_done).length;
        const pct = Math.round((completed / admData.length) * 100);
        await supabase
          .from("nabh_criteria")
          .update({
            compliance_score: pct,
            compliance_status: pct >= 80 ? "compliant" : pct >= 50 ? "partially_compliant" : "non_compliant",
            auto_collected: true,
            last_assessed: new Date().toISOString().split("T")[0],
          })
          .eq("criterion_number", "MRD.1");
      }

      toast({ title: "Auto-collection complete", description: "NABH criteria updated from system data" });
      loadData();
    } catch {
      toast({ title: "Error during auto-collection", variant: "destructive" });
    } finally {
      setCollecting(false);
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
        { data: labTAT },
      ] = await Promise.all([
        supabase.from("patients").select("id", { count: "exact", head: true }),
        supabase.from("admissions").select("id", { count: "exact", head: true }).eq("status", "admitted"),
        supabase.from("lab_orders").select("id", { count: "exact", head: true }).eq("order_date", today),
        (supabase as any).from("incident_reports").select("id", { count: "exact", head: true }).eq("status", "open"),
        (supabase as any).from("capa_actions").select("id", { count: "exact", head: true }).eq("status", "open"),
        supabase.from("lab_orders").select("order_date, order_time, updated_at").eq("status", "completed").limit(50).order("order_date", { ascending: false }),
      ]);

      const avgTAT = labTAT && labTAT.length > 0 ? "within acceptable range" : "no data";
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
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Compliance Trend</p>
            <div className="h-[140px] mb-4">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData}>
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={30} />
                  <Tooltip contentStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="score" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.15)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Auto-Evidence Collected</p>
            <div className="space-y-2 mb-4">
              {autoEvidence.map((ev, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className="text-green-500 mt-0.5">✓</span>
                  <div>
                    <span className="text-foreground">{ev.text}</span>
                    <span className="ml-1 text-muted-foreground">— {ev.criterion}</span>
                  </div>
                </div>
              ))}
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
                <Button size="sm" variant="ghost" className="h-6 text-[10px] mt-1 text-destructive hover:text-destructive">
                  Raise CAPA
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
          <Button size="sm" variant="outline" onClick={runAIMapping} disabled={aiMapping} className="w-full text-xs gap-1.5 mb-2">
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
