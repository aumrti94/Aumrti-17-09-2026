import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { calcGST } from "@/lib/currency";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { generateBillNumber } from "@/hooks/useBillNumber";
import { getRate } from "@/lib/serviceRates";
import { autoPostJournalEntry } from "@/lib/accounting";
import { recalculateBillTotalsSafe } from "@/lib/billTotals";
import { recordServiceCharge } from "@/lib/serviceBilling";

const STATUS_COLS = [
  { key: "stimulation", label: "Stimulation", color: "bg-blue-50 border-blue-200" },
  { key: "opu_done", label: "OPU Done", color: "bg-purple-50 border-purple-200" },
  { key: "fertilization", label: "Fertilization", color: "bg-teal-50 border-teal-200" },
  { key: "et_done", label: "ET Done", color: "bg-green-50 border-green-200" },
  { key: "luteal_support", label: "Awaiting Result", color: "bg-amber-50 border-amber-200" },
];

const CYCLE_TYPES = ["ivf", "icsi", "fet", "iui", "imsi", "donor_egg", "donor_sperm", "surrogacy"];
const PROTOCOLS = ["Long agonist", "Short agonist", "Antagonist", "Mini IVF", "Natural cycle"];

// IVF status → billing milestone mapping
const STATUS_BILLING_MAP: Record<string, { itemType: string; label: string; fallbackFee: number }> = {
  stimulation: { itemType: "ivf_stimulation", label: "Stimulation", fallbackFee: 15000 },
  opu_done: { itemType: "ivf_egg_retrieval", label: "Egg Retrieval (OPU)", fallbackFee: 25000 },
  et_done: { itemType: "ivf_embryo_transfer", label: "Embryo Transfer", fallbackFee: 20000 },
  completed: { itemType: "ivf_cycle_package", label: "Cycle Completion", fallbackFee: 10000 },
};

interface Props {
  showStartCycle: boolean;
  onCloseStartCycle: () => void;
  onRefreshKPIs: () => void;
}

/** Auto-bill an IVF milestone */
async function billIVFMilestone(opts: {
  hospitalId: string;
  patientId: string;
  coupleCode: string;
  cycleNumber: number;
  milestoneType: string;
  milestoneLabel: string;
  fallbackFee: number;
  userId: string;
}) {
  try {
    const { hospitalId, patientId, milestoneType, milestoneLabel, fallbackFee, coupleCode, cycleNumber, userId } = opts;

    // Look up rate
    const { data: svc } = await supabase.from("service_master").select("fee, gst_percent")
      .eq("hospital_id", hospitalId).eq("is_active", true)
      .ilike("name", `%${milestoneType.replace("ivf_", "").replace("_", "%")}%`).limit(1);
    const fee = svc?.[0]?.fee || await getRate(hospitalId, "ivf_cycle", fallbackFee);
    const gstPct = svc?.[0]?.gst_percent || 0;
    const gstAmt = calcGST(fee, gstPct);
    const total = fee + gstAmt;

    const billNumber = await generateBillNumber(hospitalId, "IVF");

    const { data: bill, error } = await supabase.from("bills").insert({
      hospital_id: hospitalId,
      patient_id: patientId,
      bill_number: billNumber,
      bill_type: "opd",
      bill_date: new Date().toISOString().split("T")[0],
      subtotal: fee,
      gst_amount: gstAmt,
      total_amount: total,
      patient_payable: total,
      paid_amount: 0,
      balance_due: total,
      payment_status: "unpaid",
      bill_status: "final",
      created_by: userId,
    }).select("id").maybeSingle();

    if (error || !bill) { console.error("IVF billing failed:", error); return; }

    await supabase.from("bill_line_items").insert({
      hospital_id: hospitalId,
      bill_id: bill.id,
      description: `IVF: ${milestoneLabel} - ${coupleCode} Cycle #${cycleNumber}`,
      item_type: milestoneType,
      unit_rate: fee,
      quantity: 1,
      taxable_amount: fee,
      gst_percent: gstPct,
      gst_amount: gstAmt,
      total_amount: total,
    });

    recordServiceCharge({
      hospitalId, patientId,
      serviceModule: "ivf",
      serviceName: `IVF: ${milestoneLabel} - ${coupleCode} Cycle #${cycleNumber}`,
      unitRate: fee, gstPercent: gstPct, gstAmount: gstAmt, totalAmount: total,
      billId: bill.id, performedBy: userId,
    });

    await recalculateBillTotalsSafe(bill.id);

    await autoPostJournalEntry({
      triggerEvent: "bill_finalized_opd",
      sourceModule: "ivf",
      sourceId: bill.id,
      amount: total,
      description: `IVF Revenue - ${milestoneLabel} - ${billNumber}`,
      hospitalId,
      postedBy: userId,
    });

    toast.success(`IVF billed: ₹${total.toLocaleString("en-IN")} (${milestoneLabel})`);
  } catch (err) {
    console.error("IVF billing error (non-blocking):", err);
  }
}

