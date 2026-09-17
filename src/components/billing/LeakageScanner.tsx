import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Sparkles, Plus, X, FlaskConical, Radio, Pill, Scissors, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { chargeOTCase } from "@/lib/serviceBilling";
import {
  buildDedupeKey,
  splitBilledServices,
  type BillableCandidate,
  type ChargedLine,
} from "@/lib/billedServiceCheck";
import type { BillRecord } from "@/pages/billing/BillingPage";
import type { LineItem } from "@/components/billing/BillEditor";

interface LeakageItem {
  type: "lab" | "radiology" | "pharmacy" | "surgery";
  description: string;
  suggestedRate: number;
  qty: number;
  source: string;
  itemType: string;
  hsnCode: string;
  gstPercent: number;
  /** Carried through so the line written back can be recognised on the next scan. */
  dedupeKey?: string;
  otSchedule?: any; // full ot_schedules row — present only for type "surgery"
}

interface Props {
  bill: BillRecord;
  hospitalId: string | null;
  lineItems: LineItem[];
  onRefresh: () => void;
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  lab: <FlaskConical size={14} className="text-emerald-600" />,
  radiology: <Radio size={14} className="text-violet-600" />,
  pharmacy: <Pill size={14} className="text-blue-600" />,
  surgery: <Scissors size={14} className="text-rose-600" />,
};

