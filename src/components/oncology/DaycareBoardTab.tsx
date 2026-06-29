import React, { useState, useEffect } from "react";
import { generateBillNumber } from "@/hooks/useBillNumber";
import { autoPostJournalEntry } from "@/lib/accounting";
import { getRate } from "@/lib/serviceRates";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ShieldAlert, CheckCircle2, Clock, AlertTriangle, XCircle } from "lucide-react";
import VialSharingCard from "./VialSharingCard";

interface DaycareBoardTabProps {
  showNewOrder: boolean;
  onCloseNewOrder: () => void;
  onRefresh: () => void;
}

const DaycareBoardTab: React.FC<DaycareBoardTabProps> = ({ showNewOrder, onCloseNewOrder, onRefresh }) => {
  const { toast } = useToast();
  const [chairs, setChairs] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [filter, setFilter] = useState("all");
  const [verifyOrderId, setVerifyOrderId] = useState<string | null>(null);
  const [assignModal, setAssignModal] = useState<{ orderId: string; patientId: string } | null>(null);
  const [selectedChairId, setSelectedChairId] = useState("");

  // New order form
  const [newOrderModal, setNewOrderModal] = useState(false);
  const [oncPatients, setOncPatients] = useState<any[]>([]);
  const [protocols, setProtocols] = useState<any[]>([]);
  const [newOrder, setNewOrder] = useState({ oncPatientId: "", cycleNumber: 1, dayOfCycle: 1, scheduledDate: new Date().toISOString().split("T")[0], anc: "", platelets: "", creatinine: "", bilirubin: "" });

  useEffect(() => { loadData(); }, []);
  useEffect(() => { if (showNewOrder) { setNewOrderModal(true); loadOncPatients(); } }, [showNewOrder]);

  const loadData = async () => {
    const today = new Date().toISOString().split("T")[0];
    const [cRes, oRes] = await Promise.all([
      (supabase as any).from("daycare_chairs").select("*").order("chair_name"),
      (supabase as any).from("chemo_orders").select("*, chemo_order_drugs(*), oncology_patients(*, patients(*)), chemo_protocols(*)").eq("scheduled_date", today).order("created_at", { ascending: false }),
    ]);
    setChairs(cRes.data || []);
    setOrders(oRes.data || []);
  };

  const loadOncPatients = async () => {
    const [pRes, prRes] = await Promise.all([
      (supabase as any).from("oncology_patients").select("*, patients(*), chemo_protocols(*)").eq("is_active", true),
      (supabase as any).from("chemo_protocols").select("*").eq("is_active", true),
    ]);
    setOncPatients(pRes.data || []);
    setProtocols(prRes.data || []);
  };

  const createOrder = async () => {
    const pat = oncPatients.find((p: any) => p.id === newOrder.oncPatientId);
    if (!pat) return;
    const protocol = pat.chemo_protocols || protocols.find((p: any) => p.id === pat.protocol_id);
    if (!protocol) { toast({ title: "No protocol assigned to this patient", variant: "destructive" }); return; }

    // Get current user's users.id for ordered_by FK
    let orderedBy = pat.treating_oncologist;
    if (!orderedBy) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: userData } = await supabase.from("users").select("id").eq("auth_user_id", user.id).maybeSingle();
        orderedBy = userData?.id;
      }
    }
    if (!orderedBy) { toast({ title: "Cannot determine ordering doctor", description: "Please log in or assign a treating oncologist", variant: "destructive" }); return; }

    const drugs = (protocol.drugs || []) as any[];
    const { data, error } = await (supabase as any).from("chemo_orders").insert({
      hospital_id: pat.hospital_id,
      patient_id: pat.patient_id,
      oncology_patient_id: pat.id,
      protocol_id: protocol.id,
      cycle_number: newOrder.cycleNumber,
      day_of_cycle: newOrder.dayOfCycle,
      scheduled_date: newOrder.scheduledDate,
      ordered_by: orderedBy,
      bsa_used: pat.bsa_m2 || 1.7,
      weight_at_order: pat.weight_kg || 60,
      anc: newOrder.anc ? parseFloat(newOrder.anc) : null,
      platelets: newOrder.platelets ? parseInt(newOrder.platelets) : null,
      creatinine: newOrder.creatinine ? parseFloat(newOrder.creatinine) : null,
      bilirubin: newOrder.bilirubin ? parseFloat(newOrder.bilirubin) : null,
      lab_date: new Date().toISOString().split("T")[0],
    }).select().maybeSingle();

    if (error) { toast({ title: "Error creating order", description: error.message, variant: "destructive" }); return; }

    // Insert drug line items
    const bsa = parseFloat(pat.bsa_m2) || 1.7;
    const drugInserts = drugs.map((d: any) => ({
      hospital_id: pat.hospital_id,
      order_id: data.id,
      drug_name: d.drug_name,
      planned_dose_mg_m2: d.dose_mg_m2,
      planned_dose_mg: Math.round(d.dose_mg_m2 * bsa * 100) / 100,
      route: d.route,
      infusion_time_min: d.infusion_time_min,
    }));
    if (drugInserts.length > 0) {
      await (supabase as any).from("chemo_order_drugs").insert(drugInserts);
    }

    toast({ title: "Chemo order created successfully" });
    setNewOrderModal(false);
    onCloseNewOrder();
    loadData();
    onRefresh();
  };

  const handleVerifyStep = async (orderId: string, step: number) => {
    const order = orders.find((o: any) => o.id === orderId);
    if (!order) return;

    // Lab hold checks for step 4
    if (step === 4) {
      const holds: string[] = [];
      if (order.anc !== null && parseFloat(order.anc) < 1000) holds.push("ANC too low (<1000)");
      if (order.platelets !== null && order.platelets < 75000) holds.push("Platelets insufficient (<75,000)");
      if (order.creatinine !== null && parseFloat(order.creatinine) > 1.5) holds.push("Renal function impaired (Cr >1.5)");
      if (holds.length > 0) {
        await (supabase as any).from("chemo_orders").update({ status: "held", hold_reason: holds.join("; ") }).eq("id", orderId);
        toast({ title: "CYCLE HELD", description: holds.join("; "), variant: "destructive" });
        loadData();
        onRefresh();
        return;
      }
    }

    const now = new Date().toISOString();
    const update: any = {};
    update[`v${step}_protocol_confirmed`?.replace("1_protocol_confirmed", "") || ""] = true;
    // Build update based on step
    const fieldMap: Record<number, string> = { 1: "v1_protocol_confirmed", 2: "v2_dose_correct", 3: "v3_allergies_checked", 4: "v4_labs_reviewed", 5: "v5_pharmacist_signoff" };
    const timeMap: Record<number, string> = { 1: "v1_at", 2: "v2_at", 3: "v3_at", 4: "v4_at", 5: "v5_at" };

    const updateData: any = { [fieldMap[step]]: true, [timeMap[step]]: now };

    // Check if all 5 steps will be complete
    const allDone = [1, 2, 3, 4, 5].every((s) => s === step ? true : order[fieldMap[s]]);
    if (allDone) {
      updateData.dispensing_allowed = true;
      updateData.status = "verified";
    }

    await (supabase as any).from("chemo_orders").update(updateData).eq("id", orderId);
    toast({ title: `Step ${step} verified` });
    loadData();
    onRefresh();
  };

  const handleDispense = async (orderId: string) => {
    await (supabase as any).from("chemo_orders").update({ status: "dispensing" }).eq("id", orderId);
    toast({ title: "Dispensing authorised" });
    loadData();
    onRefresh();
  };

  const handleAssignChair = async () => {
    if (!assignModal || !selectedChairId) return;
    await Promise.all([
      (supabase as any).from("daycare_chairs").update({ status: "occupied", current_patient: assignModal.patientId, occupied_since: new Date().toISOString(), estimated_end: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString() }).eq("id", selectedChairId),
      (supabase as any).from("chemo_orders").update({ status: "administered" }).eq("id", assignModal.orderId),
    ]);
    toast({ title: "Infusion started" });
    setAssignModal(null);
    loadData();
    onRefresh();
  };

  const handleCompleteInfusion = async (chairId: string, orderId?: string) => {
    await (supabase as any).from("daycare_chairs").update({ status: "cleaning", current_patient: null, occupied_since: null, estimated_end: null }).eq("id", chairId);
    if (orderId) {
      // Idempotency: check if already billed
      const { data: existingOrder } = await (supabase as any)
        .from("chemo_orders").select("billing_status, hospital_id, patient_id, admission_id")
        .eq("id", orderId).maybeSingle();

      await (supabase as any).from("chemo_orders").update({ status: "completed" }).eq("id", orderId);

      if (existingOrder?.billing_status !== "billed") {
        const { data: order } = await (supabase as any)
          .from("chemo_orders")
          .select("*, chemo_order_drugs(*)")
          .eq("id", orderId)
          .maybeSingle();

        if (order?.patient_id) {
          const { data: user } = await supabase.from("users").select("hospital_id").limit(1).maybeSingle();
          const hospitalId = user?.hospital_id || order.hospital_id;
          const dedupeKey = `oncology:chemo:${orderId}`;

          if (hospitalId) {
            const perMg = await getRate(hospitalId, "chemo_per_mg", 50);
            const totalDrugCost = (order.chemo_order_drugs || [])
              .reduce((s: number, d: any) => s + (Number(d.planned_dose_mg || 0) * perMg), 0);
            if (totalDrugCost <= 0) {
              // No cost configured — record for leakage dashboard
              await (supabase as any).from("service_charges").insert({
                hospital_id: hospitalId, patient_id: order.patient_id,
                admission_id: order.admission_id || null,
                service_module: "oncology",
                service_ref_id: orderId,
                service_date: new Date().toISOString().split("T")[0],
                service_name: `Chemotherapy Cycle ${order.cycle_number || ""}`,
                quantity: 1, unit_rate: 0, gst_percent: 0, gst_amount: 0, total_amount: 0,
                billing_status: "unbilled",
                notes: "Drug cost = 0. Configure chemo drug rates in service master.",
              }).catch(() => {});
            } else {
              const billDate = new Date().toISOString().split("T")[0];
              const billNum = await generateBillNumber(hospitalId, "CHEMO");

              const { data: chemoBill } = await supabase.from("bills").insert({
                hospital_id: hospitalId,
                patient_id: order.patient_id,
                admission_id: order.admission_id || null,
                bill_number: billNum,
                bill_type: "daycare",
                bill_date: billDate,
                bill_status: "final",
                payment_status: "unpaid",
                total_amount: totalDrugCost,
                balance_due: totalDrugCost,
                subtotal: totalDrugCost,
                taxable_amount: totalDrugCost,
                patient_payable: totalDrugCost,
                notes: `Chemotherapy: ${order.cycle_number ? "Cycle " + order.cycle_number : ""}`,
              }).select("id").maybeSingle();

              if (chemoBill) {
                // Dedupe guard on line item
                const { data: existingItem } = await (supabase as any)
                  .from("bill_line_items").select("id")
                  .eq("bill_id", chemoBill.id).eq("source_dedupe_key", dedupeKey).maybeSingle();

                if (!existingItem) {
                  await (supabase as any).from("bill_line_items").insert({
                    hospital_id: hospitalId, bill_id: chemoBill.id,
                    item_type: "daycare",
                    description: `Chemotherapy Cycle ${order.cycle_number || ""} — ${(order.chemo_order_drugs || []).map((d: any) => d.drug_name).join(", ")}`,
                    quantity: 1, unit_rate: totalDrugCost,
                    taxable_amount: totalDrugCost, gst_percent: 0,
                    gst_amount: 0, total_amount: totalDrugCost,
                    source_module: "oncology",
                    source_record_id: orderId,
                    source_dedupe_key: dedupeKey,
                  });
                }

                const { data: { user: authUser } } = await supabase.auth.getUser();
                await autoPostJournalEntry({
                  triggerEvent: "bill_finalized_oncology",
                  sourceModule: "oncology",
                  sourceId: chemoBill.id,
                  amount: totalDrugCost,
                  description: `Oncology Daycare Revenue - Bill ${billNum}`,
                  hospitalId,
                  postedBy: authUser?.id || "",
                });

                // Mark chemo_order as billed
                await (supabase as any).from("chemo_orders").update({
                  billing_status: "billed", bill_id: chemoBill.id,
                  billed_at: new Date().toISOString(), billed_amount: totalDrugCost,
                }).eq("id", orderId);
              }
            }
          }
        }
      }
    }
    toast({ title: "Infusion completed" });
    loadData();
    onRefresh();
  };

  const filteredOrders = orders.filter((o: any) => {
    if (filter === "all") return true;
    if (filter === "pending") return o.status === "pending_verification";
    if (filter === "ready") return o.status === "verified" || o.status === "dispensing";
    if (filter === "completed") return o.status === "completed";
    return true;
  });

  const availableChairs = chairs.filter((c: any) => c.status === "available");

  const getVerificationCount = (order: any) => [order.v1_protocol_confirmed, order.v2_dose_correct, order.v3_allergies_checked, order.v4_labs_reviewed, order.v5_pharmacist_signoff].filter(Boolean).length;

  return (
    <div className="space-y-4 mt-3">
      {/* Vial Sharing Opportunities */}
      <VialSharingCard orders={orders} />

      {/* Chair Grid */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground mb-2">CHAIR STATUS</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
          {chairs.map((chair: any) => {
            const occupiedOrder = orders.find((o: any) => o.patient_id === chair.current_patient && o.status === "administered");
            return (
              <Card key={chair.id} className={`${chair.status === "available" ? "border-green-400 bg-background" : chair.status === "occupied" ? "border-blue-400 bg-blue-50/50" : "border-muted bg-muted/30"}`}>
                <CardContent className="p-3">
                  <p className="text-sm font-bold">{chair.chair_name}</p>
                  <Badge variant="outline" className="text-[10px] mt-1">{chair.chair_type}</Badge>
                  {chair.status === "available" && <p className="text-xs text-green-600 mt-2 font-medium">● Available</p>}
                  {chair.status === "occupied" && (
                    <div className="mt-2 space-y-1">
                      <p className="text-xs text-blue-600 font-medium">● In Use</p>
                      {occupiedOrder && <p className="text-[11px] text-muted-foreground truncate">{occupiedOrder.oncology_patients?.patients?.full_name}</p>}
                      {chair.estimated_end && (
                        <p className="text-[10px] text-muted-foreground">Est. end: {new Date(chair.estimated_end).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</p>
                      )}
                      <Button size="sm" variant="outline" className="w-full text-xs h-7 mt-1" onClick={() => handleCompleteInfusion(chair.id, occupiedOrder?.id)}>✓ Complete</Button>
                    </div>
                  )}
                  {chair.status === "cleaning" && <p className="text-xs text-amber-600 mt-2 font-medium">● Cleaning</p>}
                  {chair.status === "maintenance" && <p className="text-xs text-muted-foreground mt-2">● Maintenance</p>}
                </CardContent>
              </Card>
            );
          })}
        </div>
        <div className="mt-2 flex gap-4 text-[11px] text-muted-foreground bg-muted/30 rounded p-2">
          <span>🟢 Available</span>
          <span>🔵 Occupied — infusion in progress</span>
          <span>🟡 Cleaning — post-session</span>
        </div>
      </div>

      {/* Orders Filter */}
      <div className="flex gap-2">
        {[{ key: "all", label: "All" }, { key: "pending", label: "Pending Verification" }, { key: "ready", label: "Ready to Administer" }, { key: "completed", label: "Completed" }].map((f) => (
          <Button key={f.key} size="sm" variant={filter === f.key ? "default" : "outline"} onClick={() => setFilter(f.key)} className="text-xs">{f.label}</Button>
        ))}
      </div>

      {/* Today's Orders */}
      <div className="space-y-3">
        {filteredOrders.length === 0 && <p className="text-sm text-muted-foreground py-8 text-center">No orders for today</p>}
        {filteredOrders.map((order: any) => {
          const vCount = getVerificationCount(order);
          const patName = order.oncology_patients?.patients?.full_name || "Unknown";
          const protocolName = order.chemo_protocols?.protocol_name || "Unknown";
          const drugs = order.chemo_order_drugs || [];

          if (order.status === "pending_verification" || order.status === "held") {
            return (
              <Card key={order.id} className={`${order.status === "held" ? "border-l-4 border-l-destructive bg-destructive/5" : "border-l-4 border-l-amber-500 bg-amber-50/50"}`}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-sm font-bold">{patName}</p>
                      <p className="text-xs text-muted-foreground">{protocolName} · Cycle {order.cycle_number} Day {order.day_of_cycle}</p>
                    </div>
                    {order.status === "held" ? (
                      <Badge variant="destructive">HELD: {order.hold_reason}</Badge>
                    ) : (
                      <Badge className="bg-amber-100 text-amber-800 border-amber-300">⏳ {vCount}/5 verified</Badge>
                    )}
                  </div>

                  {order.status !== "held" && (
                    <div className="space-y-2 border rounded-md p-3 bg-background">
                      {/* Step 1 */}
                      <VerificationStep step={1} label="Protocol Confirmed" sublabel={`Protocol ${protocolName} confirmed for this patient's diagnosis`} done={order.v1_protocol_confirmed} doneAt={order.v1_at} onVerify={() => handleVerifyStep(order.id, 1)} />
                      {/* Step 2 */}
                      <VerificationStep step={2} label="Dose Correct" done={order.v2_dose_correct} doneAt={order.v2_at} onVerify={() => handleVerifyStep(order.id, 2)}>
                        <div className="text-xs space-y-1 ml-8 mb-1">
                          <p className="text-muted-foreground">BSA = {order.bsa_used} m²</p>
                          {drugs.map((d: any) => {
                            const protocolDose = d.planned_dose_mg_m2 ? (d.planned_dose_mg_m2 * parseFloat(order.bsa_used)) : d.planned_dose_mg;
                            const deviation = d.planned_dose_mg && protocolDose ? Math.abs(((d.planned_dose_mg - protocolDose) / protocolDose) * 100) : 0;
                            return (
                              <div key={d.id}>
                                <span className="font-medium">{d.drug_name}</span>: {d.planned_dose_mg_m2} mg/m² × {order.bsa_used} = <span className="font-bold">{d.planned_dose_mg} mg</span> ({d.route})
                                {deviation > 10 && <span className="text-destructive ml-2 font-bold">⚠️ {deviation.toFixed(0)}% deviation!</span>}
                              </div>
                            );
                          })}
                        </div>
                      </VerificationStep>
                      {/* Step 3 */}
                      <VerificationStep step={3} label="Allergies Checked" sublabel="Allergy cross-check completed" done={order.v3_allergies_checked} doneAt={order.v3_at} onVerify={() => handleVerifyStep(order.id, 3)} />
                      {/* Step 4 */}
                      <VerificationStep step={4} label="Labs Reviewed" done={order.v4_labs_reviewed} doneAt={order.v4_at} onVerify={() => handleVerifyStep(order.id, 4)}>
                        <div className="text-xs space-y-0.5 ml-8 mb-1">
                          <p>ANC: <span className={`font-bold ${order.anc !== null && parseFloat(order.anc) < 1000 ? "text-destructive" : "text-green-600"}`}>{order.anc ?? "N/A"}</span> /μL {order.anc !== null && parseFloat(order.anc) < 1000 && "⚠️ HOLD"}</p>
                          <p>Platelets: <span className={`font-bold ${order.platelets !== null && order.platelets < 75000 ? "text-destructive" : "text-green-600"}`}>{order.platelets?.toLocaleString("en-IN") ?? "N/A"}</span> /μL</p>
                          <p>Creatinine: <span className={`font-bold ${order.creatinine !== null && parseFloat(order.creatinine) > 1.5 ? "text-destructive" : "text-green-600"}`}>{order.creatinine ?? "N/A"}</span> mg/dL</p>
                          <p>Bilirubin: <span className={`font-bold ${order.bilirubin !== null && parseFloat(order.bilirubin) > 1.5 ? "text-destructive" : "text-green-600"}`}>{order.bilirubin ?? "N/A"}</span> mg/dL</p>
                        </div>
                      </VerificationStep>
                      {/* Step 5 */}
                      <VerificationStep step={5} label="Pharmacist Sign-Off" sublabel="I have independently verified all 4 steps above" done={order.v5_pharmacist_signoff} doneAt={order.v5_at} onVerify={() => handleVerifyStep(order.id, 5)} />

                      {/* Dispense Button */}
                      <div className="mt-3 pt-3 border-t">
                        {vCount === 5 ? (
                          <Button className="w-full bg-green-600 hover:bg-green-700 text-white" onClick={() => handleDispense(order.id)}>
                            <CheckCircle2 className="mr-2 h-4 w-4" /> All Verified — Dispense
                          </Button>
                        ) : (
                          <Button className="w-full" disabled variant="secondary">
                            <ShieldAlert className="mr-2 h-4 w-4" /> Dispensing Not Allowed — {vCount}/5 steps done
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          }

          if (order.status === "verified" || order.status === "dispensing") {
            return (
              <Card key={order.id} className="border-l-4 border-l-green-500 bg-green-50/50">
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-bold">{patName}</p>
                    <p className="text-xs text-muted-foreground">{protocolName} · Cycle {order.cycle_number}</p>
                    <Badge className="bg-green-100 text-green-800 mt-1">✅ Verified & Dispensed</Badge>
                  </div>
                  <Button size="sm" onClick={() => setAssignModal({ orderId: order.id, patientId: order.patient_id })}>▶ Assign Chair & Start</Button>
                </CardContent>
              </Card>
            );
          }

          return (
            <Card key={order.id} className="border-l-4 border-l-muted">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold">{patName}</p>
                  <p className="text-xs text-muted-foreground">{protocolName} · Cycle {order.cycle_number}</p>
                </div>
                <Badge variant="outline">{order.status}</Badge>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* New Order Modal */}
      <Dialog open={newOrderModal} onOpenChange={(o) => { setNewOrderModal(o); if (!o) onCloseNewOrder(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>New Chemo Order</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Patient</Label>
              <Select value={newOrder.oncPatientId} onValueChange={(v) => setNewOrder({ ...newOrder, oncPatientId: v })}>
                <SelectTrigger><SelectValue placeholder="Select oncology patient" /></SelectTrigger>
                <SelectContent>
                  {oncPatients.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>{p.patients?.full_name} — {p.primary_diagnosis}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div><Label>Cycle #</Label><Input type="number" min={1} value={newOrder.cycleNumber} onChange={(e) => setNewOrder({ ...newOrder, cycleNumber: parseInt(e.target.value) || 1 })} /></div>
              <div><Label>Day of Cycle</Label><Input type="number" min={1} value={newOrder.dayOfCycle} onChange={(e) => setNewOrder({ ...newOrder, dayOfCycle: parseInt(e.target.value) || 1 })} /></div>
              <div><Label>Scheduled Date</Label><Input type="date" value={newOrder.scheduledDate} onChange={(e) => setNewOrder({ ...newOrder, scheduledDate: e.target.value })} /></div>
            </div>
            <p className="text-xs font-semibold text-muted-foreground">Pre-Chemo Labs (optional — verified during step 4)</p>
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">ANC (/μL)</Label><Input value={newOrder.anc} onChange={(e) => setNewOrder({ ...newOrder, anc: e.target.value })} placeholder="e.g. 2500" /></div>
              <div><Label className="text-xs">Platelets (/μL)</Label><Input value={newOrder.platelets} onChange={(e) => setNewOrder({ ...newOrder, platelets: e.target.value })} placeholder="e.g. 150000" /></div>
              <div><Label className="text-xs">Creatinine (mg/dL)</Label><Input value={newOrder.creatinine} onChange={(e) => setNewOrder({ ...newOrder, creatinine: e.target.value })} placeholder="e.g. 0.9" /></div>
              <div><Label className="text-xs">Bilirubin (mg/dL)</Label><Input value={newOrder.bilirubin} onChange={(e) => setNewOrder({ ...newOrder, bilirubin: e.target.value })} placeholder="e.g. 0.5" /></div>
            </div>
            <Button className="w-full" onClick={createOrder}>Create Chemo Order</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Assign Chair Modal */}
      <Dialog open={!!assignModal} onOpenChange={(o) => !o && setAssignModal(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Assign Chair & Start Infusion</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Label>Select Available Chair</Label>
            <Select value={selectedChairId} onValueChange={setSelectedChairId}>
              <SelectTrigger><SelectValue placeholder="Choose chair" /></SelectTrigger>
              <SelectContent>
                {availableChairs.map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>{c.chair_name} ({c.chair_type})</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {availableChairs.length === 0 && <p className="text-xs text-destructive">No chairs available</p>}
            <Button className="w-full" onClick={handleAssignChair} disabled={!selectedChairId}>▶ Start Infusion</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// Verification step component
const VerificationStep: React.FC<{ step: number; label: string; sublabel?: string; done: boolean; doneAt?: string; onVerify: () => void; children?: React.ReactNode }> = ({ step, label, sublabel, done, doneAt, onVerify, children }) => (
  <div className={`rounded-md p-2 ${done ? "bg-green-50" : "bg-background"}`}>
    <div className="flex items-center gap-2">
      {done ? <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" /> : <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30 shrink-0" />}
      <div className="flex-1">
        <p className={`text-xs font-medium ${done ? "text-green-700" : ""}`}>Step {step}: {label}</p>
        {sublabel && <p className="text-[11px] text-muted-foreground">{sublabel}</p>}
        {done && doneAt && <p className="text-[10px] text-green-600">Verified at {new Date(doneAt).toLocaleString("en-IN")}</p>}
      </div>
      {!done && <Button size="sm" variant="outline" className="text-xs h-7" onClick={onVerify}>✓ Confirm</Button>}
    </div>
    {children}
  </div>
);

export default DaycareBoardTab;
