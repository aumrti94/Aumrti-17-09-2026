import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { callAI } from "@/lib/aiProvider";
import { autoChargeService, MODULE_MORTUARY } from "@/lib/serviceBilling";
import { useHospitalId } from "@/hooks/useHospitalId";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { format, differenceInDays } from "date-fns";
import { Loader2 } from "lucide-react";
import PatientSearchPicker from "@/components/shared/PatientSearchPicker";
import PatientRegistrationModal from "@/components/patients/PatientRegistrationModal";

interface MortuaryAdmission {
  id: string;
  body_number: string;
  time_of_death: string;
  cause_of_death: string;
  manner_of_death: string;
  is_mlc: boolean;
  storage_slot: string | null;
  status: string;
  admitted_at: string;
  released_at: string | null;
  patient_id: string;
  admission_id: string | null;
  notes: string | null;
  pronounced_by: string;
}

interface MLCRecord {
  id: string;
  mlc_number: string;
  patient_id: string;
  incident_type: string;
  incident_date: string | null;
  incident_location: string | null;
  police_station: string | null;
  officer_name: string | null;
  officer_badge: string | null;
  fir_number: string | null;
  intimated_at: string | null;
  forensic_sample_collected: boolean;
  forensic_samples: string[];
  injury_description: string | null;
  post_mortem_requested: boolean;
  status: string;
  mortuary_id: string | null;
}

interface MCCDCert {
  id: string;
  mortuary_id: string;
  patient_id: string;
  cause_1a: string;
  cause_1b: string | null;
  cause_1c: string | null;
  cause_part2: string | null;
  approximate_interval_1a: string | null;
  approximate_interval_1b: string | null;
  approximate_interval_1c: string | null;
  icd_code_underlying: string | null;
  manner_of_death: string;
  was_post_mortem: boolean;
  certifying_doctor: string;
  mccd_number: string | null;
  issued_at: string | null;
  ai_draft: boolean;
}

interface BodyRelease {
  id: string;
  mortuary_id: string;
  released_to: string;
  relation: string;
  id_proof_type: string;
  id_proof_number: string | null;
  released_at: string;
  police_clearance: boolean;
  mccd_issued: boolean;
  documents_given: string[];
}

interface OrganDonation {
  id: string;
  mortuary_id: string;
  patient_id: string;
  notto_ref: string | null;
  brain_death_certified: boolean;
  brain_death_date: string | null;
  brain_death_doctors: string[];
  family_counselled: boolean;
  family_consent: boolean;
  consent_date: string | null;
  organs_pledged: string[];
  outcome: string | null;
}

