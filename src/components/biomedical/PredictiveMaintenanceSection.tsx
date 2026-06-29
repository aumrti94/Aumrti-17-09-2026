import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { callAI } from "@/lib/aiProvider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Brain, Loader2, Wrench } from "lucide-react";
import { useHospitalId } from '@/hooks/useHospitalId';


interface Prediction {
  equipmentId: string;
  equipmentName: string;
  equipmentCode: string;
  maintenance_risk: string;
  predicted_issue: string;
  recommended_action: string;
  urgency_days: number;
  estimated_cost: number;
}

const PredictiveMaintenanceSection: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [predictions, setPredictions] = useState<Prediction[]>([]);

  const runPredictions = async () => {
    setLoading(true);
    try {
      const { data: equipment } = await supabase
        .from("equipment_master")
        .select("id, equipment_name, equipment_code, make, model, purchase_date, amc_type, status")
        .eq("hospital_id", hospitalId)
        .in("status", ["operational", "under_maintenance"]);

      const results: Prediction[] = [];

      for (const eq of (equipment || []).slice(0, 10)) {
        const { data: breakdowns } = await supabase
          .from("breakdown_logs")
          .select("reported_at, severity, downtime_hrs, root_cause")
          .eq("equipment_id", eq.id)
          .order("reported_at", { ascending: false })
          .limit(10);

        const response = await callAI({
          featureKey: "ai_digest",
          hospitalId: hospitalId,
          prompt: `Predict maintenance needs for hospital equipment.

Equipment: ${eq.equipment_name} (${eq.make || ""} ${eq.model || ""})
Age: ${eq.purchase_date ? Math.floor((Date.now() - new Date(eq.purchase_date).getTime()) / 31536000000) + " years" : "Unknown"}
Last PM: Unknown
AMC: ${eq.amc_type || "none"}

Breakdown history:
${breakdowns?.map((b) => `${b.reported_at?.split("T")[0]}: ${b.severity}, ${b.downtime_hrs || 0}hrs`).join("\n") || "No breakdowns"}

Return ONLY JSON:
{"maintenance_risk":"medium","predicted_issue":"Filter replacement","recommended_action":"Schedule service within 2 weeks","urgency_days":14,"estimated_cost":5000}`,
          maxTokens: 200,
        });

        try {
          const parsed = JSON.parse(response.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
          if (parsed.maintenance_risk && parsed.maintenance_risk !== "low") {
            results.push({
              equipmentId: eq.id,
              equipmentName: eq.equipment_name,
              equipmentCode: eq.equipment_code,
              ...parsed,
            });
          }
        } catch { /* skip */ }
      }

      results.sort((a, b) => a.urgency_days - b.urgency_days);
      setPredictions(results);

      if (results.length === 0) {
        toast({ title: "All equipment looks healthy — no urgent predictions" });
      }
    } catch {
      toast({ title: "Failed to run predictions", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const schedulePM = async (pred: Prediction) => {
    const nextDue = new Date(Date.now() + pred.urgency_days * 86400000).toISOString().split("T")[0];
    await supabase.from("pm_schedules").insert({
      hospital_id: hospitalId,
      equipment_id: pred.equipmentId,
      frequency: "monthly",
      next_due_at: nextDue,
      status: "upcoming",
      checklist: [pred.recommended_action],
    });
    toast({ title: `PM scheduled for ${pred.equipmentName} on ${nextDue}` });
  };

  const riskColor = (risk: string) => {
    if (risk === "high" || risk === "critical") return "destructive";
    if (risk === "medium") return "secondary";
    return "outline";
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2 text-foreground">
          🔮 Predictive Maintenance
        </h3>
        <Button size="sm" variant="outline" onClick={runPredictions} disabled={loading} className="text-xs h-7">
          {loading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Brain className="h-3 w-3 mr-1" />}
          {loading ? "Analysing..." : "Run AI Analysis"}
        </Button>
      </div>

      {predictions.length === 0 && !loading && (
        <p className="text-xs text-muted-foreground text-center py-4">
          Click "Run AI Analysis" to predict equipment maintenance needs
        </p>
      )}

      {loading && (
        <div className="text-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">Analysing breakdown patterns and equipment age...</p>
        </div>
      )}

      {predictions.map((pred, i) => (
        <div key={i} className="rounded-lg border border-border p-3 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Badge variant={riskColor(pred.maintenance_risk) as any} className="text-[10px]">
                {pred.maintenance_risk.toUpperCase()} RISK
              </Badge>
              <span className="text-sm font-bold">{pred.equipmentName}</span>
              <span className="text-xs font-mono text-muted-foreground">({pred.equipmentCode})</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">{pred.predicted_issue}</p>
            <div className="flex gap-3 mt-1 text-[11px] text-muted-foreground">
              <span>Action: {pred.recommended_action}</span>
              <span className="font-semibold text-amber-600">Within {pred.urgency_days} days</span>
              {pred.estimated_cost > 0 && <span>Est. ₹{pred.estimated_cost.toLocaleString("en-IN")}</span>}
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => schedulePM(pred)} className="text-xs">
            <Wrench className="h-3 w-3 mr-1" /> Schedule PM
          </Button>
        </div>
      ))}
    </div>
  );
};

export default PredictiveMaintenanceSection;