const LeakageScanner: React.FC<Props> = ({ bill, hospitalId, lineItems, onRefresh }) => {
  const { toast } = useToast();
  const [isScanning, setIsScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [leakageItems, setLeakageItems] = useState<LeakageItem[]>([]);
  const [isExpanded, setIsExpanded] = useState(true);

  if (!bill.encounter_id && !bill.admission_id) return null;

  const runScan = async () => {
    if (!hospitalId) return;
    setIsScanning(true);

    // PHASE 2 EXTRACTION. This used `existingDesc.some(d => d.includes(name))` — a SUBSTRING
    // match on bill-line descriptions. Billing "Blood Sugar Fasting" therefore made a separate
    // "Blood Sugar" order read as already billed, and the hospital was never paid for it. The
    // scanner that exists to catch missed revenue was hiding it. Identity now goes through
    // source_dedupe_key; see src/lib/billedServiceCheck.ts.
    const chargedLines: ChargedLine[] = lineItems.map((i) => ({
      source_dedupe_key: (i as unknown as { source_dedupe_key?: string | null }).source_dedupe_key ?? null,
      // These lines are this bill's own, so they are live by construction.
      billStatus: null,
    }));

    const candidates: (BillableCandidate & Omit<LeakageItem, "description">)[] = [];

    try {
      // 1. Lab tests
      if (bill.encounter_id || bill.admission_id) {
        const labQuery = supabase
          .from("lab_order_items")
          .select("*, lab_test_master(test_name), lab_orders!inner(id, encounter_id, admission_id, hospital_id)")
          .eq("lab_orders.hospital_id", hospitalId)
          .in("status", ["validated", "reported"]);

        const { data: labData } = await labQuery;
        (labData || []).forEach((item: any) => {
          const lo = item.lab_orders;
          if (!lo || !item.id) return;
          const matchEnc = bill.encounter_id && lo.encounter_id === bill.encounter_id;
          const matchAdm = bill.admission_id && lo.admission_id === bill.admission_id;
          if (!matchEnc && !matchAdm) return;

          const testName = item.lab_test_master?.test_name || "Lab Test";
          candidates.push({
            dedupeKey: buildDedupeKey("lab", item.id),
            type: "lab",
            description: `Lab: ${testName}`,
            suggestedRate: 200,
            qty: 1,
            source: `Lab Order`,
            itemType: "lab",
            hsnCode: "998931",
            gstPercent: 12,
          });
        });
      }

      // 2. Radiology
      {
        let radQ = supabase
          .from("radiology_orders")
          .select("*")
          .eq("hospital_id", hospitalId)
          .eq("status", "validated");

        if (bill.encounter_id) radQ = radQ.eq("encounter_id", bill.encounter_id);
        else if (bill.admission_id) radQ = radQ.eq("admission_id", bill.admission_id);

        const { data: radData } = await radQ;
        (radData || []).forEach((item: any) => {
          if (!item.id) return;
          candidates.push({
            dedupeKey: buildDedupeKey("radiology", item.id),
            type: "radiology",
            description: `Radiology: ${item.study_name}`,
            suggestedRate: 500,
            qty: 1,
            source: `Accession ${item.accession_number || "—"}`,
            itemType: "radiology",
            hsnCode: "998921",
            gstPercent: 12,
          });
        });
      }

      // 3. Pharmacy IP dispenses
      if (bill.admission_id) {
        const { data: pharmaData } = await supabase
          .from("pharmacy_dispensing")
          .select("*, pharmacy_dispensing_items(*)")
          .eq("hospital_id", hospitalId)
          .eq("dispensing_type", "ip")
          .eq("admission_id", bill.admission_id)
          .eq("bill_linked", false);

        (pharmaData || []).forEach((pd: any) => {
          ((pd as any).pharmacy_dispensing_items || []).forEach((item: any) => {
            if (!item.id) return;
            candidates.push({
              // Keyed on the dispense ITEM, matching UnbilledServicesModal. Keying on the
              // dispense header would collapse two dispenses of the same drug into one.
              dedupeKey: buildDedupeKey("pharmacy", `dispense-item:${item.id}`),
              type: "pharmacy",
              description: `Pharmacy: ${item.drug_name}`,
              suggestedRate: Number(item.unit_price) * Number(item.quantity_dispensed),
              qty: Number(item.quantity_dispensed),
              source: `Dispensing #${pd.dispensing_number || "—"}`,
              itemType: "pharmacy",
              hsnCode: "",
              gstPercent: 12,
            });
          });
        });
      }

      // 4. OT surgeries
      if (bill.admission_id) {
        const { data: otData } = await supabase
          .from("ot_schedules")
          .select("*")
          .eq("hospital_id", hospitalId)
          .eq("admission_id", bill.admission_id)
          .eq("status", "completed");

        // Look up OT rate from service_master
        const { data: otRateRow } = await supabase
          .from("service_master")
          .select("fee")
          .eq("hospital_id", hospitalId)
          .eq("item_type", "ot_charge")
          .eq("is_active", true)
          .maybeSingle();
        const otSuggestedRate = otRateRow?.fee ? Number(otRateRow.fee) * 2 : 15000;

        (otData || []).forEach((ot: any) => {
          if (!ot.id) return;
          candidates.push({
            // The theatre charge stands for "this case was billed at all" — chargeOTCase
            // writes it alongside the surgeon, anaesthesia and implant segments.
            dedupeKey: buildDedupeKey("ot", ot.id, "ot_charge"),
            type: "surgery",
            description: `OT: ${ot.surgery_name}`,
            suggestedRate: otSuggestedRate,
            qty: 1,
            source: `OT Case`,
            itemType: "surgery",
            hsnCode: "999315",
            gstPercent: 5,
            otSchedule: ot,
          });
        });
      }
    } catch (e) {
      console.error("Leakage scan error:", e);
    }

    const split = splitBilledServices(candidates, chargedLines);
    setLeakageItems(split.unbilled.map((u) => u.candidate as unknown as LeakageItem));
    setIsScanning(false);
    setScanned(true);
  };

  const addToBill = async (item: LeakageItem) => {
    if (!hospitalId) return;

    if (item.type === "surgery" && item.otSchedule) {
      // Route through the real OT billing path (ot_charge + surgeon_fee + anaesthesia_fee +
      // implants, correct GST, correct dedupe keys) instead of a single flat guess-rate line
      // item — chargeOTCase is also safe to call even if this scan's "unbilled" heuristic was
      // wrong, since it dedupes against existing bill_line_items itself.
      const result = await chargeOTCase({ hospitalId, billId: bill.id, schedule: item.otSchedule });
      setLeakageItems((prev) => prev.filter((l) => l !== item));
      onRefresh();
      toast({
        title: result.itemsAdded > 0
          ? `OT charges added to bill (₹${result.total.toLocaleString("en-IN")})`
          : "OT charges already on this bill",
      });
      return;
    }

    const taxable = item.suggestedRate;
    const gstAmt = taxable * item.gstPercent / 100;
    await supabase.from("bill_line_items").insert({
      hospital_id: hospitalId,
      bill_id: bill.id,
      item_type: item.itemType,
      description: item.description,
      quantity: item.qty,
      unit_rate: item.qty > 0 ? item.suggestedRate / item.qty : item.suggestedRate,
      taxable_amount: taxable,
      gst_percent: item.gstPercent,
      gst_amount: gstAmt,
      total_amount: taxable + gstAmt,
      hsn_code: item.hsnCode || null,
      source_module: item.type,
      // Without this the line the scan just wrote carries no identity, so the NEXT scan
      // cannot see it and offers the same service again — which is how a scanner meant to
      // stop leakage starts causing double-billing instead.
      source_dedupe_key: item.dedupeKey ?? null,
    });
    setLeakageItems((prev) => prev.filter((l) => l !== item));
    onRefresh();
    toast({ title: `${item.description} added to bill` });
  };

  const addAll = async () => {
    for (const item of leakageItems) {
      await addToBill(item);
    }
  };

  const totalLeakage = leakageItems.reduce((s, i) => s + i.suggestedRate, 0);

  return (
    <div className="px-4 py-2 flex-shrink-0">
      {!scanned ? (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-xs bg-violet-50 border-violet-200 text-violet-700 hover:bg-violet-100 hover:text-violet-800"
          onClick={runScan}
          disabled={isScanning}
        >
          <Sparkles size={14} />
          {isScanning ? "Scanning clinical records..." : "Scan for Unbilled Services"}
        </Button>
      ) : leakageItems.length === 0 ? (
        <div className="bg-emerald-50 border-l-[3px] border-l-emerald-500 px-4 py-2.5 rounded-r-lg">
          <span className="text-[11px] text-emerald-700 font-medium">
            ✓ No unbilled services detected — bill appears complete
          </span>
        </div>
      ) : (
        <div className="bg-amber-50 border-l-[3px] border-l-amber-500 rounded-r-lg overflow-hidden">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-full flex items-center justify-between px-4 py-2.5"
          >
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-bold text-amber-700">
                ⚠️ {leakageItems.length} Unbilled Service(s) Detected
              </span>
              <span className="text-[11px] text-amber-600">
                ~₹{totalLeakage.toLocaleString("en-IN")}
              </span>
            </div>
            {isExpanded ? <ChevronUp size={14} className="text-amber-600" /> : <ChevronDown size={14} className="text-amber-600" />}
          </button>

          {isExpanded && (
            <div className="px-4 pb-3 space-y-1.5">
              {leakageItems.map((item, idx) => (
                <div key={idx} className="flex items-center gap-3 py-1.5 border-b border-amber-100 last:border-0">
                  <span className="flex-shrink-0">{TYPE_ICONS[item.type]}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-foreground truncate">{item.description}</p>
                    <p className="text-[10px] text-muted-foreground">{item.source}</p>
                  </div>
                  <span className="text-xs text-foreground font-medium flex-shrink-0">
                    ₹{item.suggestedRate.toLocaleString("en-IN")}
                  </span>
                  <Button
                    size="sm"
                    className="h-6 text-[10px] px-2 bg-emerald-600 hover:bg-emerald-700"
                    onClick={() => addToBill(item)}
                  >
                    <Plus size={10} /> Add
                  </Button>
                  <button
                    onClick={() => setLeakageItems((prev) => prev.filter((_, i) => i !== idx))}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  className="h-7 text-[11px] bg-amber-600 hover:bg-amber-700 flex-1"
                  onClick={addAll}
                >
                  + Add All ({leakageItems.length}) to Bill
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[11px]"
                  onClick={() => setLeakageItems([])}
                >
                  Dismiss All
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default LeakageScanner;
