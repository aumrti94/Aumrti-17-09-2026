import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useHospitalContext } from "@/hooks/useHospitalContext";
import { hasTabAccess, hasActionAccess } from "@/lib/tabPermissions";
import { Stethoscope, Mic, Save, CheckCircle, FlaskConical, Building2, Smartphone, ArrowUpRight, User, X, ScanLine, SendHorizonal, Printer } from "lucide-react";
import AdmitPatientModal from "@/components/ipd/AdmitPatientModal";
import OnboardingTour from "@/components/onboarding/OnboardingTour";
import type { OpdToken } from "@/pages/opd/OPDPage";
import VoiceDictationButton from "@/components/voice/VoiceDictationButton";
import ClinicalCalculatorPanel from "@/components/clinical/ClinicalCalculatorPanel";
import InvestigationResultsPanel from "@/components/clinical/InvestigationResultsPanel";
import { useUnreviewedResultCount } from "@/hooks/useUnreviewedResultCount";
import { useVoiceScribe } from "@/hooks/useVoiceScribe";
import ComplaintTab from "./tabs/ComplaintTab";
import VitalsTab from "./tabs/VitalsTab";
import ExaminationTab from "./tabs/ExaminationTab";
import RxOrdersTab from "./tabs/RxOrdersTab";
import PlanAdviceTab from "./tabs/PlanAdviceTab";
import HistoryTab from "./tabs/HistoryTab";
import OverdueFollowupBanner from "@/components/clinical/OverdueFollowupBanner";
import { getSpecialtySheet, specialtyTabMeta } from "@/lib/specialtyDetection";
import ObstetricSheet from "@/components/specialty/ObstetricSheet";
import ReferralLetterModal from "@/components/opd/ReferralLetterModal";
import DifferentialDiagnosisPanel from "@/components/opd/DifferentialDiagnosisPanel";
import ClinicalDecisionSupport from "@/components/opd/ClinicalDecisionSupport";
import ClarifyingQuestionsPanel from "@/components/opd/ClarifyingQuestionsPanel";
import type { ClarifyingQuestionsState } from "@/components/opd/ClarifyingQuestionsPanel";
import NeonatalSheet from "@/components/specialty/NeonatalSheet";
import AnaesthesiaSheet from "@/components/specialty/AnaesthesiaSheet";
import OphthalmologySheet from "@/components/specialty/OphthalmologySheet";
import { sendWhatsApp } from "@/lib/whatsapp-send";
import { isRadiologyKeyword } from "@/lib/investigationSync";
import { resolveDrugStock, calcDrugQuantity } from "@/lib/drugStock";
import { loadOrderCatalogue, resolveOrders } from "@/lib/orderCatalogue";
import { printDocument, printHeader } from "@/lib/printUtils";
import { buildInvestigationResultsHtml } from "@/lib/investigationPrint";
import { logRecordAccess } from "@/lib/ims";
import { translateText, getHospitalLanguages, ALL_PATIENT_LANGUAGES, buildBilingualHtml } from "@/lib/translateUtils";
import { useCurrentHistoryDigest, formatDigestForPrompt, digestComorbidities } from "@/lib/historyDigest";

interface Props {
  token: OpdToken | null;
  hospitalId: string | null;
  userId: string | null;
  onTokenUpdate: () => void;
  /** Optimistic in-place token update — avoids a full queue refetch for simple status changes. */
  onTokenPatch?: (tokenId: string, patch: Partial<OpdToken>) => void;
  showPatientDetails?: boolean;
  onTogglePatientDetails?: () => void;
}

export interface EncounterData {
  id?: string;
  chief_complaint: string;
  history_of_present_illness: string;
  vitals: Record<string, unknown>;
  examination_notes: string;
  soap_subjective: string;
  soap_objective: string;
  soap_assessment: string;
  soap_plan: string;
  diagnosis: string;
  icd10_code: string;
  /** Recorded ALONGSIDE icd10_code, never instead of it — the statutory exports read ICD-10. */
  icd11_code: string;
  follow_up_date: string;
  follow_up_notes: string;
  /**
   * AI Guidance → Clarifying Questions. Persisted so the card survives a tab switch and a
   * re-opened consultation without re-spending on an AI call (unlike the differential, which
   * is held in the panel's own state and lost whenever the tab unmounts).
   */
  ai_clarifying_questions: ClarifyingQuestionsState | null;
}

export interface PrescriptionData {
  id?: string;
  drugs: DrugEntry[];
  lab_orders: LabOrder[];
  radiology_orders: RadiologyOrder[];
  advice_notes: string;
  review_date: string;
  is_signed: boolean;
}

/**
 * Whether this hospital can actually supply the item.
 *
 *   in_stock     resolved to a catalogue row AND (for drugs) batches on hand.
 *                Auto-selected and eligible for the normal billing flow.
 *   not_stocked  a real item, but this hospital does not stock/offer it. It STAYS on the
 *                prescription so it prints and the patient still gets it — badged for
 *                outside purchase and excluded from auto-billing. Never silently dropped.
 *   unresolved   not matched to any catalogue row yet, or matching failed. Treated exactly
 *                like not_stocked for billing; never assumed available.
 */
export type OrderAvailability = "in_stock" | "not_stocked" | "unresolved";

export interface DrugEntry {
  drug_name: string;
  dose: string;
  route: string;
  frequency: string;
  duration_days: string;
  instructions: string;
  quantity: string;
  is_stat: boolean;
  is_ndps?: boolean;
  availability?: OrderAvailability;
  /** drug_master.id once resolved. */
  catalogue_id?: string;
  /** Units on hand across non-expired, active batches. */
  stock_qty?: number;
}

/**
 * Set when an order was auto-selected from a name that did not match the catalogue verbatim.
 *
 * `matched_from` is the doctor's own wording; the UI renders it as `matched from "…"` so a
 * rewrite that leads to a charge is never silent. `keep_as_typed` is what the revert control
 * sets — it means "I looked at your match and I do not want it", and the resolver must leave
 * the entry alone from then on or it would simply re-apply on the next render.
 */
export interface OrderMatchTrace {
  matched_from?: string;
  keep_as_typed?: boolean;
}

export interface LabOrder extends OrderMatchTrace {
  test_name: string;
  urgency: string;
  clinical_indication: string;
  availability?: OrderAvailability;
  /** lab_test_master.id (or lab_test_groups.id for a panel) once resolved. */
  catalogue_id?: string;
}

export interface RadiologyOrder extends OrderMatchTrace {
  study_name: string;
  urgency: string;
  clinical_indication: string;
  availability?: OrderAvailability;
  /** radiology_study_master.id once resolved. */
  catalogue_id?: string;
}

const emptyEncounter: EncounterData = {
  chief_complaint: "", history_of_present_illness: "", vitals: {},
  examination_notes: "", soap_subjective: "", soap_objective: "",
  soap_assessment: "", soap_plan: "", diagnosis: "", icd10_code: "", icd11_code: "",
  follow_up_date: "", follow_up_notes: "",
  ai_clarifying_questions: null,
};

const emptyPrescription: PrescriptionData = {
  drugs: [], lab_orders: [], radiology_orders: [],
  advice_notes: "", review_date: "", is_signed: false,
};

/* Row → state mappers. Shared by the token loader and by the print handler, which re-reads both
 * rows so the sheet handed to the patient can never be built from stale or blanked state. */

const mapEncounterRow = (enc: Record<string, any>): EncounterData => ({
  chief_complaint: enc.chief_complaint || "",
  history_of_present_illness: enc.history_of_present_illness || "",
  vitals: (enc.vitals as Record<string, unknown>) || {},
  examination_notes: enc.examination_notes || "",
  soap_subjective: enc.soap_subjective || "",
  soap_objective: enc.soap_objective || "",
  soap_assessment: enc.soap_assessment || "",
  soap_plan: enc.soap_plan || "",
  diagnosis: enc.diagnosis || "",
  icd10_code: enc.icd10_code || "",
  icd11_code: enc.icd11_code || "",
  follow_up_date: enc.follow_up_date || "",
  follow_up_notes: enc.follow_up_notes || "",
  ai_clarifying_questions:
    (enc.ai_clarifying_questions as unknown as ClarifyingQuestionsState | null) ?? null,
});

const mapPrescriptionRow = (rx: Record<string, any>): PrescriptionData => ({
  drugs: (rx.drugs as unknown as DrugEntry[]) || [],
  lab_orders: (rx.lab_orders as unknown as LabOrder[]) || [],
  radiology_orders: (rx.radiology_orders as unknown as RadiologyOrder[]) || [],
  advice_notes: rx.advice_notes || "",
  review_date: rx.review_date || "",
  is_signed: rx.is_signed || false,
});

const BASE_TABS = [
  { key: "complaint", label: "Complaint" },
  { key: "vitals", label: "Vitals" },
  { key: "examination", label: "Examination" },
  { key: "guidance", label: "AI Guidance" },
  { key: "rx_orders", label: "Rx & Orders" },
  // Results of what was ordered — labs, cultures, histopathology, referred-out tests and
  // imaging, live. Sits immediately after Rx & Orders because ordering and reading results
  // are the same clinical loop; before this tab existed the doctor had to leave the
  // consultation and open the Lab module to close it.
  { key: "investigations", label: "🧪 Reports" },
  { key: "plan_advice", label: "Plan & Advice" },
  { key: "history", label: "History" },
] as const;

