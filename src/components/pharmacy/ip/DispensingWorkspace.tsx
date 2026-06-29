import React, { useState, useEffect, useCallback } from "react";
import { generateBillNumber } from "@/hooks/useBillNumber";
import { autoPostJournalEntry } from "@/lib/accounting";
import { calcGST } from "@/lib/currency";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pill, Save, Check, RotateCcw, AlertTriangle, Loader2 } from "lucide-react";
import FiveRightsPanel from "./FiveRightsPanel";
import ADRCheckPanel from "./ADRCheckPanel";
import AllergyBanner from "@/components/clinical/AllergyBanner";
import { logNABHEvidence } from "@/lib/nabh-evidence";
import DrugReturnModal from "./DrugReturnModal";
import NDPSDualSignoffModal from "./NDPSDualSignoffModal";
import type { PrescriptionItem } from "./PrescriptionQueue";

interface DrugRow {
  drug_name: string;
  generic_name?: string;
  dose?: string;
  route?: string;
  frequency?: string;
  prescribed_qty: number;
  dispense_qty: number;
  is_ndps: boolean;
  drug_schedule?: string;
  drug_id?: string;
  batches: BatchOption[];
  selected_batch_id: string;
  mrp: number;
  stock_available: number;
  five_rights_verified: boolean;
  dispensed: boolean;
  ndps_second_pharmacist_id?: string;
}

interface BatchOption {
  id: string;
  batch_number: string;
  expiry_date: string;
  quantity_available: number;
  mrp: number;
  sale_price: number;
  gst_percent: number;
  is_expiring: boolean;
}

interface PatientInfo {
  full_name: string;
  uhid: string;
  allergies?: string;
  gender?: string;
  dob?: string;
  blood_group?: string;
  phone?: string;
}

interface Props {
  hospitalId: string;
  prescription: PrescriptionItem | null;
  onDispensed: () => void;
  onPatientLoaded: (p: PatientInfo | null) => void;
  onDrugsLoaded: (drugs: { drug_name: string; available: number; nearest_expiry?: string }[]) => void;
}

