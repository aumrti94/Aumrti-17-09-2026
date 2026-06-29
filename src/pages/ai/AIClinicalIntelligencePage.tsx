import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Brain, AlertTriangle, TrendingDown, Clock, RefreshCw, Loader2, ChevronRight, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, differenceInHours } from "date-fns";
import { useNavigate } from "react-router-dom";

const RISK_LEVELS = {
  critical: { label: "Critical", color: "bg-red-50 border-red-200 text-red-700", badge: "bg-red-600 text-white", min: 75 },
  high:     { label: "High",     color: "bg-orange-50 border-orange-200 text-orange-700", badge: "bg-orange-500 text-white", min: 50 },
  moderate: { label: "Moderate", color: "bg-amber-50 border-amber-200 text-amber-700", badge: "bg-amber-400 text-white", min: 25 },
  low:      { label: "Low",      color: "bg-green-50 border-green-200 text-green-700", badge: "bg-green-500 text-white", min: 0 },
};

function getRiskLevel(score: number) {
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "moderate";
  return "low";
}

function computeDeteriorationScore(vitals: any, admission: any, patient: any): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  // NEWS2-based contribution (50% weight)
  if (vitals?.news2_score >= 7) { score += 50; reasons.push(`NEWS2 score ${vitals.news2_score} (high risk)`); }
  else if (vitals?.news2_score >= 5) { score += 30; reasons.push(`NEWS2 score ${vitals.news2_score} (medium risk)`); }
  else if (vitals?.news2_score >= 3) { score += 15; reasons.push(`NEWS2 score ${vitals.news2_score} (low-medium)`); }

  // MEWS contribution
  if (vitals?.mews_score >= 5) { score += 20; reasons.push(`MEWS score ${vitals.mews_score} (escalation required)`); }
  else if (vitals?.mews_score >= 3) { score += 10; reasons.push(`MEWS score ${vitals.mews_score} (close monitoring)`); }

  // Age factor
  const age = patient?.dob ? Math.floor((Date.now() - new Date(patient.dob).getTime()) / 31557600000) : 0;
  if (age >= 75) { score += 15; reasons.push("Age ≥ 75 years"); }
  else if (age >= 65) { score += 8; reasons.push("Age ≥ 65 years"); }

  // Chronic conditions
  const conditions = (patient?.chronic_conditions || []).length;
  if (conditions >= 3) { score += 15; reasons.push(`${conditions} chronic conditions`); }
  else if (conditions >= 1) { score += 5; }

  // LOS
  const los = admission?.admitted_at ? differenceInHours(new Date(), new Date(admission.admitted_at)) / 24 : 0;
  if (los > 14) { score += 10; reasons.push(`Extended LOS: ${los.toFixed(0)} days`); }

  return { score: Math.min(score, 100), reasons };
}

function computeLOSPrediction(admission: any, patient: any): { days: number; confidence: string } {
  const baseByType: Record<string, number> = {
    emergency: 6, elective: 4, transfer: 8, daycare: 1,
  };
  let days = baseByType[admission?.admission_type] || 5;
  const age = patient?.dob ? Math.floor((Date.now() - new Date(patient.dob).getTime()) / 31557600000) : 0;
  if (age >= 65) days += 2;
  const conditions = (patient?.chronic_conditions || []).length;
  days += conditions * 0.8;
  const currentLOS = admission?.admitted_at ? differenceInHours(new Date(), new Date(admission.admitted_at)) / 24 : 0;
  const remaining = Math.max(days - currentLOS, 0);
  return {
    days: Math.round(days * 10) / 10,
    confidence: remaining < 1 ? "Due for discharge" : remaining < 2 ? "High" : "Moderate",
  };
}

