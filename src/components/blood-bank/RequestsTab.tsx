import React, { useState, useEffect } from "react";
import { generateBillNumber } from "@/hooks/useBillNumber";
import { autoPostJournalEntry } from "@/lib/accounting";
import { recordServiceCharge } from "@/lib/serviceBilling";
import { calcGST } from "@/lib/currency";
import { getRate } from "@/lib/serviceRates";
import { logNABHEvidence } from "@/lib/nabh-evidence";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { formatBloodGroup, componentLabel, isABOCompatible, isRhCompatible } from "@/lib/bloodCompatibility";
import { formatDistanceToNow } from "date-fns";

interface Props {
  showModal: boolean;
  onCloseModal: () => void;
  onRefresh: () => void;
}

type BloodGroup = 'A' | 'B' | 'AB' | 'O';
type RhFactor = 'positive' | 'negative';

const RequestsTab: React.FC<Props> = ({ showModal, onCloseModal, onRefresh }) => {
  const { toast } = useToast();
  const [requests, setRequests] = useState<any[]>([]);
  const [selectedReq, setSelectedReq] = useState<any>(null);
  const [matchingUnits, setMatchingUnits] = useState<any[]>([]);
  const [form, setForm] = useState({ blood_group: 'O', rh_factor: 'positive', component: 'rbc', units_required: 1, urgency: 'routine', indication: '', patient_id: '' });
  const [patients, setPatients] = useState<any[]>([]);

  const fetchRequests = async () => {
    const { data } = await supabase.from("blood_requests").select("*, patients(full_name, uhid)").order("created_at", { ascending: false });
    if (data) setRequests(data);
  };

  const fetchPatients = async () => {
    const { data } = await supabase.from("patients").select("id, full_name, uhid, blood_group").limit(200);
    if (data) setPatients(data);
  };

  useEffect(() => { fetchRequests(); fetchPatients(); }, []);

  const selectRequest = async (req: any) => {
    setSelectedReq(req);
    // Fetch ALL available units of the requested component, then filter by ABO+Rh compatibility
    const { data } = await supabase.from("blood_units")
      .select("*")
      .eq("component", req.component)
      .in("status", ["available", "reserved"])
      .gt("expiry_at", new Date().toISOString())
      .order("expiry_at", { ascending: true });

    if (data) {
      const compatible = data.filter(u =>
        isABOCompatible(req.blood_group as BloodGroup, u.blood_group as BloodGroup) &&
        isRhCompatible(req.rh_factor as RhFactor, u.rh_factor as RhFactor)
      );
      setMatchingUnits(compatible);
    }
  };

  const reserveUnit = async (unitId: string) => {
    if (!selectedReq) return;
    await supabase.from("blood_units").update({ status: "reserved", reserved_for: selectedReq.patient_id }).eq("id", unitId);
    toast({ title: "Unit reserved", description: `Reserved for ${selectedReq.patients?.full_name}` });
    selectRequest(selectedReq);
    onRefresh();
  };

  const issueUnit = async (unit: any) => {
    if (!selectedReq) return;
    const { data: user } = await supabase.from("users").select("id, hospital_id").limit(1).maybeSingle();
    if (!user) return;
    const hospitalId = user.hospital_id;

    // Hard block: require a verified compatible cross-match record before issuing
    const { data: xm } = await (supabase as any)
      .from("cross_match_records")
      .select("id")
      .eq("patient_id", selectedReq.patient_id)
      .eq("unit_id", unit.id)
      .eq("result", "compatible")
      .maybeSingle();

    if (!xm) {
      toast({
        title: "Cross-match not verified",
        description: "A compatible cross-match result must be recorded in the Cross-Match tab before issuing this unit.",
        variant: "destructive",
      });
      return;
    }

    // Insert blood_issues record
    const { data: issueRecord, error } = await (supabase as any).from("blood_issues").insert({
      hospital_id: hospitalId,
      unit_id: unit.id,
      patient_id: selectedReq.patient_id,
      admission_id: selectedReq.admission_id || null,
      issued_by: user.id,
      issued_at: new Date().toISOString(),
    }).select("id, admission_id").maybeSingle();

    if (error) {
      toast({ title: "Issue failed", description: error.message, variant: "destructive" });
      return;
    }

    // Update unit status to issued
    await supabase.from("blood_units").update({ status: "issued" as any, issued_to: selectedReq.patient_id }).eq("id", unit.id);

    // Update request units_issued
    await (supabase as any).from("blood_requests").update({
      status: "fulfilled",
    }).eq("id", selectedReq.id);

    toast({ title: "Blood unit issued", description: `${unit.unit_number} issued to ${selectedReq.patients?.full_name}` });

    logNABHEvidence(hospitalId, "TMS.3",
      `Blood transfusion issued: Unit ${unit.unit_number}, ${unit.blood_group}${unit.rh_factor === "positive" ? "+" : "-"}, Patient ${selectedReq.patients?.full_name}. Cross-match verified — record ID: ${xm.id}.`);

    // Auto-bill blood product
    if (issueRecord?.admission_id) {
      await createBloodBankBill(hospitalId, issueRecord, unit);
    } else {
      // OPD blood issue — create standalone bill
      await createBloodBankOPDBill(hospitalId, selectedReq.patient_id, unit);
    }

    fetchRequests();
    onRefresh();
    setSelectedReq(null);
  };

  const createBloodBankBill = async (hospitalId: string, issue: any, unit: any) => {
    if (!issue.admission_id) return;

    // Get blood product rate from service_master
    const { data: rate } = await supabase
      .from("service_master")
      .select("fee, gst_percent, gst_applicable")
      .eq("hospital_id", hospitalId)
      .ilike("name", `%${unit.component || "blood"}%`)
      .maybeSingle();

    const fee = rate?.fee ? Number(rate.fee) : await getRate(hospitalId, "blood_unit", 1500);
    const gstPct = rate?.gst_applicable ? (Number(rate.gst_percent) || 0) : 0;
    const gst = calcGST(fee, gstPct);

    // Find IPD bill
    const { data: bill } = await supabase
      .from("bills")
      .select("id, patient_id")
      .eq("hospital_id", hospitalId)
      .eq("admission_id", issue.admission_id)
      .eq("bill_type", "ipd")
      .maybeSingle();

    if (!bill) return; // Bill doesn't exist yet — will be captured on auto-pull

    const dedupeKey = `blood_bank:issue:${issue.id ?? unit.unit_number}`;
    const { data: existingItem } = await supabase
      .from("bill_line_items")
      .select("id")
      .eq("bill_id", bill.id)
      .eq("source_dedupe_key", dedupeKey)
      .maybeSingle();

    if (existingItem) return; // Already billed — idempotency guard

    await supabase.from("bill_line_items").insert({
      hospital_id: hospitalId,
      bill_id: bill.id,
      item_type: "blood_product",
      description: `Blood Product: ${(unit.component || "Blood").toUpperCase()} — ${unit.blood_group}${unit.rh_factor === "positive" ? "+" : "-"} (Unit: ${unit.unit_number})`,
      quantity: 1,
      unit_rate: fee,
      taxable_amount: fee,
      gst_percent: gstPct,
      gst_amount: gst,
      total_amount: fee + gst,
      hsn_code: "999316",
      source_module: "blood_bank",
      source_record_id: issue.id ?? null,
      source_dedupe_key: dedupeKey,
    });

    recordServiceCharge({
      hospitalId, patientId: bill.patient_id, admissionId: issue.admission_id,
      serviceModule: "blood_bank",
      serviceRefId: issue.id ?? null,
      serviceName: `Blood Product: ${(unit.component || "Blood").toUpperCase()}`,
      unitRate: fee, gstPercent: gstPct, gstAmount: gst, totalAmount: fee + gst,
      billId: bill.id,
    });

    // Mark blood_issues as billed
    if (issue.id) {
      await (supabase as any).from("blood_issues").update({
        billing_status: "billed", bill_id: bill.id,
      }).eq("id", issue.id);
    }

    toast({ title: `Blood product charged: ₹${(fee + gst).toLocaleString("en-IN")}` });

    const { data: { user: authUser } } = await supabase.auth.getUser();
    await autoPostJournalEntry({
      triggerEvent: "bill_finalized_blood_bank",
      sourceModule: "blood_bank",
      sourceId: bill.id,
      amount: fee + gst,
      description: `Blood Bank Revenue - ${(unit.component || "Blood").toUpperCase()}`,
      hospitalId,
      postedBy: authUser?.id || "",
    });
  };

  const createBloodBankOPDBill = async (hospitalId: string, patientId: string, unit: any) => {
    const { data: rate } = await supabase
      .from("service_master")
      .select("fee, gst_percent, gst_applicable")
      .eq("hospital_id", hospitalId)
      .ilike("name", `%${unit.component || "blood"}%`)
      .maybeSingle();

    const fee = rate?.fee ? Number(rate.fee) : await getRate(hospitalId, "blood_unit", 1500);
    const gstPct = rate?.gst_applicable ? (Number(rate.gst_percent) || 0) : 0;
    const gst = calcGST(fee, gstPct);

    const billNum = await generateBillNumber(hospitalId, "BLOOD");
    const { data: newBill } = await supabase.from("bills").insert({
      hospital_id: hospitalId,
      patient_id: patientId,
      bill_number: billNum,
      bill_type: "opd",
      bill_date: new Date().toISOString().split("T")[0],
      bill_status: "final",
      payment_status: "unpaid",
      total_amount: fee + gst,
      balance_due: fee + gst,
      subtotal: fee,
      gst_amount: gst,
      taxable_amount: fee,
      patient_payable: fee + gst,
    }).select("id").maybeSingle();

    if (newBill) {
      await supabase.from("bill_line_items").insert({
        hospital_id: hospitalId,
        bill_id: newBill.id,
        item_type: "blood_product",
        description: `Blood Product: ${(unit.component || "Blood").toUpperCase()} — ${unit.blood_group}${unit.rh_factor === "positive" ? "+" : "-"} (Unit: ${unit.unit_number})`,
        quantity: 1,
        unit_rate: fee,
        taxable_amount: fee,
        gst_percent: gstPct,
        gst_amount: gst,
        total_amount: fee + gst,
        hsn_code: "999316",
        source_module: "blood_bank",
      });

      recordServiceCharge({
        hospitalId, patientId,
        serviceModule: "blood_bank",
        serviceName: `Blood Product: ${(unit.component || "Blood").toUpperCase()}`,
        unitRate: fee, gstPercent: gstPct, gstAmount: gst, totalAmount: fee + gst,
        billId: newBill.id,
      });

      const { data: { user: authUser } } = await supabase.auth.getUser();
      await autoPostJournalEntry({
        triggerEvent: "bill_finalized_blood_bank",
        sourceModule: "blood_bank",
        sourceId: newBill.id,
        amount: fee + gst,
        description: `Blood Bank OPD Revenue - Bill ${billNum}`,
        hospitalId,
        postedBy: authUser?.id || "",
      });

      toast({ title: `Blood product billed: ₹${(fee + gst).toLocaleString("en-IN")}` });
    }
  };

  const submitRequest = async () => {
    if (!form.patient_id || !form.indication) {
      toast({ title: "Fill all required fields", variant: "destructive" });
      return;
    }
    const { data: user } = await supabase.from("users").select("id, hospital_id").limit(1).maybeSingle();
    if (!user) return;
    await supabase.from("blood_requests").insert({
      hospital_id: user.hospital_id,
      patient_id: form.patient_id,
      requested_by: user.id,
      blood_group: form.blood_group,
      rh_factor: form.rh_factor,
      component: form.component,
      units_required: form.units_required,
      urgency: form.urgency,
      indication: form.indication,
    });
    toast({ title: "Blood request submitted" });
    onCloseModal();
    fetchRequests();
  };

  const urgencyBadge = (u: string) => {
    if (u === "emergency") return <Badge className="bg-red-100 text-red-700 text-[10px]">🚨 EMERGENCY</Badge>;
    if (u === "urgent") return <Badge className="bg-amber-100 text-amber-700 text-[10px]">⚡ URGENT</Badge>;
    return <Badge className="bg-muted text-muted-foreground text-[10px]">📋 Routine</Badge>;
  };

  return (
    <div className="flex h-full">
      {/* Left panel */}
      <div className="w-[320px] border-r border-border overflow-y-auto p-3 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Pending Requests</p>
        {requests.filter(r => r.status === 'pending' || r.status === 'processing').map(req => (
          <button
            key={req.id}
            onClick={() => selectRequest(req)}
            className={`w-full text-left p-3 rounded-lg border transition-colors ${selectedReq?.id === req.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{req.patients?.full_name || "Patient"}</span>
              {urgencyBadge(req.urgency)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">{req.patients?.uhid}</p>
            <p className="text-xs mt-1">
              <span className="font-semibold">{formatBloodGroup(req.blood_group, req.rh_factor)}</span> · {componentLabel(req.component)} · {req.units_required} units
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">{formatDistanceToNow(new Date(req.created_at), { addSuffix: true })}</p>
          </button>
        ))}
        {requests.filter(r => r.status === 'pending' || r.status === 'processing').length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-8">No pending requests</p>
        )}
      </div>

      {/* Right panel */}
      <div className="flex-1 overflow-y-auto p-4">
        {selectedReq ? (
          <div className="space-y-4">
            <div className="bg-muted/30 rounded-lg p-4">
              <h3 className="text-sm font-semibold">{selectedReq.patients?.full_name}</h3>
              <p className="text-xs text-muted-foreground">{selectedReq.patients?.uhid} · {formatBloodGroup(selectedReq.blood_group, selectedReq.rh_factor)}</p>
              <p className="text-xs mt-1">Need: {selectedReq.units_required} × {componentLabel(selectedReq.component)}</p>
              <p className="text-xs text-muted-foreground">Indication: {selectedReq.indication}</p>
            </div>
            <div>
              <p className="text-sm font-semibold mb-2">Available Compatible Units (FEFO)</p>
              {matchingUnits.length === 0 ? (
                <p className="text-xs text-red-600">No compatible units available. Consider external requisition.</p>
              ) : (
                <div className="space-y-1">
                  {matchingUnits.map(u => {
                    const isExact = u.blood_group === selectedReq.blood_group && u.rh_factor === selectedReq.rh_factor;
                    return (
                      <div key={u.id} className={`flex items-center justify-between p-2 border rounded text-xs ${isExact ? "border-green-300 bg-green-50" : "border-amber-300 bg-amber-50"}`}>
                        <span className="font-mono">{u.unit_number}</span>
                        <span className="font-semibold">{formatBloodGroup(u.blood_group, u.rh_factor)}</span>
                        <span>{componentLabel(u.component)}</span>
                        <span>{u.volume_ml}ml</span>
                        <span>{u.storage_location}</span>
                        {u.status === "available" && <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => reserveUnit(u.id)}>Reserve</Button>}
                        {u.status === "reserved" && <Button size="sm" className="h-6 text-[10px] bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => issueUnit(u)}>✓ Issue</Button>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700">
              <p className="font-semibold">ABO Compatibility Guide</p>
              <p>O- is universal RBC donor. AB+ is universal recipient.</p>
              <p className="mt-1">If exact match unavailable: A→A,O | B→B,O | AB→any | O→O only</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-12">Select a request to view matching units</p>
        )}
      </div>

      {/* New Request Modal */}
      <Dialog open={showModal} onOpenChange={onCloseModal}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>New Blood Request</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Patient</Label>
              <Select value={form.patient_id} onValueChange={v => setForm(f => ({ ...f, patient_id: v }))}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Select patient" /></SelectTrigger>
                <SelectContent>
                  {patients.map(p => <SelectItem key={p.id} value={p.id}>{p.full_name} ({p.uhid})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Blood Group</Label>
                <Select value={form.blood_group} onValueChange={v => setForm(f => ({ ...f, blood_group: v }))}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['A','B','AB','O'].map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Rh Factor</Label>
                <Select value={form.rh_factor} onValueChange={v => setForm(f => ({ ...f, rh_factor: v }))}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="positive">Positive</SelectItem>
                    <SelectItem value="negative">Negative</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Component</Label>
                <Select value={form.component} onValueChange={v => setForm(f => ({ ...f, component: v }))}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="rbc">RBC</SelectItem>
                    <SelectItem value="whole_blood">Whole Blood</SelectItem>
                    <SelectItem value="ffp">FFP</SelectItem>
                    <SelectItem value="platelets">Platelets</SelectItem>
                    <SelectItem value="cryoprecipitate">Cryoprecipitate</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Units Required</Label>
                <Input type="number" min={1} max={10} value={form.units_required} onChange={e => setForm(f => ({ ...f, units_required: parseInt(e.target.value) || 1 }))} className="h-9" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Urgency</Label>
              <Select value={form.urgency} onValueChange={v => setForm(f => ({ ...f, urgency: v }))}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="routine">Routine</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                  <SelectItem value="emergency">Emergency</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Indication</Label>
              <Textarea placeholder="Clinical indication for transfusion..." value={form.indication} onChange={e => setForm(f => ({ ...f, indication: e.target.value }))} rows={2} />
            </div>
            <Button className="w-full" onClick={submitRequest}>Submit Request</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default RequestsTab;
