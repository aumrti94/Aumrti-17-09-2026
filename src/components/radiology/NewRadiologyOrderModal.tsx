import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { X, Search, ArrowLeft, CheckCircle2, Printer, IndianRupee, Loader2 } from "lucide-react";
import { generateBillNumber } from "@/hooks/useBillNumber";
import { autoPostJournalEntry } from "@/lib/accounting";
import { recordServiceCharge } from "@/lib/serviceBilling";
import { postAncillaryOrderCharges } from "@/lib/ancillaryCharges";
import { fetchIpdAncillaryPolicy, resolveChargePaymentStatus } from "@/lib/ipdAncillaryGate";
import AdmissionLinker from "@/components/shared/AdmissionLinker";
import { logNABHEvidence } from "@/lib/nabh-evidence";
import { getPrescribedPending } from "@/lib/prescribedPending";
import { printBillById } from "@/lib/billPrint";
import { cn } from "@/lib/utils";
import { calcGST, roundCurrency } from "@/lib/currency";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Props {
  hospitalId: string;
  modalities: { id: string; name: string; modality_type: string; is_active: boolean }[];
  onClose: () => void;
  onCreated: () => void;
  preselectedPatient?: { id: string; full_name: string; uhid: string; gender?: string | null; dob?: string | null };
  preselectedStudyNames?: string[];
  linkedEncounterId?: string | null;
  linkedAdmissionId?: string | null;
}

interface PatientResult {
  id: string;
  full_name: string;
  uhid: string;
  gender: string | null;
  dob: string | null;
}

interface StudyMaster {
  id: string;
  study_name: string;
  fee: number;
  is_active: boolean;
  modality_id: string;
  modality_type: string;
  modality_name: string;
}

interface ModalityGroup {
  id: string;
  name: string;
  modality_type: string;
  studies: StudyMaster[];
}

interface SelectedStudy {
  name: string;
  modalityType: string;
  fee: number;
  studyMasterId?: string;
}

interface StudyRate {
  name: string;
  modalityType: string;
  rate: number;
  gstPct: number;
  gstAmt: number;
  total: number;
}

/**
 * Looks up each study's GST% from service_master (same gst_applicable/
 * gst_percent lookup pattern used elsewhere — e.g. RecordVaccineTab.tsx) —
 * previously this hardcoded gst_percent/gst_amount to 0 regardless of
 * configuration.
 */
async function buildStudyRates(hospitalId: string, studies: SelectedStudy[]): Promise<StudyRate[]> {
  return Promise.all(studies.map(async (s) => {
    const { data: svc } = await supabase
      .from("service_master")
      .select("gst_percent, gst_applicable")
      .eq("hospital_id", hospitalId)
      .ilike("name", `%${s.name}%`)
      .maybeSingle();
    const gstPct = svc?.gst_applicable ? (Number(svc.gst_percent) || 0) : 0;
    const gstAmt = calcGST(s.fee, gstPct);
    return { name: s.name, modalityType: s.modalityType, rate: s.fee, gstPct, gstAmt, total: roundCurrency(s.fee + gstAmt) };
  }));
}

type Step = "order" | "payment" | "success";