export default function MortuaryPage() {
  const { hospitalId, loading: hospitalLoading } = useHospitalId();
  const [tab, setTab] = useState("register");
  const [admissions, setAdmissions] = useState<MortuaryAdmission[]>([]);
  const [mlcRecords, setMlcRecords] = useState<MLCRecord[]>([]);
  const [mccdCerts, setMccdCerts] = useState<MCCDCert[]>([]);
  const [releases, setReleases] = useState<BodyRelease[]>([]);
  const [donations, setDonations] = useState<OrganDonation[]>([]);
  const [patients, setPatients] = useState<any[]>([]);
  const [doctors, setDoctors] = useState<any[]>([]);
  const [admitModal, setAdmitModal] = useState(false);
  const [mlcModal, setMlcModal] = useState(false);
  const [releaseModal, setReleaseModal] = useState(false);
  const [mccdForm, setMccdForm] = useState<string | null>(null);
  const [organModal, setOrganModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showPatientReg, setShowPatientReg] = useState<"admit" | "mlc" | null>(null);

  // Form states
  const [admitForm, setAdmitForm] = useState({
    patient_id: "", time_of_death: "", pronounced_by: "", cause_of_death: "",
    manner_of_death: "natural", is_mlc: false, storage_slot: "", notes: ""
  });
  const [mlcForm, setMlcForm] = useState({
    patient_id: "", mortuary_id: "", incident_type: "rta", incident_date: "",
    incident_location: "", police_station: "", officer_name: "", officer_badge: "",
    injury_description: "", forensic_samples: [] as string[],
  });
  const [mccdDraft, setMccdDraft] = useState({
    cause_1a: "", cause_1b: "", cause_1c: "", cause_part2: "",
    interval_1a: "", interval_1b: "", interval_1c: "",
    icd_code: "", manner_of_death: "natural", was_post_mortem: false,
    certifying_doctor: ""
  });
  const [releaseForm, setReleaseForm] = useState({
    mortuary_id: "", released_to: "", relation: "", id_proof_type: "Aadhaar",
    id_proof_number: "", police_clearance: false, mccd_issued: false,
    documents_given: [] as string[], witness_name: ""
  });
  const [organForm, setOrganForm] = useState({
    mortuary_id: "", patient_id: "", brain_death_certified: false,
    brain_death_date: "", brain_death_doctors: [] as string[],
    family_counselled: false, family_consent: false, consent_date: "",
    organs_pledged: [] as string[], notto_ref: ""
  });
  const [aiLoading, setAiLoading] = useState(false);
  const [policeLetterModal, setPoliceLetterModal] = useState<string | null>(null);

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    const [a, m, mc, r, d, doc] = await Promise.all([
      supabase.from("mortuary_admissions").select("*").eq("hospital_id", hospitalId).order("admitted_at", { ascending: false }),
      supabase.from("mlc_records").select("*").eq("hospital_id", hospitalId).order("created_at", { ascending: false }),
      supabase.from("mccd_certificates").select("*").eq("hospital_id", hospitalId).order("created_at", { ascending: false }),
      supabase.from("body_releases").select("*").eq("hospital_id", hospitalId).order("released_at", { ascending: false }),
      supabase.from("organ_donations").select("*").eq("hospital_id", hospitalId).order("created_at", { ascending: false }),
      supabase.from("users").select("id, full_name, role").eq("hospital_id", hospitalId),
    ]);
    if (a.error) { console.error("mortuary_admissions load error:", a.error.message); toast.error("Failed to load mortuary records"); }
    if (m.error) console.error("mlc_records load error:", m.error.message);
    if (mc.error) console.error("mccd_certificates load error:", mc.error.message);
    if (r.error) console.error("body_releases load error:", r.error.message);
    if (d.error) console.error("organ_donations load error:", d.error.message);
    if (a.data) setAdmissions(a.data as any);
    if (m.data) setMlcRecords(m.data as any);
    if (mc.data) setMccdCerts(mc.data as any);
    if (r.data) setReleases(r.data as any);
    if (d.data) setDonations(d.data as any);
    if (doc.data) setDoctors(doc.data);
    // Load patient names for display in tables (for already-linked records)
    const patientIds = new Set<string>();
    if (a.data) a.data.forEach((x: any) => patientIds.add(x.patient_id));
    if (m.data) m.data.forEach((x: any) => patientIds.add(x.patient_id));
    if (d.data) d.data.forEach((x: any) => patientIds.add(x.patient_id));
    if (mc.data) mc.data.forEach((x: any) => patientIds.add(x.patient_id));
    const ids = Array.from(patientIds).filter(Boolean);
    if (ids.length > 0) {
      const { data: pData } = await supabase.from("patients").select("id, full_name, uhid, gender, dob, phone").in("id", ids);
      if (pData) setPatients(pData);
    } else {
      setPatients([]);
    }
  };

  const getPatient = (id: string) => patients.find(p => p.id === id);
  const getDoctor = (id: string) => doctors.find(d => d.id === id);

  // KPIs
  const inMortuary = admissions.filter(a => a.status === "in_mortuary").length;
  const mlcOpen = mlcRecords.filter(m => m.status !== "closed").length;
  const mccdPending = admissions.filter(a => a.status !== "released" && !mccdCerts.some(c => c.mortuary_id === a.id)).length;
  const oldestDays = admissions.filter(a => a.status === "in_mortuary").reduce((max, a) => {
    const d = differenceInDays(new Date(), new Date(a.admitted_at));
    return d > max ? d : max;
  }, 0);

  // ═══════ ADMIT ═══════
  const handleAdmit = async () => {
    if (!admitForm.patient_id || !admitForm.time_of_death || !admitForm.pronounced_by || !admitForm.cause_of_death) {
      toast.error("Please fill all required fields"); return;
    }
    setLoading(true);
    const year = new Date().getFullYear();
    const seq = admissions.length + 1;
    const body_number = `BODY-${year}-${String(seq).padStart(3, "0")}`;
    const { error } = await supabase.from("mortuary_admissions").insert({
      hospital_id: hospitalId, patient_id: admitForm.patient_id,
      body_number, time_of_death: admitForm.time_of_death,
      pronounced_by: admitForm.pronounced_by, cause_of_death: admitForm.cause_of_death,
      manner_of_death: admitForm.manner_of_death, is_mlc: admitForm.is_mlc,
      storage_slot: admitForm.storage_slot || null, notes: admitForm.notes || null,
    });
    if (error) { toast.error(error.message); setLoading(false); return; }
    toast.success("Admitted to mortuary");
    setAdmitModal(false);
    setAdmitForm({ patient_id: "", time_of_death: "", pronounced_by: "", cause_of_death: "", manner_of_death: "natural", is_mlc: false, storage_slot: "", notes: "" });
    await loadAll();
    if (admitForm.is_mlc) { setTab("mlc"); toast.info("MLC registration required"); }
    setLoading(false);
  };

  // ═══════ MCCD AI Draft ═══════
  const handleAIDraft = async (mortuaryId: string) => {
    const mort = admissions.find(a => a.id === mortuaryId);
    if (!mort) return;
    setAiLoading(true);
    try {
      let diagInfo = "Not available";
      if (mort.admission_id) {
        const { data: adm } = await supabase.from("admissions").select("admitting_diagnosis").eq("id", mort.admission_id).maybeSingle();
        if (adm?.admitting_diagnosis) diagInfo = adm.admitting_diagnosis;
      }
      const response = await callAI({
        featureKey: "appeal_letter", hospitalId: hospitalId,
        prompt: `You are a medical officer at an Indian hospital. Draft a cause of death for MCCD (Medical Certificate of Cause of Death) Form 4.\n\nPatient clinical summary:\nDiagnosis: ${diagInfo}\nRecorded cause: ${mort.cause_of_death}\n\nReturn JSON:\n{"cause_1a":"immediate cause","interval_1a":"duration","cause_1b":"antecedent cause or null","interval_1b":"duration or null","cause_1c":"underlying cause or null","interval_1c":"duration or null","cause_part2":"other contributing conditions or null","icd_code":"ICD-10 code for underlying cause"}\n\nBe medically accurate. Standard terminology only.`,
        maxTokens: 300
      });
      const cleaned = response.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const draft = JSON.parse(cleaned);
      setMccdDraft(prev => ({
        ...prev, cause_1a: draft.cause_1a || "", cause_1b: draft.cause_1b || "",
        cause_1c: draft.cause_1c || "", cause_part2: draft.cause_part2 || "",
        interval_1a: draft.interval_1a || "", interval_1b: draft.interval_1b || "",
        interval_1c: draft.interval_1c || "", icd_code: draft.icd_code || ""
      }));
      toast.success("AI draft generated — please review and verify");
    } catch { toast.error("AI drafting unavailable — please enter manually"); }
    setAiLoading(false);
  };

  // ═══════ SAVE MCCD ═══════
  const handleSaveMCCD = async () => {
    if (!mccdForm || !mccdDraft.cause_1a || !mccdDraft.certifying_doctor) {
      toast.error("Complete required fields"); return;
    }
    setLoading(true);
    const mort = admissions.find(a => a.id === mccdForm);
    const seq = mccdCerts.length + 1;
    const mccd_number = `MCCD-${new Date().getFullYear()}-${String(seq).padStart(4, "0")}`;
    const { error } = await supabase.from("mccd_certificates").insert({
      hospital_id: hospitalId, mortuary_id: mccdForm, patient_id: mort?.patient_id || "",
      cause_1a: mccdDraft.cause_1a, cause_1b: mccdDraft.cause_1b || null,
      cause_1c: mccdDraft.cause_1c || null, cause_part2: mccdDraft.cause_part2 || null,
      approximate_interval_1a: mccdDraft.interval_1a || null,
      approximate_interval_1b: mccdDraft.interval_1b || null,
      approximate_interval_1c: mccdDraft.interval_1c || null,
      icd_code_underlying: mccdDraft.icd_code || null,
      manner_of_death: mccdDraft.manner_of_death, was_post_mortem: mccdDraft.was_post_mortem,
      certifying_doctor: mccdDraft.certifying_doctor, mccd_number,
      issued_at: new Date().toISOString(), ai_draft: true,
    });
    if (error) { toast.error(error.message); setLoading(false); return; }
    toast.success(`MCCD ${mccd_number} issued`);
    setMccdForm(null);
    setMccdDraft({ cause_1a: "", cause_1b: "", cause_1c: "", cause_part2: "", interval_1a: "", interval_1b: "", interval_1c: "", icd_code: "", manner_of_death: "natural", was_post_mortem: false, certifying_doctor: "" });
    await loadAll();
    setLoading(false);
  };

  // ═══════ MLC ═══════
  const handleSaveMLC = async () => {
    if (!mlcForm.patient_id || !mlcForm.incident_type) {
      toast.error("Patient and incident type are required"); return;
    }
    setLoading(true);
    const seq = mlcRecords.length + 1;
    const mlc_number = `MLC-${new Date().getFullYear()}-${String(seq).padStart(3, "0")}`;
    const { error } = await supabase.from("mlc_records").insert({
      hospital_id: hospitalId, patient_id: mlcForm.patient_id,
      mortuary_id: mlcForm.mortuary_id || null, mlc_number,
      incident_type: mlcForm.incident_type,
      incident_date: mlcForm.incident_date || null,
      incident_location: mlcForm.incident_location || null,
      police_station: mlcForm.police_station || null,
      officer_name: mlcForm.officer_name || null,
      officer_badge: mlcForm.officer_badge || null,
      injury_description: mlcForm.injury_description || null,
      forensic_sample_collected: mlcForm.forensic_samples.length > 0,
      forensic_samples: mlcForm.forensic_samples,
    });
    if (error) { toast.error(error.message); setLoading(false); return; }
    toast.success(`MLC ${mlc_number} registered`);
    setMlcModal(false);
    setMlcForm({ patient_id: "", mortuary_id: "", incident_type: "rta", incident_date: "", incident_location: "", police_station: "", officer_name: "", officer_badge: "", injury_description: "", forensic_samples: [] });
    await loadAll();
    setLoading(false);
  };

  const handleIntimate = async (mlcId: string) => {
    const { error } = await supabase.from("mlc_records").update({ intimated_at: new Date().toISOString(), status: "intimated" }).eq("id", mlcId);
    if (error) { toast.error(error.message); return; }
    toast.success("Police intimated — record updated");
    loadAll();
  };

  // ═══════ RELEASE ═══════
  const handleRelease = async () => {
    if (!releaseForm.mortuary_id || !releaseForm.released_to || !releaseForm.relation) {
      toast.error("Fill all required fields"); return;
    }
    const mort = admissions.find(a => a.id === releaseForm.mortuary_id);
    if (mort?.is_mlc && !releaseForm.police_clearance) {
      toast.error("Police clearance is required for MLC cases"); return;
    }
    setLoading(true);
    const { error: e1 } = await supabase.from("body_releases").insert({
      hospital_id: hospitalId, mortuary_id: releaseForm.mortuary_id,
      released_to: releaseForm.released_to, relation: releaseForm.relation,
      id_proof_type: releaseForm.id_proof_type, id_proof_number: releaseForm.id_proof_number || null,
      released_by: doctors[0]?.id || "", police_clearance: releaseForm.police_clearance,
      mccd_issued: releaseForm.mccd_issued, documents_given: releaseForm.documents_given,
      witness_name: releaseForm.witness_name || null,
    });
    if (e1) { toast.error(e1.message); setLoading(false); return; }
    await supabase.from("mortuary_admissions").update({ status: "released", released_at: new Date().toISOString() }).eq("id", releaseForm.mortuary_id);

    // Auto-bill mortuary services on body release
    if (mort?.patient_id && hospitalId) {
      autoChargeService({
        hospitalId,
        patientId:     mort.patient_id,
        serviceName:   `Mortuary Services — Body No: ${mort.body_number}`,
        serviceModule: MODULE_MORTUARY,
        sourceTable:   "mortuary_admissions",
        sourceId:      releaseForm.mortuary_id,
        serviceDate:   new Date().toISOString().split("T")[0],
      }).catch(() => {});
    }

    toast.success("Body released — records updated");
    setReleaseModal(false);
    setReleaseForm({ mortuary_id: "", released_to: "", relation: "", id_proof_type: "Aadhaar", id_proof_number: "", police_clearance: false, mccd_issued: false, documents_given: [], witness_name: "" });
    await loadAll();
    setLoading(false);
  };

  // ═══════ ORGAN DONATION ═══════
  const handleSaveOrgan = async () => {
    if (!organForm.mortuary_id || !organForm.patient_id) {
      toast.error("Select a case"); return;
    }
    setLoading(true);
    const { error } = await supabase.from("organ_donations").insert({
      hospital_id: hospitalId, mortuary_id: organForm.mortuary_id,
      patient_id: organForm.patient_id, notto_ref: organForm.notto_ref || null,
      brain_death_certified: organForm.brain_death_certified,
      brain_death_date: organForm.brain_death_date || null,
      brain_death_doctors: organForm.brain_death_doctors,
      family_counselled: organForm.family_counselled,
      family_consent: organForm.family_consent,
      consent_date: organForm.consent_date || null,
      organs_pledged: organForm.organs_pledged,
    });
    if (error) { toast.error(error.message); setLoading(false); return; }
    toast.success("Organ donation record saved");
    setOrganModal(false);
    await loadAll();
    setLoading(false);
  };

  // Police intimation letter
  const generatePoliceLetter = (mlc: MLCRecord) => {
    const patient = getPatient(mlc.patient_id);
    return `To,\nThe Officer-in-Charge,\n${mlc.police_station || "[Police Station]"}\n\nSub: Intimation of Medico-Legal Case\n\nThis is to inform you that ${patient?.full_name || "Patient"}, Age ${patient?.date_of_birth ? Math.floor((Date.now() - new Date(patient.date_of_birth).getTime()) / 31557600000) : "—"}, ${patient?.gender || ""}, was brought to the hospital on ${mlc.incident_date ? format(new Date(mlc.incident_date), "dd/MM/yyyy") : "—"} with alleged history of ${mlc.incident_type.replace(/_/g, " ")}.\n\nInjuries noted: ${mlc.injury_description || "As per clinical examination"}\n\nThis is for your information and necessary action.\n\nDate: ${format(new Date(), "dd/MM/yyyy")}`;
  };

  const getDaysColor = (admittedAt: string) => {
    const days = differenceInDays(new Date(), new Date(admittedAt));
    if (days > 3) return "text-destructive font-semibold";
    if (days >= 3) return "text-amber-600 font-medium";
    return "";
  };

  const FORENSIC_SAMPLES = ["Blood", "Urine", "Viscera", "Gastric lavage", "Swab", "Clothing", "Other"];
  const ORGANS = ["Kidney", "Liver", "Heart", "Lung", "Cornea", "Pancreas", "Skin", "Bone"];
  const RELEASE_DOCS = ["MCCD", "Death Summary", "Belongings", "Post-mortem Report"];

  if (hospitalLoading || !hospitalId) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 56px)" }}>
      {/* Header */}
      <div className="h-[52px] flex items-center justify-between px-4 border-b bg-background shrink-0">
        <h1 className="text-base font-bold">🏥 Mortuary & Medico-Legal</h1>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setAdmitModal(true)}>+ Admit to Mortuary</Button>
          <Button size="sm" variant="outline" onClick={() => setMlcModal(true)}>MLC Registration</Button>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-4 gap-3 p-3 shrink-0">
        <Card><CardContent className="p-3 text-center">
          <div className="text-2xl font-bold font-mono">{inMortuary}</div>
          <div className="text-xs text-muted-foreground">In Mortuary</div>
        </CardContent></Card>
        <Card><CardContent className="p-3 text-center">
          <div className={`text-2xl font-bold font-mono ${mlcOpen > 0 ? "text-amber-600" : ""}`}>{mlcOpen}</div>
          <div className="text-xs text-muted-foreground">Active MLC Cases</div>
        </CardContent></Card>
        <Card><CardContent className="p-3 text-center">
          <div className={`text-2xl font-bold font-mono ${mccdPending > 0 ? "text-destructive" : ""}`}>{mccdPending}</div>
          <div className="text-xs text-muted-foreground">MCCD Pending</div>
        </CardContent></Card>
        <Card><CardContent className="p-3 text-center">
          <div className={`text-2xl font-bold font-mono ${oldestDays > 3 ? "text-destructive" : ""}`}>{oldestDays}</div>
          <div className="text-xs text-muted-foreground">Days (Oldest)</div>
        </CardContent></Card>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col overflow-hidden px-3 pb-3">
        <TabsList className="shrink-0 w-full justify-start">
          <TabsTrigger value="register">📋 Register</TabsTrigger>
          <TabsTrigger value="mccd">📜 MCCD</TabsTrigger>
          <TabsTrigger value="mlc">🚔 MLC</TabsTrigger>
          <TabsTrigger value="release">🔑 Release</TabsTrigger>
          <TabsTrigger value="organ">🫀 Organ Donation</TabsTrigger>
        </TabsList>

        {/* ═══ TAB 1: REGISTER ═══ */}
        <TabsContent value="register" className="flex-1 overflow-auto mt-2">
          <Card>
            <CardHeader className="py-2 px-4"><CardTitle className="text-sm">Current Mortuary Register</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Body No</TableHead><TableHead>Patient</TableHead><TableHead>Age</TableHead>
                  <TableHead>Time of Death</TableHead><TableHead>Storage</TableHead><TableHead>Status</TableHead>
                  <TableHead>Days</TableHead><TableHead>MLC</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {admissions.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No records</TableCell></TableRow>}
                  {admissions.map(a => {
                    const patient = getPatient(a.patient_id);
                    const days = differenceInDays(new Date(), new Date(a.admitted_at));
                    return (
                      <TableRow key={a.id}>
                        <TableCell className="font-mono text-xs">{a.body_number}</TableCell>
                        <TableCell>{patient?.full_name || "—"}</TableCell>
                        <TableCell>{patient?.date_of_birth ? Math.floor((Date.now() - new Date(patient.date_of_birth).getTime()) / 31557600000) : "—"}</TableCell>
                        <TableCell className="text-xs">{format(new Date(a.time_of_death), "dd/MM/yyyy HH:mm")}</TableCell>
                        <TableCell>{a.storage_slot || "—"}</TableCell>
                        <TableCell><Badge variant={a.status === "released" ? "default" : a.status === "unclaimed" ? "destructive" : "secondary"} className="text-xs">{a.status.replace(/_/g, " ")}</Badge></TableCell>
                        <TableCell className={getDaysColor(a.admitted_at)}>
                          {a.status === "in_mortuary" ? (
                            <span>{days}d {days > 3 ? "⚠️ UNCLAIMED" : days >= 3 ? "⚠️" : ""}</span>
                          ) : "—"}
                        </TableCell>
                        <TableCell>{a.is_mlc ? <Badge variant="destructive" className="text-xs">MLC</Badge> : "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══ TAB 2: MCCD ═══ */}
        <TabsContent value="mccd" className="flex-1 overflow-auto mt-2">
          <div className="grid grid-cols-3 gap-3 h-full">
            {/* Left: Pending list */}
            <div className="col-span-1 space-y-2">
              <h3 className="text-sm font-semibold">Pending Certification</h3>
              {admissions.filter(a => a.status !== "released" && !mccdCerts.some(c => c.mortuary_id === a.id)).map(a => (
                <Card key={a.id} className={`cursor-pointer hover:border-primary ${mccdForm === a.id ? "border-primary" : ""}`} onClick={() => { setMccdForm(a.id); setMccdDraft(d => ({ ...d, manner_of_death: a.manner_of_death })); }}>
                  <CardContent className="p-3">
                    <div className="font-mono text-xs">{a.body_number}</div>
                    <div className="text-sm">{getPatient(a.patient_id)?.full_name || "—"}</div>
                    <div className="text-xs text-muted-foreground">{format(new Date(a.time_of_death), "dd/MM/yyyy HH:mm")}</div>
                  </CardContent>
                </Card>
              ))}
              {mccdCerts.length > 0 && (
                <>
                  <h3 className="text-sm font-semibold mt-4">Issued Certificates</h3>
                  {mccdCerts.map(c => (
                    <Card key={c.id} className="opacity-70">
                      <CardContent className="p-3">
                        <div className="font-mono text-xs text-green-700">{c.mccd_number}</div>
                        <div className="text-xs">{getPatient(c.patient_id)?.full_name}</div>
                      </CardContent>
                    </Card>
                  ))}
                </>
              )}
            </div>
            {/* Right: MCCD Form */}
            <div className="col-span-2">
              {!mccdForm ? (
                <div className="flex items-center justify-center h-full text-muted-foreground">Select a case to issue MCCD</div>
              ) : (
                <Card>
                  <CardHeader className="py-2 px-4 flex flex-row items-center justify-between">
                    <CardTitle className="text-sm">MCCD Form 4 — Cause of Death</CardTitle>
                    <Button size="sm" variant="outline" disabled={aiLoading} onClick={() => handleAIDraft(mccdForm)}>
                      {aiLoading ? "Drafting…" : "🤖 AI Draft"}
                    </Button>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="border rounded p-3 space-y-2 bg-muted/30">
                      <div className="text-xs font-semibold text-muted-foreground">PART I — Cause of Death</div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="col-span-2"><Label className="text-xs">1a. Immediate cause *</Label><Input value={mccdDraft.cause_1a} onChange={e => setMccdDraft(d => ({ ...d, cause_1a: e.target.value }))} placeholder="Disease or condition directly leading to death" /></div>
                        <div><Label className="text-xs">Approx. interval</Label><Input value={mccdDraft.interval_1a} onChange={e => setMccdDraft(d => ({ ...d, interval_1a: e.target.value }))} placeholder="e.g. 2 hours" /></div>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="col-span-2"><Label className="text-xs">1b. Due to (antecedent)</Label><Input value={mccdDraft.cause_1b} onChange={e => setMccdDraft(d => ({ ...d, cause_1b: e.target.value }))} /></div>
                        <div><Label className="text-xs">Interval</Label><Input value={mccdDraft.interval_1b} onChange={e => setMccdDraft(d => ({ ...d, interval_1b: e.target.value }))} /></div>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="col-span-2"><Label className="text-xs">1c. Due to (underlying)</Label><Input value={mccdDraft.cause_1c} onChange={e => setMccdDraft(d => ({ ...d, cause_1c: e.target.value }))} /></div>
                        <div><Label className="text-xs">Interval</Label><Input value={mccdDraft.interval_1c} onChange={e => setMccdDraft(d => ({ ...d, interval_1c: e.target.value }))} /></div>
                      </div>
                    </div>
                    <div><Label className="text-xs">Part II — Other significant conditions</Label><Textarea value={mccdDraft.cause_part2} onChange={e => setMccdDraft(d => ({ ...d, cause_part2: e.target.value }))} rows={2} /></div>
                    <div className="grid grid-cols-3 gap-3">
                      <div><Label className="text-xs">ICD-10 Code</Label><Input value={mccdDraft.icd_code} onChange={e => setMccdDraft(d => ({ ...d, icd_code: e.target.value }))} placeholder="e.g. I21.9" /></div>
                      <div><Label className="text-xs">Manner of death</Label>
                        <Select value={mccdDraft.manner_of_death} onValueChange={v => setMccdDraft(d => ({ ...d, manner_of_death: v }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>{["natural","accident","suicide","homicide","undetermined"].map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-end gap-2"><Switch checked={mccdDraft.was_post_mortem} onCheckedChange={v => setMccdDraft(d => ({ ...d, was_post_mortem: v }))} /><Label className="text-xs">Post-mortem conducted</Label></div>
                    </div>
                    <div><Label className="text-xs">Certifying Doctor *</Label>
                      <Select value={mccdDraft.certifying_doctor} onValueChange={v => setMccdDraft(d => ({ ...d, certifying_doctor: v }))}>
                        <SelectTrigger><SelectValue placeholder="Select doctor" /></SelectTrigger>
                        <SelectContent>{doctors.filter(d => d.role === "doctor").map(d => <SelectItem key={d.id} value={d.id}>{d.full_name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="flex gap-2">
                      <Button onClick={handleSaveMCCD} disabled={loading}>Generate MCCD Certificate</Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ═══ TAB 3: MLC ═══ */}
        <TabsContent value="mlc" className="flex-1 overflow-auto mt-2">
          <Card>
            <CardHeader className="py-2 px-4 flex flex-row items-center justify-between">
              <CardTitle className="text-sm">Active Medico-Legal Cases</CardTitle>
              <Button size="sm" onClick={() => setMlcModal(true)}>+ Register MLC</Button>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>MLC No</TableHead><TableHead>Patient</TableHead><TableHead>Incident</TableHead>
                  <TableHead>Police Station</TableHead><TableHead>FIR</TableHead><TableHead>Status</TableHead><TableHead>Actions</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {mlcRecords.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No MLC records</TableCell></TableRow>}
                  {mlcRecords.map(m => (
                    <TableRow key={m.id}>
                      <TableCell className="font-mono text-xs">{m.mlc_number}</TableCell>
                      <TableCell>{getPatient(m.patient_id)?.full_name || "—"}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{m.incident_type.replace(/_/g, " ").toUpperCase()}</Badge></TableCell>
                      <TableCell>{m.police_station || "—"}</TableCell>
                      <TableCell>{m.fir_number || "—"}</TableCell>
                      <TableCell><Badge variant={m.status === "closed" ? "default" : "secondary"} className="text-xs">{m.status}</Badge></TableCell>
                      <TableCell className="flex gap-1">
                        {m.status === "open" && <Button size="sm" variant="outline" onClick={() => handleIntimate(m.id)}>Mark Intimated</Button>}
                        <Button size="sm" variant="ghost" onClick={() => setPoliceLetterModal(m.id)}>📄 Letter</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══ TAB 4: RELEASE ═══ */}
        <TabsContent value="release" className="flex-1 overflow-auto mt-2">
          <Card>
            <CardHeader className="py-2 px-4 flex flex-row items-center justify-between">
              <CardTitle className="text-sm">Body Release</CardTitle>
              <Button size="sm" onClick={() => setReleaseModal(true)}>Release Body</Button>
            </CardHeader>
            <CardContent>
              <h4 className="text-xs font-semibold text-muted-foreground mb-2">Ready for Release</h4>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Body No</TableHead><TableHead>Patient</TableHead><TableHead>MCCD</TableHead>
                  <TableHead>MLC</TableHead><TableHead>Status</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {admissions.filter(a => a.status === "in_mortuary").map(a => {
                    const hasMCCD = mccdCerts.some(c => c.mortuary_id === a.id);
                    return (
                      <TableRow key={a.id}>
                        <TableCell className="font-mono text-xs">{a.body_number}</TableCell>
                        <TableCell>{getPatient(a.patient_id)?.full_name || "—"}</TableCell>
                        <TableCell>{hasMCCD ? <Badge className="text-xs bg-green-100 text-green-800">Issued</Badge> : <Badge variant="destructive" className="text-xs">Pending</Badge>}</TableCell>
                        <TableCell>{a.is_mlc ? <Badge variant="destructive" className="text-xs">MLC — clearance needed</Badge> : "—"}</TableCell>
                        <TableCell><Badge variant="secondary" className="text-xs">{a.status.replace(/_/g, " ")}</Badge></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {releases.length > 0 && (
                <>
                  <h4 className="text-xs font-semibold text-muted-foreground mt-4 mb-2">Released Records</h4>
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Body</TableHead><TableHead>Released To</TableHead><TableHead>Relation</TableHead>
                      <TableHead>ID Proof</TableHead><TableHead>Date</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {releases.map(r => {
                        const mort = admissions.find(a => a.id === r.mortuary_id);
                        return (
                          <TableRow key={r.id}>
                            <TableCell className="font-mono text-xs">{mort?.body_number || "—"}</TableCell>
                            <TableCell>{r.released_to}</TableCell>
                            <TableCell>{r.relation}</TableCell>
                            <TableCell>{r.id_proof_type} {r.id_proof_number ? `(${r.id_proof_number})` : ""}</TableCell>
                            <TableCell className="text-xs">{format(new Date(r.released_at), "dd/MM/yyyy HH:mm")}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══ TAB 5: ORGAN DONATION ═══ */}
        <TabsContent value="organ" className="flex-1 overflow-auto mt-2">
          <Card>
            <CardHeader className="py-2 px-4 flex flex-row items-center justify-between">
              <CardTitle className="text-sm">Organ Donation — NOTTO Protocol</CardTitle>
              <Button size="sm" onClick={() => setOrganModal(true)}>+ New Donation Record</Button>
            </CardHeader>
            <CardContent>
              {donations.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">No organ donation records</div>
              ) : (
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Patient</TableHead><TableHead>Brain Death</TableHead><TableHead>Family Consent</TableHead>
                    <TableHead>Organs Pledged</TableHead><TableHead>NOTTO Ref</TableHead><TableHead>Outcome</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {donations.map(d => (
                      <TableRow key={d.id}>
                        <TableCell>{getPatient(d.patient_id)?.full_name || "—"}</TableCell>
                        <TableCell>{d.brain_death_certified ? <Badge className="text-xs bg-green-100 text-green-800">Certified</Badge> : <Badge variant="secondary" className="text-xs">Pending</Badge>}</TableCell>
                        <TableCell>{d.family_consent ? <Badge className="text-xs bg-green-100 text-green-800">Yes</Badge> : d.family_counselled ? <Badge variant="destructive" className="text-xs">Declined</Badge> : <Badge variant="secondary" className="text-xs">Not counselled</Badge>}</TableCell>
                        <TableCell>{d.organs_pledged.length > 0 ? d.organs_pledged.join(", ") : "—"}</TableCell>
                        <TableCell className="font-mono text-xs">{d.notto_ref || "—"}</TableCell>
                        <TableCell>{d.outcome || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <div className="mt-4 p-3 bg-muted/30 rounded text-sm">
                <strong>This Year:</strong> {donations.length} donation records • Organs pledged: {donations.flatMap(d => d.organs_pledged).join(", ") || "None"}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ═══ MODALS ═══ */}

      {/* Admit Modal */}
      <Dialog open={admitModal} onOpenChange={setAdmitModal}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Admit to Mortuary</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Patient *</Label>
              <PatientSearchPicker
                hospitalId={hospitalId}
                value={admitForm.patient_id}
                onChange={v => setAdmitForm(f => ({ ...f, patient_id: v }))}
                onRegisterNew={() => setShowPatientReg("admit")}
              />
            </div>
            <div><Label>Time of Death *</Label><Input type="datetime-local" value={admitForm.time_of_death} onChange={e => setAdmitForm(f => ({ ...f, time_of_death: e.target.value }))} /></div>
            <div><Label>Pronounced by *</Label>
              <Select value={admitForm.pronounced_by} onValueChange={v => setAdmitForm(f => ({ ...f, pronounced_by: v }))}>
                <SelectTrigger><SelectValue placeholder="Select doctor" /></SelectTrigger>
                <SelectContent>{doctors.filter(d => d.role === "doctor").map(d => <SelectItem key={d.id} value={d.id}>{d.full_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Cause of Death *</Label><Textarea value={admitForm.cause_of_death} onChange={e => setAdmitForm(f => ({ ...f, cause_of_death: e.target.value }))} rows={2} /></div>
            <div><Label>Manner of Death</Label>
              <Select value={admitForm.manner_of_death} onValueChange={v => setAdmitForm(f => ({ ...f, manner_of_death: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["natural","accident","suicide","homicide","undetermined"].map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2"><Switch checked={admitForm.is_mlc} onCheckedChange={v => setAdmitForm(f => ({ ...f, is_mlc: v }))} /><Label>Medico-Legal Case (MLC)</Label></div>
            {admitForm.is_mlc && <div className="p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">⚠️ MLC registration will be required after admission</div>}
            <div><Label>Storage Slot</Label><Input value={admitForm.storage_slot} onChange={e => setAdmitForm(f => ({ ...f, storage_slot: e.target.value }))} placeholder="e.g. Cold Storage Unit 1" /></div>
            <div><Label>Notes</Label><Textarea value={admitForm.notes} onChange={e => setAdmitForm(f => ({ ...f, notes: e.target.value }))} rows={2} /></div>
          </div>
          <DialogFooter><Button onClick={handleAdmit} disabled={loading}>{loading ? "Saving…" : "Admit"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MLC Modal */}
      <Dialog open={mlcModal} onOpenChange={setMlcModal}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Register Medico-Legal Case</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Patient *</Label>
              <PatientSearchPicker
                hospitalId={hospitalId}
                value={mlcForm.patient_id}
                onChange={v => setMlcForm(f => ({ ...f, patient_id: v }))}
                onRegisterNew={() => setShowPatientReg("mlc")}
              />
            </div>
            <div><Label>Link to Mortuary Case</Label>
              <Select value={mlcForm.mortuary_id} onValueChange={v => setMlcForm(f => ({ ...f, mortuary_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent>{admissions.map(a => <SelectItem key={a.id} value={a.id}>{a.body_number}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Incident Type *</Label>
              <Select value={mlcForm.incident_type} onValueChange={v => setMlcForm(f => ({ ...f, incident_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["rta","assault","fall","poisoning","burns","drowning","hanging","gunshot","unknown_cause","other"].map(t => <SelectItem key={t} value={t}>{t.replace(/_/g, " ").toUpperCase()}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Incident Date</Label><Input type="date" value={mlcForm.incident_date} onChange={e => setMlcForm(f => ({ ...f, incident_date: e.target.value }))} /></div>
              <div><Label>Location</Label><Input value={mlcForm.incident_location} onChange={e => setMlcForm(f => ({ ...f, incident_location: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Police Station</Label><Input value={mlcForm.police_station} onChange={e => setMlcForm(f => ({ ...f, police_station: e.target.value }))} /></div>
              <div><Label>Officer Name</Label><Input value={mlcForm.officer_name} onChange={e => setMlcForm(f => ({ ...f, officer_name: e.target.value }))} /></div>
            </div>
            <div><Label>Officer Badge</Label><Input value={mlcForm.officer_badge} onChange={e => setMlcForm(f => ({ ...f, officer_badge: e.target.value }))} /></div>
            <div><Label>Injury Description</Label><Textarea value={mlcForm.injury_description} onChange={e => setMlcForm(f => ({ ...f, injury_description: e.target.value }))} rows={2} /></div>
            <div><Label className="text-xs">Forensic Samples Collected</Label>
              <div className="flex flex-wrap gap-2 mt-1">
                {FORENSIC_SAMPLES.map(s => (
                  <label key={s} className="flex items-center gap-1 text-xs">
                    <Checkbox checked={mlcForm.forensic_samples.includes(s)} onCheckedChange={c => setMlcForm(f => ({ ...f, forensic_samples: c ? [...f.forensic_samples, s] : f.forensic_samples.filter(x => x !== s) }))} />{s}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter><Button onClick={handleSaveMLC} disabled={loading}>{loading ? "Saving…" : "Register MLC"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Release Modal */}
      <Dialog open={releaseModal} onOpenChange={setReleaseModal}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Release Body</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Select Case *</Label>
              <Select value={releaseForm.mortuary_id} onValueChange={v => setReleaseForm(f => ({ ...f, mortuary_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{admissions.filter(a => a.status === "in_mortuary").map(a => <SelectItem key={a.id} value={a.id}>{a.body_number} — {getPatient(a.patient_id)?.full_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {releaseForm.mortuary_id && admissions.find(a => a.id === releaseForm.mortuary_id)?.is_mlc && (
              <div className="p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">⚠️ This is an MLC case — police clearance is mandatory before release</div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Released To *</Label><Input value={releaseForm.released_to} onChange={e => setReleaseForm(f => ({ ...f, released_to: e.target.value }))} /></div>
              <div><Label>Relation *</Label><Input value={releaseForm.relation} onChange={e => setReleaseForm(f => ({ ...f, relation: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>ID Proof Type</Label>
                <Select value={releaseForm.id_proof_type} onValueChange={v => setReleaseForm(f => ({ ...f, id_proof_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["Aadhaar","Voter ID","Passport","Driving License","Other"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>ID Number</Label><Input value={releaseForm.id_proof_number} onChange={e => setReleaseForm(f => ({ ...f, id_proof_number: e.target.value }))} /></div>
            </div>
            <div className="flex items-center gap-2"><Switch checked={releaseForm.police_clearance} onCheckedChange={v => setReleaseForm(f => ({ ...f, police_clearance: v }))} /><Label>Police Clearance Obtained</Label></div>
            <div className="flex items-center gap-2"><Switch checked={releaseForm.mccd_issued} onCheckedChange={v => setReleaseForm(f => ({ ...f, mccd_issued: v }))} /><Label>MCCD Issued</Label></div>
            <div><Label className="text-xs">Documents Given</Label>
              <div className="flex flex-wrap gap-2 mt-1">
                {RELEASE_DOCS.map(d => (
                  <label key={d} className="flex items-center gap-1 text-xs">
                    <Checkbox checked={releaseForm.documents_given.includes(d)} onCheckedChange={c => setReleaseForm(f => ({ ...f, documents_given: c ? [...f.documents_given, d] : f.documents_given.filter(x => x !== d) }))} />{d}
                  </label>
                ))}
              </div>
            </div>
            <div><Label>Witness Name</Label><Input value={releaseForm.witness_name} onChange={e => setReleaseForm(f => ({ ...f, witness_name: e.target.value }))} /></div>
          </div>
          <DialogFooter><Button onClick={handleRelease} disabled={loading}>{loading ? "Processing…" : "Confirm Release"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Organ Donation Modal */}
      <Dialog open={organModal} onOpenChange={setOrganModal}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Organ Donation — NOTTO Protocol</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Mortuary Case *</Label>
              <Select value={organForm.mortuary_id} onValueChange={v => { setOrganForm(f => ({ ...f, mortuary_id: v, patient_id: admissions.find(a => a.id === v)?.patient_id || "" })); }}>
                <SelectTrigger><SelectValue placeholder="Select case" /></SelectTrigger>
                <SelectContent>{admissions.map(a => <SelectItem key={a.id} value={a.id}>{a.body_number} — {getPatient(a.patient_id)?.full_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="border rounded p-3 space-y-2">
              <div className="text-xs font-semibold">Brain Death Certification</div>
              <div className="text-xs text-muted-foreground">Requires 4 doctors (2 hospital + 1 external neurologist + CMO)</div>
              <div className="flex items-center gap-2"><Switch checked={organForm.brain_death_certified} onCheckedChange={v => setOrganForm(f => ({ ...f, brain_death_certified: v }))} /><Label className="text-xs">Brain death certified</Label></div>
              {organForm.brain_death_certified && <div><Label className="text-xs">Date/Time</Label><Input type="datetime-local" value={organForm.brain_death_date} onChange={e => setOrganForm(f => ({ ...f, brain_death_date: e.target.value }))} /></div>}
            </div>
            <div className="border rounded p-3 space-y-2">
              <div className="text-xs font-semibold">Family Counselling</div>
              <div className="flex items-center gap-2"><Switch checked={organForm.family_counselled} onCheckedChange={v => setOrganForm(f => ({ ...f, family_counselled: v }))} /><Label className="text-xs">Family counselled</Label></div>
              {organForm.family_counselled && (
                <>
                  <div className="flex items-center gap-2"><Switch checked={organForm.family_consent} onCheckedChange={v => setOrganForm(f => ({ ...f, family_consent: v }))} /><Label className="text-xs">Family consent given</Label></div>
                  {organForm.family_consent && <div><Label className="text-xs">Consent Date</Label><Input type="datetime-local" value={organForm.consent_date} onChange={e => setOrganForm(f => ({ ...f, consent_date: e.target.value }))} /></div>}
                </>
              )}
            </div>
            {organForm.family_consent && (
              <div><Label className="text-xs">Organs Pledged</Label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {ORGANS.map(o => (
                    <label key={o} className="flex items-center gap-1 text-xs">
                      <Checkbox checked={organForm.organs_pledged.includes(o)} onCheckedChange={c => setOrganForm(f => ({ ...f, organs_pledged: c ? [...f.organs_pledged, o] : f.organs_pledged.filter(x => x !== o) }))} />{o}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div><Label>NOTTO Reference No</Label><Input value={organForm.notto_ref} onChange={e => setOrganForm(f => ({ ...f, notto_ref: e.target.value }))} /></div>
          </div>
          <DialogFooter><Button onClick={handleSaveOrgan} disabled={loading}>{loading ? "Saving…" : "Save Record"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Police Letter Modal */}
      <Dialog open={!!policeLetterModal} onOpenChange={() => setPoliceLetterModal(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Police Intimation Letter</DialogTitle></DialogHeader>
          {policeLetterModal && (
            <div className="space-y-3">
              <pre className="whitespace-pre-wrap text-sm bg-muted/30 p-4 rounded border font-sans leading-relaxed">
                {generatePoliceLetter(mlcRecords.find(m => m.id === policeLetterModal)!)}
              </pre>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(generatePoliceLetter(mlcRecords.find(m => m.id === policeLetterModal)!)); toast.success("Copied to clipboard"); }}>📋 Copy Text</Button>
                <Button size="sm" variant="outline" onClick={() => {
                  const { printDocument } = require("@/lib/printUtils");
                  printDocument("Police Intimation Letter", `<pre>${generatePoliceLetter(mlcRecords.find(m => m.id === policeLetterModal)!)}</pre>`);
                }}>🖨️ Print</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Patient Registration Modal */}
      {showPatientReg && (
        <div onClick={e => e.stopPropagation()}>
          <PatientRegistrationModal
            onClose={() => setShowPatientReg(null)}
            onSuccess={async () => {
              // Get the most recently created patient
              const { data } = await supabase
                .from("patients")
                .select("id, full_name, uhid")
                .eq("hospital_id", hospitalId)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();
              if (data) {
                if (showPatientReg === "admit") {
                  setAdmitForm(f => ({ ...f, patient_id: data.id }));
                } else if (showPatientReg === "mlc") {
                  setMlcForm(f => ({ ...f, patient_id: data.id }));
                }
              }
              setShowPatientReg(null);
              await loadAll();
            }}
          />
        </div>
      )}
    </div>
  );
}
