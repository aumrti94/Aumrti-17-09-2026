import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useHospitalId } from "@/hooks/useHospitalId";
import { Video, Send } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

const DURATIONS = [15, 30, 45];

const ScheduleTeleconsultModal: React.FC<Props> = ({ open, onOpenChange, onCreated }) => {
  const { toast } = useToast();
  const { hospitalId } = useHospitalId();
  const [patientSearch, setPatientSearch] = useState("");
  const [patients, setPatients] = useState<any[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<any>(null);
  const [doctorId, setDoctorId] = useState("");
  const [doctors, setDoctors] = useState<any[]>([]);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState(15);
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (!open || !hospitalId) return;
    supabase.from("users").select("id, full_name").eq("hospital_id", hospitalId).eq("role", "doctor").then(({ data }) => {
      setDoctors(data || []);
    });
  }, [open]);

  const searchPatients = async (q: string) => {
    setPatientSearch(q);
    if (q.length < 2) { setPatients([]); return; }
    const { data } = await supabase.from("patients").select("id, full_name, uhid, phone").ilike("full_name", `%${q}%`).limit(8);
    setPatients(data || []);
  };

  const pickPatient = (p: any) => {
    setSelectedPatient(p);
    setPatientSearch(p.full_name);
    setPhone(p.phone || "");
    setPatients([]);
  };

  const handleCreate = async () => {
    if (!selectedPatient || !doctorId || !date || !time) {
      toast({ title: "Please fill all required fields", variant: "destructive" });
      return;
    }
    setSaving(true);
    const scheduledAt = new Date(`${date}T${time}`).toISOString();
    const roomId = crypto.randomUUID();

    const hId = (await supabase.from("users").select("hospital_id").eq("auth_user_id", (await supabase.auth.getUser()).data.user?.id).maybeSingle()).data?.hospital_id;
    const { data: newSession, error } = await supabase.from("teleconsult_sessions").insert({
      patient_id: selectedPatient.id,
      doctor_id: doctorId,
      room_id: roomId,
      scheduled_at: scheduledAt,
      duration_minutes: duration,
      patient_phone: phone,
      hospital_id: hId,
    }).select("id").maybeSingle();

    setSaving(false);
    if (error) {
      toast({ title: "Failed to schedule", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Teleconsult scheduled ✓" });
    onCreated();
    onOpenChange(false);

    // Open WhatsApp invite with portal join link
    if (phone) {
      const doctor = doctors.find(d => d.id === doctorId);
      const joinUrl = newSession?.id
        ? `${window.location.origin}/join/${newSession.id}`
        : `https://meet.jit.si/HMS-${roomId}`;
      const msg = `🏥 Teleconsult Scheduled!\n\nDoctor: ${doctor?.full_name || "Doctor"}\nDate: ${date}\nTime: ${time}\nDuration: ${duration} min\n\nJoin here: ${joinUrl}\n\nPlease join 5 minutes early.`;
      const clean = phone.replace(/\D/g, "");
      const intl = clean.startsWith("91") ? clean : `91${clean}`;
      window.open(`https://wa.me/${intl}?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");
    }

    // Reset
    setSelectedPatient(null);
    setPatientSearch("");
    setDoctorId("");
    setDate("");
    setTime("");
    setDuration(15);
    setPhone("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Video size={18} /> Schedule Teleconsult</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Patient search */}
          <div className="relative">
            <Label>Patient *</Label>
            <Input placeholder="Search patient name..." value={patientSearch} onChange={e => searchPatients(e.target.value)} />
            {patients.length > 0 && (
              <div className="absolute z-50 top-full left-0 right-0 bg-card border rounded-md shadow-lg max-h-40 overflow-y-auto mt-1">
                {patients.map(p => (
                  <button key={p.id} className="w-full text-left px-3 py-2 text-sm hover:bg-muted" onClick={() => pickPatient(p)}>
                    {p.full_name} <span className="text-muted-foreground">({p.uhid})</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Doctor */}
          <div>
            <Label>Doctor *</Label>
            <Select value={doctorId} onValueChange={setDoctorId}>
              <SelectTrigger><SelectValue placeholder="Select doctor" /></SelectTrigger>
              <SelectContent>
                {doctors.map(d => <SelectItem key={d.id} value={d.id}>{d.full_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Date + Time */}
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Date *</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
            <div><Label>Time *</Label><Input type="time" value={time} onChange={e => setTime(e.target.value)} /></div>
          </div>

          {/* Duration pills */}
          <div>
            <Label>Duration</Label>
            <div className="flex gap-2 mt-1">
              {DURATIONS.map(d => (
                <button key={d} onClick={() => setDuration(d)} className={cn(
                  "px-4 py-1.5 rounded-full text-sm font-medium border transition-colors",
                  duration === d ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted"
                )}>{d} min</button>
              ))}
            </div>
          </div>

          {/* Phone */}
          <div>
            <Label>Patient Phone</Label>
            <Input placeholder="9876543210" value={phone} onChange={e => setPhone(e.target.value)} />
          </div>

          <Button onClick={handleCreate} disabled={saving} className="w-full gap-2">
            <Send size={16} /> {saving ? "Scheduling..." : "Schedule & Send WhatsApp Invite"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ScheduleTeleconsultModal;
