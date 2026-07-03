import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { Loader2, Search, BedDouble } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  hospitalId: string;
  preselectedBedId?: string | null;
  preselectedWardId?: string | null;
  preselectedBedNumber?: string | null;
  onReserved: () => void;
}

interface PatientResult {
  id: string;
  full_name: string;
  uhid: string;
  phone: string | null;
  dob: string | null;
  gender: string | null;
}

interface BedOption {
  id: string;
  bed_number: string;
  ward_id: string;
  ward_name: string;
}

const BedReservationModal: React.FC<Props> = ({
  open, onClose, hospitalId,
  preselectedBedId, preselectedWardId, preselectedBedNumber,
  onReserved,
}) => {
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<PatientResult[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientResult | null>(null);

  const [doctors, setDoctors] = useState<{ id: string; full_name: string }[]>([]);
  const [availableBeds, setAvailableBeds] = useState<BedOption[]>([]);

  const [bedId, setBedId] = useState(preselectedBedId || "");
  const [doctorId, setDoctorId] = useState("");
  const [plannedDate, setPlannedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (!open || !hospitalId) return;

    // Reset on open
    setSearch(""); setResults([]); setSelectedPatient(null);
    setBedId(preselectedBedId || ""); setDoctorId("");
    setPlannedDate(""); setNotes("");

    // Load doctors
    supabase.from("users")
      .select("id, full_name")
      .eq("hospital_id", hospitalId)
      .eq("role", "doctor")
      .eq("is_active", true)
      .order("full_name")
      .then(({ data }) => setDoctors(data || []));

    // Load available beds (only if no bed pre-selected)
    if (!preselectedBedId) {
      supabase.from("beds")
        .select("id, bed_number, ward_id, ward:wards(name)")
        .eq("hospital_id", hospitalId)
        .eq("status", "available")
        .eq("is_active", true)
        .order("bed_number")
        .then(({ data }) => {
          setAvailableBeds((data || []).map((b: any) => ({
            id: b.id,
            bed_number: b.bed_number,
            ward_id: b.ward_id,
            ward_name: b.ward?.name || "—",
          })));
        });
    }
  }, [open, hospitalId, preselectedBedId]);

  const handleSearch = async () => {
    if (!search.trim()) return;
    setSearching(true);
    const q = search.trim();
    const { data } = await supabase.from("patients")
      .select("id, full_name, uhid, phone, dob, gender")
      .eq("hospital_id", hospitalId)
      .or(`full_name.ilike.%${q}%,uhid.ilike.%${q}%,phone.ilike.%${q}%`)
      .limit(8);
    setResults(data || []);
    setSearching(false);
  };

  const handleSubmit = async () => {
    if (!selectedPatient) { toast({ title: "Select a patient", variant: "destructive" }); return; }
    if (!bedId) { toast({ title: "Select a bed", variant: "destructive" }); return; }
    if (!plannedDate) { toast({ title: "Set planned admission date", variant: "destructive" }); return; }
    if (plannedDate < today) { toast({ title: "Planned date cannot be in the past", variant: "destructive" }); return; }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: userData } = await (supabase as any)
        .from("users").select("id").eq("auth_user_id", user?.id ?? "").maybeSingle();

      // Create reservation
      const { error: resErr } = await (supabase as any).from("bed_reservations").insert({
        hospital_id: hospitalId,
        bed_id: bedId,
        patient_id: selectedPatient.id,
        doctor_id: doctorId || null,
        planned_admission_date: plannedDate,
        reserved_by: userData?.id ?? null,
        notes: notes.trim() || null,
        status: "reserved",
      });
      if (resErr) throw resErr;

      // Mark bed as reserved
      const { error: bedErr } = await supabase.from("beds")
        .update({ status: "reserved" as any })
        .eq("id", bedId);
      if (bedErr) console.error("IPD: bed status update failed:", bedErr.message);

      toast({
        title: "Bed reserved",
        description: `${selectedPatient.full_name} — ${preselectedBedNumber || bedId} on ${new Date(plannedDate).toLocaleDateString("en-IN")}`,
      });
      onReserved();
      onClose();
    } catch (err: any) {
      toast({ title: "Reservation failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BedDouble className="h-5 w-5 text-blue-500" />
            Reserve Bed
            {preselectedBedNumber && <span className="text-sm font-normal text-muted-foreground">— {preselectedBedNumber}</span>}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Patient Search */}
          <div>
            <Label className="text-xs font-semibold">Patient *</Label>
            {selectedPatient ? (
              <div className="mt-1 flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                <div>
                  <p className="text-sm font-semibold text-blue-900">{selectedPatient.full_name}</p>
                  <p className="text-xs text-blue-600">{selectedPatient.uhid} · {selectedPatient.gender || "—"}</p>
                </div>
                <button
                  onClick={() => { setSelectedPatient(null); setResults([]); setSearch(""); }}
                  className="text-xs text-blue-500 hover:text-blue-700 underline"
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="mt-1">
                <div className="flex gap-2">
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    placeholder="Search by name, UHID or phone"
                    className="h-9 text-sm flex-1"
                  />
                  <Button size="sm" variant="outline" onClick={handleSearch} disabled={searching} className="h-9 px-3">
                    {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                  </Button>
                </div>
                {results.length > 0 && (
                  <div className="mt-1 border border-border rounded-lg overflow-hidden divide-y divide-border">
                    {results.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => { setSelectedPatient(p); setResults([]); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
                      >
                        <span className="font-medium">{p.full_name}</span>
                        <span className="text-muted-foreground ml-2 text-xs">{p.uhid}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Bed selection (only if not pre-selected) */}
          {!preselectedBedId && (
            <div>
              <Label className="text-xs font-semibold">Bed *</Label>
              <select
                value={bedId}
                onChange={(e) => setBedId(e.target.value)}
                className="mt-1 w-full h-9 border border-input rounded-md px-2 text-sm bg-background"
              >
                <option value="">Select available bed</option>
                {availableBeds.map((b) => (
                  <option key={b.id} value={b.id}>{b.ward_name} — {b.bed_number}</option>
                ))}
              </select>
              {availableBeds.length === 0 && (
                <p className="text-xs text-amber-600 mt-1">No available beds at this time.</p>
              )}
            </div>
          )}

          {/* Doctor */}
          <div>
            <Label className="text-xs font-semibold">Admitting Doctor</Label>
            <select
              value={doctorId}
              onChange={(e) => setDoctorId(e.target.value)}
              className="mt-1 w-full h-9 border border-input rounded-md px-2 text-sm bg-background"
            >
              <option value="">Select doctor (optional)</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>{d.full_name}</option>
              ))}
            </select>
          </div>

          {/* Planned Date */}
          <div>
            <Label className="text-xs font-semibold">Planned Admission Date *</Label>
            <Input
              type="date"
              value={plannedDate}
              min={today}
              onChange={(e) => setPlannedDate(e.target.value)}
              className="mt-1 h-9 text-sm"
            />
          </div>

          {/* Notes */}
          <div>
            <Label className="text-xs font-semibold">Notes</Label>
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Pre-op instructions, special requirements, etc."
              className="mt-1 text-sm"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white" onClick={handleSubmit} disabled={saving}>
            {saving && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
            Reserve Bed
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default BedReservationModal;
