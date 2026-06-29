import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { X, Search, Plus, Trash2 } from "lucide-react";
import { calculateDobFromAge, createPatientRecord, type PatientGender } from "@/lib/patient-records";
import type { PrescriptionItem } from "./PrescriptionQueue";

interface Props {
  hospitalId: string;
  open: boolean;
  onClose: () => void;
  onCreate: (item: PrescriptionItem) => void;
}

interface PatientSearchResult {
  id: string;
  full_name: string;
  uhid: string;
  phone: string | null;
  gender: string | null;
  dob: string | null;
  blood_group: string | null;
}

interface ManualDrugItem {
  drug_name: string;
  dose: string;
  route: string;
  frequency: string;
  quantity: number;
}

const genders: PatientGender[] = ["male", "female", "other"];

const ManualDispenseModal: React.FC<Props> = ({ hospitalId, open, onClose, onCreate }) => {
  const { toast } = useToast();
  const [patientQuery, setPatientQuery] = useState("");
  const [patientResults, setPatientResults] = useState<PatientSearchResult[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientSearchResult | null>(null);
  const [drugQuery, setDrugQuery] = useState("");
  const [drugResults, setDrugResults] = useState<{ id: string; drug_name: string; generic_name: string | null }[]>([]);
  const [manualDrugs, setManualDrugs] = useState<ManualDrugItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [newPatient, setNewPatient] = useState({
    full_name: "",
    phone: "",
    age: "",
    gender: "female" as PatientGender,
  });

  useEffect(() => {
    if (!open) return;

    if (patientQuery.trim().length < 2) {
      setPatientResults([]);
      return;
    }

    const timer = window.setTimeout(async () => {
      const search = patientQuery.trim();
      const { data, error } = await supabase
        .from("patients")
        .select("id, full_name, uhid, phone, gender, dob, blood_group")
        .eq("hospital_id", hospitalId)
        .or(`full_name.ilike.%${search}%,phone.ilike.%${search}%,uhid.ilike.%${search}%`)
        .order("created_at", { ascending: false })
        .limit(8);

      if (!error) setPatientResults((data as PatientSearchResult[]) || []);
    }, 250);

    return () => window.clearTimeout(timer);
  }, [open, patientQuery, hospitalId]);

  useEffect(() => {
    if (!open) return;

    if (drugQuery.trim().length < 2) {
      setDrugResults([]);
      return;
    }

    const timer = window.setTimeout(async () => {
      const search = drugQuery.trim();
      const { data, error } = await supabase
        .from("drug_master")
        .select("id, drug_name, generic_name")
        .eq("hospital_id", hospitalId)
        .eq("is_active", true)
        .or(`drug_name.ilike.%${search}%,generic_name.ilike.%${search}%`)
        .order("drug_name", { ascending: true })
        .limit(8);

      if (!error) setDrugResults(data || []);
    }, 250);

    return () => window.clearTimeout(timer);
  }, [open, drugQuery, hospitalId]);

  const resetState = () => {
    setPatientQuery("");
    setPatientResults([]);
    setSelectedPatient(null);
    setDrugQuery("");
    setDrugResults([]);
    setManualDrugs([]);
    setNewPatient({ full_name: "", phone: "", age: "", gender: "female" });
    setSaving(false);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const addDrug = (drug: { drug_name: string }) => {
    setManualDrugs((prev) => {
      const existing = prev.find((item) => item.drug_name === drug.drug_name);
      if (existing) {
        return prev.map((item) =>
          item.drug_name === drug.drug_name ? { ...item, quantity: item.quantity + 1 } : item,
        );
      }

      return [
        ...prev,
        {
          drug_name: drug.drug_name,
          dose: "1 unit",
          route: "Oral",
          frequency: "BD",
          quantity: 1,
        },
      ];
    });
    setDrugQuery("");
    setDrugResults([]);
  };

  const updateDrug = (index: number, updates: Partial<ManualDrugItem>) => {
    setManualDrugs((prev) => prev.map((item, idx) => (idx === index ? { ...item, ...updates } : item)));
  };

  const removeDrug = (index: number) => {
    setManualDrugs((prev) => prev.filter((_, idx) => idx !== index));
  };

  const activePatientLabel = useMemo(() => {
    if (selectedPatient) return `${selectedPatient.full_name} · ${selectedPatient.uhid}`;
    if (newPatient.full_name.trim()) return `${newPatient.full_name.trim()} · New patient`;
    return "No patient selected";
  }, [selectedPatient, newPatient.full_name]);

  const handleCreate = async () => {
    if (!selectedPatient && !newPatient.full_name.trim()) {
      toast({ title: "Select or add a patient", variant: "destructive" });
      return;
    }

    if (manualDrugs.length === 0) {
      toast({ title: "Add at least one drug", variant: "destructive" });
      return;
    }

    setSaving(true);

    try {
      const resolvedPatient =
        selectedPatient ||
        (await createPatientRecord({
          hospitalId,
          fullName: newPatient.full_name,
          phone: newPatient.phone,
          dob: calculateDobFromAge(parseInt(newPatient.age, 10) || undefined),
          gender: newPatient.gender,
        }));

      const { data: admission } = await supabase
        .from("admissions")
        .select("id, admitted_at, wards(name), beds(bed_number)")
        .eq("hospital_id", hospitalId)
        .eq("patient_id", resolvedPatient.id)
        .eq("status", "active")
        .order("admitted_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      onCreate({
        id: `manual-${Date.now()}`,
        source: "prescription",
        patient_name: resolvedPatient.full_name,
        uhid: resolvedPatient.uhid,
        ward_name: (admission?.wards as { name?: string } | null)?.name || undefined,
        bed_number: (admission?.beds as { bed_number?: string } | null)?.bed_number || undefined,
        doctor_name: "Manual request",
        status: "pending",
        drug_count: manualDrugs.length,
        dispensed_count: 0,
        patient_id: resolvedPatient.id,
        admission_id: admission?.id || undefined,
        drugs: manualDrugs.map((drug) => ({
          drug_name: drug.drug_name,
          dose: drug.dose,
          route: drug.route,
          frequency: drug.frequency,
          quantity: drug.quantity,
        })),
      });

      toast({ title: `Manual dispense ready — ${resolvedPatient.full_name}` });
      handleClose();
    } catch (error: any) {
      toast({ title: "Could not create manual dispense", description: error.message, variant: "destructive" });
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm" onClick={handleClose}>
      <div
        className="w-[min(880px,calc(100vw-32px))] max-h-[calc(100vh-48px)] overflow-hidden rounded-2xl border border-border bg-card shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-foreground">Manual Dispense Request</h2>
            <p className="text-xs text-muted-foreground">Search patient records or add a new patient, then add drugs to dispense.</p>
          </div>
          <button onClick={handleClose} className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <X size={18} />
          </button>
        </div>

        <div className="grid grid-cols-[1.1fr_1fr] gap-0">
          <div className="border-r border-border">
            <div className="border-b border-border px-5 py-4 space-y-3">
              <div>
                <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Fetch patient from database</label>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={patientQuery}
                    onChange={(event) => setPatientQuery(event.target.value)}
                    placeholder="Search by name, phone or UHID"
                    className="pl-9"
                  />
                </div>
              </div>

              <div className="rounded-lg border border-border bg-muted/20 p-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Selected patient</p>
                <p className="mt-1 text-sm font-medium text-foreground">{activePatientLabel}</p>
              </div>
            </div>

            <ScrollArea className="h-[240px] px-5 py-3">
              <div className="space-y-2">
                {patientResults.map((patient) => (
                  <button
                    key={patient.id}
                    onClick={() => {
                      setSelectedPatient(patient);
                      setNewPatient({ full_name: "", phone: "", age: "", gender: "female" });
                    }}
                    className={`w-full rounded-lg border px-3 py-3 text-left transition-all active:scale-[0.98] ${
                      selectedPatient?.id === patient.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{patient.full_name}</p>
                        <p className="text-[11px] text-muted-foreground">{patient.uhid}{patient.phone ? ` · ${patient.phone}` : ""}</p>
                      </div>
                      {patient.blood_group && <Badge variant="secondary">{patient.blood_group}</Badge>}
                    </div>
                  </button>
                ))}
                {patientQuery.trim().length >= 2 && patientResults.length === 0 && (
                  <p className="py-6 text-center text-xs text-muted-foreground">No patient found. Add a new patient below.</p>
                )}
              </div>
            </ScrollArea>

            <div className="border-t border-border px-5 py-4">
              <p className="mb-3 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">New patient details</p>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  value={newPatient.full_name}
                  onChange={(event) => {
                    setSelectedPatient(null);
                    setNewPatient((prev) => ({ ...prev, full_name: event.target.value }));
                  }}
                  placeholder="Patient full name"
                />
                <Input
                  value={newPatient.phone}
                  onChange={(event) => {
                    setSelectedPatient(null);
                    setNewPatient((prev) => ({ ...prev, phone: event.target.value }));
                  }}
                  placeholder="Phone number"
                />
                <Input
                  value={newPatient.age}
                  onChange={(event) => {
                    setSelectedPatient(null);
                    setNewPatient((prev) => ({ ...prev, age: event.target.value }));
                  }}
                  placeholder="Age"
                  type="number"
                  min={0}
                />
                <div className="flex items-center gap-1 rounded-lg border border-border bg-background p-1">
                  {genders.map((gender) => (
                    <button
                      key={gender}
                      type="button"
                      onClick={() => {
                        setSelectedPatient(null);
                        setNewPatient((prev) => ({ ...prev, gender }));
                      }}
                      className={`flex-1 rounded-md px-2 py-2 text-[11px] font-medium capitalize transition-colors ${
                        newPatient.gender === gender ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {gender}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col">
            <div className="border-b border-border px-5 py-4 space-y-3">
              <div>
                <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Add drugs</label>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={drugQuery}
                    onChange={(event) => setDrugQuery(event.target.value)}
                    placeholder="Search drug master"
                    className="pl-9"
                  />
                </div>
              </div>

              {drugResults.length > 0 && (
                <div className="rounded-xl border border-border bg-background p-2">
                  {drugResults.map((drug) => (
                    <button
                      key={drug.id}
                      onClick={() => addDrug(drug)}
                      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted"
                    >
                      <div>
                        <p className="text-sm font-semibold text-foreground">{drug.drug_name}</p>
                        {drug.generic_name && <p className="text-[11px] text-muted-foreground">{drug.generic_name}</p>}
                      </div>
                      <Plus size={14} className="text-primary" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <ScrollArea className="h-[416px] px-5 py-4">
              <div className="space-y-3">
                {manualDrugs.length === 0 && (
                  <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                    Add at least one drug for this manual dispense.
                  </div>
                )}

                {manualDrugs.map((drug, index) => (
                  <div key={`${drug.drug_name}-${index}`} className="rounded-xl border border-border bg-background p-4">
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{drug.drug_name}</p>
                        <p className="text-[11px] text-muted-foreground">Will open in IP dispensing workspace for stock + 5-rights verification.</p>
                      </div>
                      <button onClick={() => removeDrug(index)} className="rounded-md p-1 text-destructive transition-colors hover:bg-destructive/10">
                        <Trash2 size={14} />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <Input value={drug.dose} onChange={(event) => updateDrug(index, { dose: event.target.value })} placeholder="Dose" />
                      <Input value={drug.route} onChange={(event) => updateDrug(index, { route: event.target.value })} placeholder="Route" />
                      <Input value={drug.frequency} onChange={(event) => updateDrug(index, { frequency: event.target.value })} placeholder="Frequency" />
                      <Input
                        value={drug.quantity}
                        onChange={(event) => updateDrug(index, { quantity: Math.max(1, parseInt(event.target.value, 10) || 1) })}
                        placeholder="Qty"
                        type="number"
                        min={1}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>

            <div className="border-t border-border px-5 py-4">
              <Button className="w-full h-11 text-sm font-bold" disabled={saving} onClick={handleCreate}>
                {saving ? "Opening workspace…" : "Create Manual Dispense"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ManualDispenseModal;