const DispensingWorkspace: React.FC<Props> = ({ hospitalId, prescription, onDispensed, onPatientLoaded, onDrugsLoaded }) => {
  const { toast } = useToast();
  const [drugRows, setDrugRows] = useState<DrugRow[]>([]);
  const [patient, setPatient] = useState<PatientInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [fiveRightsIdx, setFiveRightsIdx] = useState<number | null>(null);
  const [dispensing, setDispensing] = useState(false);
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [ndpsModalOpen, setNdpsModalOpen] = useState(false);
  const [ndpsApprovedCountersignerId, setNdpsApprovedCountersignerId] = useState<string | null>(null);
  const [ndpsPrescriberLicence, setNdpsPrescriberLicence] = useState("");
  const [currentDispensingId, setCurrentDispensingId] = useState<string | null>(null);

  const loadPrescription = useCallback(async () => {
    if (!prescription) {
      setDrugRows([]);
      setPatient(null);
      onPatientLoaded(null);
      onDrugsLoaded([]);
      return;
    }

    setLoading(true);

    // Fetch patient
    const { data: patientData } = await supabase
      .from("patients")
      .select("full_name, uhid, allergies, gender, dob, blood_group, phone")
      .eq("id", prescription.patient_id)
      .maybeSingle();

    if (patientData) {
      setPatient(patientData as PatientInfo);
      // Get admission info for patient panel
      let ward_name = "", bed_number = "", admitted_at = "";
      if (prescription.admission_id) {
        const { data: adm } = await supabase
          .from("admissions")
          .select("admitted_at, wards(name), beds(bed_number)")
          .eq("id", prescription.admission_id)
          .maybeSingle();
        if (adm) {
          ward_name = (adm.wards as any)?.name || "";
          bed_number = (adm.beds as any)?.bed_number || "";
          admitted_at = adm.admitted_at || "";
        }
      }
      onPatientLoaded({ ...patientData, ward_name, bed_number, admitted_at } as any);
    }

    // Get drugs list
    let drugsList: any[] = [];

    if (prescription.source === "prescription" && prescription.drugs) {
      drugsList = Array.isArray(prescription.drugs) ? prescription.drugs : [];
    } else if (prescription.prescription_id) {
      const { data: presc } = await supabase
        .from("prescriptions")
        .select("drugs")
        .eq("id", prescription.prescription_id)
        .maybeSingle();
      drugsList = Array.isArray(presc?.drugs) ? presc.drugs : [];
    }

    // If no drugs from prescription, check ipd_medications for admission
    if (drugsList.length === 0 && prescription.admission_id) {
      const { data: meds } = await supabase
        .from("ipd_medications")
        .select("*")
        .eq("admission_id", prescription.admission_id)
        .eq("is_active", true);
      drugsList = (meds || []).map(m => ({
        drug_name: m.drug_name,
        dose: m.dose,
        route: m.route,
        frequency: m.frequency,
        quantity: 1,
      }));
    }

    // Build drug rows with batch info
    const rows: DrugRow[] = [];
    const stockInfo: { drug_name: string; available: number; nearest_expiry?: string }[] = [];

    for (const drug of drugsList) {
      const drugName = drug.drug_name || drug.name || "";
      
      // Find drug in master
      const { data: masterDrug } = await supabase
        .from("drug_master")
        .select("id, drug_name, generic_name, is_ndps, drug_schedule")
        .eq("hospital_id", hospitalId)
        .ilike("drug_name", `%${drugName}%`)
        .limit(1)
        .maybeSingle();

      // Find batches (FEFO) — exclude quarantined and destroyed stock
      const { data: batchData } = await (supabase as any)
        .from("drug_batches")
        .select("*")
        .eq("hospital_id", hospitalId)
        .eq("drug_id", masterDrug?.id || "")
        .gt("quantity_available", 0)
        .gt("expiry_date", new Date().toISOString().split("T")[0])
        .eq("is_active", true)
        .neq("status", "quarantined")
        .neq("status", "destroyed")
        .order("expiry_date", { ascending: true });

      const batches: BatchOption[] = (batchData || []).map(b => ({
        id: b.id,
        batch_number: b.batch_number,
        expiry_date: b.expiry_date,
        quantity_available: b.quantity_available,
        mrp: Number(b.mrp),
        sale_price: Number(b.sale_price),
        gst_percent: Number(b.gst_percent || 12),
        is_expiring: new Date(b.expiry_date) <= new Date(Date.now() + 30 * 86400000),
      }));

      const totalStock = batches.reduce((s, b) => s + b.quantity_available, 0);
      const firstBatch = batches[0];

      rows.push({
        drug_name: drugName,
        generic_name: masterDrug?.generic_name || "",
        dose: drug.dose || drug.dosage || "",
        route: drug.route || "Oral",
        frequency: drug.frequency || "",
        prescribed_qty: drug.quantity || drug.qty || 1,
        dispense_qty: Math.min(drug.quantity || drug.qty || 1, totalStock),
        is_ndps: masterDrug?.is_ndps || false,
        drug_schedule: masterDrug?.drug_schedule || "",
        drug_id: masterDrug?.id,
        batches,
        selected_batch_id: firstBatch?.id || "",
        mrp: firstBatch?.mrp || 0,
        stock_available: totalStock,
        five_rights_verified: false,
        dispensed: false,
      });

      stockInfo.push({
        drug_name: drugName,
        available: totalStock,
        nearest_expiry: firstBatch?.expiry_date,
      });
    }

    setDrugRows(rows);
    onDrugsLoaded(stockInfo);
    setLoading(false);
  }, [prescription, hospitalId, onPatientLoaded, onDrugsLoaded]);

  useEffect(() => { loadPrescription(); }, [loadPrescription]);

  const updateRow = (idx: number, updates: Partial<DrugRow>) => {
    setDrugRows(prev => prev.map((r, i) => i === idx ? { ...r, ...updates } : r));
  };

  const handleBatchChange = (idx: number, batchId: string) => {
    const batch = drugRows[idx].batches.find(b => b.id === batchId);
    updateRow(idx, {
      selected_batch_id: batchId,
      mrp: batch?.mrp || 0,
    });
  };

  const handleFiveRightsConfirm = (secondPharmacistId?: string) => {
    if (fiveRightsIdx !== null) {
      updateRow(fiveRightsIdx, {
        five_rights_verified: true,
        ndps_second_pharmacist_id: secondPharmacistId,
      });
      setFiveRightsIdx(null);
    }
  };

  const allVerified = drugRows.length > 0 && drugRows.every(r => r.five_rights_verified || r.dispense_qty === 0);
  const ndpsRows = drugRows.filter(r => r.is_ndps && r.dispense_qty > 0);
  // Allow clicking Dispense even with NDPS drugs present — modal intercepts for dual sign-off
  const canDispenseAll = allVerified && !dispensing;

  const handleNdpsApproved = (countersignerId: string, prescriberLicence: string) => {
    setNdpsApprovedCountersignerId(countersignerId);
    setNdpsPrescriberLicence(prescriberLicence);
    setNdpsModalOpen(false);
    // Pass values directly to avoid stale closure on ndpsApprovedCountersignerId
    handleDispenseAll(countersignerId, prescriberLicence);
  };

  const handleDispenseAll = async (ndpsCountersignerId?: string, ndpsLicence?: string) => {
    if (!prescription || !patient) return;
    setDispensing(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { data: userData } = await supabase
        .from("users")
        .select("id")
        .eq("auth_user_id", user.id)
        .maybeSingle();
      if (!userData) throw new Error("User not found");

      // Reuse cached dispensingId on re-entry after NDPS approval
      let dispensingId: string | null = currentDispensingId || (prescription.source === "dispensing" ? prescription.id : null);

      // Create dispensing record if from prescription source
      if (!dispensingId) {
        const dispNum = `DISP-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(Math.random() * 9000) + 1000}`;
        const { data: newDisp, error: dispErr } = await supabase
          .from("pharmacy_dispensing")
          .insert({
            hospital_id: hospitalId,
            dispensing_number: dispNum,
            patient_id: prescription.patient_id,
            admission_id: prescription.admission_id || null,
            prescription_id: prescription.prescription_id || null,
            dispensed_by: userData.id,
            dispensing_type: "ip",
            status: "dispensed",
          })
          .select("id")
          .maybeSingle();
        if (dispErr) throw dispErr;
        dispensingId = newDisp.id;
        setCurrentDispensingId(dispensingId);
      }

      // Use parameter values (from modal callback) or fall back to state
      const activeCountersignerId = ndpsCountersignerId ?? ndpsApprovedCountersignerId;
      const activePrescriberLicence = ndpsLicence ?? ndpsPrescriberLicence;

      // NDPS dual sign-off gate — intercept before any stock/register writes
      const currentNdpsRows = drugRows.filter(r => r.is_ndps && r.dispense_qty > 0);
      if (currentNdpsRows.length > 0 && !activeCountersignerId) {
        setNdpsModalOpen(true);
        setDispensing(false);
        return;
      }

      let totalAmount = 0;

      for (const row of drugRows) {
        if (row.dispense_qty <= 0 || !row.selected_batch_id) continue;

        const batch = row.batches.find(b => b.id === row.selected_batch_id);
        if (!batch) continue;

        const itemTotal = row.mrp * row.dispense_qty;
        totalAmount += itemTotal;

        // Deduct stock
        await supabase
          .from("drug_batches")
          .update({ quantity_available: batch.quantity_available - row.dispense_qty })
          .eq("id", row.selected_batch_id);

        // Insert dispensing item
        await supabase
          .from("pharmacy_dispensing_items")
          .insert({
            hospital_id: hospitalId,
            dispensing_id: dispensingId!,
            drug_id: row.drug_id!,
            batch_id: row.selected_batch_id,
            drug_name: row.drug_name,
            batch_number: batch.batch_number,
            expiry_date: batch.expiry_date,
            quantity_requested: row.prescribed_qty,
            quantity_dispensed: row.dispense_qty,
            unit_price: row.mrp,
            gst_percent: batch.gst_percent,
            total_price: itemTotal,
            five_rights_verified: row.five_rights_verified,
            is_ndps: row.is_ndps,
            ndps_second_pharmacist_id: row.ndps_second_pharmacist_id || null,
          });

        // NDPS register entry
        if (row.is_ndps && row.drug_id) {
          // Get current balance
          const { data: lastEntry } = await supabase
            .from("ndps_register")
            .select("balance_after")
            .eq("drug_id", row.drug_id)
            .eq("hospital_id", hospitalId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          const balance = (lastEntry?.balance_after || 0) - row.dispense_qty;

          await supabase
            .from("ndps_register")
            .insert({
              hospital_id:         hospitalId,
              drug_id:             row.drug_id,
              drug_name:           row.drug_name,
              drug_schedule:       row.drug_schedule || "X",
              transaction_type:    "issue",
              quantity:            row.dispense_qty,
              balance_after:       Math.max(0, Number(balance)),
              patient_name:        patient.full_name,
              pharmacist_id:       userData.id,
              second_pharmacist_id: activeCountersignerId || null,
              countersigned_by:    activeCountersignerId || null,
              countersigned_at:    activeCountersignerId ? new Date().toISOString() : null,
              prescriber_licence:  activePrescriberLicence || null,
            });
        }
      }

      // Update dispensing totals
      await supabase
        .from("pharmacy_dispensing")
        .update({
          status: "dispensed",
          total_amount: totalAmount,
          net_amount: totalAmount,
        })
        .eq("id", dispensingId!);

      // NABH evidence: MOM criterion (medication safety / 5-rights)
      logNABHEvidence(
        hospitalId,
        "MOM",
        `5-rights verified for ${patient.full_name}: ${drugRows.map(r => r.drug_name).join(", ")}. Dispensed ₹${totalAmount.toFixed(0)}.`
      );

      // Auto-create pharmacy bill in bills table for IPD billing sync
      if (prescription.admission_id && totalAmount > 0) {
        // Calculate actual GST from individual items
        let totalGst = 0;
        for (const row of drugRows) {
          if (row.dispense_qty <= 0 || !row.selected_batch_id) continue;
          const batch = row.batches.find(b => b.id === row.selected_batch_id);
          const batchGst = batch?.gst_percent || 5; // essential meds default 5%
          const itemTotal = row.mrp * row.dispense_qty;
          totalGst += calcGST(itemTotal, batchGst);
        }

        const billNum = await generateBillNumber(hospitalId, "PHARM");
        const { data: pharmBill } = await supabase.from("bills").insert({
          hospital_id: hospitalId,
          patient_id: prescription.patient_id,
          admission_id: prescription.admission_id,
          bill_number: billNum,
          bill_type: "pharmacy",
          bill_status: "final",
          bill_date: new Date().toISOString().split("T")[0],
          total_amount: totalAmount + totalGst,
          subtotal: totalAmount,
          gst_amount: totalGst,
          paid_amount: 0,
          balance_due: totalAmount + totalGst,
          payment_status: "unpaid",
          created_by: userData.id,
        }).select("id").maybeSingle();

        if (pharmBill) {
          await autoPostJournalEntry({
            triggerEvent: "bill_finalized_pharmacy",
            sourceModule: "pharmacy",
            sourceId: pharmBill.id,
            amount: totalAmount + totalGst,
            description: `Pharmacy Revenue - Bill ${billNum}`,
            hospitalId,
            postedBy: user.id,
          });
        }
      }

      // Auto-sync: mark pharmacy cleared if all IP meds for this admission are dispensed
      if (prescription.admission_id) {
        const { data: pendingDisp } = await supabase
          .from("pharmacy_dispensing")
          .select("id")
          .eq("admission_id", prescription.admission_id)
          .eq("hospital_id", hospitalId)
          .in("status", ["pending", "processing"])
          .limit(1);
        if (!pendingDisp || pendingDisp.length === 0) {
          await supabase.from("admissions")
            .update({ pharmacy_cleared: true })
            .eq("id", prescription.admission_id);
        }
      }

      toast({ title: `✓ Dispensed to ${patient.full_name} — ₹${totalAmount.toFixed(0)}` });
      // Reset NDPS sign-off state for next prescription
      setNdpsApprovedCountersignerId(null);
      setNdpsPrescriberLicence("");
      setCurrentDispensingId(null);
      onDispensed();
    } catch (err: any) {
      toast({ title: "Dispensing failed", description: err.message, variant: "destructive" });
    } finally {
      setDispensing(false);
    }
  };

  if (!prescription) {
    return (
      <div className="flex-1 flex items-center justify-center bg-muted/30">
        <div className="text-center space-y-2">
          <Pill size={48} className="mx-auto text-muted-foreground/30" />
          <p className="text-base text-muted-foreground">Select a prescription from the queue</p>
          <p className="text-[13px] text-muted-foreground/60">or create a manual dispense request</p>
        </div>
      </div>
    );
  }

  const total = drugRows.reduce((s, r) => s + r.mrp * r.dispense_qty, 0);
  const itemCount = drugRows.filter(r => r.dispense_qty > 0).length;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-muted/20 relative">
      {/* Patient Header */}
      <div className="h-[60px] flex-shrink-0 bg-card border-b border-border px-5 flex items-center gap-4">
        <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-[11px] font-bold">
          {patient?.full_name?.split(" ").map(n => n[0]).join("").slice(0, 2)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-bold text-foreground">{patient?.full_name}</p>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">{patient?.uhid}</Badge>
            {prescription.ward_name && (
              <span className="text-[10px] bg-muted px-2 py-0.5 rounded text-muted-foreground">
                {prescription.ward_name}{prescription.bed_number ? ` · Bed ${prescription.bed_number}` : ""}
              </span>
            )}
            {patient?.blood_group && (
              <span className="text-[10px] text-destructive font-bold">{patient.blood_group}</span>
            )}
          </div>
        </div>
        {patient?.allergies && (
          <div className="bg-destructive/10 text-destructive text-[11px] font-bold px-2.5 py-1 rounded-md">
            ⚠️ ALLERGIES: {patient.allergies}
          </div>
        )}
        <div className="text-right text-[11px] text-muted-foreground">
          {prescription.doctor_name && <p>Dr. {prescription.doctor_name}</p>}
        </div>
      </div>

      {/* Allergy Banner */}
      {patient?.allergies && (
        <div className="flex-shrink-0 px-5">
          <AllergyBanner allergies={patient.allergies} />
        </div>
      )}

      {/* ADR Check Panel — shown when drugs are loaded */}
      {drugRows.length > 0 && patient && (
        <div className="flex-shrink-0 px-5 py-2 border-b border-border bg-card space-y-1.5">
          {drugRows.map((row, idx) => (
            <ADRCheckPanel
              key={`adr-${idx}-${row.drug_name}`}
              drugName={row.drug_name}
              drugDose={row.dose || ""}
              currentMedications={drugRows.filter((_, i) => i !== idx).map(r => ({ drug_name: r.drug_name, dose: r.dose || "" }))}
              patientAllergies={patient.allergies ? patient.allergies.split(",").map((a: string) => a.trim()) : []}
              hospitalId={hospitalId}
              onAcknowledged={() => {}}
              onBlock={() => updateRow(idx, { dispense_qty: 0 })}
            />
          ))}
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-muted-foreground">Loading drugs…</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="bg-muted/50">
                <th className="text-left px-3 py-2 text-[11px] font-bold uppercase text-muted-foreground w-[180px]">Drug Name</th>
                <th className="text-center px-2 py-2 text-[11px] font-bold uppercase text-muted-foreground w-[80px]">Prescribed</th>
                <th className="text-center px-2 py-2 text-[11px] font-bold uppercase text-muted-foreground w-[100px]">Dispense Qty</th>
                <th className="text-left px-2 py-2 text-[11px] font-bold uppercase text-muted-foreground w-[150px]">Batch</th>
                <th className="text-center px-2 py-2 text-[11px] font-bold uppercase text-muted-foreground w-[70px]">MRP</th>
                <th className="text-center px-2 py-2 text-[11px] font-bold uppercase text-muted-foreground w-[70px]">Stock</th>
                <th className="text-center px-2 py-2 text-[11px] font-bold uppercase text-muted-foreground w-[60px]">5-Rights</th>
                <th className="text-center px-2 py-2 text-[11px] font-bold uppercase text-muted-foreground w-[80px]">Status</th>
              </tr>
            </thead>
            <tbody>
              {drugRows.map((row, idx) => {
                const allergyMatch = patient?.allergies?.toLowerCase().includes(row.drug_name.toLowerCase());
                return (
                  <tr
                    key={idx}
                    className={cn(
                      "border-b border-border/30 h-[52px]",
                      row.dispensed && "opacity-60",
                      allergyMatch && "bg-destructive/5",
                      row.stock_available === 0 && "bg-muted/50"
                    )}
                  >
                    {/* Drug Name */}
                    <td className="px-3 py-2">
                      <p className="text-[13px] font-bold text-foreground">{row.drug_name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {[row.dose, row.route, row.frequency].filter(Boolean).join(" · ")}
                      </p>
                      <div className="flex gap-1 mt-0.5">
                        {row.is_ndps && (
                          <span className="text-[9px] px-1.5 py-0 rounded bg-destructive/10 text-destructive font-bold">NDPS</span>
                        )}
                        {row.drug_schedule && row.drug_schedule !== "OTC" && !row.is_ndps && (
                          <span className="text-[9px] px-1.5 py-0 rounded bg-amber-100 text-amber-700 font-bold">{row.drug_schedule}</span>
                        )}
                        {allergyMatch && (
                          <span className="text-[9px] px-1.5 py-0 rounded bg-destructive/10 text-destructive font-bold">⚠️ ALLERGY</span>
                        )}
                      </div>
                    </td>

                    {/* Prescribed */}
                    <td className="text-center px-2 py-2 text-[13px]">{row.prescribed_qty}</td>

                    {/* Dispense Qty */}
                    <td className="text-center px-2 py-2">
                      <Input
                        type="number"
                        min={0}
                        max={row.stock_available}
                        value={row.dispense_qty}
                        onChange={e => updateRow(idx, { dispense_qty: Math.max(0, parseInt(e.target.value) || 0) })}
                        className={cn(
                          "w-[72px] h-9 text-center text-sm font-bold mx-auto",
                          row.dispense_qty > row.stock_available && "border-destructive"
                        )}
                        disabled={row.dispensed || row.stock_available === 0}
                      />
                    </td>

                    {/* Batch */}
                    <td className="px-2 py-2">
                      {row.batches.length > 0 ? (
                        <Select
                          value={row.selected_batch_id}
                          onValueChange={v => handleBatchChange(idx, v)}
                          disabled={row.dispensed}
                        >
                          <SelectTrigger className="h-9 text-[11px] w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {row.batches.map(b => (
                              <SelectItem key={b.id} value={b.id} className="text-[11px]">
                                {b.batch_number} · {new Date(b.expiry_date).toLocaleDateString("en-IN", { month: "short", year: "2-digit" })} · {b.quantity_available}u
                                {b.is_expiring && " ⚠️"}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-[11px] text-destructive font-bold">OUT OF STOCK</span>
                      )}
                      <p className="text-[9px] text-muted-foreground mt-0.5">FEFO auto-selected</p>
                    </td>

                    {/* MRP */}
                    <td className="text-center px-2 py-2">
                      <p className="text-xs">₹{row.mrp}</p>
                      <p className="text-[10px] text-muted-foreground">₹{(row.mrp * row.dispense_qty).toFixed(0)}</p>
                    </td>

                    {/* Stock */}
                    <td className="text-center px-2 py-2">
                      <span className={cn(
                        "text-[11px] font-medium",
                        row.stock_available > 20 ? "text-green-600" : row.stock_available >= 5 ? "text-amber-600" : "text-destructive"
                      )}>
                        {row.stock_available} left
                      </span>
                    </td>

                    {/* 5 Rights */}
                    <td className="text-center px-2 py-2">
                      <button
                        onClick={() => row.dispensed ? null : setFiveRightsIdx(idx)}
                        disabled={row.dispensed || row.dispense_qty === 0}
                        className={cn(
                          "w-5 h-5 rounded border-2 flex items-center justify-center transition-all mx-auto",
                          row.five_rights_verified
                            ? "bg-green-500 border-green-500 text-white"
                            : "border-muted-foreground/30 hover:border-primary",
                          (row.dispensed || row.dispense_qty === 0) && "opacity-40 cursor-not-allowed"
                        )}
                      >
                        {row.five_rights_verified && <Check size={12} />}
                      </button>
                    </td>

                    {/* Status */}
                    <td className="text-center px-2 py-2">
                      {row.dispensed ? (
                        <span className="text-[11px] text-green-600 font-medium">✓ Dispensed</span>
                      ) : row.stock_available === 0 ? (
                        <span className="text-[11px] text-destructive">No stock</span>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">Ready</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {drugRows.length === 0 && !loading && (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-muted-foreground text-sm">
                    No drugs found in this prescription
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* NDPS Dual Sign-Off Modal */}
      {ndpsModalOpen && patient && currentDispensingId && (
        <NDPSDualSignoffModal
          open={ndpsModalOpen}
          onClose={() => { setNdpsModalOpen(false); setDispensing(false); }}
          onApproved={handleNdpsApproved}
          ndpsRows={ndpsRows
            .filter(r => r.drug_id)
            .map(r => ({ drug_id: r.drug_id!, drug_name: r.drug_name, quantity: r.dispense_qty }))}
          patientName={patient.full_name}
          prescriberName={prescription.doctor_name || ""}
          dispensingId={currentDispensingId}
          hospitalId={hospitalId}
          prescriptionNumber={prescription.prescription_id || undefined}
        />
      )}

      {/* Drug Return Modal */}
      {showReturnModal && prescription.admission_id && patient && (
        <DrugReturnModal
          admissionId={prescription.admission_id}
          patientId={prescription.patient_id}
          patientName={patient.full_name}
          hospitalId={hospitalId}
          onClose={() => setShowReturnModal(false)}
          onComplete={() => { setShowReturnModal(false); onDispensed(); }}
        />
      )}

      {/* 5-Rights Panel */}
      {fiveRightsIdx !== null && patient && drugRows[fiveRightsIdx] && (
        <FiveRightsPanel
          drug={drugRows[fiveRightsIdx]}
          patient={patient}
          hospitalId={hospitalId}
          onConfirm={handleFiveRightsConfirm}
          onClose={() => setFiveRightsIdx(null)}
        />
      )}

      {/* Action Bar */}
      <div className="h-[56px] flex-shrink-0 bg-card border-t border-border px-5 flex items-center gap-3">
        <div>
          <span className="text-base font-bold text-foreground">Total: ₹{total.toFixed(0)}</span>
          <span className="text-[11px] text-muted-foreground ml-2">{itemCount} items</span>
        </div>
        <div className="flex-1" />
        {prescription.admission_id && (
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-9 text-amber-700 border-amber-300 hover:bg-amber-50"
            onClick={() => setShowReturnModal(true)}
          >
            <RotateCcw size={13} className="mr-1" /> Return Drugs
          </Button>
        )}
        <Button variant="ghost" size="sm" className="text-xs h-9">
          <Save size={14} className="mr-1" /> Save Partial
        </Button>
        <Button
          size="sm"
          className="h-10 px-6 text-xs font-bold"
          disabled={!canDispenseAll}
          onClick={handleDispenseAll}
        >
          {dispensing ? (
            <><Loader2 size={14} className="mr-1 animate-spin" /> Processing...</>
          ) : (
            <><Check size={14} className="mr-1" /> Dispense All</>
          )}
        </Button>
      </div>
    </div>
  );
};

export default DispensingWorkspace;
