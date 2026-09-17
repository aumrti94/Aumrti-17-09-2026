import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useDebounce } from "@/hooks/useDebounce";
import { useToast } from "@/hooks/use-toast";
import { X, Search, ArrowLeft, CheckCircle2, Printer, IndianRupee, Loader2, AlertTriangle } from "lucide-react";
import { generateBillNumber } from "@/hooks/useBillNumber";
import { autoPostJournalEntry } from "@/lib/accounting";
import { recordServiceCharge } from "@/lib/serviceBilling";
import { postAncillaryOrderCharges } from "@/lib/ancillaryCharges";
import { fetchIpdAncillaryPolicy, resolveChargePaymentStatus } from "@/lib/ipdAncillaryGate";
import AdmissionLinker from "@/components/shared/AdmissionLinker";
import { logNABHEvidence } from "@/lib/nabh-evidence";
import { getPrescribedPending } from "@/lib/prescribedPending";
import { resolveTreatingDoctor } from "@/lib/encounterLink";
import { printBillById } from "@/lib/billPrint";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Test {
  id: string;
  test_name: string;
  test_code: string | null;
  category: string;
  sample_type: string;
  unit: string | null;
  normal_min: number | null;
  normal_max: number | null;
  tat_minutes: number;
  fee: number | null;
}

interface Patient {
  id: string;
  full_name: string;
  uhid: string;
  gender: string | null;
  dob: string | null;
}

interface TestRate {
  id: string;
  name: string;
  rate: number;
  gstPct: number;
  gstAmount: number;
  total: number;
}

interface TestGroup {
  id: string;
  group_name: string;
  group_code: string | null;
  fee: number;
  testIds: string[];
}

interface Props {
  hospitalId: string;
  onClose: () => void;
  onCreated: () => void;
  preselectedPatient?: { id: string; full_name: string; uhid: string; gender?: string | null; dob?: string | null };
  preselectedTestNames?: string[];
  linkedEncounterId?: string | null;
  linkedAdmissionId?: string | null;
}

type Step = "order" | "payment" | "success";

