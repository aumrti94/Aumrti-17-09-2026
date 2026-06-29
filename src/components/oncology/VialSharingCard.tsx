import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Pill, ArrowRight, Sparkles, Loader2, Check } from "lucide-react";
import { callAI } from "@/lib/aiProvider";
import { supabase } from "@/integrations/supabase/client";

interface VialSharingCardProps {
  orders: any[];
  hospitalId?: string;
}

interface SharingOpp {
  drug: string;
  windowStart: string;
  patients: { name: string; dose: number; patientId: string }[];
  totalDose: number;
  estimatedSaving: number;
  recommendation: string;
}

const RECONSTITUTION_WINDOW_HOURS = 4;

function floorToWindow(isoTime: string): string {
  const d = new Date(isoTime);
  const h = d.getHours();
  const windowStart = Math.floor(h / RECONSTITUTION_WINDOW_HOURS) * RECONSTITUTION_WINDOW_HOURS;
  d.setHours(windowStart, 0, 0, 0);
  return d.toISOString();
}

function formatWindow(isoTime: string): string {
  const d = new Date(isoTime);
  const h = d.getHours();
  const end = h + RECONSTITUTION_WINDOW_HOURS;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:00–${pad(end)}:00`;
}

const VialSharingCard: React.FC<VialSharingCardProps> = ({ orders, hospitalId }) => {
  const [opportunities, setOpportunities] = useState<SharingOpp[]>([]);
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [loadingAI, setLoadingAI] = useState(false);
  const [applied, setApplied] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!orders?.length) return;

    // Bin-pack by drug + 4h reconstitution window
    const drugWindowGroups: Record<string, { patient: string; dose: number; time: string; patientId: string }[]> = {};

    for (const order of orders) {
      const patName = order.oncology_patients?.patients?.full_name || "Unknown";
      const drugs = order.chemo_order_drugs || [];
      const orderTime = order.created_at || new Date().toISOString();
      const windowKey = floorToWindow(orderTime);

      for (const drug of drugs) {
        const key = `${drug.drug_name}__${windowKey}`;
        if (!drugWindowGroups[key]) drugWindowGroups[key] = [];
        drugWindowGroups[key].push({
          patient: patName,
          dose: drug.planned_dose_mg || 0,
          time: orderTime,
          patientId: order.patient_id,
        });
      }
    }

    const savings: SharingOpp[] = [];
    for (const [key, patients] of Object.entries(drugWindowGroups)) {
      if (patients.length < 2) continue;
      const [drugName, windowStart] = key.split("__");
      const totalDose = patients.reduce((s, p) => s + p.dose, 0);
      savings.push({
        drug: drugName,
        windowStart,
        patients: patients.map((p) => ({ name: p.patient, dose: p.dose, patientId: p.patientId })),
        totalDose,
        estimatedSaving: Math.round(patients.length * 0.2 * 10000),
        recommendation: `Schedule ${patients.map((p) => p.name).join(" + ")} in ${formatWindow(windowStart)} for ${drugName}`,
      });
    }

    setOpportunities(savings);
  }, [orders]);

  const runAIOptimizer = async () => {
    if (!hospitalId || opportunities.length === 0) return;
    setLoadingAI(true);
    const summary = opportunities.map(o => {
      const patientLines = o.patients.map(p => `${p.name} (${p.dose}mg)`).join(", ");
      return `${o.drug} | Window: ${formatWindow(o.windowStart)} | Patients: ${patientLines} | Total dose: ${o.totalDose}mg`;
    }).join("\n");

    const response = await callAI({
      featureKey: "vial_wastage",
      hospitalId,
      prompt: `You are an oncology pharmacist AI. Analyse these vial sharing opportunities and provide an optimised schedule to minimise drug wastage.

Opportunities (grouped by drug + 4-hour reconstitution window):
${summary}

Consider:
- Chemotherapy vials must be used within 4–6 hours of reconstitution
- Patients in the same window can share a single reconstituted vial
- Prioritise combinations with highest total dose (fewer vials opened)
- Note any drug stability concerns for specific agents

Give one concise paragraph with the most impactful recommendation and estimated annual savings if the same pattern is applied monthly.`,
      maxTokens: 220,
    });
    if (!response.error && response.text) setAiInsight(response.text);
    setLoadingAI(false);
  };

  const applySchedule = async (opp: SharingOpp) => {
    const key = `${opp.drug}__${opp.windowStart}`;
    setApplied(prev => new Set([...prev, key]));
    
    if (!hospitalId) return;

    try {
      const patientIds = opp.patients.map(p => p.patientId).filter(Boolean);
      if (patientIds.length === 0) return;

      // 1. Get active admissions for these patients
      const { data: admissions } = await supabase
        .from("admissions")
        .select("id, patient_id")
        .in("patient_id", patientIds)
        .in("status", ["admitted", "daycare"]);

      if (!admissions || admissions.length === 0) return;
      const admissionIds = admissions.map(a => a.id);

      // 2. Get ipd_medications for these admissions matching the drug
      const { data: meds } = await supabase
        .from("ipd_medications")
        .select("id, admission_id")
        .in("admission_id", admissionIds)
        .ilike("medication_name", `%${opp.drug}%`);

      if (!meds || meds.length === 0) return;
      const medIds = meds.map(m => m.id);

      // 3. Update nursing_mar scheduled_time
      const windowTime = new Date(opp.windowStart).toLocaleTimeString("en-GB", { hour12: false }); // HH:mm:ss
      await supabase
        .from("nursing_mar")
        .update({ scheduled_time: windowTime } as any)
        .in("medication_id", medIds)
        .is("administered_at", null);

    } catch (err) {
      console.error("Failed to apply schedule", err);
    }
  };

  if (opportunities.length === 0) return null;

  const totalSaving = opportunities.reduce((s, o) => s + o.estimatedSaving, 0);

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Pill className="h-4 w-4 text-primary" /> Vial Sharing Opportunities
          </span>
          <Badge variant="secondary" className="text-xs">
            Est. savings ₹{totalSaving.toLocaleString("en-IN")} today
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {hospitalId && !aiInsight && (
          <Button size="sm" variant="outline" className="w-full h-7 text-xs gap-1.5 mb-2" onClick={runAIOptimizer} disabled={loadingAI}>
            {loadingAI ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} className="text-primary" />}
            {loadingAI ? "AI optimising..." : "AI Wastage Optimizer"}
          </Button>
        )}
        {aiInsight && (
          <div className="bg-primary/5 border border-primary/20 rounded-lg p-2.5 mb-2 text-xs text-foreground">
            <span className="font-semibold text-primary flex items-center gap-1 mb-1"><Sparkles size={11} /> AI Recommendation</span>
            {aiInsight}
          </div>
        )}
        {opportunities.map((opp, i) => {
          const key = `${opp.drug}__${opp.windowStart}`;
          const isApplied = applied.has(key);
          return (
            <div key={i} className="bg-background rounded-lg border border-border p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-foreground">{opp.drug}</span>
                    <Badge variant="outline" className="text-[9px]">{opp.patients.length} patients</Badge>
                    <Badge variant="outline" className="text-[9px] text-blue-600 border-blue-200">⏱ {formatWindow(opp.windowStart)}</Badge>
                  </div>
                  <div className="flex items-center gap-1 mt-1 flex-wrap">
                    {opp.patients.map((p, j) => (
                      <React.Fragment key={j}>
                        <span className="text-[11px] text-muted-foreground">{p.name} <span className="text-[10px] text-blue-500">({p.dose}mg)</span></span>
                        {j < opp.patients.length - 1 && <ArrowRight className="h-2.5 w-2.5 text-muted-foreground shrink-0" />}
                      </React.Fragment>
                    ))}
                  </div>
                  <p className="text-[10px] text-emerald-600 mt-0.5">
                    💰 Save ~₹{opp.estimatedSaving.toLocaleString("en-IN")} • Total dose: {opp.totalDose}mg
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={isApplied ? "secondary" : "outline"}
                  className="h-6 text-[10px] shrink-0 gap-1"
                  onClick={() => applySchedule(opp)}
                  disabled={isApplied}
                >
                  {isApplied ? <><Check size={9} /> Applied</> : "Apply"}
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};

export default VialSharingCard;
