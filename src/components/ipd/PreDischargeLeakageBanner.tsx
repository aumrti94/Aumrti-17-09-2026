import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, Loader2, ExternalLink } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface UnbilledItem {
  type: string;
  description: string;
}

interface Props {
  admissionId: string;
  hospitalId: string;
}

const PreDischargeLeakageBanner: React.FC<Props> = ({ admissionId, hospitalId }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [unbilled, setUnbilled] = useState<UnbilledItem[]>([]);
  const [checked, setChecked] = useState(false);

  const scan = useCallback(async () => {
    setLoading(true);
    const found: UnbilledItem[] = [];

    // Fetch billed line item descriptions for this admission
    const { data: bills } = await supabase
      .from("bills")
      .select("id")
      .eq("admission_id", admissionId)
      .neq("status", "cancelled") as any;

    const billIds = (bills || []).map((b: any) => b.id);

    const { data: billedItems } = billIds.length
      ? await supabase.from("bill_line_items").select("description").in("bill_id", billIds) as any
      : { data: [] };

    const billedDesc = new Set(
      (billedItems || []).map((i: any) => (i.description || "").toLowerCase().trim())
    );

    // Check lab orders
    const { data: labOrders } = await (supabase as any)
      .from("lab_orders")
      .select("id, lab_order_items(test_id, lab_test_master(test_name))")
      .eq("admission_id", admissionId)
      .eq("hospital_id", hospitalId)
      .in("status", ["completed", "validated", "reported"]);

    for (const order of labOrders || []) {
      for (const item of order.lab_order_items || []) {
        const testName = item.lab_test_master?.test_name || "";
        if (testName && !billedDesc.has(testName.toLowerCase().trim())) {
          found.push({ type: "Lab", description: testName });
        }
      }
    }

    // Check radiology orders
    const { data: radOrders } = await (supabase as any)
      .from("radiology_orders")
      .select("investigation_name, status")
      .eq("admission_id", admissionId)
      .eq("hospital_id", hospitalId)
      .in("status", ["completed", "reported"]);

    for (const ord of radOrders || []) {
      const name = ord.investigation_name || "";
      if (name && !billedDesc.has(name.toLowerCase().trim())) {
        found.push({ type: "Radiology", description: name });
      }
    }

    // Check OT procedures
    const { data: otCases } = await (supabase as any)
      .from("ot_cases")
      .select("procedure_name, status")
      .eq("admission_id", admissionId)
      .eq("hospital_id", hospitalId)
      .eq("status", "completed");

    for (const ot of otCases || []) {
      const name = ot.procedure_name || "";
      if (name && !billedDesc.has(name.toLowerCase().trim())) {
        found.push({ type: "OT Procedure", description: name });
      }
    }

    // Deduplicate
    const seen = new Set<string>();
    const deduped = found.filter(f => {
      const key = `${f.type}:${f.description}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    setUnbilled(deduped);
    setChecked(true);
    setLoading(false);
  }, [admissionId, hospitalId]);

  useEffect(() => { scan(); }, [scan]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground border border-border rounded-lg px-3 py-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Checking for unbilled services…
      </div>
    );
  }

  if (!checked) return null;

  if (unbilled.length === 0) {
    return (
      <div className="flex items-center gap-2 border border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/20 rounded-lg px-3 py-2">
        <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
        <span className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
          Revenue leakage check passed — no unbilled services found.
        </span>
      </div>
    );
  }

  return (
    <div className="border border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 rounded-lg p-3 space-y-2">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
            {unbilled.length} unbilled service{unbilled.length !== 1 ? "s" : ""} detected before discharge
          </p>
          <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5">
            The following were completed but may not be on the IPD bill. Review before finalising discharge.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1 border-amber-300 text-amber-700 hover:bg-amber-100 shrink-0"
          onClick={() => navigate(`/billing?action=new&admission_id=${admissionId}&type=ipd`)}
        >
          <ExternalLink className="h-3 w-3" /> Fix in Billing
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {unbilled.slice(0, 6).map((item, i) => (
          <span key={i} className="text-[10px] bg-amber-100 text-amber-800 border border-amber-200 rounded px-1.5 py-0.5">
            <span className="font-medium">{item.type}:</span> {item.description}
          </span>
        ))}
        {unbilled.length > 6 && (
          <span className="text-[10px] text-amber-700">+{unbilled.length - 6} more</span>
        )}
      </div>
    </div>
  );
};

export default PreDischargeLeakageBanner;
