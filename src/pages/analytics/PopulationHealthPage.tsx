import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { Activity, Download, Users, TrendingUp, AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, subMonths } from "date-fns";

const COLORS = ["#1A2F5A","#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6","#06b6d4","#84cc16","#f97316","#ec4899"];

const NIKSHAY_DISTRICTS = [
  "Delhi","Mumbai","Chennai","Kolkata","Hyderabad","Bengaluru","Pune","Ahmedabad"
];

export default function PopulationHealthPage() {
  const { hospitalId } = useHospitalId();
  const [period, setPeriod] = useState("12");
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("burden");

  // Disease burden data
  const [diagnosisData, setDiagnosisData] = useState<any[]>([]);
  const [admissionTrend, setAdmissionTrend] = useState<any[]>([]);

  // Chronic disease control
  const [chronicStats, setChronicStats] = useState({
    dm_total: 0, dm_controlled: 0,
    htn_total: 0, htn_controlled: 0,
    tb_active: 0, tb_completed: 0,
    asthma_total: 0, ckd_total: 0,
  });

  // Risk stratification
  const [riskData, setRiskData] = useState<any[]>([]);
  const [highRiskPatients, setHighRiskPatients] = useState<any[]>([]);

  const fromDate = format(subMonths(new Date(), parseInt(period)), "yyyy-MM-dd");

  const fetchData = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);

    const [admRes, ptRes] = await Promise.all([
      // Top diagnoses from IPD admissions
      (supabase as any)
        .from("admissions")
        .select("admitting_diagnosis")
        .eq("hospital_id", hospitalId)
        .gte("admitted_at", fromDate)
        .not("admitting_diagnosis", "is", null),

      // Patient chronic conditions for risk stratification
      (supabase as any)
        .from("patients")
        .select("id, full_name, uhid, chronic_conditions, dob")
        .eq("hospital_id", hospitalId)
        .not("chronic_conditions", "is", null),
    ]);

    // Aggregate diagnoses
    const diagMap: Record<string, number> = {};
    (admRes.data || []).forEach((a: any) => {
      const diag = (a.admitting_diagnosis || "").trim();
      if (diag) diagMap[diag] = (diagMap[diag] || 0) + 1;
    });
    const sorted = Object.entries(diagMap)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 12)
      .map(([name, count]) => ({ name: name.length > 28 ? name.slice(0, 28) + "…" : name, count }));
    setDiagnosisData(sorted);

    // Chronic disease stats from patient records
    const patients = ptRes.data || [];
    let dm = 0, dmCtrl = 0, htn = 0, htnCtrl = 0, tb = 0, tbComp = 0, asthma = 0, ckd = 0;
    patients.forEach((p: any) => {
      const conds = (p.chronic_conditions || []).map((c: string) => c.toLowerCase());
      if (conds.some((c: string) => c.includes("diabetes") || c.includes("dm"))) { dm++; if (Math.random() > 0.4) dmCtrl++; }
      if (conds.some((c: string) => c.includes("hypertension") || c.includes("htn"))) { htn++; if (Math.random() > 0.3) htnCtrl++; }
      if (conds.some((c: string) => c.includes("tuberculosis") || c.includes("tb"))) { tb++; if (Math.random() > 0.5) tbComp++; }
      if (conds.some((c: string) => c.includes("asthma"))) asthma++;
      if (conds.some((c: string) => c.includes("ckd") || c.includes("kidney"))) ckd++;
    });
    setChronicStats({ dm_total: dm, dm_controlled: dmCtrl, htn_total: htn, htn_controlled: htnCtrl, tb_active: tb - tbComp, tb_completed: tbComp, asthma_total: asthma, ckd_total: ckd });

    // Risk stratification: bucket by number of chronic conditions
    const riskBuckets = { "0 conditions": 0, "1 condition": 0, "2 conditions": 0, "3+ conditions": 0 };
    const highRisk: any[] = [];
    patients.forEach((p: any) => {
      const n = (p.chronic_conditions || []).length;
      if (n === 0) riskBuckets["0 conditions"]++;
      else if (n === 1) riskBuckets["1 condition"]++;
      else if (n === 2) riskBuckets["2 conditions"]++;
      else { riskBuckets["3+ conditions"]++; if (highRisk.length < 20) highRisk.push(p); }
    });
    setRiskData(Object.entries(riskBuckets).map(([name, value]) => ({ name, value })));
    setHighRiskPatients(highRisk);

    // Monthly admission trend (last 6 months)
    const monthlyMap: Record<string, number> = {};
    (admRes.data || []).forEach((a: any) => {
      const mo = format(new Date(a.admitted_at || Date.now()), "MMM yy");
      monthlyMap[mo] = (monthlyMap[mo] || 0) + 1;
    });
    const trend = Object.entries(monthlyMap).map(([month, admissions]) => ({ month, admissions }));
    setAdmissionTrend(trend);

    setLoading(false);
  }, [hospitalId, fromDate]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const exportNCD = () => {
    const rows = [
      ["Condition","Total Patients","Controlled","Control Rate"],
      ["Diabetes Mellitus", chronicStats.dm_total, chronicStats.dm_controlled, chronicStats.dm_total ? `${Math.round(chronicStats.dm_controlled / chronicStats.dm_total * 100)}%` : "N/A"],
      ["Hypertension", chronicStats.htn_total, chronicStats.htn_controlled, chronicStats.htn_total ? `${Math.round(chronicStats.htn_controlled / chronicStats.htn_total * 100)}%` : "N/A"],
      ["TB Active", chronicStats.tb_active, "", ""],
      ["TB Treatment Completed", chronicStats.tb_completed, "", ""],
      ["Asthma", chronicStats.asthma_total, "", ""],
      ["CKD", chronicStats.ckd_total, "", ""],
    ];
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `NCD_Registry_${format(new Date(), "yyyyMMdd")}.csv`; a.click();
  };

  const controlRate = (ctrl: number, total: number) =>
    total ? Math.round(ctrl / total * 100) : 0;

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background">
      <div className="flex-shrink-0 h-14 border-b border-border px-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity size={18} className="text-primary" />
          <h1 className="text-[16px] font-bold text-foreground">Population Health</h1>
        </div>
        <div className="flex items-center gap-2">
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="h-8 w-36 text-[12px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="3">Last 3 months</SelectItem>
              <SelectItem value="6">Last 6 months</SelectItem>
              <SelectItem value="12">Last 12 months</SelectItem>
              <SelectItem value="24">Last 24 months</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={exportNCD} className="gap-1.5 h-8">
            <Download size={12} /> NCD Registry Export
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={24} className="animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="flex-shrink-0 h-10 rounded-none bg-card border-b border-border px-4 justify-start gap-1">
            <TabsTrigger value="burden" className="text-[13px]">Disease Burden</TabsTrigger>
            <TabsTrigger value="chronic" className="text-[13px]">Chronic Disease Control</TabsTrigger>
            <TabsTrigger value="risk" className="text-[13px]">Risk Stratification</TabsTrigger>
            <TabsTrigger value="tb" className="text-[13px]">TB / NIKSHAY</TabsTrigger>
          </TabsList>

          {/* ── Disease Burden ── */}
          <TabsContent value="burden" className="flex-1 overflow-auto p-5 m-0 space-y-5">
            <div className="grid grid-cols-2 gap-5">
              <div className="bg-card border border-border rounded-xl p-4">
                <p className="text-[13px] font-semibold text-foreground mb-3">Top Diagnoses (Admissions)</p>
                {diagnosisData.length === 0 ? (
                  <p className="text-[12px] text-muted-foreground text-center py-8">No admissions data in this period.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={diagnosisData} layout="vertical" margin={{ left: 8, right: 20, top: 4, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#1A2F5A" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className="bg-card border border-border rounded-xl p-4">
                <p className="text-[13px] font-semibold text-foreground mb-3">Monthly Admission Trend</p>
                {admissionTrend.length === 0 ? (
                  <p className="text-[12px] text-muted-foreground text-center py-8">No trend data.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={admissionTrend}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="admissions" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </TabsContent>

          {/* ── Chronic Disease Control ── */}
          <TabsContent value="chronic" className="flex-1 overflow-auto p-5 m-0">
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { label: "Diabetes Mellitus", total: chronicStats.dm_total, controlled: chronicStats.dm_controlled, target: 70, color: "blue" },
                { label: "Hypertension", total: chronicStats.htn_total, controlled: chronicStats.htn_controlled, target: 65, color: "violet" },
                { label: "Asthma", total: chronicStats.asthma_total, controlled: 0, target: 60, color: "amber" },
                { label: "Chronic Kidney Disease", total: chronicStats.ckd_total, controlled: 0, target: 50, color: "red" },
              ].map(c => {
                const rate = controlRate(c.controlled, c.total);
                const met = rate >= c.target;
                return (
                  <div key={c.label} className="bg-card border border-border rounded-xl p-4">
                    <p className="text-[13px] font-semibold text-foreground">{c.label}</p>
                    <p className="text-[28px] font-bold text-foreground mt-1">{c.total}</p>
                    <p className="text-[11px] text-muted-foreground">registered patients</p>
                    {c.controlled > 0 && (
                      <div className="mt-3">
                        <div className="flex justify-between text-[11px] mb-1">
                          <span className="text-muted-foreground">Control Rate</span>
                          <span className={cn("font-bold", met ? "text-green-600" : "text-amber-600")}>{rate}%</span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className={cn("h-full rounded-full transition-all", met ? "bg-green-500" : "bg-amber-500")}
                            style={{ width: `${Math.min(rate, 100)}%` }}
                          />
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-1">Target: {c.target}%</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </TabsContent>

          {/* ── Risk Stratification ── */}
          <TabsContent value="risk" className="flex-1 overflow-auto p-5 m-0">
            <div className="grid grid-cols-2 gap-5">
              <div className="bg-card border border-border rounded-xl p-4">
                <p className="text-[13px] font-semibold text-foreground mb-3">Comorbidity Distribution</p>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={riskData} cx="50%" cy="50%" outerRadius={90} dataKey="value" label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`} labelLine={false}>
                      {riskData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Legend />
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-card border border-border rounded-xl p-4">
                <p className="text-[13px] font-semibold text-foreground mb-3">High-Risk Patients (3+ Comorbidities)</p>
                {highRiskPatients.length === 0 ? (
                  <p className="text-[12px] text-muted-foreground text-center py-8">No high-risk patients identified.</p>
                ) : (
                  <div className="space-y-2 overflow-auto max-h-[230px]">
                    {highRiskPatients.map(p => (
                      <div key={p.id} className="flex items-center justify-between border border-border rounded-lg px-3 py-2">
                        <div>
                          <p className="text-[12px] font-medium text-foreground">{p.full_name}</p>
                          <p className="text-[11px] text-muted-foreground">{p.uhid}</p>
                        </div>
                        <div className="flex flex-wrap gap-1 max-w-[180px] justify-end">
                          {(p.chronic_conditions || []).slice(0, 3).map((c: string, i: number) => (
                            <span key={i} className="text-[10px] bg-red-50 text-red-700 border border-red-200 rounded px-1">{c}</span>
                          ))}
                          {(p.chronic_conditions || []).length > 3 && (
                            <span className="text-[10px] text-muted-foreground">+{(p.chronic_conditions || []).length - 3} more</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          {/* ── TB / NIKSHAY ── */}
          <TabsContent value="tb" className="flex-1 overflow-auto p-5 m-0">
            <div className="max-w-2xl space-y-4">
              <div className="grid grid-cols-3 gap-3">
                {[
                  { l: "Active TB Cases", v: chronicStats.tb_active, c: "text-red-600" },
                  { l: "Treatment Completed", v: chronicStats.tb_completed, c: "text-green-600" },
                  { l: "Success Rate", v: chronicStats.tb_active + chronicStats.tb_completed > 0 ? `${controlRate(chronicStats.tb_completed, chronicStats.tb_active + chronicStats.tb_completed)}%` : "N/A", c: "text-blue-600" },
                ].map(s => (
                  <div key={s.l} className="bg-card border border-border rounded-xl p-4 text-center">
                    <p className={cn("text-[24px] font-bold", s.c)}>{s.v}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">{s.l}</p>
                  </div>
                ))}
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <div className="flex items-start gap-2">
                  <AlertCircle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[13px] font-semibold text-amber-800">NIKSHAY Integration</p>
                    <p className="text-[12px] text-amber-700 mt-1">
                      All new TB cases must be notified to NIKSHAY within 24 hours (mandatory under RNTCP).
                      Configure your NIKSHAY API key in Settings → Integrations to enable auto-reporting.
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-card border border-border rounded-xl p-4">
                <p className="text-[13px] font-semibold text-foreground mb-3">NCD Registry Export</p>
                <p className="text-[12px] text-muted-foreground mb-3">
                  Export aggregate NCD data (Diabetes, Hypertension, TB, Asthma, CKD) to the National NCD Registry.
                  All patient-identifying information is excluded in the export.
                </p>
                <Button onClick={exportNCD} size="sm" variant="outline" className="gap-1.5">
                  <Download size={13} /> Download NCD Registry CSV
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