const CyclesTab = ({ showStartCycle, onCloseStartCycle, onRefreshKPIs }: Props) => {
  const [cycles, setCycles] = useState<any[]>([]);
  const [couples, setCouples] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Form
  const [coupleId, setCoupleId] = useState("");
  const [cycleType, setCycleType] = useState("");
  const [protocol, setProtocol] = useState("");
  const [saving, setSaving] = useState(false);

  const loadData = async () => {
    setLoading(true);
    const [cyclesRes, couplesRes] = await Promise.all([
      supabase.from("ivf_cycles").select("*").order("created_at", { ascending: false }),
      supabase.from("art_couples").select("id, couple_code, consent_obtained, female_patient_id").eq("is_active", true),
    ]);
    if (cyclesRes.error) console.error(cyclesRes.error);
    if (couplesRes.error) console.error(couplesRes.error);
    setCycles(cyclesRes.data || []);
    setCouples(couplesRes.data || []);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const handleStartCycle = async () => {
    if (!coupleId || !cycleType) { toast.error("Couple and cycle type are required"); return; }
    const couple = couples.find((c) => c.id === coupleId);
    if (!couple?.consent_obtained) { toast.error("Cannot start cycle — consent not obtained"); return; }

    setSaving(true);
    const { data: userData } = await supabase.from("users").select("id, hospital_id").limit(1).maybeSingle();
    const hospitalId = userData?.hospital_id;
    const existingCount = cycles.filter((c) => c.couple_id === coupleId).length;

    const { error } = await supabase.from("ivf_cycles").insert({
      hospital_id: hospitalId,
      couple_id: coupleId,
      cycle_number: existingCount + 1,
      cycle_type: cycleType,
      protocol: protocol || null,
      start_date: new Date().toISOString().split("T")[0],
    });

    if (error) { console.error(error); toast.error("Failed to start cycle"); }
    else {
      toast.success("Cycle started");

      // Bill the stimulation start milestone
      if (hospitalId && couple.female_patient_id) {
        const milestone = STATUS_BILLING_MAP["stimulation"];
        await billIVFMilestone({
          hospitalId,
          patientId: couple.female_patient_id,
          coupleCode: couple.couple_code,
          cycleNumber: existingCount + 1,
          milestoneType: milestone.itemType,
          milestoneLabel: milestone.label,
          fallbackFee: milestone.fallbackFee,
          userId: userData?.id || "",
        });
      }

      onCloseStartCycle();
      setCoupleId(""); setCycleType(""); setProtocol("");
      loadData();
      onRefreshKPIs();
    }
    setSaving(false);
  };

  /** Advance cycle status and trigger billing */
  const advanceCycleStatus = async (cycleId: string, newStatus: string) => {
    const cycle = cycles.find((c) => c.id === cycleId);
    if (!cycle) return;

    const { error } = await (supabase as any).from("ivf_cycles").update({ status: newStatus }).eq("id", cycleId);
    if (error) { toast.error("Status update failed"); return; }

    // Trigger billing for milestone
    const milestone = STATUS_BILLING_MAP[newStatus];
    if (milestone) {
      const couple = couples.find((cp) => cp.id === cycle.couple_id);
      const { data: userData } = await supabase.from("users").select("id, hospital_id").limit(1).maybeSingle();
      if (userData?.hospital_id && couple?.female_patient_id) {
        await billIVFMilestone({
          hospitalId: userData.hospital_id,
          patientId: couple.female_patient_id,
          coupleCode: couple?.couple_code || "—",
          cycleNumber: cycle.cycle_number || 1,
          milestoneType: milestone.itemType,
          milestoneLabel: milestone.label,
          fallbackFee: milestone.fallbackFee,
          userId: userData.id,
        });
      }
    }

    loadData();
    onRefreshKPIs();
  };

  const getStatusCycles = (status: string) => {
    if (status === "luteal_support") return cycles.filter((c) => ["luteal_support", "test_due"].includes(c.status));
    return cycles.filter((c) => c.status === status);
  };

  const typeLabel = (t: string) => t.toUpperCase().replace("_", " ");

  // Next status for each column
  const nextStatusMap: Record<string, string> = {
    stimulation: "opu_done",
    opu_done: "fertilization",
    fertilization: "et_done",
    et_done: "luteal_support",
  };

  return (
    <div className="space-y-4">
      {/* Kanban */}
      <div className="grid grid-cols-5 gap-3" style={{ minHeight: 300 }}>
        {STATUS_COLS.map((col) => (
          <div key={col.key} className={`rounded-lg border p-2 ${col.color}`}>
            <h3 className="text-xs font-semibold mb-2 px-1">{col.label} ({getStatusCycles(col.key).length})</h3>
            <div className="space-y-2 overflow-auto" style={{ maxHeight: 400 }}>
              {getStatusCycles(col.key).map((c) => {
                const couple = couples.find((cp) => cp.id === c.couple_id);
                const daysSinceStart = Math.floor((Date.now() - new Date(c.start_date).getTime()) / 86400000);
                const nextStatus = nextStatusMap[col.key];
                return (
                  <Card key={c.id} className="p-2 text-xs space-y-1">
                    <div className="font-mono font-medium">{couple?.couple_code || "—"}</div>
                    <Badge variant="outline" className="text-[10px]">{typeLabel(c.cycle_type)}</Badge>
                    <div className="text-muted-foreground">Day {daysSinceStart} • Cycle #{c.cycle_number}</div>
                    {c.protocol && <div className="text-muted-foreground">{c.protocol}</div>}
                    {nextStatus && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full h-6 text-[10px] mt-1"
                        onClick={() => advanceCycleStatus(c.id, nextStatus)}
                      >
                        → {STATUS_COLS.find(s => s.key === nextStatus)?.label || nextStatus}
                      </Button>
                    )}
                  </Card>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Start Cycle Modal */}
      <Dialog open={showStartCycle} onOpenChange={(o) => { if (!o) onCloseStartCycle(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Start New IVF Cycle</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Couple *</Label>
              <Select value={coupleId} onValueChange={setCoupleId}>
                <SelectTrigger><SelectValue placeholder="Select couple" /></SelectTrigger>
                <SelectContent>
                  {couples.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.couple_code} {!c.consent_obtained && "⚠️ No consent"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Cycle Type *</Label>
              <Select value={cycleType} onValueChange={setCycleType}>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {CYCLE_TYPES.map((t) => <SelectItem key={t} value={t}>{typeLabel(t)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Protocol</Label>
              <Select value={protocol} onValueChange={setProtocol}>
                <SelectTrigger><SelectValue placeholder="Select protocol" /></SelectTrigger>
                <SelectContent>
                  {PROTOCOLS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleStartCycle} disabled={saving} className="w-full">
              {saving ? "Starting…" : "Begin Cycle"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CyclesTab;
