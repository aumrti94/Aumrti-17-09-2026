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

export interface LabOrder {
  test_name: string;
  urgency: string;
  clinical_indication: string;
  availability?: OrderAvailability;
  /** lab_test_master.id (or lab_test_groups.id for a panel) once resolved. */
  catalogue_id?: string;
}

export interface RadiologyOrder {
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
  soap_assessment: "", soap_plan: "", diagnosis: "", icd10_code: "",
  follow_up_date: "", follow_up_notes: "",
  ai_clarifying_questions: null,
};

const emptyPrescription: PrescriptionData = {
  drugs: [], lab_orders: [], radiology_orders: [],
  advice_notes: "", review_date: "", is_signed: false,
};

const BASE_TABS = [
  { key: "complaint", label: "Complaint" },
  { key: "vitals", label: "Vitals" },
  { key: "examination", label: "Examination" },
  { key: "guidance", label: "AI Guidance" },
  { key: "rx_orders", label: "Rx & Orders" },
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

  // Load encounter when token changes
  useEffect(() => {
    if (!token || !hospitalId || !userId) {
      setEncounter(emptyEncounter);
      setPrescription(emptyPrescription);
      setEncounterId(null);
      setPrescriptionId(null);
      setDiagnosisSeed(null);
      return;
    }
    if (token.id === prevTokenId.current) return;
    prevTokenId.current = token.id;
    isDirtyRef.current = false;
    setDiagnosisSeed(null);

    (async () => {
      // Fetch existing encounter for this token
      const { data: enc } = await supabase
        .from("opd_encounters")
        .select("*")
        .eq("token_id", token.id)
        .maybeSingle();

      if (enc) {
        setEncounterId(enc.id);
        setEncounter({
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
          follow_up_date: enc.follow_up_date || "",
          follow_up_notes: enc.follow_up_notes || "",
          ai_clarifying_questions:
            (enc.ai_clarifying_questions as unknown as ClarifyingQuestionsState | null) ?? null,
        });

        // Fetch prescription
        const { data: rx } = await supabase
          .from("prescriptions")
          .select("*")
          .eq("encounter_id", enc.id)
          .maybeSingle();
        if (rx) {
          setPrescriptionId(rx.id);
          setPrescription({
            drugs: (rx.drugs as unknown as DrugEntry[]) || [],
            lab_orders: (rx.lab_orders as unknown as LabOrder[]) || [],
            radiology_orders: (rx.radiology_orders as unknown as RadiologyOrder[]) || [],
            advice_notes: rx.advice_notes || "",
            review_date: rx.review_date || "",
            is_signed: rx.is_signed || false,
          });
        } else {
          setPrescription(emptyPrescription);
          setPrescriptionId(null);
        }
      } else {
        setEncounter(emptyEncounter);
        setPrescription(emptyPrescription);
        setEncounterId(null);
        setPrescriptionId(null);
      }
    })();
  }, [token, hospitalId, userId]);

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
        const { data: newEnc } = await supabase.from("opd_encounters").insert([payload] as never).select("id").maybeSingle();
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
        await supabase.from("prescriptions").update(payload as never).eq("id", prescriptionId);
      } else {
        const { data: newRx } = await supabase.from("prescriptions").insert([payload] as never).select("id").maybeSingle();
        if (newRx) setPrescriptionId(newRx.id);
      }
    } catch (err) {
      console.error("Prescription save error:", err);
    }
  }, [token, hospitalId, userId, encounterId, prescriptionId]);

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

  const handlePrintPrescription = () => {
    if (!token || !hospitalInfo) {
      toast({ title: "Hospital details not found", variant: "destructive" });
      return;
    }
    logRecordAccess({ hospitalId, recordType: "OPD_Record", recordId: token.id, patientId: token.patient_id, action: "print" });

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

    const labHtml = prescription.lab_orders.length > 0
      ? `<div class="section-title">Lab Orders</div><ul style="margin:0;padding-left:20px;">${prescription.lab_orders.map(l => `<li>${l.test_name}</li>`).join("")}</ul>`
      : "";
    const radHtml = prescription.radiology_orders.length > 0
      ? `<div class="section-title" style="margin-top:10px;">Radiology Orders</div><ul style="margin:0;padding-left:20px;">${prescription.radiology_orders.map(r => `<li>${r.study_name}</li>`).join("")}</ul>`
      : "";
    const investigationsHtml = labHtml || radHtml ? `${labHtml}${radHtml}` : "";

    const vitalsHtml = Object.entries(encounter.vitals).length > 0
      ? `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:15px;background:#f8fafc;padding:10px;border-radius:4px;border:1px solid #e2e8f0;">
          ${Object.entries(encounter.vitals).map(([k, v]) => `<div><span class="label" style="text-transform:capitalize">${k}:</span> <b>${v}</b></div>`).join("")}
        </div>`
      : "";

    const body = `
      ${printHeader(hospitalInfo.name, "OPD PRESCRIPTION", `<p style="font-size:12px;color:#64748b;margin:2px 0;">${hospitalInfo.address || ""}</p>`)}
      
      <div style="display:flex;justify-content:space-between;border-bottom:1px solid #e2e8f0;padding-bottom:10px;margin-bottom:20px;">
        <div style="flex:1">
          <div style="margin-bottom:4px;"><span class="label">Patient:</span> <b>${token.patient?.full_name}</b></div>
          <div style="margin-bottom:4px;"><span class="label">UHID:</span> <b>${token.patient?.uhid}</b></div>
          <div style="margin-bottom:4px;"><span class="label">Age/Sex:</span> <span>${token.patient?.dob ? Math.floor((Date.now() - new Date(token.patient.dob).getTime()) / 31557600000) : "--"}y / ${token.patient?.gender || "--"}</span></div>
        </div>
        <div style="text-align:right;flex:1">
          <div style="margin-bottom:4px;"><span class="label">Date:</span> <b>${new Date().toLocaleDateString("en-IN")}</b></div>
          <div style="margin-bottom:4px;"><span class="label">Doctor:</span> <b>${token.doctor?.full_name || "Dr. Consultation"}</b></div>
          <div style="margin-bottom:4px;"><span class="label">Dept:</span> <span>${deptName || "--"}</span></div>
        </div>
      </div>

      ${vitalsHtml}

      <div class="section-title">Clinical Notes</div>
      <div style="margin-bottom:15px;line-height:1.5;">
        <p style="margin:4px 0;"><span class="label">Chief Complaint:</span> ${encounter.chief_complaint || "--"}</p>
        ${encounter.history_of_present_illness ? `<p style="margin:4px 0 0 0;"><span class="label">History of Present Illness:</span></p><div style="white-space:pre-wrap;margin:0 0 4px 0;">${encounter.history_of_present_illness}</div>` : ""}
        ${encounter.soap_assessment ? `<p style="margin:4px 0;"><span class="label">Assessment:</span> ${encounter.soap_assessment}</p>` : ""}
        ${encounter.diagnosis ? `<p style="margin:4px 0;"><span class="label">Diagnosis:</span> <b>${encounter.diagnosis}</b> ${encounter.icd10_code ? `(${encounter.icd10_code})` : ""}</p>` : ""}
      </div>

      <div class="section-title">Rx (Prescription)</div>
      ${drugsHtml}

      ${investigationsHtml}

      ${encounter.soap_plan
          ? `<div class="section-title" style="margin-top:10px;">Plan &amp; Investigations</div><div style="white-space:pre-wrap;background:#f8fafc;padding:10px;border-radius:4px;border:1px solid #e2e8f0;">${encounter.soap_plan}</div>`
          : ""}

      ${prescription.advice_notes
          ? translatedAdvice && printLang !== "English"
            ? buildBilingualHtml(prescription.advice_notes, translatedAdvice, printLang, ALL_PATIENT_LANGUAGES.find(l => l.code === printLang)?.native || printLang)
            : `<div class="section-title">Advice & Instructions</div><div style="white-space:pre-wrap;background:#f8fafc;padding:10px;border-radius:4px;border:1px solid #e2e8f0;">${prescription.advice_notes}</div>`
          : ""}

      ${(() => {
        const reviewDate = prescription.review_date || encounter.follow_up_date;
        return (encounter.follow_up_notes || reviewDate) ? `<div style="margin-top:20px;padding:10px;border:1px dashed #1A2F5A;border-radius:4px;background:#f0f7ff;">
        <b style="color:#1A2F5A">Follow-up</b>
        ${reviewDate ? `<span style="margin-left:6px;color:#1A2F5A;">Review date: ${new Date(reviewDate).toLocaleDateString("en-IN")}</span>` : ""}
        ${encounter.follow_up_notes ? `<p style="margin-top:5px;font-size:12px;color:#475569;white-space:pre-wrap;">${encounter.follow_up_notes}</p>` : ""}
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
            keepRads.push({ study_name: r.name, urgency: l.urgency, clinical_indication: l.clinical_indication, availability: "in_stock", catalogue_id: r.catalogueId ?? undefined });
          } else {
            keepLabs.push({ ...l, test_name: r.name, catalogue_id: r.catalogueId ?? undefined, availability: r.offered ? "in_stock" : "not_stocked" });
          }
        }
        for (const rad of prev.radiology_orders) {
          const r = addedRadNames.has(rad.study_name) && rad.availability === "unresolved"
            ? byDictated.get(rad.study_name) : null;
          if (!r) { keepRads.push(rad); continue; }
          if (r.kind === "lab" || r.kind === "lab_group") {
            keepLabs.push({ test_name: r.name, urgency: rad.urgency, clinical_indication: rad.clinical_indication, availability: "in_stock", catalogue_id: r.catalogueId ?? undefined });
          } else {
            keepRads.push({ ...rad, study_name: r.name, catalogue_id: r.catalogueId ?? undefined, availability: r.offered ? "in_stock" : "not_stocked" });
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
  const addLabOrder = useCallback((name: string) => {
    if (!name.trim()) return;
    setPrescription((prev) => {
      // Case-insensitive so "Fever Profile" can't be added alongside "fever profile".
      if (prev.lab_orders.some((l) => l.test_name.trim().toLowerCase() === name.trim().toLowerCase())) return prev;
      const next = { ...prev, lab_orders: [...prev.lab_orders, { test_name: name, urgency: "routine", clinical_indication: "" }] };
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

    // Soft reminder if doctor has pending lab/radiology orders in the prescription JSON.
    // Lab/Radiology orders are created through the billing flow (New Lab Order / New Radiology Order)
    // after payment — they should NOT be auto-created here.
    const pendingLabCount = prescription.lab_orders.length;
    const pendingRadCount = prescription.radiology_orders.length;
    if (pendingLabCount > 0 || pendingRadCount > 0) {
      const parts: string[] = [];
      if (pendingLabCount > 0) parts.push(`${pendingLabCount} lab test(s)`);
      if (pendingRadCount > 0) parts.push(`${pendingRadCount} radiology study(s)`);
      toast({
        title: `Reminder: ${parts.join(" and ")} in prescription`,
        description: "Ensure billing has collected payment and created the lab/radiology orders.",
      });
    }

    await autoSavePrescription(prescription, encounterId);
    isDirtyRef.current = false;
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

          // Rate lookup priority: doctor → department → global → ₹500 fallback
          let fee = 500;
          if (token.doctor_id) {
            const { data: docSvc } = await (supabase as any).from("service_master").select("fee")
              .eq("hospital_id", hospitalId).eq("item_type", "consultation").eq("is_active", true)
              .eq("doctor_id", token.doctor_id).limit(1).maybeSingle();
            if (docSvc?.fee) fee = Number(docSvc.fee);
          }
          if (fee === 500 && token.department_id) {
            const { data: deptSvc } = await (supabase as any).from("service_master").select("fee")
              .eq("hospital_id", hospitalId).eq("item_type", "consultation").eq("is_active", true)
              .eq("department_id", token.department_id).is("doctor_id", null).limit(1).maybeSingle();
            if (deptSvc?.fee) fee = Number(deptSvc.fee);
          }
          if (fee === 500) {
            const { data: globalSvc } = await (supabase as any).from("service_master").select("fee")
              .eq("hospital_id", hospitalId).eq("item_type", "consultation").eq("is_active", true)
              .is("doctor_id", null).is("department_id", null).limit(1).maybeSingle();
            if (globalSvc?.fee) fee = Number(globalSvc.fee);
          }

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
        {activeTab === "rx_orders" && <RxOrdersTab prescription={prescription} onChange={updatePrescription} hospitalId={hospitalId} patientAllergies={token?.patient?.allergies ? token.patient.allergies.split(",").map(a => a.trim()) : []} diagnosis={encounter.diagnosis} icdCode={encounter.icd10_code} patientAge={patientAge || undefined} patientGender={token?.patient?.gender || undefined} />}
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
            const { error } = await supabase.from("physio_referrals").insert({
              hospital_id: hospitalId,
              patient_id: token.patient_id,
              opd_encounter_id: encounterId || undefined,
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
