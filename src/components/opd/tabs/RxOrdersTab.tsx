import React, { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { X, Plus, AlertTriangle, ShieldX, CheckCircle2, Pencil, RotateCcw, Clock, FileText } from "lucide-react";
import type { PrescriptionData, DrugEntry, LabOrder, RadiologyOrder, OrderAvailability } from "../ConsultationWorkspace";
import { checkDrugSafety, type DrugSafetyResult } from "@/lib/drugSafetyCheck";
import DrugSafetyAlertModal from "@/components/opd/DrugSafetyAlertModal";
import AllergyBanner from "@/components/clinical/AllergyBanner";
import { isAntibioticByName } from "@/lib/high-alert-meds";
import AntibioticJustificationModal from "@/components/quality/AntibioticJustificationModal";
import { useToast } from "@/hooks/use-toast";
import { useConfigValues } from "@/hooks/useConfigValues";
import { useDoctorQuickPicks } from "@/hooks/useDoctorQuickPicks";
import { useRealtimeRefetch } from "@/hooks/useRealtimeRefetch";
import type { RxQuickPickTemplate, TestGroupOrderEntry } from "@/lib/quickPickDefaults";
import QuickPickManagerPanel from "@/components/opd/QuickPickManagerPanel";
import DrugMasterSearchInput from "@/components/opd/DrugMasterSearchInput";
import TestGroupPickerModal from "@/components/opd/TestGroupPickerModal";
import {
  loadOrderCatalogue,
  matchOrderNameDetailed,
  type OrderCatalogue,
} from "@/lib/orderCatalogue";
import { resolveOrdersWithAI } from "@/lib/orderCatalogueAI";
import { useAIFeature } from "@/hooks/useAIFeature";

interface Props {
  prescription: PrescriptionData;
  onChange: (partial: Partial<PrescriptionData>) => void;
  hospitalId: string | null;
  patientAllergies?: string[];
  diagnosis?: string;
  icdCode?: string;
  patientAge?: number;
  patientGender?: string;
  encounterId?: string | null;
  /** IPD's equivalent of encounterId. Exactly one of the two is set — a prescription belongs
   *  to an encounter or an admission, never both (CHECK prescriptions_one_context). */
  admissionId?: string | null;
  /** Required to attach a drug-safety override to the patient's record (BUG-P4-004). */
  patientId?: string | null;
  /** The prescriber. An override with no author is not an audit trail (P4-S11). */
  userId?: string | null;
}


const FREQ_PER_DAY: Record<string, number> = {
  OD: 1, QD: 1, HS: 1, SOS: 1, STAT: 1, AC: 1, PC: 1,
  BD: 2,
  TDS: 3,
  QID: 4,
};

const calcQty = (dose: string, frequency: string, days: string): number => {
  const doseNum = parseFloat(dose) || 1;
  const freqPerDay = FREQ_PER_DAY[frequency?.toUpperCase()] ?? 1;
  const d = parseInt(days || "0", 10) || 0;
  return d > 0 ? Math.ceil(doseNum * freqPerDay * d) : 0;
};


const templateToDrugEntry = (t: RxQuickPickTemplate): DrugEntry => ({
  drug_name: t.drug_name,
  dose: t.dose,
  route: t.route,
  frequency: t.frequency,
  duration_days: t.duration_days,
  instructions: t.instructions,
  quantity: t.quantity,
  is_stat: false,
});


/** Safety badge icons per drug */
interface DrugSafetyMeta {
  severity: "interaction" | "allergy_override" | "duplicate";
  tooltip: string;
}

/**
 * How far along the money is for a prescribed investigation. Absence from the map is the
 * third state, PRESCRIBED — it is in the doctor's draft and no order row exists yet.
 *
 * The chip used to read "BILLED & ORDERED" purely from the existence of a lab_orders row,
 * which is not a claim about payment at all. Under payment-first ordering an order row only
 * exists once the cashier has taken the money, so "awaiting_payment" is now rare (it means an
 * IPD pre-paid order, or a charge posted by a path that does not collect) — but a chip that
 * asserts BILLED must be able to say otherwise, or it is just decoration.
 */
export type OrderState = "awaiting_payment" | "paid";
type OrderStateMap = Map<string, OrderState>;

const orderStateOf = (map: OrderStateMap, name: string): OrderState | null =>
  map.get(name.toLowerCase().trim()) ?? null;

/** The chip on a prescribed investigation. `null` state = PRESCRIBED (no order row yet). */
export const OrderStateChip: React.FC<{ state: OrderState | null; className?: string }> = ({
  state, className,
}) => {
  if (state === "paid") {
    return (
      <span className={cn("text-emerald-600 font-bold flex items-center gap-1", className)}>
        <CheckCircle2 size={10} /> BILLED &amp; ORDERED
      </span>
    );
  }
  if (state === "awaiting_payment") {
    return (
      <span className={cn("text-amber-700 font-bold flex items-center gap-1", className)}>
        <Clock size={10} /> AWAITING PAYMENT
      </span>
    );
  }
  return (
    <span className={cn("text-muted-foreground font-bold flex items-center gap-1", className)}>
      <FileText size={10} /> PRESCRIBED
    </span>
  );
};

const RxOrdersTab: React.FC<Props> = ({ prescription, onChange, hospitalId, patientAllergies = [], encounterId, admissionId, patientId, userId }) => {
  const { toast } = useToast();
  const routeOptions     = useConfigValues("drug_routes");
  const frequencyOptions = useConfigValues("drug_frequencies");
  const [showAddDrug, setShowAddDrug] = useState(false);
  const [showRxManager, setShowRxManager] = useState(false);
  const [newTemplate, setNewTemplate] = useState<RxQuickPickTemplate>({ drug_name: "", dose: "", route: "Oral", frequency: "OD", duration_days: "", instructions: "", quantity: "" });
  const [addingTemplate, setAddingTemplate] = useState(false);
  const [showLabManager, setShowLabManager] = useState(false);
  const [showRadManager, setShowRadManager] = useState(false);
  const { items: rxTemplates, isLoading: rxLoading, save: saveRx, reset: resetRx } =
    useDoctorQuickPicks<RxQuickPickTemplate>("rx_templates");
  const { items: labTemplates, isLoading: labTplLoading, save: saveLabTpl, reset: resetLabTpl } =
    useDoctorQuickPicks<string>("lab_templates");
  const { items: radTemplates, isLoading: radTplLoading, save: saveRadTpl, reset: resetRadTpl } =
    useDoctorQuickPicks<string>("radiology_templates");
  const { items: testOrderPrefs, save: saveTestOrder } =
    useDoctorQuickPicks<TestGroupOrderEntry>("test_group_order");
  const [searchQuery, setSearchQuery] = useState("");
  const [newDrug, setNewDrug] = useState<DrugEntry>({ drug_name: "", dose: "", route: "Oral", frequency: "OD", duration_days: "", instructions: "", quantity: "", is_stat: false });
  const [labInput, setLabInput] = useState("");
  const [radInput, setRadInput] = useState("");
  const [labMaster, setLabMaster] = useState<{ name: string; category: string }[]>([]);
  const [radMaster, setRadMaster] = useState<{ name: string; modality: string }[]>([]);
  const [labGroups, setLabGroups] = useState<{ id: string; group_name: string; fee: number; testNames: string[] }[]>([]);
  const [labSuggestions, setLabSuggestions] = useState<string[]>([]);
  const [radSuggestions, setRadSuggestions] = useState<string[]>([]);
  const [orderedLabTests, setOrderedLabTests] = useState<OrderStateMap>(new Map());
  const [orderedRadStudies, setOrderedRadStudies] = useState<OrderStateMap>(new Map());
  const [openLabPicker, setOpenLabPicker] = useState<{ groupKey: string; title: string; feeLabel?: string; testNames: string[] } | null>(null);
  const [openRadPicker, setOpenRadPicker] = useState<{ groupKey: string; title: string; studyNames: string[] } | null>(null);
  /**
   * The matcher's view of this hospital's catalogue — tests, PANELS and studies together,
   * plus aliases. The chip lists above deliberately do not serve this purpose: `labMaster`
   * holds only lab_test_master, so a panel like Fever Panel was invisible to the "is this in
   * the catalogue?" check and every prescribed panel was reported as not offered.
   */
  const [catalogue, setCatalogue] = useState<OrderCatalogue | null>(null);
  const aiMatchEnabled = useAIFeature("order_catalogue_match");

  // Drug safety state
  const [checking, setChecking] = useState(false);
  const [safetyResult, setSafetyResult] = useState<DrugSafetyResult | null>(null);
  const [pendingDrug, setPendingDrug] = useState<DrugEntry | null>(null);
  const [showSafetyModal, setShowSafetyModal] = useState(false);
  const [safeFlash, setSafeFlash] = useState(false);
  const [drugSafetyMeta, setDrugSafetyMeta] = useState<Map<number, DrugSafetyMeta>>(new Map());
  const [showAntibioticModal, setShowAntibioticModal] = useState(false);
  const [antibioticJustified, setAntibioticJustified] = useState(false);

  // Fetch lab tests, groups, and radiology modalities from DB
  useEffect(() => {
    if (!hospitalId) return;
    supabase.from("lab_test_master").select("test_name, category").eq("hospital_id", hospitalId).eq("is_active", true).order("test_name")
      .then(({ data }) => setLabMaster((data || []).map((t: any) => ({ name: t.test_name, category: t.category || "other" }))));
    (supabase as any)
      .from("lab_test_groups")
      .select("id, group_name, fee, lab_test_group_items(test_id, lab_test_master:test_id(test_name))")
      .eq("hospital_id", hospitalId)
      .eq("is_active", true)
      .order("group_name")
      .then(({ data }: any) => setLabGroups((data || []).map((g: any) => ({
        id: g.id,
        group_name: g.group_name,
        fee: Number(g.fee) || 0,
        testNames: (g.lab_test_group_items || []).map((i: any) => i.lab_test_master?.test_name).filter(Boolean),
      }))));
    (supabase as any)
      .from("radiology_study_master")
      .select("study_name, modality_id, radiology_modalities:modality_id(name)")
      .eq("hospital_id", hospitalId)
      .eq("is_active", true)
      .order("sort_order")
      .then(({ data }: any) => setRadMaster((data || []).map((m: any) => ({
        name: m.study_name,
        modality: m.radiology_modalities?.name || "Other",
      }))));
    // Cached per hospital for 5 minutes and shared with ConsultationWorkspace, so this is
    // usually free.
    loadOrderCatalogue(hospitalId).then(setCatalogue).catch(() => setCatalogue(null));
  }, [hospitalId]);

  /**
   * Auto-select the catalogue row a prescribed name actually means.
   *
   * "Fever panel test" is Fever Panel; "usg abdomen and pelvis" is USG Abdomen + Pelvis; "KFT"
   * is the Kidney Function Test panel. Until this ran, each of those was carried to
   * `syncLabOrders` as free text, failed its exact-name match, and was dropped — never
   * ordered, never billed, with only an amber line on screen to show for it.
   *
   * Rewriting to the canonical name is what makes the order and the charge happen, so it is
   * done here rather than at commit time: the doctor sees the substitution while they can
   * still disagree with it. `keep_as_typed` is that disagreement, and is honoured forever.
   *
   * Runs on every change to the lists, not just on voice input, because a name arrives here
   * typed, from a template, from the AI Guidance chips and from a ward round too.
   */
  useEffect(() => {
    if (!catalogue?.all.length) return;

    const labs: LabOrder[] = [];
    const rads: RadiologyOrder[] = [];
    let changed = false;

    for (const l of prescription.lab_orders) {
      const hit = l.keep_as_typed ? null : matchOrderNameDetailed(l.test_name, catalogue);
      if (!hit) { labs.push(l); continue; }
      if (hit.entry.kind === "radiology") {
        // Catalogue membership is a better router than any keyword rule: an MRI typed into
        // the lab box is a radiology order, and leaving it in the lab list means no modality
        // ever sees it.
        changed = true;
        rads.push({
          study_name: hit.entry.name, urgency: l.urgency, clinical_indication: l.clinical_indication,
          availability: "in_stock", catalogue_id: hit.entry.id,
          matched_from: hit.entry.name === l.test_name ? undefined : l.test_name,
        });
        continue;
      }
      if (hit.entry.name === l.test_name && l.catalogue_id === hit.entry.id) { labs.push(l); continue; }
      changed = true;
      labs.push({
        ...l, test_name: hit.entry.name, catalogue_id: hit.entry.id, availability: "in_stock",
        matched_from: hit.entry.name === l.test_name ? l.matched_from : l.test_name,
      });
    }

    for (const r of prescription.radiology_orders) {
      const hit = r.keep_as_typed ? null : matchOrderNameDetailed(r.study_name, catalogue);
      if (!hit) { rads.push(r); continue; }
      if (hit.entry.kind !== "radiology") {
        changed = true;
        labs.push({
          test_name: hit.entry.name, urgency: r.urgency, clinical_indication: r.clinical_indication,
          availability: "in_stock", catalogue_id: hit.entry.id,
          matched_from: hit.entry.name === r.study_name ? undefined : r.study_name,
        });
        continue;
      }
      if (hit.entry.name === r.study_name && r.catalogue_id === hit.entry.id) { rads.push(r); continue; }
      changed = true;
      rads.push({
        ...r, study_name: hit.entry.name, catalogue_id: hit.entry.id, availability: "in_stock",
        matched_from: hit.entry.name === r.study_name ? r.matched_from : r.study_name,
      });
    }

    if (changed) onChange({ lab_orders: labs, radiology_orders: rads });
    // `onChange` is a fresh closure on every parent render; depending on it would re-run this
    // on every keystroke elsewhere in the consultation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogue, prescription.lab_orders, prescription.radiology_orders]);

  /** Names that resolve to nothing this hospital offers — the only ones that earn the badge. */
  const unresolvedLabNames = useMemo(() => {
    const s = new Set<string>();
    if (!catalogue?.all.length) return s;
    for (const l of prescription.lab_orders) {
      if (!matchOrderNameDetailed(l.test_name, catalogue)) s.add(l.test_name);
    }
    return s;
  }, [catalogue, prescription.lab_orders]);

  const unresolvedRadNames = useMemo(() => {
    const s = new Set<string>();
    if (!catalogue?.all.length) return s;
    for (const r of prescription.radiology_orders) {
      if (!matchOrderNameDetailed(r.study_name, catalogue)) s.add(r.study_name);
    }
    return s;
  }, [catalogue, prescription.radiology_orders]);

  /**
   * Tier four, for the names local matching genuinely cannot reach.
   *
   * Deliberately last and deliberately quiet: it runs after a short settle so a half-typed
   * name is not sent, it never blocks anything on screen, and a hospital with the feature off
   * simply keeps the local behaviour. Accepted answers are written to order_name_aliases and
   * the catalogue is reloaded, at which point the effect above resolves them like any other
   * alias — so the auto-select path is the same one whether the answer came from a table or a
   * model.
   */
  useEffect(() => {
    if (!aiMatchEnabled || !hospitalId || !catalogue?.all.length) return;
    const pending = [...unresolvedLabNames, ...unresolvedRadNames];
    if (!pending.length) return;

    const t = setTimeout(async () => {
      const hits = await resolveOrdersWithAI({
        hospitalId, names: pending, catalogue, patientId, encounterId,
      });
      if (hits.length) loadOrderCatalogue(hospitalId).then(setCatalogue).catch(() => {});
    }, 1200);
    return () => clearTimeout(t);
  }, [aiMatchEnabled, hospitalId, catalogue, unresolvedLabNames, unresolvedRadNames, patientId, encounterId]);

  /** Undo an auto-selection: restore the doctor's wording and stop re-matching it. */
  const revertLabMatch = useCallback((idx: number) => {
    const next = prescription.lab_orders.map((l, i) => (
      i !== idx || !l.matched_from ? l
        : { ...l, test_name: l.matched_from, matched_from: undefined, catalogue_id: undefined,
            availability: "unresolved" as const, keep_as_typed: true }
    ));
    onChange({ lab_orders: next });
  }, [prescription.lab_orders, onChange]);

  const revertRadMatch = useCallback((idx: number) => {
    const next = prescription.radiology_orders.map((r, i) => (
      i !== idx || !r.matched_from ? r
        : { ...r, study_name: r.matched_from, matched_from: undefined, catalogue_id: undefined,
            availability: "unresolved" as const, keep_as_typed: true }
    ));
    onChange({ radiology_orders: next });
  }, [prescription.radiology_orders, onChange]);

  // Group individual lab tests by category, and radiology studies by modality,
  // so they render as named category buttons instead of one flat chip wall.
  const labByCategory = useMemo(() => {
    const map = new Map<string, string[]>();
    labMaster.forEach((t) => {
      const label = t.category.charAt(0).toUpperCase() + t.category.slice(1);
      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push(t.name);
    });
    return Array.from(map.entries()).map(([label, testNames]) => ({ label, testNames }));
  }, [labMaster]);

  const radByModality = useMemo(() => {
    const map = new Map<string, string[]>();
    radMaster.forEach((s) => {
      if (!map.has(s.modality)) map.set(s.modality, []);
      map.get(s.modality)!.push(s.name);
    });
    return Array.from(map.entries()).map(([label, studyNames]) => ({ label, studyNames }));
  }, [radMaster]);

  // Doctor's personal drag-to-reorder priority per panel/category/modality (groupKey).
  const testOrderMap = useMemo(
    () => new Map(testOrderPrefs.map((e) => [e.groupKey, e.order])),
    [testOrderPrefs]
  );

  // Puts a group's names in the doctor's saved priority order; names with no
  // saved order (new tests, or a doctor who never customised this group) keep
  // their catalogue order at the end.
  const applyPriorityOrder = (groupKey: string, names: string[]) => {
    const saved = testOrderMap.get(groupKey);
    if (!saved || saved.length === 0) return names;
    const savedSet = new Set(saved);
    return [...saved.filter((n) => names.includes(n)), ...names.filter((n) => !savedSet.has(n))];
  };

  const saveGroupPriorityOrder = (groupKey: string, newOrder: string[]) => {
    saveTestOrder([...testOrderPrefs.filter((e) => e.groupKey !== groupKey), { groupKey, order: newOrder }]);
  };

  // Fetch already ordered investigations for this encounter (OPD) or admission (IPD) to show
  // status. IPD used to pass neither, so this returned early on every ward round: nothing was
  // ever BILLED & ORDERED, and TestGroupPickerModal's `disabled={alreadyOrdered}` never fired,
  // letting a ward doctor re-order a test that had already been done.
  const orderScope = useMemo(
    () => (encounterId ? { col: "encounter_id" as const, val: encounterId }
      : admissionId ? { col: "admission_id" as const, val: admissionId } : null),
    [encounterId, admissionId],
  );

  const fetchOrdered = useCallback(async () => {
    if (!orderScope) return;
    const [labRes, radRes] = await Promise.all([
      supabase.from("lab_orders")
        .select("payment_status, lab_order_items(lab_test_master(test_name))")
        .eq(orderScope.col, orderScope.val),
      supabase.from("radiology_orders").select("study_name, payment_status").eq(orderScope.col, orderScope.val),
    ]);

    // "paid" wins if the same test appears on two orders — the patient paid for it once and
    // showing AWAITING PAYMENT afterwards would send them back to the counter.
    const merge = (map: OrderStateMap, name: string, state: OrderState) => {
      const key = name.toLowerCase().trim();
      if (state === "paid" || !map.has(key)) map.set(key, state);
    };

    if (labRes.data) {
      const tests: OrderStateMap = new Map();
      labRes.data.forEach((o: any) => {
        const state: OrderState = o.payment_status === "paid" ? "paid" : "awaiting_payment";
        (o.lab_order_items || []).forEach((i: any) => {
          if (i.lab_test_master?.test_name) merge(tests, i.lab_test_master.test_name, state);
        });
      });
      setOrderedLabTests(tests);
    }
    if (radRes.data) {
      const studies: OrderStateMap = new Map();
      radRes.data.forEach((r: any) => {
        if (r.study_name) {
          merge(studies, r.study_name, r.payment_status === "paid" ? "paid" : "awaiting_payment");
        }
      });
      setOrderedRadStudies(studies);
    }
  }, [orderScope]);

  useEffect(() => { fetchOrdered(); }, [
    fetchOrdered, prescription.lab_orders.length, prescription.radiology_orders.length,
  ]);

  // Was a 5-second setInterval that polled two tables for the entire consultation. Realtime
  // gives the same freshness on an event instead of ~700 wasted round trips an hour, and the
  // hook's focus/reconnect fallback covers what realtime can miss.
  useRealtimeRefetch({
    tables: [
      { table: "lab_orders", filter: `${orderScope?.col}=eq.${orderScope?.val}` },
      { table: "radiology_orders", filter: `${orderScope?.col}=eq.${orderScope?.val}` },
    ],
    hospitalId,
    onChange: fetchOrdered,
    enabled: !!orderScope,
    channelName: "rx-orders-placed",
  });

  // Compute autocomplete suggestions — cross-filtered so radiology studies never appear in lab and vice versa
  useEffect(() => {
    if (!labInput.trim()) { setLabSuggestions([]); return; }
    const q = labInput.toLowerCase();
    const radSet = new Set(radMaster.map(m => m.name.toLowerCase()));
    setLabSuggestions(labMaster.map(m => m.name).filter(n => n.toLowerCase().includes(q) && !radSet.has(n.toLowerCase())).slice(0, 8));
  }, [labInput, labMaster, radMaster]);

  useEffect(() => {
    if (!radInput.trim()) { setRadSuggestions([]); return; }
    const q = radInput.toLowerCase();
    const labSet = new Set(labMaster.map(m => m.name.toLowerCase()));
    setRadSuggestions(radMaster.map(m => m.name).filter(n => n.toLowerCase().includes(q) && !labSet.has(n.toLowerCase())).slice(0, 8));
  }, [radInput, radMaster, labMaster]);

  // `justJustified` bypasses the state-based `antibioticJustified` check for exactly one call —
  // the one AntibioticJustificationModal's `onSaved` makes. Confirmed live: `onSaved` calls
  // `setAntibioticJustified(true)` and then `performSafetyCheck(pendingDrug)` synchronously, in
  // the same tick — React does not apply a setState call to the CURRENT closure, so this
  // function's own `antibioticJustified` (captured when THIS render's closure was created) was
  // still `false`, and `isAntibioticByName(...) && !antibioticJustified` re-opened the exact
  // same modal a second time, with no visible change (same component, same position, still
  // "open"). The net effect: no antibiotic could ever actually be prescribed through this
  // screen — every attempt looped back to a blank justification form. Not a hypothetical: this
  // was caught live while building Phase 7.5's Pharmacy spine E2E test, which needed to
  // prescribe Amoxicillin and never got past this modal.
  const performSafetyCheck = async (drug: DrugEntry, justJustified = false) => {
    if (isAntibioticByName(drug.drug_name) && !antibioticJustified && !justJustified) {
      setPendingDrug(drug);
      setShowAntibioticModal(true);
      return;
    }
    setChecking(true);
    setPendingDrug(drug);

    const currentDrugNames = prescription.drugs.map((d) => d.drug_name);

    try {
      const result = await checkDrugSafety(drug.drug_name, currentDrugNames, patientAllergies, hospitalId ?? "");

      if (result.hasIssues) {
        setSafetyResult(result);
        setShowSafetyModal(true);
      } else {
        // Safe — add directly with green flash
        addDrugDirect(drug);
        setSafeFlash(true);
        setTimeout(() => setSafeFlash(false), 1500);
      }
    } catch (e) {
      // KNOWN-BUG-108, caller facet. This used to add the drug silently on any throw — the
      // same fail-open shape as the lookup itself, one level up. checkDrugSafety now reports
      // a failed lookup as an incomplete result rather than throwing, so reaching here means
      // something unexpected broke; surface it instead of prescribing past it.
      setSafetyResult({
        hasIssues: true,
        interactions: [],
        allergyConflicts: [],
        duplicates: [],
        worstSeverity: "major",
        checkUnavailable: true,
        unavailableReasons: [
          `Drug safety check failed: ${e instanceof Error ? e.message : String(e)}`,
        ],
      });
      setShowSafetyModal(true);
    } finally {
      setChecking(false);
    }
  };

  const addDrugDirect = (drug: DrugEntry) => {
    onChange({ drugs: [...prescription.drugs, drug] });
    resetAddForm();
  };

  const resetAddForm = () => {
    setNewDrug({ drug_name: "", dose: "", route: "Oral", frequency: "OD", duration_days: "", instructions: "", quantity: "", is_stat: false });
    setSearchQuery("");
    setShowAddDrug(false);
    setPendingDrug(null);
  };

  // Save the drug currently in the Add Drug form as a reusable Quick Template
  // (doctor's rx_templates). Save-only: it does NOT add the drug to this
  // prescription — the doctor clicks the resulting chip to add it.
  const saveNewDrugAsTemplate = async () => {
    if (!newDrug.drug_name.trim()) return;
    const tpl: RxQuickPickTemplate = {
      drug_name: newDrug.drug_name,
      dose: newDrug.dose,
      route: newDrug.route,
      frequency: newDrug.frequency,
      duration_days: newDrug.duration_days,
      instructions: newDrug.instructions,
      quantity: newDrug.quantity,
    };
    const dupe = rxTemplates.some((t) =>
      t.drug_name.trim().toLowerCase() === tpl.drug_name.trim().toLowerCase() &&
      t.dose === tpl.dose && t.frequency === tpl.frequency);
    if (dupe) { toast({ title: "Template already exists" }); return; }
    try {
      await saveRx([...rxTemplates, tpl]);
      toast({ title: "✓ Saved to Quick templates" });
    } catch {
      toast({ title: "Couldn't save template", variant: "destructive" });
    }
  };

  const handleSafetyAddAnyway = () => {
    if (pendingDrug && safetyResult) {
      const newIndex = prescription.drugs.length;
      addDrugDirect(pendingDrug);
      // Mark with interaction badge
      setDrugSafetyMeta((prev) => {
        const next = new Map(prev);
        next.set(newIndex, {
          severity: "interaction",
          tooltip: safetyResult.interactions.map((i) => `${i.drug_a} + ${i.drug_b}: ${i.clinical_effect}`).join("; "),
        });
        return next;
      });
    }
    setShowSafetyModal(false);
    setSafetyResult(null);
  };

  const handleSafetyOverride = (reason: string) => {
    if (pendingDrug && safetyResult) {
      const newIndex = prescription.drugs.length;
      addDrugDirect(pendingDrug);
      // Log the override via clinical_alerts.
      //
      // BUG-P4-004: this insert previously carried only hospital_id, alert_type, severity and
      // alert_message. `patient_id` existed on the table and was left NULL, so the override the
      // modal promises will be "logged in the patient record" was attached to nobody and named
      // nobody — an anonymous note that no chart review would ever surface. patient_id and
      // created_by are both required for P4-S11 (reason AND prescriber identity).
      if (hospitalId) {
        const conflicts = safetyResult.allergyConflicts
          .map((c) => `${c.allergy} (${c.type})`)
          .join(", ");
        supabase
          .from("clinical_alerts")
          .insert({
            hospital_id: hospitalId,
            patient_id: patientId ?? null,
            created_by: userId ?? null,
            alert_type: "drug_override",
            severity: "critical",
            alert_message:
              `Drug safety override: ${pendingDrug.drug_name} added despite ${safetyResult.worstSeverity} alert` +
              `${conflicts ? ` (allergy conflict: ${conflicts})` : ""}. Reason: ${reason}`,
          } as never)
          .then(({ error }) => {
            if (error) {
              // A silent failure here recreates the exact gap this fix closes.
              toast({
                title: "Override not recorded",
                description: `${pendingDrug.drug_name} was added but the override could not be written to the patient record: ${error.message}`,
                variant: "destructive",
              });
            }
          });
      }
      setDrugSafetyMeta((prev) => {
        const next = new Map(prev);
        next.set(newIndex, {
          severity: "allergy_override",
          tooltip: `Override: ${reason}`,
        });
        return next;
      });
    }
    setShowSafetyModal(false);
    setSafetyResult(null);
  };

  const handleSafetyClose = () => {
    setShowSafetyModal(false);
    setSafetyResult(null);
    setPendingDrug(null);
  };

  const removeDrug = (i: number) => {
    onChange({ drugs: prescription.drugs.filter((_, idx) => idx !== i) });
    setDrugSafetyMeta((prev) => {
      const next = new Map<number, DrugSafetyMeta>();
      prev.forEach((v, k) => {
        if (k < i) next.set(k, v);
        else if (k > i) next.set(k - 1, v);
      });
      return next;
    });
  };

  const addLab = (name: string) => {
    if (!name.trim()) return;
    const radSet = new Set(radMaster.map(m => m.name.toLowerCase()));
    if (radSet.has(name.toLowerCase())) {
      toast({ title: "Radiology study — use Radiology Orders", description: `"${name}" is a radiology study, not a lab test.`, variant: "destructive" });
      setLabInput("");
      return;
    }
    const exists = prescription.lab_orders.find((l) => l.test_name === name);
    if (exists) return;
    onChange({ lab_orders: [...prescription.lab_orders, { test_name: name, urgency: "routine", clinical_indication: "" }] });
    setLabInput("");
  };

  const countSelectedInLabGroup = (names: string[]) =>
    names.filter((n) => prescription.lab_orders.some((l) => l.test_name === n)).length;

  const applyLabPickerSelection = (groupNames: string[], finalNames: string[]) => {
    const finalSet = new Set(finalNames);
    const kept = prescription.lab_orders.filter((l) => !groupNames.includes(l.test_name) || finalSet.has(l.test_name));
    const added = groupNames
      .filter((n) => finalSet.has(n) && !prescription.lab_orders.some((l) => l.test_name === n))
      .map((n) => ({ test_name: n, urgency: "routine", clinical_indication: "" }));
    onChange({ lab_orders: [...kept, ...added] });
    setOpenLabPicker(null);
  };

  const removeLab = (i: number) => {
    onChange({ lab_orders: prescription.lab_orders.filter((_, idx) => idx !== i) });
  };

  const addRad = (name: string) => {
    if (!name.trim()) return;
    const exists = prescription.radiology_orders.find((r) => r.study_name === name);
    if (exists) return;
    onChange({ radiology_orders: [...prescription.radiology_orders, { study_name: name, urgency: "routine", clinical_indication: "" }] });
    setRadInput("");
  };

  const removeRad = (i: number) => {
    onChange({ radiology_orders: prescription.radiology_orders.filter((_, idx) => idx !== i) });
  };

  const countSelectedInRadGroup = (names: string[]) =>
    names.filter((n) => prescription.radiology_orders.some((r) => r.study_name === n)).length;

  const applyRadPickerSelection = (groupNames: string[], finalNames: string[]) => {
    const finalSet = new Set(finalNames);
    const kept = prescription.radiology_orders.filter((r) => !groupNames.includes(r.study_name) || finalSet.has(r.study_name));
    const added = groupNames
      .filter((n) => finalSet.has(n) && !prescription.radiology_orders.some((r) => r.study_name === n))
      .map((n) => ({ study_name: n, urgency: "routine", clinical_indication: "" }));
    onChange({ radiology_orders: [...kept, ...added] });
    setOpenRadPicker(null);
  };

  const getSafetyBadge = (index: number) => {
    const meta = drugSafetyMeta.get(index);
    if (!meta) return null;
    if (meta.severity === "allergy_override") {
      return (
        <span title={meta.tooltip} className="inline-flex items-center gap-0.5 text-[9px] bg-red-100 text-destructive px-1.5 py-px rounded-full font-bold cursor-help">
          <ShieldX className="h-2.5 w-2.5" /> Override
        </span>
      );
    }
    return (
      <span title={meta.tooltip} className="inline-flex items-center gap-0.5 text-[9px] bg-amber-100 text-amber-700 px-1.5 py-px rounded-full font-bold cursor-help">
        <AlertTriangle className="h-2.5 w-2.5" /> Interaction
      </span>
    );
  };

  return (
    <div className="h-full flex overflow-hidden relative">
      {/* Main prescription area */}
      <div className="flex-1 overflow-y-auto flex flex-col">
        {/* Allergy Banner */}
        <AllergyBanner allergies={patientAllergies?.join(", ") || null} />

        {/* Safe flash */}
        {safeFlash && (
          <div className="flex-shrink-0 bg-emerald-50 border-b border-emerald-200 px-4 py-1.5 flex items-center gap-2 animate-in fade-in duration-300">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            <span className="text-xs text-emerald-700 font-medium">✓ No interactions found</span>
          </div>
        )}

        {/* Prescription */}
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[13px] font-bold text-foreground">Prescription</span>
            <button onClick={() => setShowAddDrug(true)} className="text-xs text-primary border border-primary px-2.5 py-1 rounded-md hover:bg-primary/5 flex items-center gap-1 transition-colors">
              <Plus className="h-3 w-3" /> Add Drug
            </button>
          </div>

          {prescription.drugs.map((drug, i) => (
            <div key={i} className="bg-muted/50 rounded-lg p-2.5 mb-1.5 relative group">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-foreground">{drug.drug_name}</span>
                {drug.is_ndps && <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-px rounded-full font-bold">NDPS</span>}
                <AvailabilityBadge availability={drug.availability} stockQty={drug.stock_qty} />
                {getSafetyBadge(i)}
              </div>
              <div className="flex gap-2 mt-1 flex-wrap">
                {[drug.dose, drug.route, drug.frequency, `${drug.duration_days}d`].filter(Boolean).map((v, j) => (
                  <span key={j} className="text-[11px] bg-muted text-muted-foreground px-2 py-px rounded">{v}</span>
                ))}
                {drug.quantity && (
                  <span className="text-[11px] bg-amber-100 text-amber-700 px-2 py-px rounded font-medium">Qty: {drug.quantity}</span>
                )}
              </div>
              {drug.instructions && <p className="text-xs text-muted-foreground italic mt-1">{drug.instructions}</p>}
              <button onClick={() => removeDrug(i)} className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <X className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
              </button>
            </div>
          ))}

          {showAddDrug && (
            <div className="border border-border rounded-lg p-3 mt-2 bg-background">
              <DrugMasterSearchInput
                value={searchQuery}
                hospitalId={hospitalId}
                onChange={(text) => { setSearchQuery(text); setNewDrug((d) => ({ ...d, drug_name: text })); }}
                onSelect={(r) => { setNewDrug((d) => ({ ...d, drug_name: r.drug_name, is_ndps: r.is_ndps })); setSearchQuery(r.drug_name); }}
                placeholder="Search drug name..."
                inputClassName="w-full h-9 px-3 border border-border rounded-lg text-sm outline-none focus:border-primary bg-background text-foreground"
              />
              <div className="grid grid-cols-4 gap-2 mt-2">
                <input
                  value={newDrug.dose}
                  onChange={(e) => setNewDrug((d) => {
                    const updated = { ...d, dose: e.target.value };
                    const q = calcQty(updated.dose, updated.frequency, updated.duration_days);
                    return { ...updated, quantity: q > 0 ? String(q) : updated.quantity };
                  })}
                  placeholder="Dose"
                  className="h-8 px-2 border border-border rounded text-xs outline-none bg-background text-foreground"
                />
                <select value={newDrug.route} onChange={(e) => setNewDrug((d) => ({ ...d, route: e.target.value }))} className="h-8 px-1 border border-border rounded text-xs outline-none bg-background text-foreground">
                  {routeOptions.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                <select
                  value={newDrug.frequency}
                  onChange={(e) => setNewDrug((d) => {
                    const updated = { ...d, frequency: e.target.value };
                    const q = calcQty(updated.dose, updated.frequency, updated.duration_days);
                    return { ...updated, quantity: q > 0 ? String(q) : updated.quantity };
                  })}
                  className="h-8 px-1 border border-border rounded text-xs outline-none bg-background text-foreground"
                >
                  {frequencyOptions.map((f) => <option key={f.value} value={f.value}>{f.value}</option>)}
                </select>
                <input
                  value={newDrug.duration_days}
                  onChange={(e) => setNewDrug((d) => {
                    const updated = { ...d, duration_days: e.target.value };
                    const q = calcQty(updated.dose, updated.frequency, updated.duration_days);
                    return { ...updated, quantity: q > 0 ? String(q) : updated.quantity };
                  })}
                  placeholder="Days"
                  className="h-8 px-2 border border-border rounded text-xs outline-none bg-background text-foreground"
                />
              </div>
              {/* Quantity row — auto-calculated, editable */}
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-muted-foreground font-medium w-16 flex-shrink-0">Quantity</span>
                <input
                  type="number"
                  min="1"
                  value={newDrug.quantity}
                  onChange={(e) => setNewDrug((d) => ({ ...d, quantity: e.target.value }))}
                  placeholder="Auto"
                  className="w-24 h-8 px-2 border border-amber-300 bg-amber-50 rounded text-xs outline-none focus:border-amber-500 text-foreground font-semibold"
                />
                {newDrug.quantity && (
                  <span className="text-[11px] text-amber-700">
                    = {newDrug.dose || "?"} × {FREQ_PER_DAY[newDrug.frequency?.toUpperCase()] ?? 1}×/day × {newDrug.duration_days || "?"} days
                  </span>
                )}
              </div>
              <input value={newDrug.instructions} onChange={(e) => setNewDrug((d) => ({ ...d, instructions: e.target.value }))} placeholder="Instructions (e.g., Take after food)" className="w-full h-8 px-2 mt-2 border border-border rounded text-xs outline-none bg-background text-foreground" />
              {newDrug.is_ndps && (
                <div className="mt-2 bg-amber-50 border border-amber-200 rounded p-2 text-[11px] text-amber-700">⚠️ NDPS Drug — Dual verification required before dispensing</div>
              )}
              <div className="flex gap-2 mt-2">
                <button
                  disabled={checking || !newDrug.drug_name}
                  onClick={() => { if (newDrug.drug_name) performSafetyCheck(newDrug); }}
                  className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5"
                >
                  {checking ? (
                    <>
                      <span className="h-3 w-3 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                      Checking safety...
                    </>
                  ) : (
                    "Add to Prescription"
                  )}
                </button>
                <button
                  onClick={saveNewDrugAsTemplate}
                  disabled={!newDrug.drug_name}
                  className="text-xs text-primary px-3 py-1.5 hover:underline disabled:opacity-50 disabled:no-underline flex items-center gap-1"
                  title="Save this drug as a reusable Quick Template"
                >
                  <Plus className="h-3 w-3" /> Save as template
                </button>
                <button onClick={() => { setShowAddDrug(false); setSearchQuery(""); }} className="text-xs text-muted-foreground px-3 py-1.5">Cancel</button>
              </div>
            </div>
          )}

          {/* Rx quick-pick templates */}
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] text-muted-foreground">Quick templates</span>
              <button
                onClick={() => setShowRxManager(v => !v)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
              >
                <Pencil className="h-3 w-3" />
                {showRxManager ? "Done" : "Manage"}
              </button>
            </div>

            {rxLoading ? (
              <div className="flex flex-wrap gap-1.5">
                {Array.from({ length: 3 }).map((_, i) => (
                  <span key={i} className="h-7 w-28 rounded-full bg-muted animate-pulse inline-block" />
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {rxTemplates.map((t, idx) => (
                  <button
                    key={idx}
                    onClick={() => performSafetyCheck(templateToDrugEntry(t))}
                    className="text-[11px] px-2.5 py-1 rounded-full bg-muted/50 border border-border text-muted-foreground hover:bg-muted transition-colors"
                  >
                    {t.drug_name} {t.frequency} × {t.duration_days}d
                  </button>
                ))}
              </div>
            )}

            {showRxManager && !rxLoading && (
              <div className="mt-2 border border-border rounded-lg bg-muted/30 p-3 space-y-2">
                <p className="text-xs font-semibold text-foreground/70">Manage Rx templates</p>

                {rxTemplates.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {rxTemplates.map((t, i) => (
                      <span key={i} className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full bg-background border border-border text-foreground/70">
                        {t.drug_name} {t.frequency}×{t.duration_days}d
                        <button
                          onClick={async () => {
                            const next = rxTemplates.filter((_, idx) => idx !== i);
                            await saveRx(next);
                          }}
                          className="text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {addingTemplate ? (
                  <div className="border border-border rounded-lg p-2.5 bg-background space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <DrugMasterSearchInput
                        value={newTemplate.drug_name}
                        hospitalId={hospitalId}
                        onChange={text => setNewTemplate(d => ({ ...d, drug_name: text }))}
                        onSelect={r => setNewTemplate(d => ({ ...d, drug_name: r.drug_name }))}
                        placeholder="Drug name"
                        className="col-span-2"
                        inputClassName="w-full h-8 px-2 border border-border rounded text-xs outline-none bg-background text-foreground"
                      />
                      <input
                        value={newTemplate.dose}
                        onChange={e => setNewTemplate(d => ({ ...d, dose: e.target.value }))}
                        placeholder="Dose"
                        className="h-8 px-2 border border-border rounded text-xs outline-none bg-background text-foreground"
                      />
                      <select
                        value={newTemplate.frequency}
                        onChange={e => setNewTemplate(d => ({ ...d, frequency: e.target.value }))}
                        className="h-8 px-1 border border-border rounded text-xs outline-none bg-background text-foreground"
                      >
                        {frequencyOptions.map(f => <option key={f.value} value={f.value}>{f.value}</option>)}
                      </select>
                      <input
                        value={newTemplate.duration_days}
                        onChange={e => setNewTemplate(d => ({ ...d, duration_days: e.target.value }))}
                        placeholder="Days"
                        className="h-8 px-2 border border-border rounded text-xs outline-none bg-background text-foreground"
                      />
                      <input
                        value={newTemplate.quantity}
                        onChange={e => setNewTemplate(d => ({ ...d, quantity: e.target.value }))}
                        placeholder="Qty"
                        className="h-8 px-2 border border-border rounded text-xs outline-none bg-background text-foreground"
                      />
                    </div>
                    <input
                      value={newTemplate.instructions}
                      onChange={e => setNewTemplate(d => ({ ...d, instructions: e.target.value }))}
                      placeholder="Instructions (e.g., Take after food)"
                      className="w-full h-8 px-2 border border-border rounded text-xs outline-none bg-background text-foreground"
                    />
                    <div className="flex gap-2">
                      <button
                        disabled={!newTemplate.drug_name}
                        onClick={async () => {
                          if (!newTemplate.drug_name) return;
                          await saveRx([...rxTemplates, newTemplate]);
                          setNewTemplate({ drug_name: "", dose: "", route: "Oral", frequency: "OD", duration_days: "", instructions: "", quantity: "" });
                          setAddingTemplate(false);
                        }}
                        className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded font-medium hover:bg-primary/90 disabled:opacity-50"
                      >
                        Save template
                      </button>
                      <button
                        onClick={() => setAddingTemplate(false)}
                        className="text-xs text-muted-foreground px-3 py-1.5"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setAddingTemplate(true)}
                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <Plus className="h-3 w-3" /> Add template
                  </button>
                )}

                <button
                  onClick={resetRx}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
                >
                  <RotateCcw className="h-3 w-3" />
                  Reset to defaults
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Lab & Radiology */}
        <div className="p-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-foreground/70">Lab Orders</span>
                <button
                  onClick={() => setShowLabManager(v => !v)}
                  className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors"
                >
                  <Pencil className="h-2.5 w-2.5" />
                  {showLabManager ? "Done" : "My Tests"}
                </button>
              </div>

              {/* Doctor's quick lab templates */}
              {labTplLoading ? (
                <div className="flex flex-wrap gap-1 mb-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <span key={i} className="h-5 w-16 rounded-full bg-muted animate-pulse inline-block" />
                  ))}
                </div>
              ) : labTemplates.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {labTemplates.map(name => (
                    <button
                      key={name}
                      onClick={() => addLab(name)}
                      className={cn(
                        "text-[10px] px-2 py-0.5 rounded-full border transition-colors whitespace-nowrap",
                        prescription.lab_orders.some(l => l.test_name === name)
                          ? "bg-primary/10 border-primary/30 text-primary"
                          : "bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
                      )}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}

              {showLabManager && !labTplLoading && (
                <QuickPickManagerPanel
                  items={labTemplates}
                  onSave={saveLabTpl}
                  onReset={resetLabTpl}
                  label="quick lab tests"
                  suggestions={labMaster.map(m => m.name)}
                  suggestionLabel="Lab Test Master"
                />
              )}

              {/* Search input with autocomplete */}
              <div className="relative flex gap-1 mb-2">
                <div className="relative flex-1">
                  <input
                    value={labInput}
                    onChange={(e) => setLabInput(e.target.value)}
                    placeholder="Search test name..."
                    className="w-full h-7 px-2 border border-border rounded text-xs outline-none bg-background text-foreground"
                    onKeyDown={(e) => { if (e.key === "Enter") { addLab(labSuggestions[0] || labInput); setLabSuggestions([]); } if (e.key === "Escape") setLabSuggestions([]); }}
                  />
                  {labSuggestions.length > 0 && (
                    <div className="absolute z-20 left-0 right-0 top-7 bg-card border border-border rounded-lg shadow-lg max-h-36 overflow-y-auto">
                      {labSuggestions.map(name => (
                        <button key={name} onMouseDown={(e) => { e.preventDefault(); addLab(name); setLabInput(""); setLabSuggestions([]); }}
                          className="w-full text-left px-2 py-1 text-xs hover:bg-muted border-b border-border/40 last:border-b-0">
                          {name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button onClick={() => { addLab(labSuggestions[0] || labInput); setLabSuggestions([]); }} className="text-xs bg-muted px-2 rounded hover:bg-muted/80">+</button>
              </div>
              {/* Panels — click to pick tests via checkbox popup */}
              {labGroups.length > 0 && (
                <div className="mb-2">
                  <p className="text-[9px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Panels</p>
                  <div className="flex flex-wrap gap-1">
                    {labGroups.map((g) => {
                      const selectedCount = countSelectedInLabGroup(g.testNames);
                      const done = selectedCount > 0 && selectedCount === g.testNames.length;
                      return (
                        <button key={g.id}
                          onClick={() => setOpenLabPicker({ groupKey: `panel:${g.group_name}`, title: g.group_name, feeLabel: g.fee > 0 ? `₹${g.fee}` : undefined, testNames: applyPriorityOrder(`panel:${g.group_name}`, g.testNames) })}
                          className={cn("text-[10px] px-2 py-0.5 rounded-full border transition-colors whitespace-nowrap",
                            done
                              ? "bg-primary/10 border-primary/30 text-primary"
                              : selectedCount > 0
                              ? "bg-amber-50 border-amber-300 text-amber-700"
                              : "bg-muted/50 border-border text-muted-foreground hover:bg-muted"
                          )}>
                          {g.group_name}{g.fee > 0 && <span className="ml-1 opacity-60">₹{g.fee}</span>}
                          {selectedCount > 0 && <span className="ml-1 opacity-70">{selectedCount}/{g.testNames.length}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {/* Test categories — click to pick individual tests via checkbox popup */}
              {labByCategory.length > 0 && (
                <div className="mb-2">
                  <p className="text-[9px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Test Categories</p>
                  <div className="flex flex-wrap gap-1">
                    {(() => {
                      const allNames = labMaster.map((m) => m.name);
                      const selectedCount = countSelectedInLabGroup(allNames);
                      const done = selectedCount > 0 && selectedCount === allNames.length;
                      return (
                        <button
                          onClick={() => setOpenLabPicker({ groupKey: "labcat:__all__", title: "All Tests", testNames: applyPriorityOrder("labcat:__all__", allNames) })}
                          className={cn("text-[10px] px-2 py-0.5 rounded-full border font-semibold transition-colors whitespace-nowrap",
                            done
                              ? "bg-primary/10 border-primary/30 text-primary"
                              : selectedCount > 0
                              ? "bg-amber-50 border-amber-300 text-amber-700"
                              : "bg-primary/5 border-primary/40 text-primary hover:bg-primary/10"
                          )}>
                          All Tests <span className="ml-1 opacity-60">({allNames.length})</span>
                          {selectedCount > 0 && <span className="ml-1 opacity-70">{selectedCount}/{allNames.length}</span>}
                        </button>
                      );
                    })()}
                    {labByCategory.map((cat) => {
                      const selectedCount = countSelectedInLabGroup(cat.testNames);
                      const done = selectedCount > 0 && selectedCount === cat.testNames.length;
                      return (
                        <button key={cat.label}
                          onClick={() => setOpenLabPicker({ groupKey: `labcat:${cat.label}`, title: cat.label, testNames: applyPriorityOrder(`labcat:${cat.label}`, cat.testNames) })}
                          className={cn("text-[10px] px-2 py-0.5 rounded-full border transition-colors whitespace-nowrap",
                            done
                              ? "bg-primary/10 border-primary/30 text-primary"
                              : selectedCount > 0
                              ? "bg-amber-50 border-amber-300 text-amber-700"
                              : "bg-muted/50 border-border text-muted-foreground hover:bg-muted"
                          )}>
                          {cat.label} <span className="ml-1 opacity-60">({cat.testNames.length})</span>
                          {selectedCount > 0 && <span className="ml-1 opacity-70">{selectedCount}/{cat.testNames.length}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {prescription.lab_orders.length > 0 && (
                <div className="mt-2">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[10px] font-bold text-blue-700 uppercase tracking-wide">Selected ({prescription.lab_orders.length})</span>
                    <div className="flex-1 border-t border-blue-200" />
                  </div>
                  <div className="space-y-1">
                    {prescription.lab_orders.map((l, i) => {
                      const orderState = orderStateOf(orderedLabTests, l.test_name);
                      // Resolved through the same matcher syncLabOrders uses, over tests AND
                      // panels AND aliases. The old check compared raw lowercase strings
                      // against labMaster alone, so every panel — Fever Panel included — was
                      // reported as missing from a catalogue it was sitting in.
                      const notInCatalogue = unresolvedLabNames.has(l.test_name);
                      return (
                        <div key={i} className="flex items-center justify-between bg-blue-50 border border-blue-100 rounded px-2 py-1.5">
                          <div className="flex flex-col">
                            <span className="text-xs font-medium text-foreground/80 flex items-center gap-1.5">
                              {l.test_name}
                              <AvailabilityBadge availability={l.availability} kind="test" />
                            </span>
                            {/* The catalogue warning replaces the state chip rather than joining it:
                                a test that cannot be matched will never become an order, so showing
                                PRESCRIBED next to it implies a queue it is not in. */}
                            {notInCatalogue && !orderState ? (
                              <span className="text-[9px] text-amber-700 font-bold flex items-center gap-1">
                                Prescribed test not found in the lab catalogue — not ordered or billed
                              </span>
                            ) : (
                              <OrderStateChip state={orderState} className="text-[9px]" />
                            )}
                            <MatchTrace matchedFrom={l.matched_from} onRevert={() => revertLabMatch(i)} />
                          </div>
                          <button onClick={() => removeLab(i)}><X className="h-3 w-3 text-muted-foreground hover:text-destructive" /></button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-foreground/70">Radiology Orders</span>
                <button
                  onClick={() => setShowRadManager(v => !v)}
                  className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors"
                >
                  <Pencil className="h-2.5 w-2.5" />
                  {showRadManager ? "Done" : "My Studies"}
                </button>
              </div>

              {/* Doctor's quick radiology templates */}
              {radTplLoading ? (
                <div className="flex flex-wrap gap-1 mb-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <span key={i} className="h-5 w-20 rounded-full bg-muted animate-pulse inline-block" />
                  ))}
                </div>
              ) : radTemplates.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {radTemplates.map(name => (
                    <button
                      key={name}
                      onClick={() => addRad(name)}
                      className={cn(
                        "text-[10px] px-2 py-0.5 rounded-full border transition-colors whitespace-nowrap",
                        prescription.radiology_orders.some(r => r.study_name === name)
                          ? "bg-primary/10 border-primary/30 text-primary"
                          : "bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100"
                      )}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}

              {showRadManager && !radTplLoading && (
                <QuickPickManagerPanel
                  items={radTemplates}
                  onSave={saveRadTpl}
                  onReset={resetRadTpl}
                  label="quick radiology studies"
                  suggestions={radMaster.map(m => m.name)}
                  suggestionLabel="Radiology Study Master"
                />
              )}

              {/* Search input with autocomplete */}
              <div className="relative flex gap-1 mb-2">
                <div className="relative flex-1">
                  <input
                    value={radInput}
                    onChange={(e) => setRadInput(e.target.value)}
                    placeholder="Search study name..."
                    className="w-full h-7 px-2 border border-border rounded text-xs outline-none bg-background text-foreground"
                    onKeyDown={(e) => { if (e.key === "Enter") { addRad(radSuggestions[0] || radInput); setRadSuggestions([]); } if (e.key === "Escape") setRadSuggestions([]); }}
                  />
                  {radSuggestions.length > 0 && (
                    <div className="absolute z-20 left-0 right-0 top-7 bg-card border border-border rounded-lg shadow-lg max-h-36 overflow-y-auto">
                      {radSuggestions.map(name => (
                        <button key={name} onMouseDown={(e) => { e.preventDefault(); addRad(name); setRadInput(""); setRadSuggestions([]); }}
                          className="w-full text-left px-2 py-1 text-xs hover:bg-muted border-b border-border/40 last:border-b-0">
                          {name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button onClick={() => { addRad(radSuggestions[0] || radInput); setRadSuggestions([]); }} className="text-xs bg-muted px-2 rounded hover:bg-muted/80">+</button>
              </div>
              {/* Modalities — click to pick studies via checkbox popup */}
              {radByModality.length > 0 && (
                <div className="mb-2">
                  <p className="text-[9px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Modalities</p>
                  <div className="flex flex-wrap gap-1">
                    {(() => {
                      const allNames = radMaster.map((m) => m.name);
                      const selectedCount = countSelectedInRadGroup(allNames);
                      const done = selectedCount > 0 && selectedCount === allNames.length;
                      return (
                        <button
                          onClick={() => setOpenRadPicker({ groupKey: "radmod:__all__", title: "All Studies", studyNames: applyPriorityOrder("radmod:__all__", allNames) })}
                          className={cn("text-[10px] px-2 py-0.5 rounded-full border font-semibold transition-colors whitespace-nowrap",
                            done
                              ? "bg-primary/10 border-primary/30 text-primary"
                              : selectedCount > 0
                              ? "bg-amber-50 border-amber-300 text-amber-700"
                              : "bg-primary/5 border-primary/40 text-primary hover:bg-primary/10"
                          )}>
                          All Studies <span className="ml-1 opacity-60">({allNames.length})</span>
                          {selectedCount > 0 && <span className="ml-1 opacity-70">{selectedCount}/{allNames.length}</span>}
                        </button>
                      );
                    })()}
                    {radByModality.map((mod) => {
                      const selectedCount = countSelectedInRadGroup(mod.studyNames);
                      const done = selectedCount > 0 && selectedCount === mod.studyNames.length;
                      return (
                        <button key={mod.label}
                          onClick={() => setOpenRadPicker({ groupKey: `radmod:${mod.label}`, title: mod.label, studyNames: applyPriorityOrder(`radmod:${mod.label}`, mod.studyNames) })}
                          className={cn("text-[10px] px-2 py-0.5 rounded-full border transition-colors whitespace-nowrap",
                            done
                              ? "bg-primary/10 border-primary/30 text-primary"
                              : selectedCount > 0
                              ? "bg-amber-50 border-amber-300 text-amber-700"
                              : "bg-muted/50 border-border text-muted-foreground hover:bg-muted"
                          )}>
                          {mod.label} <span className="ml-1 opacity-60">({mod.studyNames.length})</span>
                          {selectedCount > 0 && <span className="ml-1 opacity-70">{selectedCount}/{mod.studyNames.length}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {prescription.radiology_orders.length > 0 && (
                <div className="mt-2">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[10px] font-bold text-purple-700 uppercase tracking-wide">Selected ({prescription.radiology_orders.length})</span>
                    <div className="flex-1 border-t border-purple-200" />
                  </div>
                  <div className="space-y-1">
                    {prescription.radiology_orders.map((r, i) => {
                      const orderState = orderStateOf(orderedRadStudies, r.study_name);
                      // Radiology had no equivalent of the lab warning at all. An unmatched
                      // study is still ordered — the master is more often incomplete than the
                      // hospital unable to do the scan — but it bills at the default rate
                      // rather than the study's own, so it has to be visible.
                      const notInCatalogue = unresolvedRadNames.has(r.study_name);
                      return (
                        <div key={i} className="flex items-center justify-between bg-purple-50 border border-purple-100 rounded px-2 py-1.5">
                          <div className="flex flex-col">
                            <span className="text-xs font-medium text-foreground/80 flex items-center gap-1.5">
                              {r.study_name}
                              <AvailabilityBadge availability={r.availability} kind="study" />
                            </span>
                            {notInCatalogue && !orderState ? (
                              <span className="text-[9px] text-amber-700 font-bold flex items-center gap-1">
                                Study not in the radiology catalogue — ordered, but billed at the default rate
                              </span>
                            ) : (
                              <OrderStateChip state={orderState} className="text-[9px]" />
                            )}
                            <MatchTrace matchedFrom={r.matched_from} onRevert={() => revertRadMatch(i)} />
                          </div>
                          <button onClick={() => removeRad(i)}><X className="h-3 w-3 text-muted-foreground hover:text-destructive" /></button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

      </div>

      {/* The IPD "Commit to IPD Record" button used to float here, absolutely
          positioned over the test-chip list. It now lives in the IPD workspace's
          bottom action bar (IPDWorkspace.tsx), which is where the other
          admission-level actions already sit and where it covers nothing. */}

      {/* Lab panel / test-category checkbox picker */}
      {openLabPicker && (
        <TestGroupPickerModal
          open={true}
          title={openLabPicker.title}
          feeLabel={openLabPicker.feeLabel}
          items={openLabPicker.testNames}
          selectedNames={new Set(prescription.lab_orders.map(l => l.test_name))}
          orderedNames={orderedLabTests}
          onClose={() => setOpenLabPicker(null)}
          onConfirm={(finalNames) => applyLabPickerSelection(openLabPicker.testNames, finalNames)}
          onReorder={(newOrder) => saveGroupPriorityOrder(openLabPicker.groupKey, newOrder)}
        />
      )}

      {/* Radiology modality checkbox picker */}
      {openRadPicker && (
        <TestGroupPickerModal
          open={true}
          title={openRadPicker.title}
          items={openRadPicker.studyNames}
          selectedNames={new Set(prescription.radiology_orders.map(r => r.study_name))}
          orderedNames={orderedRadStudies}
          onClose={() => setOpenRadPicker(null)}
          onConfirm={(finalNames) => applyRadPickerSelection(openRadPicker.studyNames, finalNames)}
          onReorder={(newOrder) => saveGroupPriorityOrder(openRadPicker.groupKey, newOrder)}
        />
      )}

      {/* Safety alert modal */}
      {showSafetyModal && safetyResult && pendingDrug && (
        <DrugSafetyAlertModal
          open={showSafetyModal}
          drugName={pendingDrug.drug_name}
          result={safetyResult}
          hospitalId={hospitalId ?? undefined}
          onClose={handleSafetyClose}
          onAddAnyway={handleSafetyAddAnyway}
          onOverride={handleSafetyOverride}
        />
      )}

      {pendingDrug && (
        <AntibioticJustificationModal
          open={showAntibioticModal}
          drugName={pendingDrug.drug_name}
          hospitalId={hospitalId ?? ""}
          onSaved={() => {
            setShowAntibioticModal(false);
            setAntibioticJustified(true);
            // `true` — see performSafetyCheck's own comment: setAntibioticJustified(true)
            // above has not been applied to this closure yet, so the state-based check alone
            // would re-open this same modal instead of proceeding.
            if (pendingDrug) performSafetyCheck(pendingDrug, true);
          }}
          onCancel={() => { setShowAntibioticModal(false); setPendingDrug(null); }}
        />
      )}
    </div>
  );
};

/**
 * "matched from <what the doctor wrote>", with a way to take it back.
 *
 * Auto-selecting a catalogue row creates a clinical order and a charge on the doctor's behalf.
 * That is only acceptable if the substitution is visible and one click from being undone —
 * silently swapping "Fever panel test" for a ₹1100 panel would be worse than the bug it fixes.
 *
 * Renders nothing when the name matched verbatim, which is the overwhelmingly common case.
 */
const MatchTrace: React.FC<{ matchedFrom?: string; onRevert: () => void }> = ({ matchedFrom, onRevert }) => {
  if (!matchedFrom) return null;
  return (
    <span className="text-[9px] text-muted-foreground flex items-center gap-1">
      matched from “{matchedFrom}”
      <button
        type="button"
        onClick={onRevert}
        title={`Keep "${matchedFrom}" exactly as written. It will not be auto-ordered or billed.`}
        className="underline hover:text-destructive"
      >
        undo
      </button>
    </span>
  );
};

/**
 * Whether the hospital can actually supply a dictated item.
 *
 * The doctor's requirement: never drop something we don't stock — the patient still needs
 * it, they just have to buy it outside. So an unstocked item stays on the prescription and
 * prints normally; this badge is what tells the doctor, the pharmacy and reception that it
 * won't be dispensed or billed here.
 *
 * `in_stock` renders NOTHING: the common case should be quiet, and a badge on every line
 * would train people to ignore all of them.
 */
const AvailabilityBadge: React.FC<{
  availability?: OrderAvailability;
  stockQty?: number;
  kind?: "drug" | "test" | "study";
}> = ({ availability, stockQty, kind = "drug" }) => {
  if (!availability || availability === "in_stock") return null;

  const notOffered = kind === "drug" ? "Not stocked" : "Not offered here";
  const label = availability === "not_stocked" ? notOffered : "Unmatched";
  const title = availability === "not_stocked"
    ? kind === "drug"
      ? `This hospital has no stock${typeof stockQty === "number" ? ` (${stockQty} units)` : ""}. It stays on the prescription for the patient to buy outside, and is not billed here.`
      : "This hospital does not offer this — the patient will need it done elsewhere. It is not billed here."
    : "Could not be matched to the catalogue, so it is not auto-billed. Check the spelling or pick it manually.";

  return (
    <span
      title={title}
      className={cn(
        "text-[9px] px-1.5 py-px rounded-full font-bold whitespace-nowrap",
        availability === "not_stocked"
          ? "bg-orange-100 text-orange-700"
          : "bg-slate-200 text-slate-600",
      )}
    >
      {label}
    </span>
  );
};

export default RxOrdersTab;
