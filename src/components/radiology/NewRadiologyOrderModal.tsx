import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { X, Search, ArrowLeft, CheckCircle2, Printer, IndianRupee, Loader2 } from "lucide-react";
import { generateBillNumber } from "@/hooks/useBillNumber";
import { autoPostJournalEntry } from "@/lib/accounting";
import { logNABHEvidence } from "@/lib/nabh-evidence";
import { printDocument } from "@/lib/printUtils";
import { cn } from "@/lib/utils";
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
  total: number;
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
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
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
    const today = new Date().toISOString().split("T")[0];
    if (linkedEncounterId) { setLinkedEncounter(linkedEncounterId); return; }

    supabase.from("opd_encounters").select("id")
      .eq("hospital_id", hospitalId).eq("patient_id", selectedPatient.id).eq("visit_date", today)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (!data?.length) return;
        const allEncIds = data.map((e: any) => e.id);
        setLinkedEncounter(allEncIds[0]);
        setLinkInfo(allEncIds.length > 1
          ? `🔗 Linked to today's OPD encounters (${allEncIds.length} doctors)`
          : "🔗 Linked to today's OPD encounter");

        if (!preselectedNamesRef.current.length && !preselectionDone.current) {
          Promise.all([
            (supabase as any).from("prescriptions").select("radiology_orders").in("encounter_id", allEncIds),
            supabase.from("radiology_orders").select("study_name")
              .eq("hospital_id", hospitalId).eq("patient_id", selectedPatient.id).eq("order_date", today),
          ]).then(([{ data: rxList }, { data: existingOrders }]: any[]) => {
            const allNames: string[] = [...new Set<string>(
              (rxList || []).flatMap((rx: any) =>
                ((rx.radiology_orders as any[]) || []).map((r: any) => r.study_name as string).filter(Boolean)
              )
            )];
            const alreadyOrdered = new Set<string>(
              (existingOrders || []).map((o: any) => (o.study_name || "").toLowerCase().trim())
            );
            const pending = allNames.filter(n => !alreadyOrdered.has(n.toLowerCase().trim()));
            if (pending.length > 0) setPendingStudyNames(pending);
          });
        }
      });

    supabase.from("admissions").select("id")
      .eq("hospital_id", hospitalId).eq("patient_id", selectedPatient.id).eq("status", "active").limit(1)
      .then(({ data }) => {
        if (data?.[0]) {
          setLinkedAdmission(data[0].id);
          setLinkInfo(prev => prev ? prev + " & IPD admission" : "🔗 Linked to active IPD admission");
        }
      });
  }, [selectedPatient, hospitalId, linkedEncounterId]);

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

    // Skip payment only when ordering from IPD context (no OPD encounter link)
    if (linkedAdmission && !linkedEncounterId) { await createOrdersIPD(); return; }

    setLoadingRates(true);
    const rates: StudyRate[] = selectedStudies.map(s => ({ name: s.name, modalityType: s.modalityType, rate: s.fee, total: s.fee }));
    setStudyRates(rates);
    setLoadingRates(false);
    setStep("payment");
  };

  const createOrdersIPD = async () => {
    if (!currentUserId || !selectedPatient) return;
    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // 1. Create orders
      await batchCreateRadiologyOrders(currentUserId, "advance_covered");

      // 2. Create bill for IPD charge-to-advance
      const rates: StudyRate[] = selectedStudies.map(s => ({ name: s.name, modalityType: s.modalityType, rate: s.fee, total: s.fee }));
      const totalAmount = rates.reduce((s, r) => s + r.total, 0);

      if (totalAmount > 0) {
        const billNumber = await generateBillNumber(hospitalId, "RAD");
        const { data: bill } = await (supabase as any).from("bills").insert({
          hospital_id: hospitalId,
          patient_id: selectedPatient.id,
          admission_id: linkedAdmission,
          bill_number: billNumber,
          bill_type: "radiology",
          bill_status: "final",
          bill_date: new Date().toISOString().split("T")[0],
          total_amount: totalAmount,
          subtotal: totalAmount,
          gst_amount: 0,
          paid_amount: 0,
          balance_due: totalAmount,
          payment_status: "unpaid",
          created_by: currentUserId,
        }).select("id").maybeSingle();

        if (bill) {
          await (supabase as any).from("bill_line_items").insert(
            rates.map(r => ({
              hospital_id: hospitalId,
              bill_id: bill.id,
              description: `Radiology: ${r.name}`,
              item_type: "radiology",
              quantity: 1,
              unit_rate: r.rate,
              taxable_amount: r.rate,
              gst_percent: 0,
              gst_amount: 0,
              total_amount: r.total,
              service_date: new Date().toISOString().split("T")[0],
              source_module: "radiology",
              ordered_by: currentUserId,
            }))
          );

          await autoPostJournalEntry({
            triggerEvent: "bill_finalized_radiology",
            sourceModule: "radiology",
            sourceId: bill.id,
            amount: totalAmount,
            description: `Radiology Revenue (IPD) - Bill ${billNumber}`,
            hospitalId,
            postedBy: user.id,
          });
        }
      }

      toast({ title: `✓ ${selectedStudies.length} radiology order(s) created — Bill generated & charged to IPD` });
      onCreated();
      onClose();
    } catch (err: any) {
      toast({ title: "Failed to create orders", description: err.message, variant: "destructive" });
    } finally { setSubmitting(false); }
  };

  const batchCreateRadiologyOrders = async (userId: string, paymentStatus: "paid" | "advance_covered") => {
    if (!selectedPatient) return;
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
    }
  };

  const handleCollectAndCreate = async () => {
    if (!currentUserId || !selectedPatient) {
      toast({ title: "Session error", description: "Please refresh the page and try again.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const grandTotal = studyRates.reduce((s, r) => s + r.total, 0);
      const today = new Date().toISOString().split("T")[0];
      const pmodeMap: Record<string, string> = { cash: "cash", upi: "upi", card: "card", neft: "net_banking" };

      const billNumber = await generateBillNumber(hospitalId, "RAD");
      const { data: bill, error: billErr } = await (supabase as any).from("bills").insert({
        hospital_id: hospitalId, patient_id: selectedPatient.id,
        encounter_id: linkedEncounter || null, bill_number: billNumber,
        bill_type: "radiology", bill_date: today, bill_status: "final", payment_status: "paid",
        notes: paymentRef ? `Payment ref: ${paymentRef}` : null,
        subtotal: grandTotal, gst_amount: 0, total_amount: grandTotal,
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
        studyRates.map(r => ({
          hospital_id: hospitalId, bill_id: bill.id,
          description: `Radiology: ${r.name}`, item_type: "radiology",
          quantity: 1, unit_rate: r.rate, taxable_amount: r.rate,
          gst_percent: 0, gst_amount: 0, total_amount: r.total,
          service_date: today, source_module: "radiology", ordered_by: currentUserId,
        }))
      );

      try {
        await autoPostJournalEntry({
          triggerEvent: "bill_finalized_radiology", sourceModule: "radiology",
          sourceId: bill.id, amount: grandTotal,
          description: `Radiology charges — Bill ${billNumber}`,
          hospitalId, postedBy: currentUserId,
        });
      } catch { /* non-blocking */ }

      await batchCreateRadiologyOrders(currentUserId, "paid");

      setCreatedBillNumber(billNumber);
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
                    : linkedAdmission ? "📋 Create Orders (Charge to Advance) →" : "📋 Proceed to Payment →"}
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
                            setStudyRates(prev => prev.map((x, idx) => idx === i ? { ...x, rate: val, total: val } : x));
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
              <Button variant="outline" className="flex-1" onClick={() => {
                const now = new Date();
                const dateStr = now.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
                const timeStr = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
                const patientAge = selectedPatient?.dob
                  ? Math.floor((Date.now() - new Date(selectedPatient.dob).getTime()) / (365.25 * 86400000))
                  : null;
                const hosp = hospitalInfo;

                const header = `
                  <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;border-bottom:2px solid #1A2F5A;margin-bottom:18px;">
                    <div>
                      ${hosp?.logo_url ? `<img src="${hosp.logo_url}" style="max-height:56px;max-width:180px;object-fit:contain;margin-bottom:6px;display:block;" />` : ""}
                      <div style="font-size:18px;font-weight:700;color:#1A2F5A;">${hosp?.name || "Hospital"}</div>
                      ${hosp?.address ? `<div style="font-size:11px;color:#64748b;margin-top:3px;">${hosp.address}</div>` : ""}
                      ${hosp?.phone ? `<div style="font-size:11px;color:#64748b;margin-top:2px;">Ph: ${hosp.phone}</div>` : ""}
                      ${hosp?.gstin ? `<div style="font-size:10px;color:#64748b;margin-top:2px;">GSTIN: ${hosp.gstin}</div>` : ""}
                    </div>
                    <div style="text-align:right;font-size:11px;color:#64748b;">
                      <div>${dateStr}</div><div>${timeStr}</div>
                    </div>
                  </div>
                  <div style="background:#f8fafc;border-radius:6px;padding:10px 16px;margin-bottom:16px;text-align:center;">
                    <div style="font-size:15px;font-weight:700;color:#1A2F5A;letter-spacing:0.5px;">RADIOLOGY ORDER RECEIPT</div>
                    <div style="font-size:13px;color:#475569;margin-top:3px;">${createdBillNumber}</div>
                  </div>`;

                const patientSection = `
                  <div class="section-title">Patient Information</div>
                  <div class="row"><span class="label">Patient Name</span><span>${selectedPatient?.full_name || "—"}</span></div>
                  <div class="row"><span class="label">UHID</span><span style="font-family:monospace">${selectedPatient?.uhid || "—"}</span></div>
                  ${patientAge !== null ? `<div class="row"><span class="label">Age / Gender</span><span>${patientAge}Y${selectedPatient?.gender ? ` / ${selectedPatient.gender}` : ""}</span></div>` : ""}`;

                const studiesRows = studyRates.map(r =>
                  `<tr><td>${r.name}</td><td>${r.modalityType}</td><td style="text-align:right">₹${Number(r.rate).toLocaleString("en-IN")}</td></tr>`
                ).join("");
                const studiesSection = `
                  <div class="section-title" style="margin-top:16px;">Studies Ordered</div>
                  <table>
                    <thead><tr><th>Study Name</th><th>Modality</th><th style="text-align:right">Rate (₹)</th></tr></thead>
                    <tbody>${studiesRows}</tbody>
                  </table>`;

                const paymentSection = `
                  <div class="section-title" style="margin-top:16px;">Payment Details</div>
                  <div class="row"><span class="label">Payment Mode</span><span style="text-transform:capitalize">${paymentMode}</span></div>
                  ${paymentRef ? `<div class="row"><span class="label">Reference No.</span><span style="font-family:monospace">${paymentRef}</span></div>` : ""}
                  <div class="total-row"><span>Amount Paid</span><span class="amount">₹${grandTotal.toLocaleString("en-IN")}</span></div>`;

                printDocument(
                  `Radiology Receipt — ${createdBillNumber}`,
                  header + patientSection + studiesSection + paymentSection
                );
              }}><Printer className="h-4 w-4 mr-1" /> Print Receipt</Button>
              <Button className="flex-1" onClick={onClose}>Done</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default NewRadiologyOrderModal;