const NewRadiologyOrderModal: React.FC<Props> = ({
  hospitalId, onClose, onCreated,
  preselectedPatient, preselectedStudyNames = [], linkedEncounterId, linkedAdmissionId,
}) => {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("order");

  // Order step
  const [patients, setPatients] = useState<PatientResult[]>([]);
  const [patientSearch, setPatientSearch] = useState("");
  const [showPatientResults, setShowPatientResults] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<PatientResult | null>(
    preselectedPatient ? { ...preselectedPatient, gender: preselectedPatient.gender ?? null, dob: preselectedPatient.dob ?? null } : null
  );
  const [modalityGroups, setModalityGroups] = useState<ModalityGroup[]>([]);
  const [selectedStudies, setSelectedStudies] = useState<SelectedStudy[]>([]);
  const [customStudy, setCustomStudy] = useState("");
  const [customModalityType, setCustomModalityType] = useState("");
  const [priority, setPriority] = useState<"routine" | "urgent" | "stat">("routine");
  const [clinicalHistory, setClinicalHistory] = useState("");
  const [pendingStudyNames, setPendingStudyNames] = useState<string[]>([]);
  const [linkInfo, setLinkInfo] = useState<string | null>(null);
  const [linkedEncounter, setLinkedEncounter] = useState<string | null>(linkedEncounterId || null);
  const [linkedAdmission, setLinkedAdmission] = useState<string | null>(linkedAdmissionId || null);

  // Payment step
  const [studyRates, setStudyRates] = useState<StudyRate[]>([]);
  const [loadingRates, setLoadingRates] = useState(false);
  const [paymentMode, setPaymentMode] = useState("cash");
  const [paymentRef, setPaymentRef] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Success step
  const [createdBillNumber, setCreatedBillNumber] = useState<string | null>(null);
  const [createdBillId, setCreatedBillId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  // The hospital's radiology payment mode, held in state so the button label and the flow
  // branch can be decided synchronously. Defaults to post_paid until the policy loads.
  const [radMode, setRadMode] = useState<"post_paid" | "pre_paid">("post_paid");
  const [hospitalInfo, setHospitalInfo] = useState<{ name: string; logo_url: string | null; address: string | null; phone: string | null; gstin: string | null } | null>(null);

  useEffect(() => {
    supabase.from("hospitals").select("name, logo_url, address, phone, gstin")
      .eq("id", hospitalId).maybeSingle()
      .then(({ data }) => setHospitalInfo(data));
  }, [hospitalId]);

  const preselectedNamesRef = useRef<string[]>(preselectedStudyNames);
  const preselectionDone = useRef(false);

  // Fetch current user
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from("users").select("id").eq("auth_user_id", user.id).limit(1).maybeSingle();
      if (data) setCurrentUserId(data.id);
    })();
  }, []);

  // Resolve the hospital's radiology payment mode once, for the button label + branch.
  useEffect(() => {
    if (!hospitalId) return;
    fetchIpdAncillaryPolicy(hospitalId).then((p) => setRadMode(p.radiology.mode));
  }, [hospitalId]);

  // Pre-paid means "collect before the scan", so an admitted patient's order goes through the
  // same in-modal payment step OPD uses — not the charge-to-advance shortcut.
  const ipdPrePaid = !!linkedAdmission && !linkedEncounterId && radMode === "pre_paid";

  // Fetch study master from DB, grouped by modality
  useEffect(() => {
    if (!hospitalId) return;
    (async () => {
      const { data: mods } = await supabase
        .from("radiology_modalities")
        .select("id, name, modality_type")
        .eq("hospital_id", hospitalId)
        .eq("is_active", true)
        .order("name");

      const { data: studies } = await (supabase as any)
        .from("radiology_study_master")
        .select("id, study_name, fee, is_active, modality_id, modality_type")
        .eq("hospital_id", hospitalId)
        .eq("is_active", true)
        .order("sort_order");

      const modList = (mods || []) as { id: string; name: string; modality_type: string }[];
      const studyList = (studies || []) as StudyMaster[];

      const groups: ModalityGroup[] = modList.map(m => ({
        id: m.id,
        name: m.name,
        modality_type: m.modality_type,
        studies: studyList.filter(s => s.modality_id === m.id),
      })).filter(g => g.studies.length > 0);

      setModalityGroups(groups);

      // Pre-select from preselectedStudyNames once groups are loaded
      if (!preselectionDone.current) {
        const names = preselectedNamesRef.current.length > 0 ? preselectedNamesRef.current : pendingStudyNames;
        if (names.length > 0) applyPreselection(names, studyList);
      }
    })();
  }, [hospitalId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-run pre-selection when pendingStudyNames arrive (radiology module flow)
  useEffect(() => {
    if (preselectionDone.current || !pendingStudyNames.length || !modalityGroups.length) return;
    const allStudies = modalityGroups.flatMap(g => g.studies);
    applyPreselection(pendingStudyNames, allStudies);
  }, [pendingStudyNames, modalityGroups]);

  const applyPreselection = (names: string[], studyList: StudyMaster[]) => {
    const studies: SelectedStudy[] = names.map(name => {
      const match = studyList.find(s => s.study_name.toLowerCase() === name.toLowerCase().trim());
      if (match) {
        return { name: match.study_name, modalityType: match.modality_type, fee: match.fee, studyMasterId: match.id };
      }
      return { name, modalityType: "", fee: 0 };
    });
    if (studies.length > 0) {
      setSelectedStudies(studies);
      preselectionDone.current = true;
    }
  };

  // Patient search
  useEffect(() => {
    if (patientSearch.length < 2) { setPatients([]); return; }
    const q = `%${patientSearch}%`;
    const t = setTimeout(() => {
      supabase.from("patients").select("id, full_name, uhid, gender, dob")
        .eq("hospital_id", hospitalId)
        .eq("is_active", true)
        .or(`full_name.ilike.${q},uhid.ilike.${q},phone.ilike.${q}`)
        .limit(8)
        .then(({ data }) => { setPatients((data as any) || []); setShowPatientResults(true); });
    }, 300);
    return () => clearTimeout(t);
  }, [patientSearch, hospitalId]);

  // Auto-link encounter + fetch OPD prescription studies (radiology module flow)
  useEffect(() => {
    if (!selectedPatient) {
      setLinkedEncounter(linkedEncounterId || null);
      setLinkedAdmission(null);
      setLinkInfo(null);
      setPendingStudyNames([]);
      return;
    }
    if (linkedEncounterId) { setLinkedEncounter(linkedEncounterId); return; }

    // Shared with the lab modal — resolves today's OPD encounters, or falls back to the
    // patient's current admission. The old inline query bailed out when there was no
    // encounter today, so an inpatient's studies never pre-selected.
    let cancelled = false;
    getPrescribedPending(hospitalId, selectedPatient.id, "radiology", {
      preferredAdmissionId: linkedAdmissionId,
    }).then((res) => {
      if (cancelled) return;
      setLinkedEncounter(res.encounterIds[0] ?? null);
      setLinkInfo(res.linkLabel);
      if (!preselectedNamesRef.current.length && !preselectionDone.current && res.names.length > 0) {
        setPendingStudyNames(res.names);
      }
    });
    return () => { cancelled = true; };

    // Admission linking is handled by <AdmissionLinker> below — it resolves ALL active
    // admissions and lets the user pick when there is more than one, instead of grabbing an
    // arbitrary one here (which silently billed charges to the wrong stay).
  }, [selectedPatient, hospitalId, linkedEncounterId, linkedAdmissionId]);

  const toggleStudy = useCallback((study: StudyMaster) => {
    setSelectedStudies(prev => {
      const exists = prev.some(s => s.name === study.study_name);
      if (exists) return prev.filter(s => s.name !== study.study_name);
      return [...prev, { name: study.study_name, modalityType: study.modality_type, fee: study.fee, studyMasterId: study.id }];
    });
  }, []);

  const addCustomStudy = useCallback(() => {
    const name = customStudy.trim();
    if (!name || !customModalityType) return;
    if (selectedStudies.some(s => s.name.toLowerCase() === name.toLowerCase())) return;
    setSelectedStudies(prev => [...prev, { name, modalityType: customModalityType, fee: 0 }]);
    setCustomStudy("");
    setCustomModalityType("");
  }, [customStudy, customModalityType, selectedStudies]);

  const handleProceedToPayment = async () => {
    if (!selectedPatient) { toast({ title: "Please select a patient", variant: "destructive" }); return; }
    if (selectedStudies.length === 0) { toast({ title: "Please select at least one study", variant: "destructive" }); return; }

    // IPD + post_paid: accrue to the admission bill, no cash step (charge to advance).
    // IPD + pre_paid, and OPD: fall through to the in-modal payment step below.
    if (linkedAdmission && !linkedEncounterId && !ipdPrePaid) { await createOrdersIPD(); return; }

    setLoadingRates(true);
    const rates = await buildStudyRates(hospitalId, selectedStudies);
    setStudyRates(rates);
    setLoadingRates(false);
    setStep("payment");
  };

  /**
   * IPD path: create the orders, then post their charges at order time.
   *
   * This used to mint a standalone bill_type:'radiology' bill whose lines carried no
   * source_dedupe_key. The discharge sweep then both COPIED those lines onto the IPD bill
   * (keyed bill-line:{id}) and pulled the same orders itself (keyed radiology:{order.id}) —
   * two lines per scan, i.e. every IPD radiology order was billed twice. Charges now go
   * through postAncillaryOrderCharges using the sweep's own key, so it recognises and skips
   * them.
   */
  const createOrdersIPD = async () => {
    if (!currentUserId || !selectedPatient) return;
    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const policy = await fetchIpdAncillaryPolicy(hospitalId);
      const paymentStatus = resolveChargePaymentStatus({ isIPD: true, mode: policy.radiology.mode });

      const createdOrders = await batchCreateRadiologyOrders(currentUserId, paymentStatus);
      if (createdOrders.length === 0) throw new Error("No radiology orders could be created");

      // Rates resolved ONCE and handed to the charge posting: in pre_paid mode the cashier
      // collects this exact number, so it must be the number that lands on the bill.
      const rates = await buildStudyRates(hospitalId, selectedStudies);
      const rateByName = new Map(rates.map(r => [r.name, r]));

      const charged = await postAncillaryOrderCharges({
        hospitalId,
        patientId: selectedPatient.id,
        admissionId: linkedAdmission,
        service: "radiology",
        orderedBy: currentUserId,
        policy,
        items: createdOrders.map(({ orderId, studyName }) => {
          const r = rateByName.get(studyName);
          return {
            sourceId: orderId,
            dedupeKey: `radiology:${orderId}`,
            description: `Radiology: ${studyName}`,
            unitPrice: r?.rate ?? 0,
            gstPercent: r?.gstPct ?? 0,
          };
        }),
      });

      if (!charged.ok) {
        // An uncharged order would clear the gate as "no charge found" — a free scan.
        await supabase.from("radiology_orders").delete().in("id", createdOrders.map(o => o.orderId));
        throw new Error(charged.error || "Radiology charges could not be posted — orders cancelled");
      }

      toast(
        paymentStatus === "pending_payment"
          ? {
              title: `✓ ${createdOrders.length} radiology order(s) created — payment pending`,
              description: "The study cannot be started until the amount is paid at the billing counter.",
            }
          : { title: `✓ ${createdOrders.length} radiology order(s) created — charged to the IPD bill` }
      );
      onCreated();
      onClose();
    } catch (err: any) {
      toast({ title: "Failed to create orders", description: err.message, variant: "destructive" });
    } finally { setSubmitting(false); }
  };

  /**
   * Creates the radiology_orders rows and returns their ids, so the caller can post a charge
   * keyed radiology:{order.id} — the exact key the discharge sweep uses.
   *
   * paymentStatus is passed in rather than hardcoded: an IPD order is only 'advance_covered'
   * when the hospital accrues radiology to the discharge bill. If it takes payment up front,
   * the order is 'pending_payment' until a cashier collects.
   */
  const batchCreateRadiologyOrders = async (
    userId: string,
    paymentStatus: "paid" | "advance_covered" | "pending_payment",
  ): Promise<{ orderId: string; studyName: string }[]> => {
    if (!selectedPatient) return [];
    const created: { orderId: string; studyName: string }[] = [];
    const today = new Date().toISOString().split("T")[0];
    const todayCompact = today.replace(/-/g, "");

    for (let i = 0; i < selectedStudies.length; i++) {
      const study = selectedStudies[i];

      // Find modality ID — prefer UUID match via studyMasterId (works even when modality_type is null)
      const group = study.studyMasterId
        ? modalityGroups.find(g => g.studies.some(s => s.id === study.studyMasterId))
        : modalityGroups.find(g => g.modality_type === study.modalityType);
      let modalityId = group?.id;

      // Fallback: create modality on-the-fly for custom studies that have no group match
      if (!modalityId && study.modalityType) {
        const { data: newMod } = await supabase
          .from("radiology_modalities")
          .insert({ hospital_id: hospitalId, name: study.modalityType.toUpperCase(), modality_type: study.modalityType, is_active: true } as any)
          .select("id").maybeSingle();
        if (newMod) modalityId = newMod.id;
      }
      if (!modalityId) {
        toast({ title: "Study skipped", description: `Could not determine modality for "${study.name}". Please contact support.`, variant: "destructive" });
        continue;
      }

      const { data: seqVal } = await (supabase.rpc as any)("next_seq", { p_hospital_id: hospitalId, p_type: "accession" });
      const seq = String(seqVal ?? 1).padStart(4, "0");
      const isObstetricUsg = study.modalityType === "usg" && study.name.toLowerCase().includes("obstetric");

      const { data: orderData, error: orderError } = await supabase
        .from("radiology_orders")
        .insert({
          hospital_id: hospitalId,
          patient_id: selectedPatient.id,
          modality_id: modalityId,
          modality_type: study.modalityType,
          study_name: study.name,
          clinical_history: clinicalHistory || null,
          ordered_by: userId,
          priority,
          status: "ordered",
          accession_number: `RAD-${todayCompact}-${seq}`,
          is_pcpndt: isObstetricUsg,
          billing_status: "billed",
          ordered_at: new Date().toISOString(),
          order_date: today,
          order_time: new Date().toISOString(),
          payment_status: paymentStatus,
          ...(linkedEncounter ? { encounter_id: linkedEncounter } : {}),
          ...(linkedAdmission ? { admission_id: linkedAdmission } : {}),
        } as any)
        .select("id").maybeSingle();

      if (orderError || !orderData) throw orderError || new Error(`Failed to create order for "${study.name}"`);

      await supabase.from("radiology_reports").insert({ hospital_id: hospitalId, order_id: orderData.id, patient_id: selectedPatient.id });

      if (isObstetricUsg) {
        await supabase.from("pcpndt_form_f").insert({
          hospital_id: hospitalId, order_id: orderData.id,
          patient_name: selectedPatient.full_name,
          patient_age: selectedPatient.dob ? Math.floor((Date.now() - new Date(selectedPatient.dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000)) : null,
          signed_by: userId,
        });
      }

      await logNABHEvidence(
        hospitalId,
        "COP.6",
        `Radiology order created and billed: ${study.name} (${study.modalityType}) for patient ${selectedPatient.full_name}`,
        "compliant"
      );

      created.push({ orderId: orderData.id, studyName: study.name });
    }

    return created;
  };

  const handleCollectAndCreate = async () => {
    if (!currentUserId || !selectedPatient) {
      toast({ title: "Session error", description: "Please refresh the page and try again.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const subtotalAmount = studyRates.reduce((s, r) => s + r.rate, 0);
      const gstTotal = studyRates.reduce((s, r) => s + r.gstAmt, 0);
      const grandTotal = studyRates.reduce((s, r) => s + r.total, 0);
      const today = new Date().toISOString().split("T")[0];
      const pmodeMap: Record<string, string> = { cash: "cash", upi: "upi", card: "card", neft: "net_banking" };

      // Orders are created BEFORE the line items so each paid line can carry the dedupe key
      // radiology:{order.id}. For an admitted patient that key is what the discharge sweep
      // recognises — without it, this paid receipt AND the sweep would both bill the scan.
      const createdOrders = await batchCreateRadiologyOrders(currentUserId, "paid");
      const rateByName = new Map(studyRates.map((r) => [r.name, r]));

      const billNumber = await generateBillNumber(hospitalId, "RAD");
      const { data: bill, error: billErr } = await (supabase as any).from("bills").insert({
        hospital_id: hospitalId, patient_id: selectedPatient.id,
        // An admitted patient's paid receipt is tied to the admission but kept as its own
        // paid bill; only OPD orders carry an encounter link.
        admission_id: ipdPrePaid ? linkedAdmission : null,
        encounter_id: linkedEncounter || null, bill_number: billNumber,
        bill_type: "radiology", bill_date: today, bill_status: "final", payment_status: "paid",
        notes: paymentRef ? `Payment ref: ${paymentRef}` : null,
        subtotal: subtotalAmount, gst_amount: gstTotal, total_amount: grandTotal,
        patient_payable: grandTotal, paid_amount: grandTotal, balance_due: 0,
        created_by: currentUserId,
      }).select("id").maybeSingle();
      if (billErr || !bill) throw billErr || new Error("Bill creation failed");

      if (grandTotal > 0) {
        await (supabase as any).from("bill_payments").insert({
          hospital_id: hospitalId, bill_id: bill.id,
          payment_mode: pmodeMap[paymentMode] || "cash",
          amount: grandTotal, payment_date: today,
          transaction_id: paymentRef || null, received_by: currentUserId,
          notes: `Radiology: ${selectedStudies.map(s => s.name).join(", ")}`,
        });
      }

      await (supabase as any).from("bill_line_items").insert(
        createdOrders.map(({ orderId, studyName }) => {
          const r = rateByName.get(studyName);
          return {
            hospital_id: hospitalId, bill_id: bill.id,
            description: `Radiology: ${studyName}`, item_type: "radiology",
            quantity: 1, unit_rate: r?.rate ?? 0, taxable_amount: r?.rate ?? 0,
            gst_percent: r?.gstPct ?? 0, gst_amount: r?.gstAmt ?? 0, total_amount: r?.total ?? 0,
            service_date: today, source_module: "radiology", ordered_by: currentUserId,
            // Paid up front, so it is settled — and keyed so the discharge sweep skips it.
            payment_status: "paid",
            source_record_id: orderId,
            source_dedupe_key: `radiology:${orderId}`,
          };
        })
      );

      for (const { orderId, studyName } of createdOrders) {
        const r = rateByName.get(studyName);
        recordServiceCharge({
          hospitalId, patientId: selectedPatient.id,
          admissionId: ipdPrePaid ? linkedAdmission : null,
          encounterId: linkedEncounter || null,
          serviceModule: "radiology", serviceRefId: orderId,
          serviceName: `Radiology: ${studyName}`,
          unitRate: r?.rate ?? 0, gstPercent: r?.gstPct ?? 0, gstAmount: r?.gstAmt ?? 0, totalAmount: r?.total ?? 0,
          billId: bill.id, performedBy: currentUserId,
        });
      }

      try {
        await autoPostJournalEntry({
          triggerEvent: "bill_finalized_radiology", sourceModule: "radiology",
          sourceId: bill.id, amount: grandTotal,
          description: `Radiology charges — Bill ${billNumber}`,
          hospitalId, postedBy: currentUserId,
        });
      } catch { /* non-blocking */ }

      setCreatedBillNumber(billNumber);
      setCreatedBillId(bill.id);
      setStep("success");
      onCreated();
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    } finally { setSubmitting(false); }
  };

  const grandTotal = studyRates.reduce((s, r) => s + r.total, 0);
  const isPcpndt = selectedStudies.some(s => s.modalityType === "usg" && s.name.toLowerCase().includes("obstetric"));
  const allMods = modalityGroups.map(g => ({ id: g.id, name: g.name, modality_type: g.modality_type }));

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-[560px] max-h-[90vh] overflow-y-auto">

        {/* ── STEP 1: ORDER ── */}
        {step === "order" && (
          <>
            <DialogHeader>
              <DialogTitle className="text-lg">New Radiology Order</DialogTitle>
              <p className="text-sm text-muted-foreground">Select studies, set priority, then collect payment</p>
            </DialogHeader>

            <div className="space-y-4 mt-2">
              {/* Patient */}
              <div>
                <label className="text-sm font-medium text-foreground">Patient *</label>
                {selectedPatient ? (
                  <div className="flex items-center justify-between bg-muted/50 rounded-lg p-2.5 mt-1">
                    <div>
                      <p className="text-sm font-semibold">{selectedPatient.full_name}</p>
                      <p className="text-xs text-muted-foreground">{selectedPatient.uhid}</p>
                    </div>
                    {!preselectedPatient && (
                      <button onClick={() => { setSelectedPatient(null); setPatientSearch(""); setPendingStudyNames([]); setSelectedStudies([]); preselectionDone.current = false; }} className="text-muted-foreground hover:text-foreground">
                        <X size={14} />
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="relative mt-1">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input value={patientSearch} onChange={e => setPatientSearch(e.target.value)} placeholder="Search by name, UHID, phone..." className="pl-9" />
                    {showPatientResults && patients.length > 0 && (
                      <div className="absolute z-50 w-full mt-1 bg-card border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {patients.map(p => (
                          <button key={p.id} onClick={() => { setSelectedPatient(p); setShowPatientResults(false); setPatientSearch(""); }}
                            className="w-full text-left px-3 py-2 hover:bg-muted text-sm flex justify-between">
                            <span className="font-medium">{p.full_name}</span>
                            <span className="text-xs text-muted-foreground">{p.uhid}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {linkInfo && <div className="mt-2 text-xs bg-blue-50 border-l-[3px] border-blue-500 text-blue-700 px-3 py-2 rounded-r">{linkInfo}</div>}
                <AdmissionLinker
                  hospitalId={hospitalId}
                  patientId={selectedPatient?.id ?? null}
                  preferredAdmissionId={linkedAdmissionId}
                  onChange={setLinkedAdmission}
                />
              </div>

              {/* Priority */}
              <div>
                <label className="text-sm font-medium text-foreground">Priority *</label>
                <div className="flex gap-2 mt-1">
                  {(["routine", "urgent", "stat"] as const).map(p => (
                    <button key={p} onClick={() => setPriority(p)}
                      className={cn("flex-1 h-10 rounded-lg text-sm font-medium border transition-colors",
                        priority === p
                          ? p === "stat" ? "bg-destructive/10 border-destructive text-destructive"
                            : p === "urgent" ? "bg-amber-50 border-amber-500 text-amber-700"
                            : "bg-emerald-50 border-emerald-500 text-emerald-700"
                          : "bg-muted border-border text-muted-foreground hover:bg-muted/80"
                      )}>
                      {p === "routine" ? "🟢 Routine" : p === "urgent" ? "🟡 Urgent" : "🔴 STAT"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Studies from DB — grouped by modality */}
              <div>
                <label className="text-sm font-medium text-foreground">Select Studies *</label>
                {modalityGroups.length === 0 ? (
                  <p className="text-xs text-muted-foreground mt-2">No studies configured. Go to Settings → Radiology Modalities to add studies.</p>
                ) : (
                  <div className="space-y-2 mt-2 max-h-[220px] overflow-y-auto border border-border rounded-lg p-2">
                    {modalityGroups.map(group => (
                      <div key={group.id}>
                        <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">{group.name}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {group.studies.map(s => {
                            const isSelected = selectedStudies.some(sel => sel.name === s.study_name);
                            return (
                              <button
                                key={s.id}
                                onClick={() => toggleStudy(s)}
                                className={cn(
                                  "text-[11px] px-2.5 py-1 rounded-md border transition-colors",
                                  isSelected
                                    ? "bg-primary text-primary-foreground border-primary font-semibold"
                                    : "bg-muted border-border text-foreground/70 hover:bg-primary/5 hover:border-primary/30"
                                )}
                              >
                                {s.study_name}
                                {s.fee > 0 && <span className={cn("ml-1", isSelected ? "opacity-80" : "opacity-60")}>₹{s.fee.toLocaleString("en-IN")}</span>}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Custom study */}
                <div className="flex gap-2 mt-2">
                  <Input value={customStudy} onChange={e => setCustomStudy(e.target.value)} onKeyDown={e => e.key === "Enter" && addCustomStudy()} placeholder="Custom study name..." className="flex-1" />
                  <select value={customModalityType} onChange={e => setCustomModalityType(e.target.value)} className="px-2 py-2 border border-border rounded-lg text-sm bg-card">
                    <option value="">Modality...</option>
                    {allMods.map(m => <option key={m.id} value={m.modality_type}>{m.name}</option>)}
                  </select>
                  <Button variant="outline" size="sm" onClick={addCustomStudy} disabled={!customStudy.trim() || !customModalityType}>+ Add</Button>
                </div>

                {selectedStudies.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs text-muted-foreground mb-1">{selectedStudies.length} selected</p>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedStudies.map((s, i) => (
                        <span key={i} className="inline-flex items-center gap-1 px-2.5 py-1 bg-primary/5 text-primary text-xs rounded-full">
                          {s.name}{s.fee > 0 ? ` ₹${s.fee.toLocaleString("en-IN")}` : ""}
                          <button onClick={() => setSelectedStudies(prev => prev.filter((_, idx) => idx !== i))} className="hover:text-destructive"><X size={12} /></button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Clinical History */}
              <div>
                <label className="text-sm font-medium text-foreground">Clinical History / Indication</label>
                <Textarea value={clinicalHistory} onChange={e => setClinicalHistory(e.target.value)} placeholder="Reason for study, relevant history..." rows={2} className="mt-1 resize-none" />
              </div>

              {isPcpndt && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                  ⚠️ <strong>PCPNDT Act compliance required.</strong> Form F will be auto-created after the order.
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button onClick={onClose} className="flex-1 h-12 rounded-lg border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors">Cancel</button>
                <button
                  onClick={handleProceedToPayment}
                  disabled={loadingRates || submitting || !selectedPatient || selectedStudies.length === 0}
                  className="flex-[2] h-12 rounded-lg bg-[hsl(var(--sidebar-background))] text-white text-sm font-semibold hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2"
                >
                  {loadingRates || submitting
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> Processing...</>
                    : (linkedAdmission && !ipdPrePaid) ? "📋 Create Orders (Charge to Advance) →" : "📋 Proceed to Payment →"}
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── STEP 2: PAYMENT ── */}
        {step === "payment" && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2">
                <button onClick={() => setStep("order")} className="p-1 rounded hover:bg-muted text-muted-foreground"><ArrowLeft size={16} /></button>
                <div>
                  <DialogTitle className="text-lg">Collect Payment</DialogTitle>
                  <p className="text-sm text-muted-foreground">Collect payment before radiology processing begins</p>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-4 mt-2">
              <div className="bg-muted/40 rounded-lg px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-sm">{selectedPatient?.full_name}</p>
                  <p className="text-xs text-muted-foreground">{selectedPatient?.uhid}</p>
                </div>
                <Badge variant="outline">{priority.toUpperCase()}</Badge>
              </div>

              <div className="rounded-lg border border-border overflow-hidden">
                <div className="bg-muted/50 px-3 py-2 flex justify-between text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  <span>Study</span><span>Amount</span>
                </div>
                <div className="divide-y divide-border">
                  {studyRates.map((r, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2 text-sm gap-3">
                      <span className="text-foreground flex-1">{r.name}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-muted-foreground text-xs">₹</span>
                        <input
                          type="number" min="0"
                          value={r.rate === 0 ? "" : r.rate}
                          placeholder="Enter fee"
                          onChange={e => {
                            const val = parseFloat(e.target.value) || 0;
                            setStudyRates(prev => prev.map((x, idx) => {
                              if (idx !== i) return x;
                              const gstAmt = calcGST(val, x.gstPct);
                              return { ...x, rate: val, gstAmt, total: roundCurrency(val + gstAmt) };
                            }));
                          }}
                          className={cn("w-24 text-right border rounded px-2 py-1 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-primary",
                            r.rate === 0 ? "border-amber-400 bg-amber-50 placeholder-amber-400" : "border-border bg-background"
                          )}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                {studyRates.some(r => r.rate === 0) && (
                  <div className="px-3 py-2 bg-amber-50 border-t border-amber-200 text-xs text-amber-700">
                    ⚠ Studies with no price — enter fee manually or set rates in Settings → Radiology Modalities
                  </div>
                )}
                <div className="bg-muted/30 border-t">
                  <div className="flex justify-between px-3 py-3">
                    <span className="font-bold text-base">Total Payable</span>
                    <span className="font-bold text-xl text-primary">₹{grandTotal.toLocaleString("en-IN")}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Payment Mode</label>
                <div className="grid grid-cols-4 gap-2">
                  {[{ value: "cash", label: "💵 Cash" }, { value: "upi", label: "📱 UPI" }, { value: "card", label: "💳 Card" }, { value: "neft", label: "🏦 NEFT" }].map(m => (
                    <button key={m.value} onClick={() => setPaymentMode(m.value)}
                      className={cn("h-10 rounded-lg border text-sm font-medium transition-colors",
                        paymentMode === m.value ? "bg-primary text-primary-foreground border-primary" : "bg-muted border-border text-foreground hover:bg-muted/80"
                      )}>{m.label}</button>
                  ))}
                </div>
                {paymentMode !== "cash" && (
                  <Input value={paymentRef} onChange={e => setPaymentRef(e.target.value)}
                    placeholder={paymentMode === "upi" ? "UPI Reference / UTR No." : paymentMode === "card" ? "Card last 4 / Approval code" : "NEFT / Cheque reference no."}
                    className="mt-1" />
                )}
              </div>

              <div className="flex gap-2 pt-1">
                <Button variant="outline" onClick={() => setStep("order")} className="flex-1"><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
                <Button onClick={handleCollectAndCreate} disabled={submitting} className="flex-[2] h-12 text-base font-bold bg-emerald-600 hover:bg-emerald-700">
                  {submitting
                    ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Processing...</>
                    : <><IndianRupee className="h-4 w-4 mr-1" /> Collect ₹{grandTotal.toLocaleString("en-IN")} & Create Order</>}
                </Button>
              </div>
            </div>
          </>
        )}

        {/* ── STEP 3: SUCCESS ── */}
        {step === "success" && (
          <div className="py-4 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
              <CheckCircle2 className="h-9 w-9 text-emerald-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold">Payment Collected!</h2>
              <p className="text-sm text-muted-foreground mt-1">{selectedStudies.length} order{selectedStudies.length > 1 ? "s" : ""} created and added to queue</p>
            </div>
            <div className="bg-muted/40 rounded-xl p-4 text-left space-y-2 border border-border">
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Bill No.</span><span className="font-bold text-primary">{createdBillNumber}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Patient</span><span className="font-medium">{selectedPatient?.full_name}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">UHID</span><span className="font-medium font-mono text-xs">{selectedPatient?.uhid}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Studies</span><span className="font-medium">{selectedStudies.length} study/studies</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Payment</span><span className="font-medium capitalize">{paymentMode}</span></div>
              <div className="flex justify-between text-base font-bold pt-2 border-t border-border"><span>Amount Paid</span><span className="text-emerald-600">₹{grandTotal.toLocaleString("en-IN")}</span></div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={async () => {
                if (!createdBillId) return;
                const ok = await printBillById(createdBillId, hospitalId);
                if (!ok) toast({ title: "Could not open the bill for printing", variant: "destructive" });
              }}><Printer className="h-4 w-4 mr-1" /> Print Bill</Button>
              <Button className="flex-1" onClick={onClose}>Done</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default NewRadiologyOrderModal;