const ConsultationWorkspace: React.FC<Props> = ({ token, hospitalId, userId, onTokenUpdate, onTokenPatch, showPatientDetails, onTogglePatientDetails }) => {
  const { toast } = useToast();
  const { registerScreen, unregisterScreen, rawTranscript, currentPatientId } = useVoiceScribe();
  const { permissions, role } = useHospitalContext();
  const [activeTab, setActiveTab] = useState("complaint");
  const [encounter, setEncounter] = useState<EncounterData>(emptyEncounter);
  const [prescription, setPrescription] = useState<PrescriptionData>(emptyPrescription);
  const [encounterId, setEncounterId] = useState<string | null>(null);
  const [prescriptionId, setPrescriptionId] = useState<string | null>(null);
  // `isAiSuggested` distinguishes a diagnosis the doctor SPOKE from one the model inferred.
  // A suggestion is seeded as non-primary and stays out of coding and billing until confirmed.
  const [diagnosisSeed, setDiagnosisSeed] = useState<{
    text: string; icd10_code: string; nonce: number; isAiSuggested?: boolean; basis?: string;
  } | null>(null);
  // Bumped by the Clarifying Questions card once its answers are written into the HPI, to ask
  // the differential to re-run against the richer history. Both updates happen in one handler
  // so React batches them into a single render — the DDx panel's effect then closes over the
  // NEW `history` prop. Bumping this in a separate tick would re-run against the stale HPI.
  const [ddxRefreshSignal, setDdxRefreshSignal] = useState(0);

  /**
   * The patient's history built from the outside records they brought in — loaded once per
   * patient and fed to all three AI Guidance cards.
   *
   * Patient-scoped, not encounter-scoped: a bag scanned at the front desk last year is still
   * the best history this consultation has, and for a new patient it is the ONLY one.
   */
  const { digest: historyDigest, refresh: refreshHistoryDigest } =
    useCurrentHistoryDigest(token?.patient_id ?? null);
  const historyDigestText = useMemo(() => formatDigestForPrompt(historyDigest), [historyDigest]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const prevTokenId = useRef<string | null>(null);
  const isDirtyRef = useRef(false);
  /**
   * Which encounter the prescription currently in state was loaded for.
   *
   * The last line of defence against saving an empty prescription over a real one. `prescription`
   * is reset to `emptyPrescription` whenever the token selection clears, and if anything then
   * triggers a save before the real one has been re-read, the patient's whole investigation list
   * is overwritten with []. Nothing recovers that — the autosave writes straight over the row.
   * autoSavePrescription refuses to write unless this matches the encounter it is writing to.
   */
  const prescriptionLoadedFor = useRef<string | null>(null);
  /** Encounter whose prescription save last failed — latches the warning to one toast. */
  const rxSaveFailedFor = useRef<string | null>(null);
  const radStudyNamesRef = useRef<Set<string>>(new Set());
  const [deptName, setDeptName] = useState<string | null>(null);
  const [showAdmitModal, setShowAdmitModal] = useState(false);
  const [showReferralModal, setShowReferralModal] = useState(false);
  const [hospitalInfo, setHospitalInfo] = useState<any>(null);

  // Translated advice for bilingual print
  const [printLang, setPrintLang]           = useState("English");
  const [translatedAdvice, setTranslatedAdvice] = useState("");
  const [translatingAdvice, setTranslatingAdvice] = useState(false);
  const [availablePrintLangs, setAvailablePrintLangs] = useState<string[]>(["English"]);

  // Warn on browser close/refresh when dirty
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirtyRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);


  // Load hospital info
  useEffect(() => {
    if (!hospitalId) return;
    supabase.from("hospitals").select("name, address, phone, email, website, logo_url").eq("id", hospitalId).maybeSingle()
      .then(({ data }) => setHospitalInfo(data));
  }, [hospitalId]);

  // Load hospital's preferred patient languages for print
  useEffect(() => {
    if (!hospitalId) return;
    getHospitalLanguages(hospitalId).then((langs) => setAvailablePrintLangs(langs));
  }, [hospitalId]);

  // Load radiology study names for voice-scribe classification
  useEffect(() => {
    if (!hospitalId) return;
    (supabase as any)
      .from("radiology_study_master")
      .select("study_name")
      .eq("hospital_id", hospitalId)
      .eq("is_active", true)
      .then(({ data }: any) => {
        radStudyNamesRef.current = new Set(
          (data || []).map((r: any) => (r.study_name as string).toLowerCase())
        );
      });
  }, [hospitalId]);

  // Fetch department name for specialty detection
  useEffect(() => {
    if (!token?.department_id) { setDeptName(null); return; }
    supabase.from('departments').select('name').eq('id', token.department_id).maybeSingle()
      .then(({ data }) => setDeptName(data?.name || null));
  }, [token?.department_id]);

  const specialty = useMemo(() => getSpecialtySheet(deptName), [deptName]);
  const TABS = useMemo(() => {
    const all: { key: string; label: string }[] = [
      ...BASE_TABS,
      ...(specialty ? [{ key: "specialty", label: `${specialtyTabMeta[specialty].icon} ${specialtyTabMeta[specialty].label}` }] : []),
    ];
    return all.filter((t) => hasTabAccess("opd", t.key, permissions, role));
  }, [specialty, permissions, role]);

  // Badge on the Reports tab — counted even while the tab is closed, which is the point:
  // the doctor should learn a result has landed without going to look for it.
  const unreviewedResults = useUnreviewedResultCount({
    hospitalId,
    patientId: token?.patient_id ?? null,
    encounterId,
    enabled: TABS.some((t) => t.key === "investigations"),
  });

  /**
   * The doctor-patient conversation, for the AI Clarifying Questions card.
   *
   * The scribe panel is app-global and survives a patient switch, so `rawTranscript` may
   * belong to a DIFFERENT patient than the one on screen. Sending that to the model would be
   * a cross-patient PHI leak, so the transcript is only released when the scribe's own
   * `currentPatientId` matches this token's patient. This guard lives here rather than in the
   * card so there is exactly one place it can be got wrong.
   *
   * Truncated to the last 4,000 characters: the tail is the most recent — and most relevant —
   * part of the consultation, and a hard cap bounds both token spend and how much PHI leaves
   * the building. Never persisted; see migration 20261012000030.
   */
  const scribeTranscript = useMemo(() => {
    if (!token?.patient_id || !currentPatientId) return "";
    if (currentPatientId !== token.patient_id) return "";
    return rawTranscript.slice(-4000);
  }, [rawTranscript, currentPatientId, token?.patient_id]);

  // Auto-reset activeTab to first available if current tab is no longer visible
  useEffect(() => {
    if (TABS.length > 0 && !TABS.some((t) => t.key === activeTab)) {
      setActiveTab(TABS[0].key);
    }
  }, [TABS, activeTab]);
  const encounterRef = useRef(encounter);
  const prescriptionRef = useRef(prescription);
  encounterRef.current = encounter;
  prescriptionRef.current = prescription;

  // Voice scribe applies through these rather than raw setState.
  //
  // fillFn used to call setEncounter/setPrescription directly, which skips isDirtyRef and
  // never arms the 2 s autosave — so an applied dictation lived in React state only and was
  // LOST if the doctor navigated away before touching another field or hitting Save.
  // Held in refs because fillFn is registered once (stable deps) while the updaters are
  // defined further down the component.
  const updateEncounterRef = useRef<((p: Partial<EncounterData>) => void) | null>(null);
  const updatePrescriptionRef = useRef<((p: Partial<PrescriptionData>) => void) | null>(null);
  const enrichVoiceOrdersRef = useRef<((added: {
    drugs: DrugEntry[]; labOrders: LabOrder[]; radOrders: RadiologyOrder[];
  }) => Promise<void>) | null>(null);
  /** Lets the token-change effect flush a pending save before it clears state. */
  const autoSavePrescriptionRef = useRef<
    ((data: PrescriptionData, encounterIdOverride?: string) => Promise<void>) | null
  >(null);

  // Register fill function for voice scribe
  useEffect(() => {
    const fillFn = (data: Record<string, unknown>) => {
      const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

      // Only fields the model actually returned are patched, so an omitted key never
      // blanks what the doctor already typed.
      const encPatch: Partial<EncounterData> = {};
      if (str(data.chief_complaint)) encPatch.chief_complaint = str(data.chief_complaint);
      if (str(data.history_of_present_illness)) encPatch.history_of_present_illness = str(data.history_of_present_illness);
      if (str(data.examination_findings)) encPatch.examination_notes = str(data.examination_findings);
      // Systemic Examination / Clinical Notes. No AI key mapped here before — the UI has
      // two examination boxes and the schema had one, so this box could never be filled.
      if (str(data.systemic_examination)) encPatch.soap_objective = str(data.systemic_examination);
      if (str(data.diagnosis)) encPatch.diagnosis = str(data.diagnosis);
      if (str(data.icd_suggestion)) encPatch.icd10_code = str(data.icd_suggestion);
      if (str(data.plan)) encPatch.soap_plan = str(data.plan);
      if (str(data.follow_up)) encPatch.follow_up_notes = str(data.follow_up);

      // updateEncounter (NOT setEncounter) so isDirtyRef is set and the 2 s autosave arms.
      // Applying voice used to leave the note in React state only — navigate away before
      // touching another field and the whole dictation was lost.
      if (Object.keys(encPatch).length > 0) updateEncounterRef.current?.(encPatch);

      // Seed the DiagnosisPanel. A SPOKEN diagnosis is authoritative; an AI-inferred one is
      // offered separately as an unconfirmed suggestion — never primary, and not coded or
      // billed until the doctor accepts it.
      const spoken = str(data.diagnosis);
      const suggested = str(data.suggested_diagnosis);
      if (spoken) {
        setDiagnosisSeed({
          text: spoken,
          icd10_code: str(data.icd_suggestion),
          nonce: Date.now(),
          isAiSuggested: false,
        });
      } else if (suggested) {
        setDiagnosisSeed({
          text: suggested,
          icd10_code: str(data.suggested_icd),
          nonce: Date.now(),
          isAiSuggested: true,
          basis: str(data.diagnosis_basis),
        });
      }

      // Prescriptions and orders land immediately as "unresolved", then an async pass
      // matches them to this hospital's catalogue and stock (see enrichVoiceOrders).
      // Filling first keeps the UI instant; enrichment only adds badges and quantities.
      const drugs: DrugEntry[] = ((data.prescription as DrugEntry[]) || []).map((d) => ({
        drug_name: d.drug_name || "",
        dose: d.dose || "",
        route: d.route || "Oral",
        frequency: d.frequency || "OD",
        duration_days: (d as unknown as Record<string, string>).duration || "",
        instructions: d.instructions || "",
        quantity: "",
        is_stat: false,
        availability: "unresolved",
      }));

      const isRadiology = (name: string) =>
        radStudyNamesRef.current.has(name.toLowerCase()) ||
        isRadiologyKeyword(name);

      const labOrders: LabOrder[] = [];
      const radOrders: RadiologyOrder[] = [];
      ((data.investigations as string[]) || []).forEach((name) => {
        if (isRadiology(name)) radOrders.push({ study_name: name, urgency: "routine", clinical_indication: "", availability: "unresolved" });
        else labOrders.push({ test_name: name, urgency: "routine", clinical_indication: "", availability: "unresolved" });
      });

      if (drugs.length > 0 || labOrders.length > 0 || radOrders.length > 0) {
        const prev = prescriptionRef.current;

        // Append only what isn't already on the prescription. A follow-up dictation re-sends
        // the whole conversation, so the model legitimately re-emits items it already gave us
        // (and can repeat one within a single response). This used to be a blind append, which
        // put the same test/drug on the printed prescription two or more times.
        const norm = (s: string) => s.trim().toLowerCase();
        const keepNew = <T,>(incoming: T[], existing: Set<string>, nameOf: (item: T) => string): T[] => {
          const out: T[] = [];
          for (const item of incoming) {
            const key = norm(nameOf(item) || "");
            if (!key || existing.has(key)) continue;
            existing.add(key); // also collapses repeats within this same batch
            out.push(item);
          }
          return out;
        };

        const newDrugs = keepNew(drugs, new Set(prev.drugs.map((d) => norm(d.drug_name))), (d) => d.drug_name);
        const newLabs = keepNew(labOrders, new Set(prev.lab_orders.map((l) => norm(l.test_name))), (l) => l.test_name);
        const newRads = keepNew(radOrders, new Set(prev.radiology_orders.map((r) => norm(r.study_name))), (r) => r.study_name);

        if (newDrugs.length > 0 || newLabs.length > 0 || newRads.length > 0) {
          // updatePrescription for the same autosave reason as updateEncounter above.
          updatePrescriptionRef.current?.({
            drugs: [...prev.drugs, ...newDrugs],
            lab_orders: [...prev.lab_orders, ...newLabs],
            radiology_orders: [...prev.radiology_orders, ...newRads],
          });
          // Enrich only the newly added rows — the existing ones already went through this.
          void enrichVoiceOrdersRef.current?.({ drugs: newDrugs, labOrders: newLabs, radOrders: newRads });
        }
      }
      // Follow-up now lands reliably in encounter.follow_up_notes (set above),
      // so it is no longer dropped when there are no drugs/orders.
    };
    // Snapshot the current form (mapped back to the AI's field names) so a
    // follow-up recording MERGES with what's already here instead of wiping it.
    // Text fields only — prescriptions/investigations are appended by fillFn, so
    // sending them here too would double them up.
    const getExistingData = (): Record<string, unknown> | null => {
      const enc = encounterRef.current;
      const data: Record<string, unknown> = {};
      if (enc.chief_complaint?.trim()) data.chief_complaint = enc.chief_complaint;
      if (enc.history_of_present_illness?.trim()) data.history_of_present_illness = enc.history_of_present_illness;
      if (enc.examination_notes?.trim()) data.examination_findings = enc.examination_notes;
      // Was omitted entirely, so a follow-up recording had no idea what was already in the
      // systemic-examination box and merging it was impossible by construction.
      if (enc.soap_objective?.trim()) data.systemic_examination = enc.soap_objective;
      if (enc.diagnosis?.trim()) data.diagnosis = enc.diagnosis;
      if (enc.icd10_code?.trim()) data.icd_suggestion = enc.icd10_code;
      if (enc.soap_plan?.trim()) data.plan = enc.soap_plan;
      if (enc.follow_up_notes?.trim()) data.follow_up = enc.follow_up_notes;
      return Object.keys(data).length > 0 ? data : null;
    };
    registerScreen("opd_consultation", fillFn, getExistingData);
    return () => unregisterScreen("opd_consultation");
  }, [registerScreen, unregisterScreen]);

  // Load encounter when token changes.
  //
  // Keyed on the token ID, not the token object: OPDPage re-derives `selectedToken` from a list
  // it refetches on every realtime opd_tokens event and on tab focus, so the object identity
  // churns constantly while the doctor is mid-consultation. Only a change of PATIENT should
  // reload anything.
  useEffect(() => {
    const tokenId = token?.id ?? null;

    if (!tokenId || !hospitalId || !userId) {
      // The selection genuinely cleared — the queue's date arrows moved to another day, the
      // mobile Back button was pressed, or a refetch returned a list without this token.
      //
      // prevTokenId MUST be reset here. It used to be left pointing at the token that was just
      // cleared, so re-selecting that same patient hit the `tokenId === prevTokenId.current`
      // short-circuit below and never re-read anything: the doctor came back to an Rx & Orders
      // tab with every prescribed test gone, over a prescription that was still intact in the
      // database. The next autosave then wrote that empty state back and made the loss real.
      // That is the "prescribed tests disappeared" report.
      //
      // Flush anything still sitting in the 2s autosave debounce first, or clearing the
      // selection silently discards the last few seconds of work.
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = undefined;
        if (isDirtyRef.current && encounterId) {
          void autoSavePrescriptionRef.current?.(prescriptionRef.current, encounterId);
        }
      }
      prevTokenId.current = null;
      prescriptionLoadedFor.current = null;
      isDirtyRef.current = false;
      setEncounter(emptyEncounter);
      setPrescription(emptyPrescription);
      setEncounterId(null);
      setPrescriptionId(null);
      setDiagnosisSeed(null);
      return;
    }
    if (tokenId === prevTokenId.current) return;
    prevTokenId.current = tokenId;
    isDirtyRef.current = false;
    prescriptionLoadedFor.current = null;
    setDiagnosisSeed(null);

    (async () => {
      // Fetch existing encounter for this token.
      //
      // THIS IS WHERE "the prescribed tests are missing after a refresh" comes from.
      //
      // .maybeSingle() errors when more than one row matches, and there is no unique index on
      // opd_encounters.token_id. autoSaveEncounter picks insert-vs-update from the encounterId
      // React state, so two saves that both observe it as null — the 2-second debounced
      // autosave racing the explicit save on Complete — each INSERT, leaving two encounter
      // rows for one token. From then on this query fails on EVERY load, `enc` comes back
      // null, and the else-branch below blanks the encounter AND the prescription. The
      // doctor's tests are still in the database; the workspace simply stops being able to
      // read them. Reload again and they are still gone. (The identical bug on `prescriptions`
      // was fixed by migration 20261013000021; nobody applied the same guard one level up.)
      //
      // Recover by taking the most recent encounter instead of blanking. A companion migration
      // dedupes and adds the missing unique index so the state stops arising.
      const { data: enc, error: encErr } = await supabase
        .from("opd_encounters")
        .select("*")
        .eq("token_id", token.id)
        .maybeSingle();

      let encRow: any = enc;
      if (encErr) {
        console.error(
          `Encounter load failed for token ${token.id}: ${encErr.message}. ` +
          `Falling back to the most recent encounter — blanking the workspace would hide ` +
          `clinical data that is still stored.`
        );
        const { data: newest } = await supabase
          .from("opd_encounters")
          .select("*")
          .eq("token_id", token.id)
          .order("created_at", { ascending: false })
          .limit(1);
        encRow = newest?.[0] ?? null;
      }

      if (encRow) {
        const enc = encRow;
        setEncounterId(enc.id);
        setEncounter(mapEncounterRow(enc));

        // Fetch prescription.
        //
        // The error is checked, not discarded, because the two outcomes are opposites and
        // .maybeSingle() reports both as `data: null`:
        //   * genuinely no prescription yet  → an empty prescription IS the truth;
        //   * the query FAILED               → an empty prescription is a lie, and writing it
        //                                      back blanks the doctor's tests and drugs.
        //
        // .maybeSingle() errors when more than one row matches. A unique index now prevents
        // duplicate prescriptions per encounter (20261013000021), but any row pair written
        // before that migration landed still errors here forever — the prescription loads
        // empty, the "Selected" list shows nothing, and the next save then tries to INSERT
        // (prescriptionId having been cleared), which the unique index rejects. That is how a
        // doctor's prescribed tests silently disappear and never come back.
        //
        // On error, fall back to the newest row rather than blanking.
        const { data: rx, error: rxErr } = await supabase
          .from("prescriptions")
          .select("*")
          .eq("encounter_id", enc.id)
          .maybeSingle();

        let rxRow: any = rx;
        if (rxErr) {
          console.error(
            `Prescription load failed for encounter ${enc.id}: ${rxErr.message}. ` +
            `Falling back to the most recent row — do NOT blank the prescription on a read error.`
          );
          const { data: newest } = await supabase
            .from("prescriptions")
            .select("*")
            .eq("encounter_id", enc.id)
            .order("created_at", { ascending: false })
            .limit(1);
          rxRow = newest?.[0] ?? null;
        }

        if (rxRow) {
          setPrescriptionId(rxRow.id);
          setPrescription(mapPrescriptionRow(rxRow));
        } else if (!rxErr) {
          setPrescription(emptyPrescription);
          setPrescriptionId(null);
        }
        // On an error with no recoverable row, deliberately leave the in-memory prescription
        // alone: prescriptionLoadedFor stays unset below, so the save guard blocks any write.
        // Only now is the in-memory prescription a true picture of this encounter, so only now
        // may it be written back. See prescriptionLoadedFor's declaration.
        prescriptionLoadedFor.current = enc.id;
      } else {
        // No encounter row yet — a consultation that has not been started. The empty
        // prescription IS the truth here, and with no prescriptionId the save path INSERTs,
        // so there is nothing for the guard to protect.
        setEncounter(emptyEncounter);
        setPrescription(emptyPrescription);
        setEncounterId(null);
        setPrescriptionId(null);
      }
    })();
    // token?.id, not token — see the note above the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token?.id, hospitalId, userId]);

  // Auto-save encounter. Returns the encounter id (existing or newly created) so
  // callers that must act on a saved encounter — e.g. handleComplete — can proceed
  // immediately instead of waiting for the setEncounterId state update to land.
  const autoSaveEncounter = useCallback(async (data: EncounterData): Promise<string | null> => {
    if (!token || !hospitalId || !userId) return null;
    setSaving(true);
    setSaved(false);
    try {
      const payload = {
        hospital_id: hospitalId,
        token_id: token.id,
        patient_id: token.patient_id,
        doctor_id: token.doctor_id || userId,
        visit_date: new Date().toISOString().split("T")[0],
        chief_complaint: data.chief_complaint || null,
        history_of_present_illness: data.history_of_present_illness || null,
        vitals: data.vitals as unknown as import("@/integrations/supabase/types").Json,
        examination_notes: data.examination_notes || null,
        soap_subjective: data.soap_subjective || null,
        soap_objective: data.soap_objective || null,
        soap_assessment: data.soap_assessment || null,
        soap_plan: data.soap_plan || null,
        diagnosis: data.diagnosis || null,
        icd10_code: data.icd10_code || null,
        icd11_code: data.icd11_code || null,
        follow_up_date: data.follow_up_date || null,
        follow_up_notes: data.follow_up_notes || null,
        ai_clarifying_questions:
          (data.ai_clarifying_questions ?? null) as unknown as import("@/integrations/supabase/types").Json,
        updated_at: new Date().toISOString(),
      };

      let savedId: string | null = encounterId;
      if (encounterId) {
        await supabase.from("opd_encounters").update(payload as never).eq("id", encounterId);
      } else {
        // Adopt-don't-duplicate. Two saves can both reach here with encounterId still null
        // (the debounced autosave racing Complete), and a second INSERT gives the token two
        // encounters — after which the workspace can no longer load either of them. Once the
        // companion unique index exists this INSERT is rejected outright, so the duplicate is
        // caught here and the existing row is adopted; until then the pre-check does the same
        // job. Either way the second writer updates the first writer's row instead of
        // creating a rival to it.
        const { data: existingEnc } = await supabase
          .from("opd_encounters")
          .select("id")
          .eq("token_id", token.id)
          .order("created_at", { ascending: false })
          .limit(1);

        if (existingEnc?.[0]?.id) {
          savedId = existingEnc[0].id;
          setEncounterId(savedId);
          const { error: updErr } = await supabase
            .from("opd_encounters").update(payload as never).eq("id", savedId);
          if (updErr) throw updErr;
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
          return savedId;
        }

        const { data: newEnc, error: insErr } = await supabase
          .from("opd_encounters").insert([payload] as never).select("id").maybeSingle();
        if (insErr) {
          console.error(`Encounter insert failed for token ${token.id}: ${insErr.message}`);
          throw insErr;
        }
        if (newEnc) {
          savedId = newEnc.id;
          setEncounterId(newEnc.id);
          // Backfill encounter_id into the single walk-in bill for this token.
          // Fetch the most recent unlinked bill first (PostgREST UPDATE has no LIMIT),
          // then update only that one row so we don't link other patients' or
          // other tokens' bills to this encounter.
          const today = new Date().toISOString().split("T")[0];
          const { data: unlinkedBill } = await (supabase as any)
            .from("bills")
            .select("id")
            .eq("patient_id", token.patient_id)
            .eq("bill_type", "opd")
            .eq("hospital_id", hospitalId)
            .eq("bill_date", today)
            .is("encounter_id", null)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (unlinkedBill?.id) {
            await (supabase as any).from("bills")
              .update({ encounter_id: newEnc.id } as never)
              .eq("id", unlinkedBill.id);
          }
        }
      }
      setSaved(true);
      isDirtyRef.current = false;
      setTimeout(() => setSaved(false), 2000);
      return savedId;
    } catch (err) {
      console.error("Auto-save error:", err);
      return null;
    } finally {
      setSaving(false);
    }
  }, [token, hospitalId, userId, encounterId]);


  // Auto-save prescription. `encounterIdOverride` lets a caller that just created the
  // encounter pass its id directly — the `encounterId` state captured in this callback is
  // still stale within the same tick, which would otherwise silently skip the save.
  const autoSavePrescription = useCallback(async (data: PrescriptionData, encounterIdOverride?: string) => {
    const targetEncounterId = encounterIdOverride ?? encounterId;
    if (!token || !hospitalId || !userId || !targetEncounterId) return;

    // Never overwrite a STORED prescription with state that was not loaded from it.
    //
    // `prescription` gets reset to empty whenever the token selection clears. If a save then
    // fires — a debounce that outlived the switch, a Complete on a workspace that silently
    // blanked — the UPDATE below replaces the patient's drugs and investigations with []. There
    // is no undo: prescription_history snapshots the row we are about to destroy, but nothing
    // in the UI restores from it.
    //
    // Only the UPDATE path needs guarding. With no prescriptionId this INSERTs, and there is by
    // definition no stored row to lose.
    if (prescriptionId && prescriptionLoadedFor.current !== targetEncounterId) {
      console.warn(
        `Refusing to save prescription ${prescriptionId}: in-memory state belongs to ` +
        `${prescriptionLoadedFor.current ?? "no encounter"}, not ${targetEncounterId}. ` +
        `This is the guard against blanking a prescription after the token selection cleared.`
      );
      return;
    }

    try {
      const payload = {
        hospital_id: hospitalId,
        encounter_id: targetEncounterId,
        patient_id: token.patient_id,
        doctor_id: userId,
        prescription_date: new Date().toISOString().split("T")[0],
        drugs: JSON.parse(JSON.stringify(data.drugs)),
        lab_orders: JSON.parse(JSON.stringify(data.lab_orders)),
        radiology_orders: JSON.parse(JSON.stringify(data.radiology_orders)),
        advice_notes: data.advice_notes || null,
        review_date: data.review_date || null,
        is_signed: data.drugs.length > 0,
      };

      if (prescriptionId) {
        // Save current version to history before overwriting
        try {
          const { data: currentRx } = await supabase
            .from("prescriptions")
            .select("*")
            .eq("id", prescriptionId)
            .maybeSingle();
          if (currentRx) {
            const { count } = await (supabase as any)
              .from("prescription_history")
              .select("id", { count: "exact", head: true })
              .eq("prescription_id", prescriptionId);
            await (supabase as any).from("prescription_history").insert({
              prescription_id: prescriptionId,
              hospital_id: hospitalId,
              version_number: ((count as number) || 0) + 1,
              snapshot: currentRx,
              changed_by: userId,
            });
          }
        } catch (histErr) {
          console.error("Prescription history save error (non-blocking):", histErr);
        }
        const { error: updErr } = await supabase.from("prescriptions").update(payload as never).eq("id", prescriptionId);
        if (updErr) {
          console.error(`Prescription update failed for ${prescriptionId}: ${updErr.message}`);
          throw updErr;
        }
      } else {
        const { data: newRx, error: insErr } = await supabase
          .from("prescriptions").insert([payload] as never).select("id").maybeSingle();

        // A swallowed error here is why prescribed tests survived on screen but were gone
        // after a refresh.
        //
        // prescriptions has a unique index on encounter_id (20261013000021). Whenever this
        // component holds prescriptionId === null while a row already exists for the encounter
        // — a load that errored, or two saves racing so the loser's INSERT collides — this
        // INSERT is rejected with 23505. The error was discarded, so `newRx` was null,
        // prescriptionId stayed null, and EVERY later save took this same INSERT branch and
        // failed identically. The prescription was frozen: the doctor kept adding tests, the UI
        // kept showing them from memory, and nothing was ever written. Reload, and they were
        // gone.
        //
        // Recover instead of failing: adopt the existing row and switch to UPDATE, which also
        // self-heals an encounter already stuck in this state.
        if (insErr) {
          const isDuplicate = (insErr as any).code === "23505"
            || /duplicate key|unique constraint/i.test(insErr.message || "");
          if (!isDuplicate) {
            console.error(`Prescription insert failed: ${insErr.message}`);
            throw insErr;
          }

          const { data: existing } = await supabase
            .from("prescriptions")
            .select("id")
            .eq("encounter_id", targetEncounterId)
            .order("created_at", { ascending: false })
            .limit(1);
          const existingId = existing?.[0]?.id;
          if (!existingId) throw insErr;

          console.warn(
            `Prescription for encounter ${targetEncounterId} already existed; adopting row ` +
            `${existingId} and updating it instead of inserting a duplicate.`
          );
          setPrescriptionId(existingId);
          prescriptionLoadedFor.current = targetEncounterId;
          const { error: updErr } = await supabase
            .from("prescriptions").update(payload as never).eq("id", existingId);
          if (updErr) throw updErr;
        } else if (newRx) {
          setPrescriptionId(newRx.id);
          // From here on there IS a stored row, so later saves have something to destroy and
          // must satisfy the guard above. Stamped only on this branch: on the update branch the
          // guard has already proved the pointer matches, and re-stamping there could resurrect
          // it after a concurrent clear had deliberately blanked it.
          prescriptionLoadedFor.current = targetEncounterId;
        }
      }
      // A save that worked clears the "could not save" latch below.
      rxSaveFailedFor.current = null;
    } catch (err: any) {
      console.error("Prescription save error:", err);
      // TELL THE DOCTOR. This used to fail silently: the drugs and investigations stayed on
      // screen because they live in React state, so everything looked saved until the page
      // was reloaded and they were simply gone. A save failure the prescriber never learns
      // about is worse than one that interrupts them. Latched per encounter so a repeating
      // 2-second autosave cannot spam the same warning.
      if (rxSaveFailedFor.current !== targetEncounterId) {
        rxSaveFailedFor.current = targetEncounterId;
        toast({
          title: "Prescription not saved",
          description:
            "Your drugs and investigations are still on screen but have NOT been stored. " +
            "Do not reload — try Complete again, or copy them out first.",
          variant: "destructive",
        });
      }
    }
  }, [token, hospitalId, userId, encounterId, prescriptionId, toast]);
  autoSavePrescriptionRef.current = autoSavePrescription;

  // Debounced update
  const updateEncounter = useCallback((partial: Partial<EncounterData>) => {
    setEncounter((prev) => {
      const next = { ...prev, ...partial };
      isDirtyRef.current = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => autoSaveEncounter(next), 2000);
      return next;
    });
  }, [autoSaveEncounter]);
  updateEncounterRef.current = updateEncounter;

  /**
   * Append the scanned-records summary to the HPI.
   *
   * Mirrors applyQuestionsToHpi in ClarifyingQuestionsPanel: the block is delimited and
   * re-applying REPLACES rather than stacks, so a doctor who presses it twice does not end
   * up with two copies of the patient's outside history in the note. The `g` flag means a
   * pre-existing duplicate self-heals on the next apply.
   */
  const insertHistoryDigestToHpi = useCallback((text: string) => {
    const BLOCK_RE = /\n*--- Previous records \(from outside documents[^)]*\) ---\n[\s\S]*?\n--- end ---/g;
    const stripped = (encounterRef.current.history_of_present_illness || "")
      .replace(BLOCK_RE, "").replace(/\n{3,}/g, "\n\n").trimEnd();
    updateEncounter({
      history_of_present_illness: stripped ? `${stripped}\n\n${text}` : text,
    });
  }, [updateEncounter]);

  const handlePrintPrescription = async () => {
    if (!token || !hospitalInfo) {
      toast({ title: "Hospital details not found", variant: "destructive" });
      return;
    }
    logRecordAccess({ hospitalId, recordType: "OPD_Record", recordId: token.id, patientId: token.patient_id, action: "print" });

    // The printed sheet is what the patient walks out of the building with, so it is built from
    // what is SAVED, not from whatever is in component state. Those can differ two ways:
    //
    //   - edits still sitting inside the 2s autosave debounce, which would print as missing;
    //   - a workspace whose state was blanked when the token selection cleared, which printed a
    //     prescription with no complaint, no drugs and no investigations over a database row
    //     that held all three. That is the "lab tests and radiology missing from the printout"
    //     report — the template below was always correct, it was handed empty arrays.
    //
    // Flush first, then re-read. A patient handed a blank prescription has no way to know
    // anything is wrong, which is what makes this worth a round trip.
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = undefined;
      if (isDirtyRef.current) {
        await autoSaveEncounter(encounter);
        await autoSavePrescription(prescriptionRef.current, encounterId ?? undefined);
        isDirtyRef.current = false;
      }
    }

    let prescription = prescriptionRef.current;
    let encounterForPrint = encounter;
    if (encounterId) {
      const [{ data: encRow }, { data: rxRow }] = await Promise.all([
        supabase.from("opd_encounters").select("*").eq("id", encounterId).maybeSingle(),
        supabase.from("prescriptions").select("*").eq("encounter_id", encounterId).maybeSingle(),
      ]);
      if (encRow) encounterForPrint = mapEncounterRow(encRow);
      if (rxRow) prescription = mapPrescriptionRow(rxRow);
    }
    const encounter_ = encounterForPrint;

    // A sheet with nothing clinical on it is a printing failure, not a valid prescription.
    // Say so instead of emitting it.
    const hasContent =
      prescription.drugs.length > 0 ||
      prescription.lab_orders.length > 0 ||
      prescription.radiology_orders.length > 0 ||
      !!prescription.advice_notes?.trim() ||
      !!encounter_.chief_complaint?.trim() ||
      !!encounter_.diagnosis?.trim() ||
      !!encounter_.soap_plan?.trim();
    if (!hasContent) {
      toast({
        title: "Nothing to print yet",
        description:
          "This consultation has no complaint, medication or investigation saved against it. " +
          "Add them and try again — printing now would hand the patient a blank prescription.",
        variant: "destructive",
      });
      return;
    }

    const drugsHtml = prescription.drugs.length > 0
      ? `<table>
          <tr><th>Drug Name</th><th>Dose</th><th>Freq</th><th>Duration</th><th>Instructions</th></tr>
          ${prescription.drugs.map(d => `<tr>
            <td><b>${d.drug_name}</b></td>
            <td>${d.dose}</td>
            <td>${d.frequency}</td>
            <td>${d.duration_days} days</td>
            <td style="font-size:11px">${d.instructions}</td>
          </tr>`).join("")}
        </table>`
      : "<p>No medications prescribed.</p>";

    // Everything the lab and radiology have released for this visit, abnormal values in bold.
    // Anything already reported is dropped from the "ordered" lists below, so each test appears
    // once — either as something still awaited, or with the value that came back.
    const { html: resultsHtml, resultedNames } = await buildInvestigationResultsHtml({
      hospitalId: hospitalId ?? "",
      encounterId,
    });
    const awaited = <T,>(rows: T[], nameOf: (row: T) => string) =>
      rows.filter((r) => !resultedNames.has(nameOf(r).toLowerCase().trim()));

    const pendingLabs = awaited(prescription.lab_orders, (l) => l.test_name);
    const pendingRads = awaited(prescription.radiology_orders, (r) => r.study_name);
    const orderedHeading = resultsHtml ? "Awaiting Results" : "Lab Orders";

    // Same space problem as the results table: a column of ten short test names down the left of
    // an otherwise blank page. Two columns above six items. `break-inside:avoid` keeps a name
    // from being split across the column boundary.
    const nameList = (names: string[]) =>
      `<ul style="margin:0;padding-left:20px;${names.length > 6 ? "column-count:2;column-gap:24px;" : ""}">${
        names.map(n => `<li style="break-inside:avoid;">${n}</li>`).join("")
      }</ul>`;

    const labHtml = pendingLabs.length > 0
      ? `<div class="section-title">${orderedHeading}</div>${nameList(pendingLabs.map(l => l.test_name))}`
      : "";
    const radHtml = pendingRads.length > 0
      ? `<div class="section-title" style="margin-top:10px;">${resultsHtml ? "Imaging Awaiting Report" : "Radiology Orders"}</div>${nameList(pendingRads.map(r => r.study_name))}`
      : "";
    // Results first — they are the actionable part and the reason the sheet is worth reading.
    // What is still outstanding follows, so "Awaiting Results" cannot appear above the results.
    const investigationsHtml = `${resultsHtml}${labHtml}${radHtml}`;

    // Vitals sit in the top-right of the patient header, stacked vertically, instead of the
    // full-width band they used to occupy. That band cost a whole horizontal strip of the page
    // for six short numbers; on a one-page prescription that space belongs to the drug table
    // and the results. The column beside Date/Doctor/Dept was empty anyway.
    //
    // Systolic and diastolic are stored as two keys but are one reading, so they print as
    // "BP: 120/80" — two separate lines would be both longer and clinically odd.
    const VITAL_LABELS: Record<string, string> = {
      pulse: "Pulse", spo2: "SpO₂", temperature: "Temp", weight_kg: "Weight",
      height_cm: "Height", respiratory_rate: "Resp. Rate", bmi: "BMI",
      blood_sugar: "Blood Sugar", pain_score: "Pain Score",
    };
    const VITAL_UNITS: Record<string, string> = {
      pulse: "/min", spo2: "%", weight_kg: "kg", height_cm: "cm", respiratory_rate: "/min",
    };
    const prettyVital = (k: string) =>
      VITAL_LABELS[k] ?? k.replace(/_(kg|cm)$/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

    const rawVitals = (encounter_.vitals || {}) as Record<string, unknown>;
    const filled = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== "";

    // Two columns, not one right-aligned run: labels right-aligned against the colon, values
    // left-aligned beside it, so every key starts and every value starts on its own vertical
    // line. Flush-right text leaves both edges ragged, which is what made the box hard to scan.
    //
    // The global print stylesheet sets `table { width:100% }` and puts a bottom border and 5/8px
    // padding on every `td`, so each cell overrides those explicitly — otherwise this renders as
    // a full-width ruled table instead of a compact block.
    const TD = "border:none;padding:1px 0;vertical-align:baseline;";
    const vitalLines: string[] = [];
    const vitalRow = (label: string, value: string, unit?: string) =>
      `<tr>
         <td class="label" style="${TD}text-align:right;padding-right:5px;white-space:nowrap;">${label}:</td>
         <td style="${TD}text-align:left;white-space:nowrap;"><b>${value}</b>${unit ? ` ${unit}` : ""}</td>
       </tr>`;

    if (filled(rawVitals.bp_systolic) || filled(rawVitals.bp_diastolic)) {
      vitalLines.push(vitalRow("BP", `${rawVitals.bp_systolic ?? "--"}/${rawVitals.bp_diastolic ?? "--"}`, "mmHg"));
    }
    for (const [k, v] of Object.entries(rawVitals)) {
      if (k === "bp_systolic" || k === "bp_diastolic" || !filled(v)) continue;
      vitalLines.push(vitalRow(prettyVital(k), String(v), VITAL_UNITS[k]));
    }

    // Floated right so the Clinical Notes / Rx content flows up the left of it instead of
    // starting below it — a right-aligned block on its own line would give back the vertical
    // space this change was meant to save.
    const vitalsHtml = vitalLines.length > 0
      ? `<div style="float:right;font-size:11px;color:#475569;line-height:1.5;
                     border:1px solid #e2e8f0;border-radius:4px;padding:6px 10px;margin:0 0 8px 14px;background:#f8fafc;">
           <div class="label" style="font-weight:bold;text-align:center;margin-bottom:3px;">Vitals</div>
           <table style="width:auto;border-collapse:collapse;margin:0;">${vitalLines.join("")}</table>
         </div>`
      : "";

    const body = `
      ${printHeader(hospitalInfo.name, "OPD PRESCRIPTION", `<p style="font-size:12px;color:#64748b;margin:2px 0;">${hospitalInfo.address || ""}</p>`)}
      
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;border-bottom:1px solid #e2e8f0;padding-bottom:10px;margin-bottom:14px;">
        <div style="flex:1;min-width:0;">
          <div style="margin-bottom:4px;"><span class="label">Patient:</span> <b>${token.patient?.full_name}</b></div>
          <div style="margin-bottom:4px;"><span class="label">UHID:</span> <b>${token.patient?.uhid}</b></div>
          <div style="margin-bottom:4px;"><span class="label">Age/Sex:</span> <span>${token.patient?.dob ? Math.floor((Date.now() - new Date(token.patient.dob).getTime()) / 31557600000) : "--"}y / ${token.patient?.gender || "--"}</span></div>
        </div>
        <div style="text-align:right;flex:1;min-width:0;">
          <div style="margin-bottom:4px;"><span class="label">Date:</span> <b>${new Date().toLocaleDateString("en-IN")}</b></div>
          <div style="margin-bottom:4px;"><span class="label">Doctor:</span> <b>${token.doctor?.full_name || "Dr. Consultation"}</b></div>
          <div style="margin-bottom:4px;"><span class="label">Dept:</span> <span>${deptName || "--"}</span></div>
        </div>
      </div>

      ${vitalsHtml}

      <div class="section-title">Clinical Notes</div>
      <div style="margin-bottom:15px;line-height:1.5;">
        <p style="margin:4px 0;"><span class="label">Chief Complaint:</span> ${encounter_.chief_complaint || "--"}</p>
        ${encounter_.history_of_present_illness ? `<p style="margin:4px 0 0 0;"><span class="label">History of Present Illness:</span></p><div style="white-space:pre-wrap;margin:0 0 4px 0;">${encounter_.history_of_present_illness}</div>` : ""}
        ${encounter_.soap_assessment ? `<p style="margin:4px 0;"><span class="label">Assessment:</span> ${encounter_.soap_assessment}</p>` : ""}
        ${encounter_.diagnosis ? `<p style="margin:4px 0;"><span class="label">Diagnosis:</span> <b>${encounter_.diagnosis}</b> ${encounter_.icd10_code ? `(${encounter_.icd10_code})` : ""}${encounter_.icd11_code ? ` [ICD-11 ${encounter_.icd11_code}]` : ""}</p>` : ""}
      </div>

      <div style="clear:both;"></div>

      <div class="section-title">Rx (Prescription)</div>
      ${drugsHtml}

      ${investigationsHtml}

      ${encounter_.soap_plan
          ? `<div class="section-title" style="margin-top:10px;">Plan &amp; Investigations</div><div style="white-space:pre-wrap;background:#f8fafc;padding:10px;border-radius:4px;border:1px solid #e2e8f0;">${encounter_.soap_plan}</div>`
          : ""}

      ${prescription.advice_notes
          ? translatedAdvice && printLang !== "English"
            ? buildBilingualHtml(prescription.advice_notes, translatedAdvice, printLang, ALL_PATIENT_LANGUAGES.find(l => l.code === printLang)?.native || printLang)
            : `<div class="section-title">Advice & Instructions</div><div style="white-space:pre-wrap;background:#f8fafc;padding:10px;border-radius:4px;border:1px solid #e2e8f0;">${prescription.advice_notes}</div>`
          : ""}

      ${(() => {
        const reviewDate = prescription.review_date || encounter_.follow_up_date;
        return (encounter_.follow_up_notes || reviewDate) ? `<div style="margin-top:20px;padding:10px;border:1px dashed #1A2F5A;border-radius:4px;background:#f0f7ff;">
        <b style="color:#1A2F5A">Follow-up</b>
        ${reviewDate ? `<span style="margin-left:6px;color:#1A2F5A;">Review date: ${new Date(reviewDate).toLocaleDateString("en-IN")}</span>` : ""}
        ${encounter_.follow_up_notes ? `<p style="margin-top:5px;font-size:12px;color:#475569;white-space:pre-wrap;">${encounter_.follow_up_notes}</p>` : ""}
      </div>` : "";
      })()}

      <div style="margin-top:80px;display:flex;justify-content:flex-end;">
        <div style="text-align:center;width:220px;border-top:1px solid #1e293b;padding-top:8px;">
          <p style="margin:0;font-weight:bold;color:#1A2F5A;">${token.doctor?.full_name || "Doctor's Signature"}</p>
          <p style="margin:0;font-size:10px;color:#64748b;">Medical Council Registration Number</p>
        </div>
      </div>
    `;

    printDocument(`Prescription_${token.patient?.uhid}`, body);
  };

  const updatePrescription = useCallback((partial: Partial<PrescriptionData>) => {
    setPrescription((prev) => {
      const next = { ...prev, ...partial };
      isDirtyRef.current = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        autoSaveEncounter(encounter);
        autoSavePrescription(next);
      }, 2000);
      return next;
    });
  }, [autoSaveEncounter, autoSavePrescription, encounter]);
  updatePrescriptionRef.current = updatePrescription;

  /**
   * Match voice-added orders to this hospital's catalogue and stock, after they are already
   * on screen.
   *
   * Runs asynchronously so applying a dictation stays instant — this only adds catalogue
   * ids, quantities, the NDPS flag and availability badges. Nothing is ever REMOVED here:
   * a drug the hospital does not stock stays on the prescription so it still prints and the
   * patient can buy it outside; it is simply marked so nobody expects the pharmacy to
   * dispense it and auto-billing skips it.
   */
  const enrichVoiceOrders = useCallback(async (added: {
    drugs: DrugEntry[]; labOrders: LabOrder[]; radOrders: RadiologyOrder[];
  }) => {
    if (!hospitalId) return;
    try {
      const [stock, catalogue] = await Promise.all([
        added.drugs.length ? resolveDrugStock(hospitalId, added.drugs.map(d => d.drug_name)) : Promise.resolve(new Map()),
        (added.labOrders.length || added.radOrders.length) ? loadOrderCatalogue(hospitalId) : Promise.resolve(null),
      ]);

      const prev = prescriptionRef.current;
      const addedDrugNames = new Set(added.drugs.map(d => d.drug_name));
      const addedLabNames = new Set(added.labOrders.map(l => l.test_name));
      const addedRadNames = new Set(added.radOrders.map(r => r.study_name));

      const nextDrugs = prev.drugs.map((d) => {
        if (!addedDrugNames.has(d.drug_name) || d.availability !== "unresolved") return d;
        const hit = stock.get(d.drug_name);
        if (!hit) return { ...d, availability: "unresolved" as const };
        return {
          ...d,
          // Canonical catalogue spelling, so the pharmacy screen and the bill agree.
          drug_name: hit.drug_name,
          catalogue_id: hit.drug_id,
          // Voice-added drugs never carried this, so the NDPS badge and dual-verification
          // warning silently failed to fire on dictated controlled substances.
          is_ndps: hit.is_ndps,
          stock_qty: hit.total_stock,
          availability: hit.total_stock > 0 ? ("in_stock" as const) : ("not_stocked" as const),
          quantity: d.quantity || calcDrugQuantity(d.dose, d.frequency, d.duration_days),
        };
      });

      let nextLabs = prev.lab_orders;
      let nextRads = prev.radiology_orders;

      if (catalogue) {
        const resolvedLabs = resolveOrders([...addedLabNames], catalogue, isRadiologyKeyword);
        const resolvedRads = resolveOrders([...addedRadNames], catalogue, isRadiologyKeyword);
        const byDictated = new Map([...resolvedLabs, ...resolvedRads].map(r => [r.dictated, r]));

        // A name first routed by keyword can turn out to be the other kind once matched
        // against the real catalogue, so rebuild both lists together.
        const keepLabs: LabOrder[] = [];
        const keepRads: RadiologyOrder[] = [];

        for (const l of prev.lab_orders) {
          const r = addedLabNames.has(l.test_name) && l.availability === "unresolved"
            ? byDictated.get(l.test_name) : null;
          if (!r) { keepLabs.push(l); continue; }
          if (r.kind === "radiology") {
            keepRads.push({ study_name: r.name, urgency: l.urgency, clinical_indication: l.clinical_indication, availability: "in_stock", catalogue_id: r.catalogueId ?? undefined, matched_from: r.matchedFrom });
          } else {
            keepLabs.push({ ...l, test_name: r.name, catalogue_id: r.catalogueId ?? undefined, availability: r.offered ? "in_stock" : "not_stocked", matched_from: r.matchedFrom });
          }
        }
        for (const rad of prev.radiology_orders) {
          const r = addedRadNames.has(rad.study_name) && rad.availability === "unresolved"
            ? byDictated.get(rad.study_name) : null;
          if (!r) { keepRads.push(rad); continue; }
          if (r.kind === "lab" || r.kind === "lab_group") {
            keepLabs.push({ test_name: r.name, urgency: rad.urgency, clinical_indication: rad.clinical_indication, availability: "in_stock", catalogue_id: r.catalogueId ?? undefined, matched_from: r.matchedFrom });
          } else {
            keepRads.push({ ...rad, study_name: r.name, catalogue_id: r.catalogueId ?? undefined, availability: r.offered ? "in_stock" : "not_stocked", matched_from: r.matchedFrom });
          }
        }
        nextLabs = keepLabs;
        nextRads = keepRads;
      }

      updatePrescriptionRef.current?.({
        drugs: nextDrugs, lab_orders: nextLabs, radiology_orders: nextRads,
      });
    } catch (err) {
      // Enrichment is an upgrade, never a requirement — the orders are already on screen.
      console.warn("Voice order enrichment failed (non-fatal):", err);
    }
  }, [hospitalId]);
  enrichVoiceOrdersRef.current = enrichVoiceOrders;

  // Add a lab test (used by the Clinical Guidance recommended-investigations chips)
  //
  // The model writes what a clinician writes — "CBC", "LFT", "RFT" — not this hospital's
  // catalogue spelling. Marking the entry `unresolved` hands it to the resolver in
  // RxOrdersTab, which rewrites it to the row it actually means, moves it to the radiology
  // list if that is what it turned out to be, and shows the doctor what it matched. Added raw
  // and unmarked, an AI-suggested test failed syncLabOrders' exact-name match and was dropped.
  const addLabOrder = useCallback((name: string) => {
    if (!name.trim()) return;
    setPrescription((prev) => {
      // Case-insensitive so "Fever Profile" can't be added alongside "fever profile".
      if (prev.lab_orders.some((l) => l.test_name.trim().toLowerCase() === name.trim().toLowerCase())) return prev;
      const next = {
        ...prev,
        lab_orders: [
          ...prev.lab_orders,
          { test_name: name, urgency: "routine", clinical_indication: "", availability: "unresolved" as const },
        ],
      };
      isDirtyRef.current = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => autoSavePrescription(next), 2000);
      return next;
    });
  }, [autoSavePrescription]);

  const handleStartConsultation = async () => {
    if (!token) return;
    const now = new Date().toISOString();

    // Flip the UI immediately. A full refetch here re-ran auth + user + queue queries
    // before anything on screen changed, which read as the page "refreshing" on click.
    // The realtime opd_tokens subscription in OPDPage reconciles with the server anyway.
    onTokenPatch?.(token.id, { status: "in_consultation", consultation_start_at: now } as Partial<OpdToken>);

    const { error } = await supabase.from("opd_tokens").update({
      status: "in_consultation",
      called_at: now,
      consultation_start_at: now,
    }).eq("id", token.id);

    if (error) {
      // Roll the optimistic change back so the button doesn't lie about the real state.
      onTokenPatch?.(token.id, { status: token.status, consultation_start_at: token.consultation_start_at } as Partial<OpdToken>);
      toast({ title: "Could not start the consultation", description: error.message, variant: "destructive" });
      return;
    }

    // No onTokenPatch available (older caller) — fall back to the refetch path.
    if (!onTokenPatch) onTokenUpdate();
  };

  /**
   * Reopens a finalized consultation. Same-day follow-through is routine — the patient
   * goes for labs/imaging and comes back with reports — and a completed token previously
   * showed no action at all, stranding the doctor with no way back in.
   * Re-completing is safe: the consultation fee is guarded by opd_encounters.consultation_billed,
   * the bill line by its source_dedupe_key, and the MRD row by an existence check.
   */
  const handleResumeConsultation = async () => {
    if (!token) return;

    onTokenPatch?.(token.id, { status: "in_consultation", consultation_end_at: null } as Partial<OpdToken>);

    const { error } = await supabase.from("opd_tokens").update({
      status: "in_consultation",
      consultation_end_at: null,
    }).eq("id", token.id);

    if (error) {
      onTokenPatch?.(token.id, { status: token.status, consultation_end_at: token.consultation_end_at } as Partial<OpdToken>);
      toast({ title: "Could not reopen the consultation", description: error.message, variant: "destructive" });
      return;
    }

    if (!onTokenPatch) onTokenUpdate();
    toast({
      title: "Consultation reopened",
      description: "Review the reports, then Complete again when you're done.",
    });
  };

  /**
   * Finalizes a consultation once its encounter row is guaranteed to exist.
   * `encounterId` is a parameter (deliberately shadowing the state of the same name) so
   * every step below acts on the just-saved encounter instead of a stale closure value —
   * on a brand-new consultation the state hasn't updated yet when this runs.
   */
  const finalizeConsultation = async (encounterId: string) => {
    if (!token) return;

    await autoSavePrescription(prescription, encounterId);
    isDirtyRef.current = false;

    // Lab / Radiology handoff — PAYMENT FIRST, ORDER SECOND.
    //
    // Completing a consultation deliberately creates NO lab_orders / radiology_orders row and
    // posts NO charge. The prescription JSON saved just above is the handoff: the Lab and
    // Radiology modules read it through getPendingInvestigations (lib/pendingInvestigations.ts)
    // and list the patient under "Pending from OPD", where the desk runs the Collect Payment
    // wizard in NewLabOrderModal / NewRadiologyOrderModal — one step that takes the cash and
    // creates the order, already paid and billed, in the same transaction.
    //
    // This reverts an attempt to create-and-charge here. Two things went wrong with it:
    //
    //   1. It billed without collecting. postCharge resolves payment_status from admissionId,
    //      which is absent on this path, so every test landed as "pending_payment" on an UNPAID
    //      OPD bill — while the order was simultaneously stamped billing_status:"billed",
    //      billed:true. The lab then drew the sample on the strength of a payment nobody had
    //      taken.
    //   2. It starved the module that was supposed to collect. getPendingInvestigations
    //      subtracts already-ordered tests from the prescription, so the moment this created
    //      the order there was nothing left in "Pending from OPD" to charge for.
    //
    // BUG-P4-009 (OPD orders sat "unbilled" forever, invisible to the lab worklist, which
    // filters .neq("billing_status","unbilled")) is what motivated that attempt. It no longer
    // applies: under payment-first no order row exists to go stale, and every order the lab
    // worklist sees was created paid.
    //
    // IPD is unaffected — IPDWorkspace already branches on the hospital's IPD Ancillary Payment
    // policy (post_paid accrues to the admission bill at commit; pre_paid leaves the items on
    // the prescription for the module to collect on), which is the same contract as this.
    const pendingInvestigations =
      prescription.lab_orders.length + prescription.radiology_orders.length;
    if (pendingInvestigations > 0) {
      toast({
        title: `${pendingInvestigations} investigation(s) sent for billing`,
        description:
          "The order is raised in Lab / Radiology once payment is collected — see “Pending from OPD”.",
      });
    }
    await supabase.from("opd_tokens").update({
      status: "completed",
      consultation_end_at: new Date().toISOString(),
    }).eq("id", token.id);

    // Fire-and-forget ABHA care context linking (non-blocking)
    if (encounterId && hospitalId) {
      supabase.functions.invoke("abdm-auto-link-care-context", {
        body: {
          hospital_id: hospitalId,
          patient_id: token.patient_id,
          event_type: "opd_completed",
          source_id: encounterId,
        },
      }).then(() => {
        if (token.patient?.abha_id) {
          toast({ title: "ABHA record linking initiated" });
        }
      }).catch(() => {});
    }

    // Link OPD bill to encounter_id (bill was created at walk-in without encounter)
    if (encounterId && hospitalId) {
      const today = new Date().toISOString().split("T")[0];
      const { data: opdBill } = await (supabase as any)
        .from("bills")
        .select("id")
        .eq("hospital_id", hospitalId)
        .eq("patient_id", token.patient_id)
        .eq("bill_type", "opd")
        .eq("bill_date", today)
        .is("encounter_id", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (opdBill) {
        await (supabase as any).from("bills").update({
          encounter_id: encounterId,
          updated_at: new Date().toISOString(),
        } as any).eq("id", opdBill.id);
      }
    }

    // Upsert MRD records for this encounter
    if (encounterId && hospitalId) {
      const { data: existingRecord } = await supabase
        .from("medical_records")
        .select("id")
        .eq("hospital_id", hospitalId)
        .eq("patient_id", token.patient_id)
        .eq("visit_id", encounterId)
        .maybeSingle();

      if (!existingRecord) {
        await supabase.from("medical_records").insert({
          hospital_id: hospitalId,
          patient_id: token.patient_id,
          visit_id: encounterId,
          record_type: "opd",
          status: "active",
          destroy_after: new Date(
            Date.now() + ((token as any).is_mlc ? 10 : 3) * 365 * 24 * 3600000
          ).toISOString().split("T")[0],
        });

        await supabase.from("icd_codings").insert({
          hospital_id: hospitalId,
          visit_id: encounterId,
          visit_type: "opd",
          status: "pending",
        });
      }
    }

    // ── Consultation Fee Billing ──────────────────────────────────────────────
    // Idempotency: guarded by opd_encounters.consultation_billed.
    // Runs for EVERY consultation finalization — even if a walk-in bill exists.
    // This is the authoritative consultation charge creation point.
    if (encounterId && hospitalId && userId) {
      try {
        // Check idempotency flag first
        const { data: encounterRow } = await (supabase as any)
          .from("opd_encounters")
          .select("consultation_billed, consultation_bill_id, consultation_fee")
          .eq("id", encounterId)
          .maybeSingle();

        if (!encounterRow?.consultation_billed) {
          const { autoChargeService, MODULE_OPD_CONSULT } = await import("@/lib/serviceBilling");
          const { autoPostJournalEntry } = await import("@/lib/accounting");

          // Priced by the SAME engine the front desk used (@/lib/consultationFee), so the
          // amount posted here can no longer diverge from the amount collected.
          //
          // This block used to run its own ladder with `fee === 500` as a "not resolved yet"
          // sentinel, which meant a doctor legitimately priced at ₹500 fell through to the
          // department and global tiers. It also had no notion of follow-up rates, validity,
          // or emergency pricing, so a follow-up collected at ₹300 was billed here at ₹700.
          //
          // The token's own charged_tier is authoritative: it records what the desk actually
          // charged. Re-deriving the tier from the patient's history would double-count this
          // very visit, since its token row already exists by now.
          const { priceConsultation } = await import("@/lib/consultationFee");
          const priced = await priceConsultation({
            hospitalId,
            patientId: token.patient_id,
            doctorId: token.doctor_id,
            departmentId: token.department_id,
            visitType:
              token.charged_tier === "emergency" ? "emergency"
              : token.charged_tier === "follow_up" ? "followup"
              : "new",
            excludeTokenId: token.id,
          });
          const fee = priced.fee;

          // Find the OPD bill for this encounter.
          // Primary: bill already linked to this encounter (the "link block" above runs first).
          // Fallback: most recent unlinked bill today (handles portal / same-day registration
          //   where auto-save backfill hasn't run yet). Using IS NULL prevents stealing
          //   another patient's bill when the same patient has multiple tokens today.
          const today = new Date().toISOString().split("T")[0];
          let { data: encounterBill } = await (supabase as any)
            .from("bills")
            .select("id")
            .eq("hospital_id", hospitalId)
            .eq("encounter_id", encounterId)
            .eq("bill_type", "opd")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (!encounterBill) {
            ({ data: encounterBill } = await (supabase as any)
              .from("bills")
              .select("id")
              .eq("hospital_id", hospitalId)
              .eq("patient_id", token.patient_id)
              .eq("bill_type", "opd")
              .eq("bill_date", today)
              .is("encounter_id", null)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle());
          }

          let billId = encounterBill?.id;

          if (!billId) {
            // No bill at all — create one (pure follow-up / portal booking)
            // bill_number omitted: the bills BEFORE INSERT trigger (20261008000161) mints it
            // in this transaction, so a failed insert rolls the counter back instead of
            // leaving a hole in the OPD series.
            const { data: newBill } = await (supabase as any).from("bills").insert({
              hospital_id: hospitalId, patient_id: token.patient_id,
              bill_type: "opd", bill_date: today,
              encounter_id: encounterId, bill_status: "final", payment_status: "unpaid",
              subtotal: 0, gst_amount: 0, total_amount: 0,
              patient_payable: 0, balance_due: 0, created_by: userId,
            }).select("id").maybeSingle();
            billId = newBill?.id;
          }

          if (billId && fee > 0) {
            // Always link encounter to bill
            await (supabase as any).from("bills")
              .update({ encounter_id: encounterId })
              .eq("id", billId)
              .is("encounter_id", null);

            // Guard: skip if this bill already has ANY consultation line (walk-in or prior finalization)
            const { data: existingItem } = await (supabase as any)
              .from("bill_line_items")
              .select("id")
              .eq("bill_id", billId)
              .eq("item_type", "consultation")
              .maybeSingle();

            if (!existingItem) {
              await (supabase as any).from("bill_line_items").insert({
                hospital_id:      hospitalId,
                bill_id:          billId,
                description:      "Consultation Fee",
                item_type:        "consultation",
                unit_rate:        fee,
                quantity:         1,
                taxable_amount:   fee,
                gst_percent:      0,
                gst_amount:       0,
                total_amount:     fee,
                service_date:     today,
                source_module:    "opd",
                source_record_id: encounterId,
                source_dedupe_key: `opd_consult:${encounterId}`,
                ordered_by:       userId,
              });

              // Recalculate bill totals only when a new line was actually inserted
              const { recalculateBillTotalsSafe } = await import("@/lib/billTotals");
              await recalculateBillTotalsSafe(billId);

              await autoPostJournalEntry({
                triggerEvent: "bill_finalized_opd", sourceModule: "billing",
                sourceId: billId, amount: fee,
                description: `OPD Consultation - ${token.patient?.full_name}`,
                hospitalId, postedBy: userId,
              });

              toast({ title: `Consultation fee ₹${fee.toLocaleString("en-IN")} added to bill` });
            }
          }

          // Always stamp the flag so the encounter is marked billed regardless of which path created the line
          await (supabase as any).from("opd_encounters").update({
            consultation_billed:  true,
            consultation_bill_id: billId ?? null,
            consultation_fee:     fee,
          }).eq("id", encounterId);
        }
      } catch (billErr) {
        console.error("Consultation billing error (non-blocking):", billErr);
      }
    }

    onTokenUpdate();
    toast({ title: `Consultation complete for ${token.patient?.full_name || "patient"}` });
  };

  const handleComplete = async () => {
    if (!token) return;

    // Validated up front so the doctor always gets feedback. This check used to sit behind
    // an `if (!encounterId) return;` guard, which made Complete a silent no-op on any
    // consultation where nothing had been typed (and so nothing auto-saved) yet.
    if (!encounter.chief_complaint.trim()) {
      toast({ title: "Chief complaint is required", variant: "destructive" });
      return;
    }

    // updatePrescription/addLabOrder arm a 2s debounced autosave (saveTimer) that calls
    // autoSaveEncounter + autoSavePrescription on its own. If Complete is clicked before that
    // timer fires, it survives this function and later runs concurrently with the saves below.
    // autoSavePrescription decides insert-vs-update from the prescriptionId React state, which
    // neither call has updated yet at that point, so both insert — leaving two prescriptions
    // rows for one encounter_id. The reload query uses .maybeSingle(), which then throws on the
    // duplicate and silently falls back to an empty prescription (BUG: chips/orders vanish on
    // reopen). Cancel the pending debounce so completion is the only save that runs.
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = undefined;
    }

    setFinalizing(true);
    try {
      // Save first so a brand-new consultation has a real encounter row to finalize.
      const savedEncounterId = await autoSaveEncounter(encounter);
      if (!savedEncounterId) {
        toast({ title: "Could not save the consultation", description: "Please try again.", variant: "destructive" });
        return;
      }
      await finalizeConsultation(savedEncounterId);
    } catch (err) {
      console.error("Complete consultation error:", err);
      toast({ title: "Could not complete the consultation", description: "Please try again.", variant: "destructive" });
    } finally {
      setFinalizing(false);
    }
  };

  const handleSendWhatsApp = async () => {
    if (!token?.patient?.phone) {
      toast({ title: "Patient phone number not available", variant: "destructive" });
      return;
    }
    const phone = token.patient.phone.replace(/\D/g, "");
    const drugList = prescription.drugs.map((d) => `• ${d.drug_name} - ${d.dose} - ${d.frequency} - ${d.duration_days} days`).join("\n");
    const labList = prescription.lab_orders.map((l) => l.test_name).join(", ");
    const msg = `🏥 *Prescription*\n*Patient:* ${token.patient.full_name}\n📅 ${new Date().toLocaleDateString("en-IN")}\n\n💊 *Medicines:*\n${drugList || "None"}\n\n🔬 *Lab Tests:* ${labList || "None"}\n\n📋 *Advice:* ${prescription.advice_notes || "—"}\n📅 *Review:* ${prescription.review_date || "As needed"}`;
    await sendWhatsApp({ hospitalId: hospitalId ?? "", phone: `91${phone}`, message: msg });
    if (prescriptionId) {
      supabase.from("prescriptions").update({ whatsapp_sent: true }).eq("id", prescriptionId);
    }
  };

  if (!token) {
    return (
      <div className="flex-1 bg-slate-50 flex flex-col items-center justify-center">
        <Stethoscope className="h-12 w-12 text-slate-300 mb-3" />
        <p className="text-base text-slate-400">Select a patient from the queue</p>
        <p className="text-[13px] text-slate-300 mt-1">or register a walk-in to begin</p>
      </div>
    );
  }

  const initials = (token.patient?.full_name || "?")
    .split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  const patientAge = token.patient?.dob
    ? Math.floor((Date.now() - new Date(token.patient.dob).getTime()) / 31557600000)
    : null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-50">
      {role === "doctor" && <OnboardingTour tourKey="doctor_opd_intro" />}
      {/* Patient header bar */}
      <div className="flex-shrink-0 h-[60px] bg-white border-b border-slate-200 px-4 flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-[#1A2F5A] text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
          {initials}
        </div>
        <div className="min-w-0">
          <p className="text-base font-bold text-slate-900 truncate">{token.patient?.full_name}</p>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="bg-slate-100 text-slate-600 px-1.5 py-px rounded">{token.patient?.uhid}</span>
            {patientAge !== null && <span className="text-slate-500">{patientAge}y · {token.patient?.gender || "—"}</span>}
            {token.patient?.blood_group && (
              <span className="bg-red-50 text-red-600 px-1.5 py-px rounded text-[10px]">{token.patient.blood_group}</span>
            )}
          </div>
        </div>

        {/* Allergies */}
        <div className="flex-1 flex items-center gap-1.5 flex-wrap min-w-0 px-2">
          {token.patient?.allergies ? (
            <>
              <span className="text-[10px] font-bold text-red-600">⚠️ Allergies:</span>
              {token.patient.allergies.split(",").map((a, i) => (
                <span key={i} className="text-[10px] bg-red-50 text-red-600 border border-red-200 rounded-full px-2 py-px">{a.trim()}</span>
              ))}
            </>
          ) : (
            <span className="text-[11px] text-slate-400">+ Add allergy</span>
          )}
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs bg-blue-50 text-[#1A2F5A] px-2 py-0.5 rounded font-medium">{token.token_number}</span>
          {/* "called" (patient called into the room but not yet started) also lands here —
              it previously matched no branch, leaving the header with no action at all. */}
          {(token.status === "waiting" || token.status === "called") && (
            <button onClick={handleStartConsultation} className="text-xs bg-[#1A2F5A] text-white px-3 py-1.5 rounded-md font-semibold hover:bg-[#152647] active:scale-[0.97] transition-all">
              ▶ Start Consultation
            </button>
          )}
          {/* Single finalize action for the consultation. Carries the `complete_and_bill`
              permission that used to gate the separate bottom-bar "Complete & Bill" button —
              completing a consultation is what creates the consultation charge. */}
          {token.status === "in_consultation" && hasActionAccess("opd", "complete_and_bill", permissions, role) && (
            <button
              onClick={handleComplete}
              disabled={finalizing}
              className="text-xs bg-emerald-500 text-white px-3 py-1.5 rounded-md font-semibold hover:bg-emerald-600 active:scale-[0.97] transition-all disabled:opacity-50 disabled:pointer-events-none"
            >
              {finalizing ? "Completing…" : "✓ Complete"}
            </button>
          )}
          {/* Reopen a finalized visit — for the patient who returns the same day with reports. */}
          {token.status === "completed" && hasActionAccess("opd", "complete_and_bill", permissions, role) && (
            <button
              onClick={handleResumeConsultation}
              title="Reopen this consultation to review reports and finalize again"
              className="text-xs border border-[#1A2F5A] text-[#1A2F5A] px-3 py-1.5 rounded-md font-semibold hover:bg-[#1A2F5A]/5 active:scale-[0.97] transition-all"
            >
              ↻ Resume Consultation
            </button>
          )}
          {token && (
            <button onClick={() => setShowReferralModal(true)}
              className="text-xs border border-slate-200 text-slate-600 hover:bg-slate-50 px-3 py-1.5 rounded-md font-medium flex items-center gap-1.5 active:scale-[0.97] transition-all">
              <SendHorizonal className="h-3 w-3" /> Refer
            </button>
          )}
         {token && onTogglePatientDetails && !showPatientDetails && (
            <button
              onClick={onTogglePatientDetails}
              className="text-xs border border-slate-200 text-slate-600 hover:bg-slate-50 px-3 py-1.5 rounded-md font-medium flex items-center gap-1.5 active:scale-[0.97] transition-all"
            >
              <User className="h-3 w-3" /> Patient Details
            </button>
          )}
         </div>
      </div>

      {/* Tab strip */}
      <div className="flex-shrink-0 h-12 bg-white border-b border-slate-200 flex">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "px-5 h-full text-[13px] border-b-2 transition-colors",
              activeTab === tab.key
                ? "border-[#1A2F5A] text-[#1A2F5A] font-semibold"
                : "border-transparent text-slate-500 hover:text-slate-700"
            )}
          >
            {tab.label}
            {/* Results that have landed but not been read. This is what replaces the doctor
                having to remember to go and check the Lab module. */}
            {tab.key === "investigations" && unreviewedResults > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-600 text-white text-[11px] font-bold align-middle">
                {unreviewedResults > 9 ? "9+" : unreviewedResults}
              </span>
            )}
          </button>
        ))}
        {/* Save indicator */}
        <div className="ml-auto flex items-center pr-4 gap-1">
          {saving && <span className="text-[11px] text-slate-400">Saving...</span>}
          {saved && <span className="text-[11px] text-emerald-500 flex items-center gap-1"><CheckCircle className="h-3 w-3" /> Saved</span>}
        </div>
      </div>

      {/* Overdue follow-up banner */}
      {token && <OverdueFollowupBanner patientId={token.patient_id} />}

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "complaint" && <ComplaintTab encounter={encounter} onChange={updateEncounter} />}
        {activeTab === "vitals" && <VitalsTab encounter={encounter} onChange={updateEncounter} />}
        {activeTab === "examination" && (
          <ExaminationTab encounter={encounter} onChange={updateEncounter} encounterId={encounterId} hospitalId={hospitalId} patientId={token?.patient_id ?? null} userId={userId} seedDiagnosis={diagnosisSeed} />
        )}
        {activeTab === "investigations" && hospitalId && token?.patient_id && (
          // encounterId is created lazily on first save, so it can still be null here — the
          // panel falls back to patient scope rather than showing an empty tab.
          <InvestigationResultsPanel
            hospitalId={hospitalId}
            patientId={token.patient_id}
            encounterId={encounterId}
            currentUserId={userId}
          />
        )}
        {activeTab === "guidance" && (
          <div className="h-full overflow-y-auto p-4 space-y-4">
            {/* AI Differential Diagnosis — needs a chief complaint */}
            {hospitalId && encounter.chief_complaint ? (
              <DifferentialDiagnosisPanel
                chiefComplaint={encounter.chief_complaint}
                examination={encounter.examination_notes}
                history={encounter.history_of_present_illness}
                vitals={encounter.vitals as Record<string, any>}
                age={patientAge ?? undefined}
                gender={token?.patient?.gender ?? undefined}
                // The digest rides on the EXISTING patientContext prop rather than a new one:
                // the differential already treats this field as "everything else known about
                // the patient", which is exactly what the outside records are.
                patientContext={
                  [
                    token?.patient?.chronic_conditions?.length
                      ? `Known chronic conditions: ${token.patient.chronic_conditions.join(", ")}`
                      : null,
                    historyDigestText,
                  ].filter(Boolean).join("\n\n") || undefined
                }
                hospitalId={hospitalId}
                patientId={token?.patient_id ?? null}
                encounterId={encounterId}
                refreshSignal={ddxRefreshSignal}
                onSelectDiagnosis={(diagnosis, icd10) =>
                  updateEncounter({ diagnosis, icd10_code: icd10 })
                }
              />
            ) : (
              <div className="border rounded-lg px-3 py-2.5 bg-muted/30 flex items-center gap-2">
                <Stethoscope className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Enter a chief complaint to generate AI differential diagnosis.</span>
              </div>
            )}

            {/* Clarifying Questions — narrows the case BEFORE a diagnosis exists, which is
                the gap the other two cards leave. Needs only a chief complaint. */}
            {hospitalId && encounter.chief_complaint ? (
              <ClarifyingQuestionsPanel
                encounter={encounter}
                onChange={updateEncounter}
                hospitalId={hospitalId}
                patientId={token?.patient_id ?? null}
                encounterId={encounterId}
                age={patientAge ?? undefined}
                gender={token?.patient?.gender ?? undefined}
                allergies={token?.patient?.allergies ?? undefined}
                chronicConditions={token?.patient?.chronic_conditions?.join(", ") || undefined}
                voiceTranscript={scribeTranscript}
                // Stops it asking "have you been diagnosed with diabetes?" when a 2023
                // discharge summary in the patient's bag already says so — that lands under
                // already_known instead, which is what makes the card feel like it read the chart.
                priorHistoryDigest={historyDigestText}
                onRefineDdx={() => setDdxRefreshSignal((n) => n + 1)}
              />
            ) : (
              <div className="border rounded-lg px-3 py-2.5 bg-muted/30 flex items-center gap-2">
                <Stethoscope className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Enter a chief complaint to generate clarifying questions.</span>
              </div>
            )}

            {/* Clinical Guidance — needs a diagnosis */}
            {encounter.diagnosis && hospitalId ? (
              <ClinicalDecisionSupport
                diagnosis={encounter.diagnosis}
                icdCode={encounter.icd10_code || ""}
                patientAge={patientAge || undefined}
                patientGender={token?.patient?.gender || undefined}
                // Problems documented in outside records are comorbidities whether or not
                // anyone at this hospital has typed them into the chronic-conditions chips yet.
                comorbidities={digestComorbidities(historyDigest, token?.patient?.chronic_conditions ?? [])}
                // First-line treatment has to account for what the patient is already on and
                // what has already failed — both of which live only in the outside records.
                priorHistory={historyDigestText}
                hospitalId={hospitalId}
                onAddLabOrder={addLabOrder}
              />
            ) : (
              <div className="border rounded-lg px-3 py-2.5 bg-muted/30 flex items-center gap-2">
                <Stethoscope className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Add a diagnosis to see clinical treatment guidance (first-line treatment, investigations, drug cautions, red flags).</span>
              </div>
            )}
          </div>
        )}
        {/* encounterId, patientId and userId are all load-bearing, not decorative:
            encounterId drives the "BILLED & ORDERED" confirmation chips (they could never
            appear while it was unset), and patientId/userId are what attach a drug-safety
            override to the patient and the prescriber (BUG-P4-004). */}
        {activeTab === "rx_orders" && <RxOrdersTab prescription={prescription} onChange={updatePrescription} hospitalId={hospitalId} patientAllergies={token?.patient?.allergies ? token.patient.allergies.split(",").map(a => a.trim()) : []} diagnosis={encounter.diagnosis} icdCode={encounter.icd10_code} patientAge={patientAge || undefined} patientGender={token?.patient?.gender || undefined} encounterId={encounterId} patientId={token?.patient_id ?? null} userId={userId} />}
        {activeTab === "plan_advice" && <PlanAdviceTab prescription={prescription} onChange={updatePrescription} encounter={encounter} onEncounterChange={updateEncounter} />}
        {activeTab === "history" && (
          <HistoryTab
            token={token}
            encounterId={encounterId}
            userId={userId ?? ""}
            onInsertToHpi={insertHistoryDigestToHpi}
            onDigestChange={refreshHistoryDigest}
          />
        )}
        {activeTab === "specialty" && specialty === 'obstetric' && hospitalId && (
          <ObstetricSheet patientId={token.patient_id} hospitalId={hospitalId} encounterId={encounterId} />
        )}
        {activeTab === "specialty" && specialty === 'neonatal' && hospitalId && (
          <NeonatalSheet patientId={token.patient_id} hospitalId={hospitalId} encounterId={encounterId} />
        )}
        {activeTab === "specialty" && specialty === 'anaesthesia' && hospitalId && (
          <AnaesthesiaSheet patientId={token.patient_id} hospitalId={hospitalId} encounterId={encounterId} />
        )}
        {activeTab === "specialty" && specialty === 'ophthalmology' && hospitalId && (
          <OphthalmologySheet patientId={token.patient_id} hospitalId={hospitalId} encounterId={encounterId} />
        )}
      </div>

      {/* Bottom action bar */}
      <div data-tour="doctor-consult-actions" className="flex-shrink-0 h-14 bg-white border-t border-slate-200 px-4 flex items-center gap-2">
        <button onClick={() => autoSaveEncounter(encounter)} className="text-xs text-slate-600 border border-slate-200 px-3 py-1.5 rounded-md hover:bg-slate-50 flex items-center gap-1.5 active:scale-[0.97] transition-all">
          <Save className="h-3.5 w-3.5" /> Save Draft
        </button>
        {/* "Complete & Bill" removed — it duplicated the header's Complete button
            (same handleComplete, which already creates the consultation charge). */}
        <VoiceDictationButton sessionType="opd_consultation" patientId={token.patient_id} size="sm" />
        <ClinicalCalculatorPanel onInsertToNote={(text) => {
          window.dispatchEvent(new CustomEvent("insert-clinical-note", { detail: text }));
        }} />
        <div className="flex-1" />
        {hasActionAccess("opd", "admit_patient", permissions, role) && (
          <button onClick={() => {
            if (!token?.patient_id) { toast({ title: "Select a patient first", variant: "destructive" }); return; }
            setShowAdmitModal(true);
          }} className="text-xs text-slate-600 border border-slate-200 px-3 py-1.5 rounded-md hover:bg-slate-50 flex items-center gap-1.5 active:scale-[0.97] transition-all">
            <Building2 className="h-3.5 w-3.5" /> Admit
          </button>
        )}
        {hasActionAccess("opd", "refer_physio", permissions, role) && (
          <button onClick={async () => {
            if (!token || !hospitalId || !userId) return;
            // The encounter autosave is debounced (see saveTimer above), so a referral made
            // right after typing can race a still-pending save and land with no encounter
            // link. Force the save first and use its returned id, same as handleComplete does.
            const savedEncounterId = encounterId || (await autoSaveEncounter(encounter));
            const { error } = await supabase.from("physio_referrals").insert({
              hospital_id: hospitalId,
              patient_id: token.patient_id,
              opd_encounter_id: savedEncounterId || undefined,
              referred_by: userId,
              diagnosis: encounter.diagnosis || encounter.chief_complaint || "Physiotherapy referral",
              goals: [],
              urgency: "routine",
            } as any);
            if (error) { toast({ title: "Referral failed", description: error.message, variant: "destructive" }); return; }
            toast({ title: "↗ Referred to Physiotherapy" });
          }} className="text-xs text-teal-700 border border-teal-300 px-3 py-1.5 rounded-md hover:bg-teal-50 flex items-center gap-1.5 active:scale-[0.97] transition-all">
            <ArrowUpRight className="h-3.5 w-3.5" /> Refer Physio
          </button>
        )}
        {hasActionAccess("opd", "send_rx", permissions, role) && (
          <button onClick={handleSendWhatsApp} className="text-xs text-slate-600 border border-slate-200 px-3 py-1.5 rounded-md hover:bg-slate-50 flex items-center gap-1.5 active:scale-[0.97] transition-all">
            <Smartphone className="h-3.5 w-3.5" /> Send Rx
          </button>
        )}
        {/* Language selector for bilingual prescription print */}
        {availablePrintLangs.length > 1 && (
          <select
            value={printLang}
            onChange={async (e) => {
              const lang = e.target.value;
              setPrintLang(lang);
              setTranslatedAdvice("");
              if (lang !== "English" && prescription.advice_notes?.trim()) {
                setTranslatingAdvice(true);
                try {
                  const translated = await translateText(prescription.advice_notes, lang, hospitalId ?? "", {
                    context: "patient_prescription_advice",
                    patientId: token?.patient_id ?? undefined,
                  });
                  setTranslatedAdvice(translated);
                } catch {
                  toast({ title: "Translation failed", variant: "destructive" });
                } finally {
                  setTranslatingAdvice(false);
                }
              }
            }}
            className="text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-700 h-[30px] focus:outline-none focus:ring-1 focus:ring-slate-400"
            title="Print prescription advice in this language"
          >
            {availablePrintLangs.map((lang) => {
              const meta = ALL_PATIENT_LANGUAGES.find((l) => l.code === lang);
              return (
                <option key={lang} value={lang}>
                  {meta?.native !== meta?.label ? `${meta?.native} ${lang}` : lang}
                </option>
              );
            })}
          </select>
        )}
        <button
          onClick={handlePrintPrescription}
          disabled={translatingAdvice}
          className="text-xs bg-slate-800 text-white px-3 py-1.5 rounded-md hover:bg-slate-900 flex items-center gap-1.5 active:scale-[0.97] transition-all disabled:opacity-50"
        >
          <Printer className="h-3.5 w-3.5" />
          {translatingAdvice ? "Translating…" : printLang !== "English" && translatedAdvice ? `Print (EN + ${printLang})` : "Print Rx"}
        </button>
      </div>
      {showAdmitModal && token && hospitalId && (
        <AdmitPatientModal
          open={showAdmitModal}
          onClose={() => setShowAdmitModal(false)}
          hospitalId={hospitalId}
          preselectedPatientId={token.patient_id}
          preselectedPatientName={token.patient?.full_name || ""}
          onAdmitted={() => {
            setShowAdmitModal(false);
            toast({ title: "Patient admitted to IPD successfully" });
            onTokenUpdate();
          }}
        />
      )}
      {showReferralModal && token && hospitalId && (
        <ReferralLetterModal
          open={showReferralModal}
          onClose={() => setShowReferralModal(false)}
          hospitalId={hospitalId}
          patientName={token.patient?.full_name || ""}
          patientUhid={token.patient?.uhid || ""}
          chiefComplaint={encounter?.chief_complaint || ""}
          diagnosis={encounter?.soap_assessment || encounter?.chief_complaint || ""}
          doctorName={token.doctor?.full_name || ""}
          encounterId={encounterId || undefined}
        />
      )}
    </div>
  );
};

export default ConsultationWorkspace;