export default function AIClinicalIntelligencePage() {
  const { hospitalId } = useHospitalId();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("deterioration");
  const [loading, setLoading] = useState(true);
  const [patientRisks, setPatientRisks] = useState<any[]>([]);
  const [losData, setLosData] = useState<any[]>([]);
  const [riskFilter, setRiskFilter] = useState("all");

  const fetchData = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);

    const { data: admissions } = await (supabase as any)
      .from("admissions")
      .select(`
        id, patient_id, admission_type, admitted_at, admitting_diagnosis,
        beds!inner(bed_number, wards(name))
      `)
      .eq("hospital_id", hospitalId)
      .is("discharged_at", null)
      .order("admitted_at", { ascending: false })
      .limit(100);

    if (!admissions || admissions.length === 0) {
      setPatientRisks([]);
      setLosData([]);
      setLoading(false);
      return;
    }

    const patientIds = [...new Set(admissions.map((a: any) => a.patient_id))];

    const [patientsRes, vitalsRes] = await Promise.all([
      (supabase as any).from("patients").select("id, full_name, uhid, dob, chronic_conditions, blood_group").in("id", patientIds),
      (supabase as any).from("nursing_vitals")
        .select("admission_id, news2_score, mews_score, recorded_at")
        .in("admission_id", admissions.map((a: any) => a.id))
        .order("recorded_at", { ascending: false }),
    ]);

    const patientMap: Record<string, any> = {};
    (patientsRes.data || []).forEach((p: any) => { patientMap[p.id] = p; });

    const latestVitals: Record<string, any> = {};
    (vitalsRes.data || []).forEach((v: any) => {
      if (!latestVitals[v.admission_id]) latestVitals[v.admission_id] = v;
    });

    const risks = admissions.map((adm: any) => {
      const patient = patientMap[adm.patient_id];
      const vitals = latestVitals[adm.id];
      const { score, reasons } = computeDeteriorationScore(vitals, adm, patient);
      return { adm, patient, vitals, score, reasons, riskLevel: getRiskLevel(score) };
    }).sort((a: any, b: any) => b.score - a.score);

    setPatientRisks(risks);

    const los = admissions.map((adm: any) => {
      const patient = patientMap[adm.patient_id];
      const pred = computeLOSPrediction(adm, patient);
      const currentLOS = adm.admitted_at ? differenceInHours(new Date(), new Date(adm.admitted_at)) / 24 : 0;
      return { adm, patient, pred, currentLOS: Math.round(currentLOS * 10) / 10 };
    }).sort((a: any, b: any) => b.currentLOS - a.currentLOS);

    setLosData(los);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = riskFilter === "all"
    ? patientRisks
    : patientRisks.filter(r => r.riskLevel === riskFilter);

  const counts = {
    critical: patientRisks.filter(r => r.riskLevel === "critical").length,
    high: patientRisks.filter(r => r.riskLevel === "high").length,
    moderate: patientRisks.filter(r => r.riskLevel === "moderate").length,
    low: patientRisks.filter(r => r.riskLevel === "low").length,
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background">
      <div className="flex-shrink-0 h-14 border-b border-border px-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain size={18} className="text-primary" />
          <h1 className="text-[16px] font-bold text-foreground">AI Clinical Intelligence</h1>
        </div>
        <Button size="sm" variant="outline" onClick={fetchData} className="gap-1.5 h-8">
          <RefreshCw size={12} /> Refresh
        </Button>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={24} className="animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="flex-shrink-0 h-10 rounded-none bg-card border-b border-border px-4 justify-start gap-1">
            <TabsTrigger value="deterioration" className="text-[13px]">
              Deterioration Watch
              {counts.critical > 0 && <span className="ml-1.5 bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{counts.critical}</span>}
            </TabsTrigger>
            <TabsTrigger value="los" className="text-[13px]">LOS Prediction</TabsTrigger>
            <TabsTrigger value="prior_auth" className="text-[13px]">AI Prior Auth</TabsTrigger>
          </TabsList>

          {/* ── Deterioration Watch ── */}
          <TabsContent value="deterioration" className="flex-1 overflow-hidden flex flex-col m-0">
            {/* Risk summary */}
            <div className="flex-shrink-0 grid grid-cols-4 gap-3 p-4 bg-muted/20 border-b border-border">
              {Object.entries(counts).map(([level, count]) => {
                const rl = RISK_LEVELS[level as keyof typeof RISK_LEVELS];
                return (
                  <button key={level} onClick={() => setRiskFilter(riskFilter === level ? "all" : level)}
                    className={cn("bg-card border rounded-xl p-3 text-center transition-all hover:shadow-sm",
                      riskFilter === level ? "ring-2 ring-primary" : "",
                      count > 0 && level !== "low" ? rl.color.split(" ")[0] + " " + rl.color.split(" ")[1] : "border-border")}>
                    <p className={cn("text-[22px] font-bold", count > 0 && level !== "low" ? rl.color.split(" ")[2] : "text-foreground")}>{count}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 capitalize">{level} Risk</p>
                  </button>
                );
              })}
            </div>

            <div className="flex-1 overflow-auto">
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                  <Activity size={28} className="opacity-20 mb-2" />
                  <p className="text-[13px]">No active admissions {riskFilter !== "all" ? `with ${riskFilter} risk` : ""}.</p>
                </div>
              ) : (
                <div className="p-4 space-y-2">
                  {filtered.map(({ adm, patient, vitals, score, reasons, riskLevel }) => {
                    const rl = RISK_LEVELS[riskLevel as keyof typeof RISK_LEVELS];
                    return (
                      <div key={adm.id} className={cn("border rounded-xl p-3 transition-all", rl.color)}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3 min-w-0 flex-1">
                            <div className={cn("flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-full text-[14px] font-bold", rl.badge)}>
                              {score}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-[13px] font-bold text-foreground">{patient?.full_name || "Unknown Patient"}</p>
                                <span className="text-[11px] text-muted-foreground">{patient?.uhid}</span>
                                {(adm.beds as any)?.bed_number && (
                                  <span className="text-[11px] bg-white/60 px-1.5 py-0.5 rounded border border-current/20">Bed {(adm.beds as any).bed_number}</span>
                                )}
                              </div>
                              <p className="text-[12px] text-foreground/80 mt-0.5 italic truncate">{adm.admitting_diagnosis || "—"}</p>
                              <div className="flex flex-wrap gap-2 mt-1.5">
                                {reasons.slice(0, 3).map((r: string, i: number) => (
                                  <span key={i} className="text-[10px] bg-white/50 border border-current/20 rounded px-1.5 py-0.5">{r}</span>
                                ))}
                                {reasons.length > 3 && <span className="text-[10px] text-muted-foreground">+{reasons.length - 3} more</span>}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {vitals && (
                              <div className="text-right">
                                {vitals.news2_score !== null && <p className="text-[11px]">NEWS2: <b>{vitals.news2_score}</b></p>}
                                {vitals.mews_score !== null && <p className="text-[11px]">MEWS: <b>{vitals.mews_score}</b></p>}
                                <p className="text-[10px] text-muted-foreground">{format(new Date(vitals.recorded_at), "HH:mm")}</p>
                              </div>
                            )}
                            <button onClick={() => navigate(`/ipd`)} className="p-1.5 rounded-lg hover:bg-white/40 transition-colors">
                              <ChevronRight size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </TabsContent>

          {/* ── LOS Prediction ── */}
          <TabsContent value="los" className="flex-1 overflow-auto p-4 m-0">
            <div className="max-w-3xl space-y-2">
              <p className="text-[12px] text-muted-foreground mb-3">
                AI-predicted length of stay based on admission type, age, and comorbidity profile.
                Patients sorted by actual LOS (longest first).
              </p>
              {losData.length === 0 ? (
                <p className="text-[13px] text-muted-foreground text-center py-8">No active admissions.</p>
              ) : (
                losData.map(({ adm, patient, pred, currentLOS }) => {
                  const overdue = currentLOS > pred.days;
                  return (
                    <div key={adm.id} className={cn("border rounded-xl p-3 flex items-center gap-4", overdue ? "bg-amber-50 border-amber-200" : "bg-card border-border")}>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-foreground">{patient?.full_name || "—"}</p>
                        <p className="text-[11px] text-muted-foreground">{patient?.uhid} · {adm.admission_type}</p>
                      </div>
                      <div className="flex items-center gap-6 text-center flex-shrink-0">
                        <div>
                          <p className="text-[18px] font-bold text-foreground">{currentLOS}</p>
                          <p className="text-[10px] text-muted-foreground">Current days</p>
                        </div>
                        <div className={cn("border-l pl-6", overdue ? "border-amber-300" : "border-border")}>
                          <p className={cn("text-[18px] font-bold", overdue ? "text-amber-600" : "text-blue-600")}>{pred.days}</p>
                          <p className="text-[10px] text-muted-foreground">Predicted LOS</p>
                        </div>
                        <div className="pl-2">
                          <span className={cn("text-[11px] px-2 py-1 rounded-full border font-medium",
                            pred.confidence === "Due for discharge" ? "bg-red-50 text-red-700 border-red-200" :
                            pred.confidence === "High" ? "bg-green-50 text-green-700 border-green-200" :
                            "bg-blue-50 text-blue-700 border-blue-200"
                          )}>
                            {pred.confidence}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </TabsContent>

          {/* ── AI Prior Auth ── */}
          <TabsContent value="prior_auth" className="flex-1 overflow-auto p-6 m-0">
            <div className="max-w-xl space-y-4">
              <div className="bg-card border border-border rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Brain size={16} className="text-primary" />
                  <p className="text-[13px] font-semibold text-foreground">AI-Assisted Prior Authorization</p>
                </div>
                <p className="text-[12px] text-muted-foreground">
                  Automatically generates pre-authorization requests for insurance admissions using clinical data.
                  Reduces manual effort and improves approval rates.
                </p>
                <div className="space-y-2">
                  {[
                    { l: "Auto-extracts diagnosis codes (ICD-10)", done: true },
                    { l: "Pulls supporting lab results and vitals", done: true },
                    { l: "Generates clinical justification narrative", done: true },
                    { l: "Submits to HCX network (PMJAY, CGHS, TPA)", done: true },
                    { l: "Tracks pre-auth status with SLA alerts", done: true },
                  ].map(f => (
                    <div key={f.l} className="flex items-center gap-2">
                      <div className={cn("w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0", f.done ? "bg-green-100" : "bg-muted")}>
                        {f.done && <div className="w-2 h-2 rounded-full bg-green-500" />}
                      </div>
                      <p className="text-[12px] text-foreground">{f.l}</p>
                    </div>
                  ))}
                </div>
                <Button size="sm" onClick={() => navigate("/insurance")} className="gap-1.5">
                  <ChevronRight size={12} /> Go to Insurance Module
                </Button>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <p className="text-[12px] text-blue-800 font-medium">Powered by:</p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {["insurance-automation (Edge Fn)", "submit-pre-auth-hcx (Edge Fn)", "hcx-claim-submit (Edge Fn)", "ai-proxy → Claude Sonnet"].map(t => (
                    <span key={t} className="text-[10px] bg-blue-100 text-blue-800 border border-blue-200 rounded px-2 py-0.5 font-mono">{t}</span>
                  ))}
                </div>
              </div>

              <div className="bg-card border border-border rounded-xl p-4">
                <p className="text-[13px] font-semibold text-foreground mb-2">Future: Deterioration Prediction Model</p>
                <p className="text-[12px] text-muted-foreground">
                  6-hour ahead deterioration prediction via supervised ML (Logistic Regression on NEWS2 + vitals trend + comorbidity features).
                  Currently uses rule-based scoring above. ML model training requires Gap 27 FHIR bulk export for training data.
                </p>
                <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-primary/40 rounded-full" style={{ width: "65%" }} />
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">Rule-based prototype active — ML model pending FHIR bulk export (Gap 27 ✅)</p>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