const NewLabOrderModal: React.FC<Props> = ({ hospitalId, onClose, onCreated, preselectedPatient, preselectedTestNames, linkedEncounterId, linkedAdmissionId }) => {
  const { toast } = useToast();

  // Step management
  const [step, setStep] = useState<Step>("order");
  // The hospital's lab payment mode, held in state so the button label and flow branch decide
  // synchronously. Defaults to post_paid until the policy loads.
  const [labMode, setLabMode] = useState<"post_paid" | "pre_paid">("post_paid");

  // Order form state
  const [patients, setPatients] = useState<Patient[]>([]);
  const [patientSearch, setPatientSearch] = useState("");
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [showPatientResults, setShowPatientResults] = useState(false);
  const [priority, setPriority] = useState<"routine" | "urgent" | "stat">("routine");
  const [allTests, setAllTests] = useState<Test[]>([]);
  const [testSearch, setTestSearch] = useState("");
  const [selectedTests, setSelectedTests] = useState<Test[]>([]);
  const [groups, setGroups] = useState<TestGroup[]>([]);
  const [appliedGroups, setAppliedGroups] = useState<TestGroup[]>([]);
  const [clinicalNotes, setClinicalNotes] = useState("");
  const [linkedEncounter, setLinkedEncounter] = useState<string | null>(null);
  const [linkedAdmission, setLinkedAdmission] = useState<string | null>(linkedAdmissionId || null);
  const [linkInfo, setLinkInfo] = useState<string | null>(null);
  // Who the released report goes back to. See the picker in the render for why this exists.
  const [referringDoctorId, setReferringDoctorId] = useState<string | null>(null);
  const [resolvedDoctorName, setResolvedDoctorName] = useState<string | null>(null);
  const [doctors, setDoctors] = useState<{ id: string; full_name: string }[]>([]);

  // Resolve the hospital's lab payment mode once, for the button label + branch. Pre-paid means
  // "collect before the sample is drawn", so an admitted patient's order goes through the same
  // in-modal payment step OPD uses instead of the charge-to-advance shortcut.
  useEffect(() => {
    if (!hospitalId) return;
    fetchIpdAncillaryPolicy(hospitalId).then((p) => setLabMode(p.lab.mode));
  }, [hospitalId]);
  const ipdPrePaid = !!linkedAdmission && labMode === "pre_paid";
  const [pendingTestNames, setPendingTestNames] = useState<string[]>([]);

  // Payment step state
  const [testRates, setTestRates] = useState<TestRate[]>([]);
  const [loadingRates, setLoadingRates] = useState(false);
  const [paymentMode, setPaymentMode] = useState("cash");
  const [paymentRef, setPaymentRef] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Success step state
  const [createdBillNumber, setCreatedBillNumber] = useState<string | null>(null);
  const [createdBillId, setCreatedBillId] = useState<string | null>(null);

  // Capture preselected names at mount time (stable ref — avoids stale closure)
  const preselectedNamesRef = React.useRef<string[]>(preselectedTestNames || []);
  const preselectionDone = React.useRef(false);

  // Fetch all tests (including fee for auto-billing)
  useEffect(() => {
    supabase
      .from("lab_test_master")
      .select("id, test_name, test_code, category, sample_type, unit, normal_min, normal_max, tat_minutes, fee")
      .eq("hospital_id", hospitalId)
      .eq("is_active", true)
      .order("test_name")
      .then(({ data }) => setAllTests((data as any) || []));
  }, [hospitalId]);

  // Pre-select patient if provided (OPD → Order Lab flow)
  // Also filter out already-ordered tests for this encounter
  useEffect(() => {
    if (preselectedPatient) {
      setSelectedPatient({
        ...preselectedPatient,
        gender: preselectedPatient.gender ?? null,
        dob: preselectedPatient.dob ?? null,
      });
    }
    if (linkedEncounterId) {
      setLinkedEncounter(linkedEncounterId);
      // Filter out tests already ordered across all of today's encounters for this patient
      if (preselectedNamesRef.current.length > 0 && preselectedPatient) {
        const today = new Date().toISOString().split("T")[0];
        supabase.from("opd_encounters").select("id")
          .eq("hospital_id", hospitalId).eq("patient_id", preselectedPatient.id).eq("visit_date", today)
          .then(({ data: encs }: any) => {
            const allEncIds = (encs || []).map((e: any) => e.id);
            if (!allEncIds.length) return;
            (supabase as any).from("lab_orders")
              .select("lab_order_items(lab_test_master:test_id(test_name))")
              .in("encounter_id", allEncIds)
              .then(({ data: existingOrders }: any) => {
                const alreadyOrdered = new Set<string>(
                  (existingOrders || []).flatMap((o: any) =>
                    (o.lab_order_items || []).map((i: any) => (i.lab_test_master?.test_name || "").toLowerCase().trim())
                  )
                );
                if (alreadyOrdered.size > 0) {
                  preselectedNamesRef.current = preselectedNamesRef.current.filter(
                    n => !alreadyOrdered.has(n.toLowerCase().trim())
                  );
                }
              });
          });
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-select tests from OPD prescription (fires when allTests or pendingTestNames change)
  useEffect(() => {
    if (preselectionDone.current || !allTests.length) return;
    // OPD flow: names passed as prop; Lab module flow: names fetched from saved prescription
    const names = preselectedNamesRef.current.length > 0 ? preselectedNamesRef.current : pendingTestNames;
    if (!names.length) return;
    const matched = allTests.filter((t) =>
      names.some((name) => t.test_name.toLowerCase().trim() === name.toLowerCase().trim())
    );
    if (matched.length > 0) {
      setSelectedTests(matched);
      preselectionDone.current = true;
    }
  }, [allTests, pendingTestNames]);

  // Fetch test groups
  useEffect(() => {
    (supabase as any)
      .from("lab_test_groups")
      .select("id, group_name, group_code, fee, lab_test_group_items(test_id)")
      .eq("hospital_id", hospitalId)
      .eq("is_active", true)
      .order("group_name")
      .then(({ data }: any) => {
        setGroups((data || []).map((g: any) => ({
          id: g.id,
          group_name: g.group_name,
          group_code: g.group_code,
          fee: Number(g.fee) || 0,
          testIds: (g.lab_test_group_items || []).map((i: any) => i.test_id),
        })));
      });
  }, [hospitalId]);

  // Search patients (debounced)
  const debouncedPatientSearch = useDebounce(patientSearch, 300);
  useEffect(() => {
    if (debouncedPatientSearch.length < 2) { setPatients([]); return; }
    const q = `%${debouncedPatientSearch}%`;
    supabase
      .from("patients")
      .select("id, full_name, uhid, gender, dob")
      .eq("hospital_id", hospitalId)
      .eq("is_active", true)
      .or(`full_name.ilike.${q},uhid.ilike.${q},phone.ilike.${q}`)
      .limit(8)
      .then(({ data }) => { setPatients((data as any) || []); setShowPatientResults(true); });
  }, [debouncedPatientSearch, hospitalId]);

  // Auto-link encounter / admission — and pre-select whatever the doctor prescribed.
  //
  // getPrescribedPending resolves the patient's context: today's OPD encounters, or (for an
  // admitted patient) the current admission. This used to be an inline opd_encounters query
  // that bailed out when the patient had no encounter today, which is exactly the case for an
  // inpatient — so ward orders never pre-selected and the counter had nothing to bill.
  useEffect(() => {
    if (!selectedPatient) {
      setLinkedEncounter(null); setLinkedAdmission(null); setLinkInfo(null); setPendingTestNames([]);
      return;
    }
    let cancelled = false;
    getPrescribedPending(hospitalId, selectedPatient.id, "lab", {
      preferredAdmissionId: linkedAdmissionId,
    }).then((res) => {
      if (cancelled) return;
      // Most recent encounter is the primary link; null for an admitted patient.
      setLinkedEncounter(res.encounterIds[0] ?? null);
      setLinkInfo(res.linkLabel);
      if (!preselectedNamesRef.current.length && !preselectionDone.current && res.names.length > 0) {
        setPendingTestNames(res.names);
      }
    });
    return () => { cancelled = true; };
    // Admission linking itself stays with <AdmissionLinker> below — it resolves ALL active
    // admissions and lets the user pick when there is more than one, instead of grabbing an
    // arbitrary one here (which silently billed charges to the wrong stay).
  }, [selectedPatient, hospitalId, linkedAdmissionId]);

  // Doctor list for the referring-doctor picker.
  useEffect(() => {
    (supabase as any)
      .from("users")
      .select("id, full_name")
      .eq("hospital_id", hospitalId)
      .eq("role", "doctor")
      .eq("is_active", true)
      .order("full_name")
      .then(({ data }: any) => setDoctors(data || []));
  }, [hospitalId]);

  // Default the referring doctor to the treating doctor of whichever visit this order was
  // linked to, so a released result has a clinician to go back to.
  useEffect(() => {
    if (!linkedEncounter && !linkedAdmission) {
      setResolvedDoctorName(null);
      return;
    }
    let cancelled = false;
    resolveTreatingDoctor({ encounterId: linkedEncounter, admissionId: linkedAdmission })
      .then(({ doctorId, doctorName }) => {
        if (cancelled) return;
        setResolvedDoctorName(doctorName);
        // Only fill a blank — never overwrite a doctor the user picked by hand.
        setReferringDoctorId((prev) => prev ?? doctorId);
      });
    return () => { cancelled = true; };
  }, [linkedEncounter, linkedAdmission]);

  const addTest = (test: Test) => {
    if (!selectedTests.find(t => t.id === test.id)) setSelectedTests(prev => [...prev, test]);
  };
  const removeTest = (testId: string) => setSelectedTests(prev => prev.filter(t => t.id !== testId));
  const addGroup = (group: TestGroup) => {
    const groupTests = allTests.filter(t => group.testIds.includes(t.id));
    setSelectedTests(prev => {
      const existing = new Set(prev.map(t => t.id));
      return [...prev, ...groupTests.filter(t => !existing.has(t.id))];
    });
    setAppliedGroups(prev => prev.find(g => g.id === group.id) ? prev : [...prev, group]);
  };

  const removeGroup = (groupId: string) => {
    const group = appliedGroups.find(g => g.id === groupId);
    if (!group) return;
    // Only remove tests that aren't covered by other applied groups
    const otherGroupTestIds = new Set(
      appliedGroups.filter(g => g.id !== groupId).flatMap(g => g.testIds)
    );
    setSelectedTests(prev => prev.filter(t =>
      !group.testIds.includes(t.id) || otherGroupTestIds.has(t.id)
    ));
    setAppliedGroups(prev => prev.filter(g => g.id !== groupId));
  };

  const filteredTests = testSearch.length > 0
    ? allTests.filter(t => t.test_name.toLowerCase().includes(testSearch.toLowerCase()) || (t.test_code && t.test_code.toLowerCase().includes(testSearch.toLowerCase())))
    : [];

  // Lookup rates — group tests billed at group price, others at individual price
  const fetchRates = async (): Promise<TestRate[]> => {
    // Auto-detect fully-covered groups from selectedTests (handles auto-selection from prescription)
    const selectedIds = new Set(selectedTests.map(t => t.id));
    const autoDetectedGroups = groups.filter(g =>
      g.testIds.length > 0 && g.testIds.every(id => selectedIds.has(id))
    );
    // Merge explicit appliedGroups with auto-detected ones (deduplicated)
    const effectiveGroups = [...appliedGroups];
    for (const g of autoDetectedGroups) {
      if (!effectiveGroups.some(eg => eg.id === g.id)) effectiveGroups.push(g);
    }

    const groupCoveredIds = new Set(effectiveGroups.flatMap(g => g.testIds));
    const rates: TestRate[] = [];

    // One line item per effective group (group price)
    for (const group of effectiveGroups) {
      rates.push({ id: group.id, name: group.group_name + (group.group_code ? ` (${group.group_code})` : ""), rate: group.fee, gstPct: 0, gstAmount: 0, total: group.fee });
    }

    // Individual tests NOT covered by a group
    const individualTests = selectedTests.filter(t => !groupCoveredIds.has(t.id));

    // Use fee cached in allTests — fallback to service_master only if fee is absent
    const unpriced = individualTests.filter(t => !(Number(t.fee) > 0));
    const svcLookups = unpriced.length > 0
      ? await Promise.all(unpriced.map(t =>
          (supabase as any).from("service_master")
            .select("fee, gst_percent, gst_applicable")
            .eq("hospital_id", hospitalId).eq("category", "lab")
            .ilike("name", `%${t.test_name}%`).eq("is_active", true)
            .limit(1).maybeSingle()
            .then(({ data }: any) => ({ id: t.id, svc: data }))
        ))
      : [];
    const svcMap = new Map(svcLookups.map((s: any) => [s.id, s.svc]));

    const individualRates = individualTests.map(t => {
      if (Number(t.fee) > 0) {
        const rate = Number(t.fee);
        return { id: t.id, name: t.test_name, rate, gstPct: 0, gstAmount: 0, total: rate };
      }
      const svc = svcMap.get(t.id);
      if (Number(svc?.fee) > 0) {
        const rate = Number(svc.fee);
        const gstPct = svc.gst_applicable ? Number(svc.gst_percent) || 0 : 0;
        const gstAmount = rate * gstPct / 100;
        return { id: t.id, name: t.test_name, rate, gstPct, gstAmount, total: rate + gstAmount };
      }
      return { id: t.id, name: t.test_name, rate: 0, gstPct: 0, gstAmount: 0, total: 0 };
    });

    return [...rates, ...individualRates];
  };

  // Step 1 → Step 2: compute rates and show payment screen
  const handleProceedToPayment = async () => {
    if (!selectedPatient) { toast({ title: "Please select a patient", variant: "destructive" }); return; }
    if (selectedTests.length === 0) { toast({ title: "Please select at least one test", variant: "destructive" }); return; }

    // IPD + post_paid: accrue to the admission bill, no cash step (charge to advance).
    // IPD + pre_paid, and OPD: fall through to the in-modal payment step below.
    if (linkedAdmission && !ipdPrePaid) {
      await createOrderIPD();
      return;
    }

    setLoadingRates(true);
    const rates = await fetchRates();
    setTestRates(rates);
    setLoadingRates(false);
    setStep("payment");
  };

  // Atomic per-hospital accession number (Phase 3). Best-effort: order creation
  // must not fail if the RPC is unavailable — analyzer matching simply falls back
  // to the sample barcode for such orders.
  const fetchAccession = async (): Promise<string | null> => {
    try {
      const { data, error } = await (supabase as any).rpc("next_lab_accession", { p_hospital_id: hospitalId });
      if (error) return null;
      return (data as string) || null;
    } catch {
      return null;
    }
  };

  /**
   * IPD path: create the order, then post its charges at order time.
   *
   * This used to mint a standalone bill_type:'lab' bill whose lines carried no
   * source_dedupe_key, while the discharge sweep independently pulled the same tests onto the
   * IPD bill under keys of its own — two lines per test, and a duplicate GL posting to match.
   * Charges now go through postAncillaryOrderCharges, which posts onto the admission bill
   * using the sweep's own keys (lab:{lab_order_items.id}), so the sweep recognises and skips
   * them. Whether the patient pays now or at discharge is the hospital's setting.
   */
  const createOrderIPD = async () => {
    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { data: userData } = await supabase.from("users").select("id").eq("auth_user_id", user.id).limit(1).maybeSingle();
      if (!userData) throw new Error("User record not found");

      const policy = await fetchIpdAncillaryPolicy(hospitalId);
      const paymentStatus = resolveChargePaymentStatus({ isIPD: true, mode: policy.lab.mode });

      const { data: order, error: orderErr } = await supabase.from("lab_orders").insert({
        hospital_id: hospitalId,
        patient_id: selectedPatient!.id,
        // `ordered_by` is RLS-checked: lab_orders_insert asserts it equals the calling user's
        // users.id, so it must stay the desk user who keyed this in. The clinician who actually
        // asked for the test goes in referring_doctor_id, which is what the result-ready
        // notification and the doctor's Reports tab read (falling back to ordered_by).
        ordered_by: userData.id,
        referring_doctor_id: referringDoctorId || null,
        priority,
        clinical_notes: clinicalNotes || null,
        encounter_id: linkedEncounter,
        admission_id: linkedAdmission,
        status: "ordered",
        billing_status: "billed",
        // Was omitted entirely, so IPD lab orders sat at the column default 'pending_payment'
        // while radiology set its own — the same screen behaving two ways.
        payment_status: paymentStatus,
        ordered_at: new Date().toISOString(),
        accession_number: await fetchAccession(),
      } as any).select("id").maybeSingle();
      if (orderErr || !order) throw orderErr || new Error("Failed to create order");

      // .select() so each item's id is known: the charge is keyed per test (lab:{item.id}),
      // matching the discharge sweep, which pulls from lab_order_items — not per order.
      const { data: orderItems, error: itemsErr } = await supabase.from("lab_order_items").insert(
        selectedTests.map(t => ({
          hospital_id: hospitalId,
          lab_order_id: order.id,
          test_id: t.id,
          status: "ordered",
          result_unit: t.unit,
          reference_range: t.normal_min != null && t.normal_max != null
            ? `${t.normal_min}–${t.normal_max} ${t.unit || ""}` : t.normal_max != null ? `< ${t.normal_max} ${t.unit || ""}` : null,
        }))
      ).select("id, test_id");
      if (itemsErr) throw itemsErr;

      const sampleTypes = [...new Set(selectedTests.map(t => t.sample_type))];
      await supabase.from("lab_samples").insert(
        sampleTypes.map(st => ({
          hospital_id: hospitalId, lab_order_id: order.id,
          sample_type: st, barcode: `BC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, status: "pending",
        }))
      );

      // Rates are resolved ONCE, here, and handed to the charge posting. In pre_paid mode the
      // cashier collects this exact number, so it must be the number that lands on the bill.
      const rates = await fetchRates();
      const rateByTestId = new Map(rates.map(r => [r.id, r]));

      const charged = await postAncillaryOrderCharges({
        hospitalId,
        patientId: selectedPatient!.id,
        admissionId: linkedAdmission,
        service: "lab",
        orderedBy: userData.id,
        policy,
        items: (orderItems || []).map((oi: any) => {
          const r = rateByTestId.get(oi.test_id);
          return {
            sourceId: oi.id,
            dedupeKey: `lab:${oi.id}`,
            description: `Lab: ${r?.name || "Test"}`,
            unitPrice: r?.rate ?? 0,
            gstPercent: r?.gstPct ?? 0,
          };
        }),
      });

      if (!charged.ok) {
        // Leaving an uncharged order behind would let the gate clear it as "no charge found"
        // — a free test. Undo the order rather than ship that.
        await supabase.from("lab_orders").delete().eq("id", order.id);
        throw new Error(charged.error || "Lab charges could not be posted — order cancelled");
      }

      if (priority === "stat") {
        await supabase.from("clinical_alerts").insert({
          hospital_id: hospitalId, alert_type: "stat_lab_order", severity: "high",
          alert_message: `STAT lab order for ${selectedPatient!.full_name}: ${selectedTests.map(t => t.test_name).join(", ")}`,
          patient_id: selectedPatient!.id,
        });
      }

      await logNABHEvidence(
        hospitalId,
        "COP.6",
        `Lab order created and billed (IPD): ${selectedTests.map(t => t.test_name).join(", ")} for patient ${selectedPatient!.full_name}`,
        "compliant"
      );

      toast(
        paymentStatus === "pending_payment"
          ? {
              title: "✓ Lab order created — payment pending",
              description: "The sample cannot be collected until the amount is paid at the billing counter.",
            }
          : { title: "✓ Lab order created — charged to the IPD bill" }
      );
      onCreated();

    } catch (err: any) {
      toast({ title: "Failed to create order", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  // Step 2 → collect payment → create bill + order → Step 3 (success)
  const handleCollectAndCreate = async () => {
    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { data: userData } = await supabase.from("users").select("id").eq("auth_user_id", user.id).limit(1).maybeSingle();
      if (!userData) throw new Error("User record not found");

      const subtotal = testRates.reduce((s, t) => s + t.rate, 0);
      const gstTotal = testRates.reduce((s, t) => s + t.gstAmount, 0);
      const grandTotal = subtotal + gstTotal;
      const now = new Date().toISOString();
      const today = now.split("T")[0];

      // Map UI payment modes to bill_payments constraint values
      const pmodeMap: Record<string, string> = { cash: "cash", upi: "upi", card: "card", neft: "net_banking" };
      const dbPaymentMode = pmodeMap[paymentMode] || "cash";

      // 1. Create the order + items FIRST. For an admitted patient the paid line must carry
      //    the dedupe key lab:{lab_order_items.id}, which the discharge sweep also uses — so
      //    the order items must exist (and their ids be known) before the bill lines are cut,
      //    or the sweep would bill the same tests a second time.
      const { data: order, error: orderErr } = await supabase.from("lab_orders").insert({
        hospital_id: hospitalId,
        patient_id: selectedPatient!.id,
        // ordered_by = the calling user (RLS), referring_doctor_id = who asked for it.
        // See the post-paid insert above.
        ordered_by: userData.id,
        referring_doctor_id: referringDoctorId || null,
        priority,
        clinical_notes: clinicalNotes || null,
        encounter_id: linkedEncounter,
        // An admitted patient's paid receipt is tied to the admission; OPD orders are not.
        admission_id: ipdPrePaid ? linkedAdmission : null,
        status: "ordered",
        billing_status: "billed",
        payment_status: "paid",
        ordered_at: new Date().toISOString(),
        accession_number: await fetchAccession(),
      } as any).select("id").maybeSingle();
      if (orderErr || !order) throw orderErr || new Error("Lab order creation failed");

      const { data: orderItems, error: itemsErr } = await supabase.from("lab_order_items").insert(
        selectedTests.map(t => ({
          hospital_id: hospitalId,
          lab_order_id: order.id,
          test_id: t.id,
          status: "ordered",
          result_unit: t.unit,
          reference_range: t.normal_min != null && t.normal_max != null
            ? `${t.normal_min}–${t.normal_max} ${t.unit || ""}` : t.normal_max != null ? `< ${t.normal_max} ${t.unit || ""}` : null,
        }))
      ).select("id, test_id");
      if (itemsErr) throw itemsErr;

      const sampleTypes = [...new Set(selectedTests.map(t => t.sample_type))];
      await supabase.from("lab_samples").insert(
        sampleTypes.map(st => ({
          hospital_id: hospitalId, lab_order_id: order.id,
          sample_type: st, barcode: `BC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, status: "pending",
        }))
      );

      // 2. Create bill (paid immediately)
      const billNumber = await generateBillNumber(hospitalId, "LAB");
      const { data: bill, error: billErr } = await (supabase as any).from("bills").insert({
        hospital_id: hospitalId,
        patient_id: selectedPatient!.id,
        admission_id: ipdPrePaid ? linkedAdmission : null,
        encounter_id: linkedEncounter || null,
        bill_number: billNumber,
        bill_type: "lab",
        bill_date: today,
        bill_status: "final",
        payment_status: "paid",
        notes: paymentRef ? `Payment ref: ${paymentRef}` : null,
        subtotal,
        gst_amount: gstTotal,
        total_amount: grandTotal,
        patient_payable: grandTotal,
        paid_amount: grandTotal,
        balance_due: 0,
        created_by: userData.id,
      }).select("id").maybeSingle();
      if (billErr || !bill) throw billErr || new Error("Bill creation failed");

      // 3. Record payment in bill_payments (drives revenue analytics + collections)
      await (supabase as any).from("bill_payments").insert({
        hospital_id: hospitalId,
        bill_id: bill.id,
        payment_mode: dbPaymentMode,
        amount: grandTotal,
        payment_date: today,
        transaction_id: paymentRef || null,
        received_by: userData.id,
        notes: `Lab: ${selectedTests.map(t => t.test_name).join(", ")}`,
      });

      // Sync to accounting ledger (non-blocking — won't fail the order if no rule configured)
      try {
        await autoPostJournalEntry({
          triggerEvent: "bill_finalized_lab",
          sourceModule: "lab",
          sourceId: bill.id,
          amount: grandTotal,
          description: `Lab charges — Bill ${billNumber}`,
          hospitalId,
          postedBy: userData.id,
        });
      } catch { /* accounting failure must not block patient care */ }

      // 4. Bill line items — one per order item, keyed lab:{item.id} so the discharge sweep
      //    recognises the already-paid tests and does not re-bill them.
      const rateByTestId = new Map(testRates.map(t => [t.id, t]));
      await (supabase as any).from("bill_line_items").insert(
        (orderItems || []).map((oi: any) => {
          const t = rateByTestId.get(oi.test_id);
          return {
            hospital_id: hospitalId,
            bill_id: bill.id,
            description: `Lab: ${t?.name || "Test"}`,
            item_type: "lab",
            quantity: 1,
            unit_rate: t?.rate ?? 0,
            taxable_amount: t?.rate ?? 0,
            gst_percent: t?.gstPct ?? 0,
            gst_amount: t?.gstAmount ?? 0,
            total_amount: t?.total ?? 0,
            service_date: today,
            source_module: "lab",
            ordered_by: userData.id,
            payment_status: "paid",
            source_record_id: oi.id,
            source_dedupe_key: `lab:${oi.id}`,
          };
        })
      );

      for (const oi of (orderItems || []) as any[]) {
        const t = rateByTestId.get(oi.test_id);
        recordServiceCharge({
          hospitalId, patientId: selectedPatient!.id,
          admissionId: ipdPrePaid ? linkedAdmission : null,
          encounterId: linkedEncounter || null,
          serviceModule: "lab", serviceRefId: oi.id,
          serviceName: `Lab: ${t?.name || "Test"}`,
          unitRate: t?.rate ?? 0, gstPercent: t?.gstPct ?? 0, gstAmount: t?.gstAmount ?? 0, totalAmount: t?.total ?? 0,
          billId: bill.id, performedBy: userData.id,
        });
      }

      if (priority === "stat") {
        await supabase.from("clinical_alerts").insert({
          hospital_id: hospitalId, alert_type: "stat_lab_order", severity: "high",
          alert_message: `STAT lab order for ${selectedPatient!.full_name}: ${selectedTests.map(t => t.test_name).join(", ")}`,
          patient_id: selectedPatient!.id,
        });
      }

      await logNABHEvidence(
        hospitalId,
        "COP.6",
        `Lab order created and billed (OPD): ${selectedTests.map(t => t.test_name).join(", ")} for patient ${selectedPatient!.full_name}`,
        "compliant"
      );

      setCreatedBillNumber(billNumber);
      setCreatedBillId(bill.id);
      setStep("success");
      // onCreated() is deliberately NOT called here — every caller (LabPage.tsx,
      // EmergencyWorkspace.tsx) wires it to immediately unmount this modal
      // (`setShowNewOrder(false)` etc), which happens in the same render pass as the
      // setStep("success") above and so pre-empts it: the order and bill are genuinely
      // created (confirmed live — a direct DB read shows the paid lab_orders/bills rows), but
      // the "Payment Collected!" / Print Bill confirmation screen never has a chance to paint.
      // Deferred to the Done button below, matching WalkInModal's own working three-step
      // order/payment/receipt pattern (onCreated + onClose only fire once the user
      // acknowledges the receipt).
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const grandTotal = testRates.reduce((s, t) => s + t.total, 0);
  const gstTotal = testRates.reduce((s, t) => s + t.gstAmount, 0);
  const subtotalAmount = testRates.reduce((s, t) => s + t.rate, 0);

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-[520px] max-h-[90vh] overflow-y-auto">

        {/* ── STEP 1: ORDER FORM ── */}
        {step === "order" && (
          <>
            <DialogHeader>
              <DialogTitle className="text-lg">New Lab Order</DialogTitle>
              <p className="text-sm text-muted-foreground">Search patient, select tests, set priority</p>
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
                    <button onClick={() => { setSelectedPatient(null); setPatientSearch(""); }} className="text-muted-foreground hover:text-foreground">
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <div className="relative mt-1">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={patientSearch}
                      onChange={e => setPatientSearch(e.target.value)}
                      placeholder="Search by name, UHID, phone..."
                      className="pl-9"
                    />
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
                {linkInfo && (
                  <div className="mt-2 text-xs bg-blue-50 border-l-[3px] border-blue-500 text-blue-700 px-3 py-2 rounded-r">
                    {linkInfo}
                  </div>
                )}
                <AdmissionLinker
                  hospitalId={hospitalId}
                  patientId={selectedPatient?.id ?? null}
                  preferredAdmissionId={linkedAdmissionId}
                  onChange={setLinkedAdmission}
                />

                {/* Referring doctor — this is who the report goes back to.
                    `ordered_by` used to be whoever was logged in at the lab bench, so a
                    released result had no clinician to notify and the Reports tab had no
                    doctor to attribute the order to. Defaults to the treating doctor of the
                    linked visit; editable for a direct-to-lab walk-in. */}
                {selectedPatient && (
                  <div className="mt-3">
                    <label className="text-sm font-medium text-foreground">Referring Doctor</label>
                    <select
                      value={referringDoctorId || ""}
                      onChange={(e) => setReferringDoctorId(e.target.value || null)}
                      className="w-full h-10 mt-1 rounded-lg border border-border bg-background px-3 text-sm"
                    >
                      <option value="">— No referring doctor (report goes to no one) —</option>
                      {doctors.map((d) => (
                        <option key={d.id} value={d.id}>Dr {d.full_name}</option>
                      ))}
                    </select>
                    {resolvedDoctorName && referringDoctorId && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Auto-filled from the linked visit — the report will be sent to Dr {resolvedDoctorName}.
                      </p>
                    )}
                  </div>
                )}
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
                {priority === "stat" && (
                  <div className="mt-2 text-xs bg-amber-50 border border-amber-200 text-amber-700 px-3 py-2 rounded-lg">
                    STAT orders are processed immediately. Please inform the lab verbally as well.
                  </div>
                )}
              </div>

              {/* Tests */}
              <div>
                <label className="text-sm font-medium text-foreground">Select Tests *</label>

                {/* DB-driven groups */}
                {groups.length > 0 && (
                  <div className="mt-2">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1.5">Groups / Panels</p>
                    <div className="flex flex-wrap gap-1.5">
                      {groups.map(group => {
                        const applied = appliedGroups.some(g => g.id === group.id) ||
                          (group.testIds.length > 0 && group.testIds.every(id => selectedTests.some(t => t.id === id)));
                        return (
                          <button
                            key={group.id}
                            onClick={() => applied ? removeGroup(group.id) : addGroup(group)}
                            className={cn(
                              "px-3 py-1.5 text-xs border rounded-md transition-colors",
                              applied
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-muted border-border text-foreground hover:bg-primary/5 hover:border-primary/30"
                            )}
                          >
                            {group.group_name}
                            {group.fee > 0 && <span className="ml-1 opacity-70">₹{group.fee}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="relative mt-2">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input value={testSearch} onChange={e => setTestSearch(e.target.value)} placeholder="Search tests by name or code..." className="pl-9" />
                  {filteredTests.length > 0 && (
                    <div className="absolute z-50 w-full mt-1 bg-card border border-border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                      {filteredTests.slice(0, 10).map(t => (
                        <button key={t.id} onClick={() => { addTest(t); setTestSearch(""); }}
                          className="w-full text-left px-3 py-2 hover:bg-muted text-sm flex justify-between">
                          <span>{t.test_name}</span>
                          <span className="text-xs text-muted-foreground">{t.test_code}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {selectedTests.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs text-muted-foreground mb-1">{selectedTests.length} test(s) selected</p>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedTests.map(t => (
                        <span key={t.id} className="inline-flex items-center gap-1 px-2.5 py-1 bg-primary/5 text-primary text-xs rounded-full">
                          {t.test_name}
                          <button onClick={() => removeTest(t.id)} className="hover:text-destructive"><X size={12} /></button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Unmatched prescribed tests — names from OPD prescription not found in lab catalog */}
                {(() => {
                  const prescribed = preselectedNamesRef.current.length > 0
                    ? preselectedNamesRef.current
                    : pendingTestNames;
                  const unmatched = prescribed.filter(
                    name => !allTests.some(t => t.test_name.toLowerCase().trim() === name.toLowerCase().trim())
                  );
                  return unmatched.length > 0 ? (
                    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                      <p className="text-[11px] font-semibold text-amber-800 flex items-center gap-1.5 mb-1.5">
                        <AlertTriangle size={12} />
                        {unmatched.length} prescribed test{unmatched.length > 1 ? "s" : ""} not found in lab catalog
                      </p>
                      <div className="flex flex-wrap gap-1.5 mb-1.5">
                        {unmatched.map(name => (
                          <span key={name} className="inline-flex items-center text-[11px] px-2 py-0.5 rounded-full border border-amber-300 bg-white text-amber-700">
                            {name}
                          </span>
                        ))}
                      </div>
                      <p className="text-[10px] text-amber-600">
                        Search for an equivalent test above, or add these to the catalog via Settings → Lab → Tests.
                      </p>
                    </div>
                  ) : null;
                })()}
              </div>

              {/* Clinical Notes */}
              <div>
                <label className="text-sm font-medium text-foreground">Clinical Notes / Indication</label>
                <Textarea value={clinicalNotes} onChange={e => setClinicalNotes(e.target.value)}
                  placeholder="Reason for test, relevant history..." rows={2} className="mt-1 resize-none" />
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <button onClick={onClose} className="flex-1 h-12 rounded-lg border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handleProceedToPayment}
                  disabled={loadingRates || submitting || !selectedPatient || selectedTests.length === 0}
                  className="flex-[2] h-12 rounded-lg bg-[hsl(var(--sidebar-background))] text-white text-sm font-semibold hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2"
                >
                  {loadingRates || submitting
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> Processing...</>
                    : (linkedAdmission && !ipdPrePaid)
                    ? "📋 Create Order (Charge to Advance) →"
                    : "📋 Proceed to Payment →"
                  }
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── STEP 2: PAYMENT COLLECTION ── */}
        {step === "payment" && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2">
                <button onClick={() => setStep("order")} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
                  <ArrowLeft size={16} />
                </button>
                <div>
                  <DialogTitle className="text-lg">Collect Payment</DialogTitle>
                  <p className="text-sm text-muted-foreground">Collect cash before lab processing begins</p>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-4 mt-2">
              {/* Patient info */}
              <div className="bg-muted/40 rounded-lg px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-sm">{selectedPatient?.full_name}</p>
                  <p className="text-xs text-muted-foreground">{selectedPatient?.uhid}</p>
                </div>
                <Badge variant="outline">{priority.toUpperCase()}</Badge>
              </div>

              {/* Itemized charges */}
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="bg-muted/50 px-3 py-2 flex justify-between text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  <span>Test</span>
                  <span>Amount</span>
                </div>
                <div className="divide-y divide-border">
                  {testRates.map((t, i) => (
                    <div key={t.id} className="flex items-center justify-between px-3 py-2 text-sm gap-3">
                      <span className="text-foreground flex-1">{t.name}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-muted-foreground text-xs">₹</span>
                        <input
                          type="number"
                          min="0"
                          value={t.rate === 0 ? "" : t.rate}
                          placeholder="Enter fee"
                          onChange={e => {
                            const val = parseFloat(e.target.value) || 0;
                            setTestRates(prev => prev.map((r, idx) =>
                              idx === i ? { ...r, rate: val, gstAmount: val * r.gstPct / 100, total: val + (val * r.gstPct / 100) } : r
                            ));
                          }}
                          className={cn(
                            "w-24 text-right border rounded px-2 py-1 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-primary",
                            t.rate === 0 ? "border-amber-400 bg-amber-50 placeholder-amber-400" : "border-border bg-background"
                          )}
                        />
                        {t.gstAmount > 0 && (
                          <span className="text-xs text-muted-foreground">+₹{t.gstAmount.toFixed(0)}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {testRates.some(t => t.rate === 0) && (
                  <div className="px-3 py-2 bg-amber-50 border-t border-amber-200 text-xs text-amber-700">
                    ⚠ Tests with no price — enter fee manually or set rates in Settings → Services & Fees
                  </div>
                )}
                {/* Totals */}
                <div className="bg-muted/30 border-t divide-y divide-border">
                  {gstTotal > 0 && (
                    <div className="flex justify-between px-3 py-2 text-xs text-muted-foreground">
                      <span>Subtotal</span>
                      <span>₹{subtotalAmount.toLocaleString("en-IN")}</span>
                    </div>
                  )}
                  {gstTotal > 0 && (
                    <div className="flex justify-between px-3 py-2 text-xs text-muted-foreground">
                      <span>GST</span>
                      <span>₹{gstTotal.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between px-3 py-3">
                    <span className="font-bold text-base">Total Payable</span>
                    <span className="font-bold text-xl text-primary">₹{grandTotal.toLocaleString("en-IN")}</span>
                  </div>
                </div>
              </div>

              {/* Payment mode */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Payment Mode</label>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { value: "cash", label: "💵 Cash" },
                    { value: "upi", label: "📱 UPI" },
                    { value: "card", label: "💳 Card" },
                    { value: "neft", label: "🏦 NEFT" },
                  ].map(m => (
                    <button key={m.value} onClick={() => setPaymentMode(m.value)}
                      className={cn("h-10 rounded-lg border text-sm font-medium transition-colors",
                        paymentMode === m.value
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-muted border-border text-foreground hover:bg-muted/80"
                      )}>
                      {m.label}
                    </button>
                  ))}
                </div>
                {paymentMode !== "cash" && (
                  <Input
                    value={paymentRef}
                    onChange={e => setPaymentRef(e.target.value)}
                    placeholder={paymentMode === "upi" ? "UPI Reference / UTR No." : paymentMode === "card" ? "Card last 4 digits / Approval code" : "NEFT / Cheque reference no."}
                    className="mt-1"
                  />
                )}
              </div>

              {/* Collect button */}
              <div className="flex gap-2 pt-1">
                <Button variant="outline" onClick={() => setStep("order")} className="flex-1">
                  <ArrowLeft className="h-4 w-4 mr-1" /> Back
                </Button>
                <Button
                  onClick={handleCollectAndCreate}
                  disabled={submitting}
                  className="flex-[2] h-12 text-base font-bold bg-emerald-600 hover:bg-emerald-700"
                >
                  {submitting
                    ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Processing...</>
                    : <><IndianRupee className="h-4 w-4 mr-1" /> Collect ₹{grandTotal.toLocaleString("en-IN")} & Create Order</>
                  }
                </Button>
              </div>
            </div>
          </>
        )}

        {/* ── STEP 3: SUCCESS / RECEIPT ── */}
        {step === "success" && (
          <div className="py-4 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
              <CheckCircle2 className="h-9 w-9 text-emerald-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">Payment Collected!</h2>
              <p className="text-sm text-muted-foreground mt-1">Lab order created and bill invoice generated</p>
            </div>

            {/* Receipt summary */}
            <div className="bg-muted/40 rounded-xl p-4 text-left space-y-2 border border-border">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Bill No.</span>
                <span className="font-bold text-primary">{createdBillNumber}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Patient</span>
                <span className="font-medium">{selectedPatient?.full_name}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Tests</span>
                <span className="font-medium">{selectedTests.length} test(s)</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Payment</span>
                <span className="font-medium capitalize">{paymentMode}</span>
              </div>
              <div className="flex justify-between text-base font-bold pt-2 border-t border-border">
                <span>Amount Paid</span>
                <span className="text-emerald-600">₹{grandTotal.toLocaleString("en-IN")}</span>
              </div>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={async () => {
                if (!createdBillId) return;
                const ok = await printBillById(createdBillId, hospitalId);
                if (!ok) toast({ title: "Could not open the bill for printing", variant: "destructive" });
              }}>
                <Printer className="h-4 w-4 mr-1" /> Print Bill
              </Button>
              <Button className="flex-1" onClick={() => { onCreated(); onClose(); }}>
                Done
              </Button>
            </div>
          </div>
        )}

      </DialogContent>
    </Dialog>
  );
};

export default NewLabOrderModal;
