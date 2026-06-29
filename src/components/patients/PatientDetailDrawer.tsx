import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { X, Phone, MapPin, Shield, Heart, Pencil, Trash2, FileJson, Loader2, Info } from "lucide-react";
import ChronicDiseaseSection from "@/components/clinical/ChronicDiseaseSection";
import PatientDocuments from "@/components/clinical/PatientDocuments";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Patient {
  id: string;
  uhid: string;
  full_name: string;
  phone: string | null;
  gender: string | null;
  dob: string | null;
  blood_group: string | null;
  allergies: string | null;
  chronic_conditions: string[] | null;
  insurance_id: string | null;
  abha_id: string | null;
  address: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  created_at: string;
  email?: string | null;
}

interface Visit {
  id: string;
  visit_date: string;
  chief_complaint: string | null;
  diagnosis: string | null;
}

interface Props {
  patient: Patient;
  onClose: () => void;
  onUpdated?: () => void;
  onDeleted?: () => void;
}

const bloodGroups = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const genders = ["male", "female", "other"];

function getAge(dob: string | null): string {
  if (!dob) return "—";
  const years = Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  return `${years} years`;
}

const initials = (name: string) =>
  name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();

const PatientDetailDrawer: React.FC<Props> = ({ patient, onClose, onUpdated, onDeleted }) => {
  const { toast } = useToast();
  const [visits, setVisits] = useState<Visit[]>([]);
  const [hospitalId, setHospitalId] = useState<string>("");
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [exportingFhir, setExportingFhir] = useState(false);
  const [fhirBannerVisible, setFhirBannerVisible] = useState(false);

  const handleExportFHIR = async () => {
    setExportingFhir(true);
    try {
      const { data, error } = await supabase.functions.invoke("fhir-export", {
        body: { patient_id: patient.id },
      });
      if (error) throw error;
      const bundle = typeof data === "string" ? JSON.parse(data) : data;
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/fhir+json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `patient_${patient.uhid || patient.id}_fhir_r4.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setFhirBannerVisible(true);
      toast({ title: "FHIR R4 Bundle exported" });
    } catch (e: any) {
      toast({ title: "FHIR export failed", description: e?.message || "Unknown error", variant: "destructive" });
    } finally {
      setExportingFhir(false);
    }
  };

  const [editForm, setEditForm] = useState({
    full_name: patient.full_name,
    phone: patient.phone || "",
    email: (patient as any).email || "",
    gender: patient.gender || "",
    dob: patient.dob || "",
    blood_group: patient.blood_group || "",
    address: patient.address || "",
    allergies: patient.allergies || "",
    chronic_conditions: patient.chronic_conditions?.join(", ") || "",
    insurance_id: patient.insurance_id || "",
    emergency_contact_name: patient.emergency_contact_name || "",
    emergency_contact_phone: patient.emergency_contact_phone || "",
  });

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data } = await supabase.from("users").select("id, hospital_id").eq("auth_user_id", user.id).maybeSingle();
      if (data) { setHospitalId(data.hospital_id); setCurrentUserId(data.id); }
    });
  }, []);

  useEffect(() => {
    supabase.from("opd_encounters").select("id, visit_date, chief_complaint, diagnosis")
      .eq("patient_id", patient.id).order("visit_date", { ascending: false }).limit(5)
      .then(({ data }) => setVisits((data as Visit[]) || []));
  }, [patient.id]);

  const startEdit = () => {
    setEditForm({
      full_name: patient.full_name,
      phone: patient.phone || "",
      email: (patient as any).email || "",
      gender: patient.gender || "",
      dob: patient.dob || "",
      blood_group: patient.blood_group || "",
      address: patient.address || "",
      allergies: patient.allergies || "",
      chronic_conditions: patient.chronic_conditions?.join(", ") || "",
      insurance_id: patient.insurance_id || "",
      emergency_contact_name: patient.emergency_contact_name || "",
      emergency_contact_phone: patient.emergency_contact_phone || "",
    });
    setEditing(true);
  };

  const handleSave = async () => {
    if (!editForm.full_name.trim()) {
      toast({ title: "Patient name is required", variant: "destructive" }); return;
    }
    if (editForm.phone && !/^\d{10}$/.test(editForm.phone.replace(/\s/g, ""))) {
      toast({ title: "Phone must be exactly 10 digits", variant: "destructive" }); return;
    }
    setSaving(true);
    const chronic = editForm.chronic_conditions.split(",").map(s => s.trim()).filter(Boolean);
    const { error } = await supabase.from("patients").update({
      full_name: editForm.full_name.trim(),
      phone: editForm.phone || null,
      gender: editForm.gender || null,
      dob: editForm.dob || null,
      blood_group: editForm.blood_group || null,
      address: editForm.address || null,
      allergies: editForm.allergies || null,
      chronic_conditions: chronic.length ? chronic : null,
      insurance_id: editForm.insurance_id || null,
      emergency_contact_name: editForm.emergency_contact_name || null,
      emergency_contact_phone: editForm.emergency_contact_phone || null,
    } as any).eq("id", patient.id);
    setSaving(false);
    if (error) {
      toast({ title: "Failed to update patient", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Patient details updated" });
      setEditing(false);
      onUpdated?.();
    }
  };

  const handleDelete = async () => {
    setDeleting(true); setDeleteError("");
    // Check active admissions
    const { count: admCount } = await supabase.from("admissions").select("*", { count: "exact", head: true })
      .eq("patient_id", patient.id).neq("status", "discharged");
    if ((admCount ?? 0) > 0) {
      setDeleteError("Cannot delete patient with active admissions. Please discharge first.");
      setDeleting(false); return;
    }
    // Check unpaid bills
    const { count: billCount } = await supabase.from("bills").select("*", { count: "exact", head: true })
      .eq("patient_id", patient.id).neq("payment_status", "paid");
    if ((billCount ?? 0) > 0) {
      setDeleteError("Cannot delete patient with unpaid bills. Please settle bills first.");
      setDeleting(false); return;
    }
    // Soft delete
    const { error } = await supabase.from("patients").update({ is_active: false } as any).eq("id", patient.id);
    setDeleting(false);
    if (error) {
      toast({ title: "Failed to delete patient", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Patient removed from active records" });
      setShowDeleteConfirm(false);
      onDeleted?.();
      onClose();
    }
  };

  const set = (field: string, value: string) => setEditForm(f => ({ ...f, [field]: value }));
  const inputClass = "h-8 text-sm";

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/25" onClick={onClose}>
      <div className="w-full max-w-md h-full bg-card shadow-lg overflow-y-auto animate-in slide-in-from-right duration-200" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border px-5 py-4 flex items-start gap-4 z-10">
          <div className="h-11 w-11 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-sm font-bold flex-shrink-0">
            {initials(patient.full_name)}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-foreground truncate">{patient.full_name}</h2>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <Badge variant="outline" className="text-[10px]">{patient.uhid}</Badge>
              <span className="text-xs text-muted-foreground">{getAge(patient.dob)} {patient.gender ? `· ${patient.gender}` : ""}</span>
              {patient.blood_group && <Badge variant="outline" className="text-[10px] border-destructive/30 text-destructive">{patient.blood_group}</Badge>}
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {!editing && (
              <>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={startEdit} title="Edit Patient">
                  <Pencil size={14} />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setShowDeleteConfirm(true)} title="Delete Patient">
                  <Trash2 size={14} />
                </Button>
              </>
            )}
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}><X size={16} /></Button>
          </div>
        </div>

        <div className="p-5 space-y-5">
          {editing ? (
            /* ====== EDIT MODE ====== */
            <div className="space-y-4">
              <Section title="Basic Details">
                <div className="space-y-2">
                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground mb-0.5 block">Full Name *</label>
                    <Input value={editForm.full_name} onChange={(e) => set("full_name", e.target.value)} className={inputClass} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[11px] font-medium text-muted-foreground mb-0.5 block">Phone</label>
                      <Input value={editForm.phone} onChange={(e) => set("phone", e.target.value)} placeholder="10 digits" className={inputClass} />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-muted-foreground mb-0.5 block">Date of Birth</label>
                      <Input type="date" value={editForm.dob} onChange={(e) => set("dob", e.target.value)} max={new Date().toISOString().split("T")[0]} className={inputClass} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[11px] font-medium text-muted-foreground mb-0.5 block">Gender</label>
                      <select value={editForm.gender} onChange={(e) => set("gender", e.target.value)} className="w-full h-8 text-sm border border-border rounded-md px-2 bg-background">
                        <option value="">Select...</option>
                        {genders.map(g => <option key={g} value={g} className="capitalize">{g}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-muted-foreground mb-0.5 block">Blood Group</label>
                      <select value={editForm.blood_group} onChange={(e) => set("blood_group", e.target.value)} className="w-full h-8 text-sm border border-border rounded-md px-2 bg-background">
                        <option value="">Select...</option>
                        {bloodGroups.map(bg => <option key={bg} value={bg}>{bg}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground mb-0.5 block">Address</label>
                    <Input value={editForm.address} onChange={(e) => set("address", e.target.value)} className={inputClass} />
                  </div>
                </div>
              </Section>

              <Section title="Medical Info">
                <div className="space-y-2">
                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground mb-0.5 block">Allergies</label>
                    <Input value={editForm.allergies} onChange={(e) => set("allergies", e.target.value)} placeholder="Comma-separated" className={inputClass} />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground mb-0.5 block">Chronic Conditions</label>
                    <Input value={editForm.chronic_conditions} onChange={(e) => set("chronic_conditions", e.target.value)} placeholder="DM, HTN (comma-separated)" className={inputClass} />
                  </div>
                </div>
              </Section>

              <Section title="Insurance / ID">
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground mb-0.5 block">Insurance / TPA ID</label>
                  <Input value={editForm.insurance_id} onChange={(e) => set("insurance_id", e.target.value)} className={inputClass} />
                </div>
              </Section>

              <Section title="Emergency Contact">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground mb-0.5 block">Name</label>
                    <Input value={editForm.emergency_contact_name} onChange={(e) => set("emergency_contact_name", e.target.value)} className={inputClass} />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground mb-0.5 block">Phone</label>
                    <Input value={editForm.emergency_contact_phone} onChange={(e) => set("emergency_contact_phone", e.target.value)} className={inputClass} />
                  </div>
                </div>
              </Section>

              <div className="flex gap-2 pt-2">
                <Button onClick={handleSave} disabled={saving} className="flex-1" size="sm">
                  {saving ? "Saving…" : "Save Changes"}
                </Button>
                <Button variant="outline" onClick={() => setEditing(false)} size="sm">Cancel</Button>
              </div>
            </div>
          ) : (
            /* ====== VIEW MODE ====== */
            <>
              <div className="space-y-2">
                <Button size="sm" variant="outline" className="w-full" onClick={handleExportFHIR} disabled={exportingFhir}>
                  {exportingFhir ? <Loader2 size={14} className="animate-spin mr-1" /> : <FileJson size={14} className="mr-1" />}
                  Export FHIR R4
                </Button>
                {fhirBannerVisible && (
                  <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-2 text-[11px] text-foreground">
                    <Info size={12} className="text-primary mt-0.5 flex-shrink-0" />
                    <span>FHIR R4 Bundle generated — contains Patient, Encounter, and Condition resources for ABDM Health Record sharing.</span>
                  </div>
                )}
              </div>

              <Section title="Contact">
                {patient.phone && (
                  <Row icon={<Phone size={14} />}>
                    <a href={`tel:${patient.phone}`} className="text-sm text-primary hover:underline">{patient.phone}</a>
                  </Row>
                )}
                {patient.address && (
                  <Row icon={<MapPin size={14} />}>
                    <span className="text-sm text-foreground">{patient.address}</span>
                  </Row>
                )}
                {!patient.phone && !patient.address && <Empty />}
              </Section>

              <Section title="Medical Info">
                <div className="space-y-2">
                  <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Allergies</label>
                  {patient.allergies ? (
                    <div className="flex flex-wrap gap-1">
                      {patient.allergies.split(",").map((a, i) => (
                        <Badge key={i} variant="destructive" className="text-[10px]">{a.trim()}</Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-success">No known allergies</p>
                  )}
                </div>
                <div className="space-y-2 mt-3">
                  <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Chronic Conditions</label>
                  {patient.chronic_conditions?.length ? (
                    <div className="flex flex-wrap gap-1">
                      {patient.chronic_conditions.map((c, i) => (
                        <Badge key={i} variant="secondary" className="text-[10px]">{c}</Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">None recorded</p>
                  )}
                </div>
              </Section>

              <Section title="Insurance / ID">
                <Row icon={<Shield size={14} />}>
                  <span className="text-sm">{patient.insurance_id || "Self-pay"}</span>
                </Row>
                {patient.abha_id && (
                  <Row icon={<Heart size={14} />}>
                    <span className="text-sm">ABHA: {patient.abha_id}</span>
                  </Row>
                )}
              </Section>

              {(patient.emergency_contact_name || patient.emergency_contact_phone) && (
                <Section title="Emergency Contact">
                  <p className="text-sm text-foreground">{patient.emergency_contact_name}</p>
                  {patient.emergency_contact_phone && (
                    <a href={`tel:${patient.emergency_contact_phone}`} className="text-sm text-primary hover:underline">{patient.emergency_contact_phone}</a>
                  )}
                </Section>
              )}

              <ChronicDiseaseSection patientId={patient.id} hospitalId={hospitalId} />

              <Section title="Recent OPD Visits">
                {visits.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No previous visits</p>
                ) : (
                  <div className="space-y-2">
                    {visits.map((v) => (
                      <div key={v.id} className="bg-muted rounded-lg p-3">
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-medium text-foreground">
                            {new Date(v.visit_date!).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                          </span>
                        </div>
                        {v.chief_complaint && <p className="text-xs text-muted-foreground mt-1">{v.chief_complaint}</p>}
                        {v.diagnosis && <Badge variant="outline" className="text-[10px] mt-1">{v.diagnosis}</Badge>}
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              {hospitalId && currentUserId && (
                <PatientDocuments patientId={patient.id} hospitalId={hospitalId} userId={currentUserId} />
              )}
            </>
          )}
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {patient.full_name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will mark the patient as inactive. They will no longer appear in the patient list but their records will be preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && <p className="text-sm text-destructive font-medium">{deleteError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteError("")}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting ? "Checking…" : "Delete Patient"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">{title}</h3>
    {children}
  </div>
);

const Row: React.FC<{ icon: React.ReactNode; children: React.ReactNode }> = ({ icon, children }) => (
  <div className="flex items-center gap-2 text-muted-foreground">{icon}{children}</div>
);

const Empty = () => <p className="text-xs text-muted-foreground">No details available</p>;

export default PatientDetailDrawer;