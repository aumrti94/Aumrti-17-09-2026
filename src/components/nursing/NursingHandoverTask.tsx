import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { NursingTask } from "@/pages/nursing/NursingPage";

interface Props {
  task: NursingTask;
  shift: { label: string; type: string };
  wards: { id: string; name: string }[];
  onComplete: () => void;
}

interface PatientSBAR {
  patientId: string;
  patientName: string;
  bed: string;
  diagnosis: string;
  situation: string;
  background: string;
  assessment: string;
  recommendation: string;
  flags: Record<string, boolean>;
  open: boolean;
}

const shiftLabels: Record<string, string> = {
  morning: "Morning → Evening",
  evening: "Evening → Night",
  night: "Night → Morning",
};

const nextShift: Record<string, string> = {
  morning: "evening",
  evening: "night",
  night: "morning",
};

const flagOptions = [
  { key: "monitoring", label: "Patient requires monitoring" },
  { key: "lab_results", label: "Awaiting lab results" },
  { key: "doctor_review", label: "Doctor to review" },
  { key: "family_counsel", label: "Family to be counselled" },
  { key: "discharge_expected", label: "Discharge expected tomorrow" },
];

const NursingHandoverTask: React.FC<Props> = ({ task, shift, wards, onComplete }) => {
  const { toast } = useToast();
  const [patients, setPatients] = useState<PatientSBAR[]>([]);
  const [nurses, setNurses] = useState<{ id: string; full_name: string }[]>([]);
  const [incomingNurse, setIncomingNurse] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Fetch active admissions for ward
    const fetchData = async () => {
      let q = supabase
        .from("admissions")
        .select(`
          id, patient_id, admitting_diagnosis,
          patients!admissions_patient_id_fkey(full_name),
          beds!admissions_bed_id_fkey(bed_number),
          wards!admissions_ward_id_fkey(name)
        `)
        .eq("status", "active");

      if (task.wardId && task.wardId !== "all") {
        q = q.eq("ward_id", task.wardId);
      }

      const { data } = await q;
      const sbars: PatientSBAR[] = (data || []).map((a: any) => ({
        patientId: a.patient_id,
        patientName: a.patients?.full_name || "Unknown",
        bed: `${a.wards?.name || "?"}-${a.beds?.bed_number || "?"}`,
        diagnosis: a.admitting_diagnosis || "",
        situation: "",
        background: a.admitting_diagnosis || "",
        assessment: "",
        recommendation: "",
        flags: {},
        open: false,
      }));
      setPatients(sbars);

      // Fetch nurses
      const { data: nurseData } = await supabase
        .from("users")
        .select("id, full_name")
        .eq("role", "nurse")
        .eq("is_active", true);
      setNurses(nurseData || []);
    };
    fetchData();
  }, [task.wardId]);

  const updatePatient = (idx: number, updates: Partial<PatientSBAR>) => {
    setPatients((p) => p.map((item, i) => (i === idx ? { ...item, ...updates } : item)));
  };

  const toggleFlag = (idx: number, flag: string) => {
    setPatients((p) =>
      p.map((item, i) =>
        i === idx ? { ...item, flags: { ...item.flags, [flag]: !item.flags[flag] } } : item
      )
    );
  };

  const handleComplete = async () => {
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;

    const sbarData = patients.map((p) => ({
      patient_id: p.patientId,
      patient_name: p.patientName,
      bed: p.bed,
      situation: p.situation,
      background: p.background,
      assessment: p.assessment,
      recommendation: p.recommendation,
      flags: p.flags,
    }));

    const { error } = await supabase.from("nursing_handovers").insert({
      hospital_id: task.hospitalId!,
      ward_id: task.wardId || wards[0]?.id,
      shift_type: shift.type,
      outgoing_nurse_id: userId!,
      incoming_nurse_id: incomingNurse || null,
      sbar_data: sbarData,
      completed_at: new Date().toISOString(),
    });

    setSaving(false);
    if (error) {
      toast({ title: "Error saving handover", description: error.message, variant: "destructive" });
    } else {
      const nurseName = nurses.find((n) => n.id === incomingNurse)?.full_name || "Next nurse";
      toast({ title: `Handover completed. ${nurseName} has been notified.` });
      onComplete();
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="text-center">
        <h3 className="text-base font-bold text-foreground">
          Shift Handover — {shiftLabels[shift.type] || shift.label}
        </h3>
        <p className="text-xs text-muted-foreground mt-1">Complete SBAR for each patient</p>
      </div>

      {/* Patient accordions */}
      <div className="space-y-2">
        {patients.map((p, idx) => (
          <div key={p.patientId} className="bg-card rounded-lg border border-border overflow-hidden">
            <button
              onClick={() => updatePatient(idx, { open: !p.open })}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/50 active:scale-[0.99] transition-colors"
            >
              <div>
                <span className="text-sm font-semibold text-foreground">{p.patientName}</span>
                <span className="text-xs text-muted-foreground ml-3">{p.bed}</span>
              </div>
              <span className="text-xs text-muted-foreground">{p.open ? "▲" : "▼"}</span>
            </button>

            {p.open && (
              <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
                {[
                  { key: "situation" as const, label: "S — Situation", placeholder: "What's happening with this patient now?" },
                  { key: "background" as const, label: "B — Background", placeholder: "Relevant history / reason for admission" },
                  { key: "assessment" as const, label: "A — Assessment", placeholder: "Your clinical assessment" },
                  { key: "recommendation" as const, label: "R — Recommendation", placeholder: "What needs to happen next shift?" },
                ].map((f) => (
                  <div key={f.key}>
                    <Label className="text-xs font-semibold">{f.label}</Label>
                    <Textarea
                      rows={2}
                      value={p[f.key]}
                      onChange={(e) => updatePatient(idx, { [f.key]: e.target.value })}
                      placeholder={f.placeholder}
                      className="mt-1 text-sm"
                    />
                  </div>
                ))}

                <div className="space-y-2 mt-2">
                  {flagOptions.map((fl) => (
                    <label key={fl.key} className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={!!p.flags[fl.key]}
                        onCheckedChange={() => toggleFlag(idx, fl.key)}
                      />
                      <span className="text-xs text-foreground">{fl.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {patients.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">No active admissions in this ward</p>
      )}

      {/* Incoming nurse */}
      <div>
        <Label className="text-xs font-semibold">Incoming Nurse</Label>
        <select
          value={incomingNurse}
          onChange={(e) => setIncomingNurse(e.target.value)}
          className="mt-1 w-full h-11 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Select incoming nurse</option>
          {nurses.map((n) => (
            <option key={n.id} value={n.id}>{n.full_name}</option>
          ))}
        </select>
      </div>

      <Button
        onClick={handleComplete}
        disabled={saving}
        className="w-full h-[52px] text-sm font-bold"
      >
        {saving ? "Saving…" : "✓ Complete Handover"}
      </Button>
    </div>
  );
};

export default NursingHandoverTask;
