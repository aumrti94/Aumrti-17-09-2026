import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { callAI } from "@/lib/aiProvider";
import { Search, CheckCircle, X, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BillRecord } from "@/pages/billing/BillingPage";
import type { LineItem } from "@/components/billing/BillEditor";

interface RevenueAlert {
  id?: string;
  alert_type: string;
  description: string;
  estimated_amount: number;
  severity: string;
}

interface Props {
  bill: BillRecord;
  hospitalId: string | null;
  lineItems: LineItem[];
}

const RevenueIntelligencePanel: React.FC<Props> = ({ bill, hospitalId, lineItems }) => {
  const { toast } = useToast();
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [alerts, setAlerts] = useState<RevenueAlert[]>([]);
  const [expanded, setExpanded] = useState(true);

  if (!bill.encounter_id && !bill.admission_id) return null;

  const runAIScan = async () => {
    if (!hospitalId) return;
    setScanning(true);

    try {
      const billedServices = lineItems.map(i => `${i.description} (₹${i.total_amount})`).join(", ") || "None";

      // Gather clinical activity
      const clinicalParts: string[] = [];

      if (bill.encounter_id || bill.admission_id) {
        const labQ = supabase.from("lab_order_items")
          .select("*, lab_test_master(test_name), lab_orders!inner(encounter_id, admission_id, hospital_id)")
          .eq("lab_orders.hospital_id", hospitalId)
          .in("status", ["validated", "reported"]);
        const { data: labData } = await labQ;
        const matchedLabs = (labData || []).filter((item: any) => {
          const lo = item.lab_orders;
          if (!lo) return false;
          return (bill.encounter_id && lo.encounter_id === bill.encounter_id) ||
                 (bill.admission_id && lo.admission_id === bill.admission_id);
        });
        if (matchedLabs.length) {
          clinicalParts.push(`Lab tests: ${matchedLabs.map((l: any) => l.lab_test_master?.test_name || "Lab Test").join(", ")}`);
        }
      }

      if (bill.encounter_id || bill.admission_id) {
        let radQ = supabase.from("radiology_orders").select("study_name").eq("hospital_id", hospitalId).eq("status", "validated");
        if (bill.encounter_id) radQ = radQ.eq("encounter_id", bill.encounter_id);
        else if (bill.admission_id) radQ = radQ.eq("admission_id", bill.admission_id);
        const { data: radData } = await radQ;
        if (radData?.length) clinicalParts.push(`Radiology: ${radData.map((r: any) => r.study_name).join(", ")}`);
      }

      if (bill.admission_id) {
        const { data: otData } = await supabase.from("ot_schedules").select("surgery_name").eq("hospital_id", hospitalId).eq("admission_id", bill.admission_id).eq("status", "completed");
        if (otData?.length) clinicalParts.push(`Surgeries: ${otData.map((o: any) => o.surgery_name).join(", ")}`);

        const { data: pharmaData } = await supabase.from("pharmacy_dispensing").select("dispensing_number, pharmacy_dispensing_items(drug_name)")
          .eq("hospital_id", hospitalId).eq("dispensing_type", "ip").eq("admission_id", bill.admission_id);
        const drugCount = (pharmaData || []).reduce((s, p: any) => s + (p.pharmacy_dispensing_items?.length || 0), 0);
        if (drugCount) clinicalParts.push(`Medications dispensed: ${drugCount} items`);
      }

      if (!clinicalParts.length) {
        setAlerts([]);
        setScanned(true);
        setScanning(false);
        return;
      }

      const response = await callAI({
        featureKey: "revenue_leakage",
        hospitalId,
        prompt: `Analyse this hospital bill for potential revenue leakage.

BILLED SERVICES:
${billedServices}

CLINICAL ACTIVITY RECORDED:
${clinicalParts.join("\n")}

Identify any potential missing charges where a clinical service was performed but may not be billed.
Be conservative — only flag genuine discrepancies.

Return ONLY JSON array (empty array if no issues):
[{"alert_type":"unbilled_procedure","description":"Surgery performed but OT charges not found in bill","estimated_amount":5000,"severity":"high"}]`,
        maxTokens: 300,
      });

      try {
        const parsed = JSON.parse(response.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
        const validAlerts = (Array.isArray(parsed) ? parsed : []).filter(
          (a: any) => a.description && a.alert_type
        );

        // Save to DB
        for (const alert of validAlerts) {
          await supabase.from("revenue_alerts").insert({
            hospital_id: hospitalId,
            bill_id: bill.id,
            patient_id: bill.patient_id,
            alert_type: alert.alert_type,
            description: alert.description,
            estimated_amount: alert.estimated_amount || 0,
            severity: alert.severity || "medium",
          });
        }

        // Log AI usage
        await supabase.from("ai_feature_logs").insert({
          hospital_id: hospitalId,
          module: "billing",
          feature_key: "revenue_leakage",
          patient_id: bill.patient_id,
          input_summary: `Bill #${bill.bill_number}, ${lineItems.length} items`,
          output_summary: `${validAlerts.length} alerts found`,
          success: true,
        });

        setAlerts(validAlerts);
      } catch {
        setAlerts([]);
      }
    } catch (e) {
      console.error("Revenue intelligence scan error:", e);
      setAlerts([]);
    }

    setScanned(true);
    setScanning(false);
  };

  const resolveAlert = async (idx: number) => {
    const alert = alerts[idx];
    if (alert.id) {
      await supabase.from("revenue_alerts").update({ resolved: true, resolved_at: new Date().toISOString() } as any).eq("id", alert.id);
    }
    setAlerts(prev => prev.filter((_, i) => i !== idx));
    toast({ title: "Alert resolved" });
  };

  const dismissAlert = (idx: number) => {
    setAlerts(prev => prev.filter((_, i) => i !== idx));
  };

  const totalEstimated = alerts.reduce((s, a) => s + (a.estimated_amount || 0), 0);

  const severityStyle = (s: string) => {
    if (s === "high") return "bg-destructive/10 text-destructive border-destructive/20";
    if (s === "medium") return "bg-warning/10 text-warning border-warning/20";
    return "bg-muted text-muted-foreground border-border";
  };

  return (
    <div className="px-4 py-2 flex-shrink-0">
      {!scanned ? (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-xs bg-accent/10 border-accent/30 text-accent hover:bg-accent/20"
          onClick={runAIScan}
          disabled={scanning}
        >
          {scanning ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          {scanning ? "AI scanning clinical records..." : "🔍 AI Revenue Intelligence Scan"}
        </Button>
      ) : alerts.length === 0 ? (
        <div className="bg-emerald-50 dark:bg-emerald-950/30 border-l-[3px] border-l-emerald-500 px-4 py-2.5 rounded-r-lg">
          <span className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium">
            ✓ AI scan complete — no revenue leakage detected
          </span>
        </div>
      ) : (
        <div className="bg-warning/5 border border-warning/20 rounded-lg overflow-hidden">
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full flex items-center justify-between px-4 py-2.5"
          >
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-bold text-warning">
                🔍 Revenue Intelligence — {alerts.length} potential issue(s)
              </span>
              <Badge variant="outline" className="text-[10px] border-warning/30 text-warning">
                ~₹{totalEstimated.toLocaleString("en-IN")} potential recovery
              </Badge>
            </div>
            {expanded ? <ChevronUp size={14} className="text-warning" /> : <ChevronDown size={14} className="text-warning" />}
          </button>

          {expanded && (
            <div className="px-4 pb-3 space-y-2">
              {alerts.map((alert, idx) => (
                <div key={idx} className="flex items-center gap-3 py-2 border-b border-warning/10 last:border-0">
                  <Badge variant="outline" className={cn("text-[9px] capitalize", severityStyle(alert.severity))}>
                    {alert.severity}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground">{alert.description}</p>
                    <p className="text-[10px] text-muted-foreground capitalize">{alert.alert_type.replace(/_/g, " ")}</p>
                  </div>
                  <span className="text-xs font-bold text-foreground tabular-nums flex-shrink-0">
                    ₹{(alert.estimated_amount || 0).toLocaleString("en-IN")}
                  </span>
                  <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 gap-1" onClick={() => resolveAlert(idx)}>
                    <CheckCircle size={10} /> Resolve
                  </Button>
                  <button onClick={() => dismissAlert(idx)} className="text-muted-foreground hover:text-foreground">
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default RevenueIntelligencePanel;
