import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle } from "lucide-react";

interface Props {
  hospitalId: string;
  patientId: string;
  patientName: string;
  edVisitId?: string | null;
  admissionId?: string | null;
  onClose: () => void;
  onSaved: (mlcNumber: string) => void;
}

const CASE_TYPES = [
  { value: "road_accident", label: "Road Traffic Accident" },
  { value: "assault", label: "Assault / Violence" },
  { value: "poisoning", label: "Poisoning" },
  { value: "burns", label: "Burns" },
  { value: "fall", label: "Fall from Height" },
  { value: "sexual_assault", label: "Sexual Assault" },
  { value: "other", label: "Other" },
];

const INJURY_TYPES = [
  { value: "blunt", label: "Blunt Force" },
  { value: "sharp", label: "Sharp / Incised" },
  { value: "firearm", label: "Firearm" },
  { value: "chemical", label: "Chemical / Corrosive" },
  { value: "mixed", label: "Mixed" },
  { value: "other", label: "Other" },
];

const INTIMATION_MODES = [
  { value: "phone", label: "Phone Call" },
  { value: "in_person", label: "In Person" },
  { value: "written", label: "Written" },
];

const MLCDetailsModal: React.FC<Props> = ({
  hospitalId, patientId, patientName, edVisitId, admissionId, onClose, onSaved,
}) => {
  const [mlcNumber, setMlcNumber] = useState("");
  const [caseType, setCaseType] = useState("");
  const [incidentDate, setIncidentDate] = useState("");
  const [incidentTime, setIncidentTime] = useState("");
  const [incidentPlace, setIncidentPlace] = useState("");
  const [incidentDescription, setIncidentDescription] = useState("");
  const [injuryType, setInjuryType] = useState("");
  const [bodyPartsInjured, setBodyPartsInjured] = useState("");
  const [allegedHistory, setAllegedHistory] = useState("");
  const [policeStation, setPoliceStation] = useState("");
  const [policeOfficerName, setPoliceOfficerName] = useState("");
  const [policeOfficerDesignation, setPoliceOfficerDesignation] = useState("");
  const [firNumber, setFirNumber] = useState("");
  const [policeInformed, setPoliceInformed] = useState(false);
  const [policeInformedAt, setPoliceInformedAt] = useState("");
  const [intimationMode, setIntimationMode] = useState("");
  const [intimationSentBy, setIntimationSentBy] = useState("");
  const [medicolegalOpinion, setMedicolegalOpinion] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Generate MLC number on mount
  useEffect(() => {
    const generate = async () => {
      const year = new Date().getFullYear();
      const { count } = await (supabase as any)
        .from("mlc_cases")
        .select("id", { count: "exact", head: true })
        .eq("hospital_id", hospitalId)
        .gte("created_at", `${year}-01-01`)
        .lt("created_at", `${year + 1}-01-01`);
      setMlcNumber(`MLC-${year}-${String((count ?? 0) + 1).padStart(4, "0")}`);
    };
    generate();
  }, [hospitalId]);

  const handleSubmit = async () => {
    if (!caseType) {
      toast({ title: "Select case type", variant: "destructive" });
      return;
    }
    setSubmitting(true);

    const { data: { user } } = await supabase.auth.getUser();
    const { data: userData } = await supabase
      .from("users")
      .select("id")
      .eq("auth_user_id", user?.id || "")
      .maybeSingle();

    const bodyParts = bodyPartsInjured
      ? bodyPartsInjured.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

    const { error } = await (supabase as any).from("mlc_cases").insert({
      hospital_id: hospitalId,
      mlc_number: mlcNumber,
      ed_visit_id: edVisitId || null,
      admission_id: admissionId || null,
      patient_id: patientId,
      case_type: caseType,
      incident_date: incidentDate || null,
      incident_time: incidentTime || null,
      incident_place: incidentPlace || null,
      incident_description: incidentDescription || null,
      injury_type: injuryType || null,
      body_parts_injured: bodyParts.length > 0 ? bodyParts : null,
      alleged_history: allegedHistory || null,
      police_station: policeStation || null,
      police_officer_name: policeOfficerName || null,
      police_officer_designation: policeOfficerDesignation || null,
      fir_number: firNumber || null,
      police_informed: policeInformed,
      police_informed_at: policeInformedAt ? new Date(policeInformedAt).toISOString() : null,
      intimation_mode: intimationMode || null,
      intimation_sent_by: intimationSentBy || null,
      intimation_to_police_at: policeInformed && policeInformedAt ? new Date(policeInformedAt).toISOString() : null,
      medicolegal_opinion: medicolegalOpinion || null,
      created_by: userData?.id || null,
    });

    if (error) {
      toast({ title: "Error saving MLC details", description: error.message, variant: "destructive" });
      setSubmitting(false);
      return;
    }

    // Update ed_visits with mlc_details containing mlc_number
    if (edVisitId) {
      await supabase.from("ed_visits").update({
        mlc_details: { mlc_number: mlcNumber, case_type: caseType, police_station: policeStation || null },
      }).eq("id", edVisitId);
    }

    // Update admissions with mlc_number
    if (admissionId) {
      await (supabase as any).from("admissions").update({
        mlc_number: mlcNumber,
        police_station: policeStation || null,
        police_informed_at: policeInformedAt ? new Date(policeInformedAt).toISOString() : null,
      }).eq("id", admissionId);
    }

    toast({ title: `MLC Case ${mlcNumber} documented`, description: `Patient: ${patientName}` });
    onSaved(mlcNumber);
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-600" />
            <DialogTitle className="text-red-700">MLC Case Documentation</DialogTitle>
          </div>
          <DialogDescription>
            Patient: <strong>{patientName}</strong> — MLC No: <strong className="text-red-600">{mlcNumber || "Generating…"}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Case Type */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-bold uppercase text-muted-foreground">Case Type *</label>
              <Select value={caseType} onValueChange={setCaseType}>
                <SelectTrigger className="h-9 text-sm mt-1">
                  <SelectValue placeholder="Select type…" />
                </SelectTrigger>
                <SelectContent>
                  {CASE_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[11px] font-bold uppercase text-muted-foreground">Injury Type</label>
              <Select value={injuryType} onValueChange={setInjuryType}>
                <SelectTrigger className="h-9 text-sm mt-1">
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {INJURY_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Incident Details */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-bold uppercase text-muted-foreground">Incident Date</label>
              <Input type="date" value={incidentDate} onChange={(e) => setIncidentDate(e.target.value)} className="h-9 text-sm mt-1" />
            </div>
            <div>
              <label className="text-[11px] font-bold uppercase text-muted-foreground">Incident Time</label>
              <Input type="time" value={incidentTime} onChange={(e) => setIncidentTime(e.target.value)} className="h-9 text-sm mt-1" />
            </div>
          </div>

          <div>
            <label className="text-[11px] font-bold uppercase text-muted-foreground">Place of Incident</label>
            <Input value={incidentPlace} onChange={(e) => setIncidentPlace(e.target.value)} className="h-9 text-sm mt-1" placeholder="Road, address, location…" />
          </div>

          <div>
            <label className="text-[11px] font-bold uppercase text-muted-foreground">Description of Incident</label>
            <Textarea value={incidentDescription} onChange={(e) => setIncidentDescription(e.target.value)} className="text-sm mt-1 resize-none h-16" placeholder="Brief description as narrated by patient / bystander…" />
          </div>

          <div>
            <label className="text-[11px] font-bold uppercase text-muted-foreground">Body Parts Injured (comma-separated)</label>
            <Input value={bodyPartsInjured} onChange={(e) => setBodyPartsInjured(e.target.value)} className="h-9 text-sm mt-1" placeholder="e.g. Head, Right arm, Chest" />
          </div>

          <div>
            <label className="text-[11px] font-bold uppercase text-muted-foreground">Alleged History</label>
            <Textarea value={allegedHistory} onChange={(e) => setAllegedHistory(e.target.value)} className="text-sm mt-1 resize-none h-16" placeholder="History as given by patient/bystander…" />
          </div>

          {/* Police Details */}
          <div className="border border-border rounded-lg p-3 space-y-3">
            <p className="text-[11px] font-bold uppercase text-muted-foreground">Police Intimation</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-bold uppercase text-muted-foreground">Police Station</label>
                <Input value={policeStation} onChange={(e) => setPoliceStation(e.target.value)} className="h-9 text-sm mt-1" placeholder="Name of police station" />
              </div>
              <div>
                <label className="text-[11px] font-bold uppercase text-muted-foreground">FIR Number</label>
                <Input value={firNumber} onChange={(e) => setFirNumber(e.target.value)} className="h-9 text-sm mt-1" placeholder="If registered" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-bold uppercase text-muted-foreground">Officer Name</label>
                <Input value={policeOfficerName} onChange={(e) => setPoliceOfficerName(e.target.value)} className="h-9 text-sm mt-1" />
              </div>
              <div>
                <label className="text-[11px] font-bold uppercase text-muted-foreground">Designation</label>
                <Input value={policeOfficerDesignation} onChange={(e) => setPoliceOfficerDesignation(e.target.value)} className="h-9 text-sm mt-1" placeholder="SI, ASI, Inspector…" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-bold uppercase text-muted-foreground">Intimation Mode</label>
                <Select value={intimationMode} onValueChange={setIntimationMode}>
                  <SelectTrigger className="h-9 text-sm mt-1">
                    <SelectValue placeholder="Select…" />
                  </SelectTrigger>
                  <SelectContent>
                    {INTIMATION_MODES.map((m) => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-[11px] font-bold uppercase text-muted-foreground">Intimation Sent By</label>
                <Input value={intimationSentBy} onChange={(e) => setIntimationSentBy(e.target.value)} className="h-9 text-sm mt-1" placeholder="Staff name / designation" />
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={policeInformed}
                onChange={(e) => setPoliceInformed(e.target.checked)}
                className="rounded border-border"
              />
              <span className="text-sm">Police have been informed</span>
            </label>
            {policeInformed && (
              <div>
                <label className="text-[11px] font-bold uppercase text-muted-foreground">Informed At</label>
                <Input type="datetime-local" value={policeInformedAt} onChange={(e) => setPoliceInformedAt(e.target.value)} className="h-9 text-sm mt-1" />
              </div>
            )}
          </div>

          {/* Medicolegal Opinion */}
          <div>
            <label className="text-[11px] font-bold uppercase text-muted-foreground">Medicolegal Opinion / Remarks</label>
            <Textarea value={medicolegalOpinion} onChange={(e) => setMedicolegalOpinion(e.target.value)} className="text-sm mt-1 resize-none h-16" placeholder="Doctor's medicolegal opinion…" />
          </div>

          <Button
            onClick={handleSubmit}
            disabled={submitting || !caseType || !mlcNumber}
            className="w-full h-10 bg-red-600 hover:bg-red-700 text-white font-bold"
          >
            {submitting ? "Saving…" : `Save MLC Case — ${mlcNumber}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default MLCDetailsModal;
