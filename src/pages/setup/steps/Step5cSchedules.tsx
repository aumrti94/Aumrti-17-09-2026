import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { CalendarDays, Check, Plus, Trash2 } from "lucide-react";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface Session {
  start: string;
  end: string;
  max_patients: number;
  slot_duration: number;
}

interface DoctorSchedule {
  days: string[];
  sessions: Session[];
  consultationFee: string;
  followUpFee: string;
  validityDays: string;
  saved: boolean;
}

interface Props {
  hospitalId: string;
  doctors: Array<{ id: string; name: string }>;
  onComplete: () => void;
  onSkip: () => void;
}

const defaultSessions = (): Session[] => [
  { start: "09:00", end: "13:00", max_patients: 30, slot_duration: 15 },
  { start: "17:00", end: "20:00", max_patients: 20, slot_duration: 15 },
];

const Step5cSchedules: React.FC<Props> = ({ hospitalId, doctors, onComplete, onSkip }) => {
  const { toast } = useToast();
  const [selectedDoc, setSelectedDoc] = useState<string>(doctors[0]?.id ?? "");
  const [schedules, setSchedules] = useState<Record<string, DoctorSchedule>>(
    Object.fromEntries(
      doctors.map((d) => [d.id, { days: ["Mon","Tue","Wed","Thu","Fri","Sat"], sessions: defaultSessions(), consultationFee: "500", followUpFee: "300", validityDays: "7", saved: false }])
    )
  );
  const [saving, setSaving] = useState(false);

  if (doctors.length === 0) {
    return (
      <div>
        <div className="flex items-center gap-2 mb-1">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
            <CalendarDays size={16} className="text-primary" />
          </div>
          <span className="text-xs font-semibold text-primary uppercase tracking-wide">Step 7 · OPD Schedules</span>
        </div>
        <h2 className="text-[22px] font-bold text-foreground mt-2">OPD Schedules</h2>
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-4 text-[13px] text-amber-800 mt-6">
          No doctors were added in the previous step. You can set up doctor schedules from{" "}
          <strong>Settings → Doctor Schedules</strong> after go-live.
        </div>
        <div className="flex items-center justify-between mt-8">
          <button onClick={onSkip} className="text-sm text-muted-foreground hover:text-foreground">
            Skip for now →
          </button>
          <button
            onClick={onComplete}
            className="bg-primary text-primary-foreground px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-[hsl(220,54%,16%)] transition-colors"
          >
            Continue →
          </button>
        </div>
      </div>
    );
  }

  const sched = schedules[selectedDoc] ?? { days: [], sessions: defaultSessions(), saved: false };

  const toggleDay = (day: string) => {
    setSchedules((prev) => {
      const cur = prev[selectedDoc];
      const days = cur.days.includes(day) ? cur.days.filter((d) => d !== day) : [...cur.days, day];
      return { ...prev, [selectedDoc]: { ...cur, days, saved: false } };
    });
  };

  const updateSession = (si: number, field: keyof Session, val: string | number) => {
    setSchedules((prev) => {
      const cur = prev[selectedDoc];
      const sessions = cur.sessions.map((s, idx) => idx === si ? { ...s, [field]: val } : s);
      return { ...prev, [selectedDoc]: { ...cur, sessions, saved: false } };
    });
  };

  const addSession = () => {
    setSchedules((prev) => {
      const cur = prev[selectedDoc];
      return { ...prev, [selectedDoc]: { ...cur, sessions: [...cur.sessions, { start: "08:00", end: "12:00", max_patients: 20, slot_duration: 15 }], saved: false } };
    });
  };

  const removeSession = (si: number) => {
    setSchedules((prev) => {
      const cur = prev[selectedDoc];
      if (cur.sessions.length <= 1) return prev;
      return { ...prev, [selectedDoc]: { ...cur, sessions: cur.sessions.filter((_, i) => i !== si), saved: false } };
    });
  };

  const saveDoctor = async () => {
    if (!selectedDoc) return;
    setSaving(true);
    try {
      const docName = doctors.find((d) => d.id === selectedDoc)?.name ?? "";
      await supabase.from("doctor_schedules").delete().eq("hospital_id", hospitalId).eq("doctor_id", selectedDoc);
      const rows: any[] = [];
      sched.days.forEach((day) => {
        sched.sessions.forEach((session) => {
          rows.push({
            hospital_id: hospitalId,
            doctor_id: selectedDoc,
            day_of_week: day,
            session_start: session.start,
            session_end: session.end,
            max_patients: session.max_patients,
            slot_duration_minutes: session.slot_duration,
            is_active: true,
          });
        });
      });
      if (rows.length > 0) {
        const { error } = await supabase.from("doctor_schedules").insert(rows);
        if (error) throw error;
      }
      // Upsert consultation fee into service_master so OPD booking picks it up
      const fee = parseFloat(sched.consultationFee) || 0;
      const followUpFee = parseFloat(sched.followUpFee) || 0;
      if (fee > 0) {
        const { data: existing } = await (supabase as any)
          .from("service_master")
          .select("id")
          .eq("hospital_id", hospitalId)
          .eq("doctor_id", selectedDoc)
          .eq("item_type", "consultation")
          .maybeSingle();
        const feePayload = {
          hospital_id: hospitalId,
          doctor_id: selectedDoc,
          name: `Consultation - Dr. ${docName}`,
          category: "consultation",
          item_type: "consultation",
          fee,
          follow_up_fee: followUpFee || null,
          validity_days: parseInt(sched.validityDays) || 7,
          is_active: true,
        };
        if (existing?.id) {
          await (supabase as any).from("service_master").update(feePayload).eq("id", existing.id);
        } else {
          await (supabase as any).from("service_master").insert(feePayload);
        }
      }
      setSchedules((prev) => ({ ...prev, [selectedDoc]: { ...prev[selectedDoc], saved: true } }));
      toast({ title: "Schedule saved for Dr. " + docName });
    } catch (err: any) {
      toast({ title: "Failed to save schedule", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
          <CalendarDays size={16} className="text-primary" />
        </div>
        <span className="text-xs font-semibold text-primary uppercase tracking-wide">Step 7 · OPD Schedules</span>
      </div>
      <h2 className="text-[22px] font-bold text-foreground mt-2">Doctor OPD Schedules</h2>
      <p className="text-sm text-muted-foreground mt-1 mb-5">
        Set working days and session times for each doctor.
      </p>

      <div className="bg-card rounded-2xl border border-border shadow-card flex overflow-hidden" style={{ minHeight: 320 }}>
        {/* Doctor list */}
        <div className="w-44 shrink-0 border-r border-border bg-muted/30 p-2 flex flex-col gap-1">
          {doctors.map((d) => {
            const saved = schedules[d.id]?.saved;
            return (
              <button
                key={d.id}
                onClick={() => setSelectedDoc(d.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between gap-1 transition-colors ${
                  selectedDoc === d.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                }`}
              >
                <span className="truncate">{d.name}</span>
                {saved && <Check size={13} className={selectedDoc === d.id ? "text-primary-foreground" : "text-green-500"} />}
              </button>
            );
          })}
        </div>

        {/* Schedule editor */}
        <div className="flex-1 p-5 overflow-y-auto">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Working Days</p>
          <div className="flex flex-wrap gap-2 mb-5">
            {DAYS.map((day) => (
              <button
                key={day}
                onClick={() => toggleDay(day)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  sched.days.includes(day)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:border-primary/50"
                }`}
              >
                {day}
              </button>
            ))}
          </div>

          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Sessions</p>
          <div className="space-y-2">
            {sched.sessions.map((session, si) => (
              <div key={si} className="flex items-center gap-2 bg-muted/40 rounded-lg p-2.5">
                <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">From</div>
                <input
                  type="time"
                  value={session.start}
                  onChange={(e) => updateSession(si, "start", e.target.value)}
                  className="h-7 w-28 rounded border border-input bg-background px-2 text-xs"
                />
                <div className="text-xs text-muted-foreground shrink-0">to</div>
                <input
                  type="time"
                  value={session.end}
                  onChange={(e) => updateSession(si, "end", e.target.value)}
                  className="h-7 w-28 rounded border border-input bg-background px-2 text-xs"
                />
                <Input
                  type="number"
                  value={session.max_patients}
                  onChange={(e) => updateSession(si, "max_patients", parseInt(e.target.value) || 20)}
                  className="h-7 w-16 text-xs"
                  title="Max patients"
                />
                <span className="text-xs text-muted-foreground shrink-0">pts</span>
                <select
                  value={session.slot_duration}
                  onChange={(e) => updateSession(si, "slot_duration", parseInt(e.target.value))}
                  className="h-7 rounded border border-input bg-background px-1 text-xs"
                >
                  {[10, 15, 20, 30].map((m) => <option key={m} value={m}>{m} min</option>)}
                </select>
                <button
                  onClick={() => removeSession(si)}
                  disabled={sched.sessions.length <= 1}
                  className="text-muted-foreground hover:text-destructive disabled:opacity-30 ml-auto"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
          <button onClick={addSession} className="mt-2 flex items-center gap-1 text-xs text-primary hover:underline">
            <Plus size={13} /> Add session
          </button>

          <div className="mt-4 grid grid-cols-3 gap-3">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Consultation Fee (₹)</p>
              <Input
                type="number"
                value={sched.consultationFee}
                onChange={(e) => setSchedules((prev) => ({ ...prev, [selectedDoc]: { ...prev[selectedDoc], consultationFee: e.target.value, saved: false } }))}
                className="h-8 text-sm"
                placeholder="500"
              />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Follow-up Fee (₹)</p>
              <Input
                type="number"
                value={sched.followUpFee}
                onChange={(e) => setSchedules((prev) => ({ ...prev, [selectedDoc]: { ...prev[selectedDoc], followUpFee: e.target.value, saved: false } }))}
                className="h-8 text-sm"
                placeholder="300"
              />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Follow-up Valid (days)</p>
              <Input
                type="number"
                value={sched.validityDays}
                onChange={(e) => setSchedules((prev) => ({ ...prev, [selectedDoc]: { ...prev[selectedDoc], validityDays: e.target.value, saved: false } }))}
                className="h-8 text-sm"
                placeholder="7"
              />
            </div>
          </div>

          <button
            onClick={saveDoctor}
            disabled={saving || sched.days.length === 0}
            className="mt-5 bg-secondary text-secondary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving…" : "Save this doctor's schedule"}
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between mt-8">
        <button onClick={onSkip} className="text-sm text-muted-foreground hover:text-foreground">
          Skip for now →
        </button>
        <button
          onClick={onComplete}
          className="bg-primary text-primary-foreground px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-[hsl(220,54%,16%)] transition-colors"
        >
          All Done — Continue →
        </button>
      </div>
    </div>
  );
};

export default Step5cSchedules;
