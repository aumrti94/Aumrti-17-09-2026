import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, Loader2, ExternalLink } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  buildDedupeKey,
  splitBilledServices,
  type BillableCandidate,
  type ChargedLine,
  type UnbilledReason,
} from "@/lib/billedServiceCheck";

interface UnbilledItem {
  type: string;
  description: string;
  reason: UnbilledReason;
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

    // PHASE 2 EXTRACTION. This used to compare a Set of lowercased bill-line DESCRIPTIONS
    // against service names. That answer is wrong in four ways that all happen in a normal
    // week — overlapping test names, the same drug dispensed twice, master data renamed after
    // the order, and lines on a voided bill — and every one of them is silent. The identity
    // question now goes through splitBilledServices on source_dedupe_key. See
    // src/lib/billedServiceCheck.ts for why description matching is not a billing check.
    //
    // bill_status is selected (not filtered out) so a line on a cancelled bill is reported as
    // unbilled with a reason, rather than silently counting as billed.
    const { data: bills } = (await supabase
      .from("bills")
      .select("id, bill_status")
      .eq("admission_id", admissionId)) as any;

    const billStatusById = new Map<string, string | null>(
      (bills || []).map((b: any) => [b.id, b.bill_status]),
    );
    const billIds = [...billStatusById.keys()];

    const { data: billedItems } = billIds.length
      ? ((await supabase
          .from("bill_line_items")
          .select("source_dedupe_key, bill_id")
          .in("bill_id", billIds)) as any)
      : { data: [] };

    const chargedLines: ChargedLine[] = (billedItems || []).map((i: any) => ({
      source_dedupe_key: i.source_dedupe_key,
      billStatus: billStatusById.get(i.bill_id) ?? null,
    }));

    const candidates: (BillableCandidate & { type: string })[] = [];

    // Check lab orders
    const { data: labOrders } = await (supabase as any)
      .from("lab_orders")
      .select("id, lab_order_items(id, test_id, lab_test_master(test_name))")
      .eq("admission_id", admissionId)
      .eq("hospital_id", hospitalId)
      .in("status", ["completed", "validated", "reported"]);

    for (const order of labOrders || []) {
      for (const item of order.lab_order_items || []) {
        const testName = item.lab_test_master?.test_name || "";
        if (!testName || !item.id) continue;
        candidates.push({
          type: "Lab",
          description: testName,
          dedupeKey: buildDedupeKey("lab", item.id),
        });
      }
    }

    // Check radiology orders
    const { data: radOrders } = await (supabase as any)
      .from("radiology_orders")
      .select("id, investigation_name, status")
      .eq("admission_id", admissionId)
      .eq("hospital_id", hospitalId)
      .in("status", ["completed", "reported"]);

    for (const ord of radOrders || []) {
      const name = ord.investigation_name || "";
      if (!name || !ord.id) continue;
      candidates.push({
        type: "Radiology",
        description: name,
        dedupeKey: buildDedupeKey("radiology", ord.id),
      });
    }

    // Check OT procedures.
    // "ot_cases" has never existed — the table is ot_schedules, and the procedure column is
    // surgery_name. That query always errored, so completed OT procedures were never checked
    // for billing leakage and the banner silently under-reported.
    //
    // An OT case bills several lines (theatre charge, surgeon fee, anaesthesia, implants), so
    // the theatre charge is the segment that stands for "this case was billed at all".
    const { data: otCases } = await (supabase as any)
      .from("ot_schedules")
      .select("id, surgery_name, status")
      .eq("admission_id", admissionId)
      .eq("hospital_id", hospitalId)
      .eq("status", "completed");

    for (const ot of otCases || []) {
      const name = ot.surgery_name || "";
      if (!name || !ot.id) continue;
      candidates.push({
        type: "OT Procedure",
        description: name,
        dedupeKey: buildDedupeKey("ot", ot.id, "ot_charge"),
      });
    }

    const split = splitBilledServices(candidates, chargedLines);

    setUnbilled(
      split.unbilled.map((u) => ({
        type: String(u.candidate.type),
        description: u.candidate.description,
        reason: u.reason,
      })),
    );
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
            {/* A service whose only bill line sits on a cancelled or refunded bill is
                genuinely unbilled, but it also looks exactly like a bill mid-correction —
                say which it is rather than presenting both the same way. */}
            {item.reason === "prior_bill_voided" && (
              <span className="ml-1 italic text-amber-600">(prior bill voided)</span>
            )}
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
