import React, { useState, useEffect } from "react";
import SettingsPageWrapper from "@/components/settings/SettingsPageWrapper";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, Search, Loader2, CalendarCog } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";

const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function minutesToTime(m: number): string {
  return `${Math.floor(m / 60).toString().padStart(2, "0")}:${(m % 60).toString().padStart(2, "0")}:00`;
}
function getDatesInRange(from: string, to: string): string[] {
  const result: string[] = [];
  const start = new Date(from + "T00:00:00");
  const end = new Date(to + "T00:00:00");
  const cur = new Date(start);
  while (cur <= end) {
    result.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return result;
}

const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface Session { start: string; end: string; maxPatients: number; slotDuration: number; }
interface Doctor { id: string; full_name: string; department_name: string | null; role: string; hasSchedule?: boolean; }

const SettingsDoctorSchedulesPage: React.FC = () => {
  const { toast } = useToast();
  const { hospitalId } = useHospitalId();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loadingDoctors, setLoadingDoctors] = useState(true);
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [saving, setSaving] = useState(false);
  const [workingDays, setWorkingDays] = useState<string[]>(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
  const [sessions, setSessions] = useState<Session[]>([
    { start: "09:00", end: "13:00", maxPatients: 30, slotDuration: 15 },
    { start: "17:00", end: "20:00", maxPatients: 20, slotDuration: 15 },
  ]);
  const [fee, setFee] = useState("500");
  const [advanceDays, setAdvanceDays] = useState("30");
  const [genFrom, setGenFrom] = useState("");
  const [genTo, setGenTo] = useState("");
  const [generating, setGenerating] = useState(false);
  const [blockFrom, setBlockFrom] = useState("");
  const [blockTo, setBlockTo] = useState("");
  const [blockReason, setBlockReason] = useState("");
  const [blocking, setBlocking] = useState(false);

  // Load doctors
  useEffect(() => {
    if (!hospitalId) return;
    const fetchDoctors = async () => {
      setLoadingDoctors(true);
      try {
        const { data, error } = await supabase
          .from("users")
          .select("id, full_name, role, departments(name)")
          .eq("hospital_id", hospitalId)
          .eq("role", "doctor")
          .order("full_name");
        if (error) throw error;

        // Check which have schedules
        const ids = (data || []).map((d: any) => d.id);
        let scheduleSet = new Set<string>();
        if (ids.length) {
          const { data: scheds } = await supabase
            .from("doctor_schedules")
            .select("doctor_id")
            .eq("hospital_id", hospitalId)
            .in("doctor_id", ids);
          scheduleSet = new Set((scheds || []).map((s: any) => s.doctor_id));
        }
        setDoctors((data || []).map((d: any) => ({
          id: d.id,
          full_name: d.full_name,
          role: d.role,
          department_name: d.departments?.name || null,
          hasSchedule: scheduleSet.has(d.id),
        })));
      } catch (e: any) {
        console.error("Failed to load doctors:", e);
        toast({ title: "Failed to load doctors", description: e.message, variant: "destructive" });
      } finally {
        setLoadingDoctors(false);
      }
    };
    fetchDoctors();
  }, [hospitalId, toast]);

  // Load schedule when doctor selected
  useEffect(() => {
    if (!selected || !hospitalId) return;
    const loadSchedule = async () => {
      setLoadingSchedule(true);
      try {
        const { data, error } = await supabase
          .from("doctor_schedules")
          .select("*")
          .eq("hospital_id", hospitalId)
          .eq("doctor_id", selected)
          .eq("is_active", true)
          .order("session_start");
        if (error) throw error;
        if (data && data.length > 0) {
          const uniqueDays = Array.from(new Set(data.map((r: any) => r.day_of_week)));
          setWorkingDays(uniqueDays);
          const uniqueSessions = new Map<string, Session>();
          data.forEach((r: any) => {
            const key = `${r.session_start}-${r.session_end}`;
            if (!uniqueSessions.has(key)) {
              uniqueSessions.set(key, {
                start: (r.session_start || "").slice(0, 5),
                end: (r.session_end || "").slice(0, 5),
                maxPatients: r.max_patients || 30,
                slotDuration: r.slot_duration_minutes || 15,
              });
            }
          });
          setSessions(Array.from(uniqueSessions.values()));
        } else {
          setWorkingDays(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
          setSessions([
            { start: "09:00", end: "13:00", maxPatients: 30, slotDuration: 15 },
            { start: "17:00", end: "20:00", maxPatients: 20, slotDuration: 15 },
          ]);
        }
      } catch (e: any) {
        console.error("Failed to load schedule:", e);
        toast({ title: "Failed to load schedule", description: e.message, variant: "destructive" });
      } finally {
        setLoadingSchedule(false);
      }
    };
    loadSchedule();
  }, [selected, hospitalId, toast]);

  const doctor = doctors.find((d) => d.id === selected);
  const filtered = doctors.filter((d) => (d.full_name || "").toLowerCase().includes(search.toLowerCase()));

  const handleSave = async () => {
    if (!hospitalId || !selected) return;
    if (sessions.some((s) => !s.start || !s.end)) {
      toast({ title: "Invalid session times", description: "Please fill all session start/end times.", variant: "destructive" });
      return;
    }
    // Check for overlapping sessions
    const sortedSessions = [...sessions].sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 0; i < sortedSessions.length - 1; i++) {
      const aEnd = sortedSessions[i].end;
      const bStart = sortedSessions[i + 1].start;
      // Handle overnight sessions (end < start) — skip overlap check for those
      if (sortedSessions[i].start < sortedSessions[i].end && bStart < aEnd) {
        toast({ title: "Overlapping sessions", description: `Session ending at ${aEnd} overlaps with session starting at ${bStart}.`, variant: "destructive" });
        return;
      }
    }
    setSaving(true);
    try {
      // Delete existing schedules for this doctor, then insert fresh
      const { error: delErr } = await supabase
        .from("doctor_schedules")
        .delete()
        .eq("hospital_id", hospitalId)
        .eq("doctor_id", selected);
      if (delErr) throw delErr;

      const rows = workingDays.flatMap((day) =>
        sessions.map((s) => ({
          hospital_id: hospitalId,
          doctor_id: selected,
          day_of_week: day,
          session_start: s.start,
          session_end: s.end,
          max_patients: s.maxPatients,
          slot_duration_minutes: s.slotDuration,
          is_active: true,
        }))
      );

      if (rows.length > 0) {
        const { error: insErr } = await supabase
          .from("doctor_schedules")
          .upsert(rows, { onConflict: "hospital_id,doctor_id,day_of_week,session_start" });
        if (insErr) throw insErr;
      }

      setDoctors((prev) => prev.map((d) => (d.id === selected ? { ...d, hasSchedule: rows.length > 0 } : d)));
      toast({ title: `Schedule saved for ${doctor?.full_name}` });
    } catch (e: any) {
      console.error("Save schedule failed:", e);
      toast({ title: "Failed to save schedule", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleBlockDates = async () => {
    if (!hospitalId || !selected) return;
    if (!blockFrom || !blockTo) { toast({ title: "Select a date range to block", variant: "destructive" }); return; }
    if (new Date(blockTo) < new Date(blockFrom)) { toast({ title: "End date must be after start date", variant: "destructive" }); return; }
    setBlocking(true);
    try {
      // Mark all doctor_slots for this doctor in the range as blocked
      const { error } = await (supabase as any)
        .from("doctor_slots")
        .update({ is_blocked: true, block_reason: blockReason || "Leave / Holiday" })
        .eq("hospital_id", hospitalId)
        .eq("doctor_id", selected)
        .gte("slot_date", blockFrom)
        .lte("slot_date", blockTo)
        .eq("booked_count", 0); // only block unbooked slots; don't cancel existing bookings
      if (error) throw error;
      toast({ title: `Slots blocked from ${blockFrom} to ${blockTo}` });
      setBlockFrom(""); setBlockTo(""); setBlockReason("");
    } catch (e: any) {
      toast({ title: "Error blocking dates", description: e.message, variant: "destructive" });
    } finally {
      setBlocking(false);
    }
  };

  const handleGenerateSlots = async () => {
    if (!hospitalId || !selected) return;
    if (!genFrom || !genTo) {
      toast({ title: "Select a date range", variant: "destructive" });
      return;
    }
    if (new Date(genTo) < new Date(genFrom)) {
      toast({ title: "End date must be after start date", variant: "destructive" });
      return;
    }
    if (sessions.some((s) => !s.start || !s.end)) {
      toast({ title: "Save schedule first", description: "All sessions must have valid start/end times.", variant: "destructive" });
      return;
    }
    setGenerating(true);
    try {
      const dates = getDatesInRange(genFrom, genTo);
      const rows: any[] = [];

      for (const dateStr of dates) {
        const dow = DOW_SHORT[new Date(dateStr + "T00:00:00").getDay()];
        if (!workingDays.includes(dow)) continue;

        for (const session of sessions) {
          if (!session.start || !session.end) continue;
          let mins = timeToMinutes(session.start);
          const endMins = timeToMinutes(session.end);
          const dur = session.slotDuration || 15;

          while (mins + dur <= endMins) {
            rows.push({
              hospital_id: hospitalId,
              doctor_id: selected,
              slot_date: dateStr,
              slot_time: minutesToTime(mins),
              slot_duration_mins: dur,
              max_patients: 1,
              booked_count: 0,
              slot_type: "opd",
              is_blocked: false,
            });
            mins += dur;
          }
        }
      }

      if (rows.length === 0) {
        toast({ title: "No slots to generate", description: "The date range contains no matching working days." });
        return;
      }

      // Upsert in batches of 500; ignoreDuplicates keeps existing booked_count intact
      const BATCH = 500;
      for (let i = 0; i < rows.length; i += BATCH) {
        const { error } = await (supabase as any)
          .from("doctor_slots")
          .upsert(rows.slice(i, i + BATCH), {
            onConflict: "hospital_id,doctor_id,slot_date,slot_time",
            ignoreDuplicates: true,
          });
        if (error) throw error;
      }

      toast({ title: `${rows.length} slots generated`, description: `${genFrom} → ${genTo} for ${doctor?.full_name}` });
    } catch (e: any) {
      toast({ title: "Failed to generate slots", description: e.message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <SettingsPageWrapper title="Doctor Schedules" hideSave>
      <div className="flex gap-6 -mx-4">
        <div className="w-[260px] flex-shrink-0 border-r border-border pr-4">
          <div className="relative mb-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search doctors..." className="pl-9 h-9" />
          </div>
          <div className="space-y-1">
            {loadingDoctors ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground text-sm gap-2">
                <Loader2 size={14} className="animate-spin" /> Loading doctors...
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm px-2">
                No doctors found. Add staff in Settings → Staff.
              </div>
            ) : (
              filtered.map((d) => (
                <button key={d.id} onClick={() => setSelected(d.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors ${selected === d.id ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}>
                  <p className="text-sm font-medium text-foreground">{d.full_name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-muted-foreground">{d.department_name || d.role}</span>
                    <Badge variant={d.hasSchedule ? "default" : "destructive"} className="text-[10px] h-4">{d.hasSchedule ? "Set" : "Not set"}</Badge>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="flex-1">
          {!doctor ? (
            <div className="text-center py-20 text-muted-foreground text-sm">Select a doctor to edit their schedule</div>
          ) : loadingSchedule ? (
            <div className="flex items-center justify-center py-20 text-muted-foreground text-sm gap-2">
              <Loader2 size={14} className="animate-spin" /> Loading schedule...
            </div>
          ) : (
            <div className="space-y-6">
              <h2 className="text-base font-semibold text-foreground">{doctor.full_name} — Schedule</h2>

              <section>
                <Label className="mb-2 block">Working Days</Label>
                <div className="flex gap-2">
                  {days.map((d) => (
                    <label key={d} className="flex items-center gap-1.5 text-sm">
                      <Checkbox checked={workingDays.includes(d)} onCheckedChange={(v) => setWorkingDays(v ? [...workingDays, d] : workingDays.filter((x) => x !== d))} />
                      {d}
                    </label>
                  ))}
                </div>
              </section>

              <section>
                <div className="flex items-center justify-between mb-2">
                  <Label>OPD Sessions</Label>
                  <Button size="sm" variant="outline" onClick={() => setSessions([...sessions, { start: "", end: "", maxPatients: 20, slotDuration: 15 }])} className="gap-1 h-7"><Plus size={12} /> Add Session</Button>
                </div>
                {sessions.map((s, i) => (
                  <div key={i} className="flex gap-3 items-center mb-2">
                    <Input type="time" value={s.start} onChange={(e) => { const n = [...sessions]; n[i].start = e.target.value; setSessions(n); }} className="h-8 w-28" />
                    <span className="text-xs text-muted-foreground">to</span>
                    <Input type="time" value={s.end} onChange={(e) => { const n = [...sessions]; n[i].end = e.target.value; setSessions(n); }} className="h-8 w-28" />
                    <Input type="number" value={s.maxPatients} onChange={(e) => { const n = [...sessions]; n[i].maxPatients = +e.target.value; setSessions(n); }} className="h-8 w-20" placeholder="Max" />
                    <Input type="number" value={s.slotDuration} onChange={(e) => { const n = [...sessions]; n[i].slotDuration = +e.target.value; setSessions(n); }} className="h-8 w-20" placeholder="Min" />
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setSessions(sessions.filter((_, j) => j !== i))}><Trash2 size={13} /></Button>
                  </div>
                ))}
              </section>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Consultation Fee (₹)</Label>
                  <Input type="number" value={fee} onChange={(e) => setFee(e.target.value)} className="mt-1.5" />
                </div>
                <div>
                  <Label>Advance Booking (days)</Label>
                  <Input type="number" value={advanceDays} onChange={(e) => setAdvanceDays(e.target.value)} className="mt-1.5" />
                </div>
              </div>

              <Button onClick={handleSave} disabled={saving} className="bg-primary text-primary-foreground">
                {saving ? <><Loader2 size={14} className="animate-spin mr-2" />Saving...</> : "Save Schedule"}
              </Button>

              {/* ── Block Dates ── */}
              <div className="border rounded-lg p-4 space-y-3 bg-destructive/5 border-destructive/20">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-destructive">Block Dates (Leave / Holiday)</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Marks all unbooked slots in the selected date range as blocked. Patients cannot book during blocked dates.
                  Slots already booked are preserved and need to be rescheduled manually.
                </p>
                <div className="flex gap-3 items-end flex-wrap">
                  <div>
                    <Label className="text-xs">From</Label>
                    <Input type="date" value={blockFrom} onChange={(e) => setBlockFrom(e.target.value)} className="h-8 w-36 mt-1" min={new Date().toISOString().slice(0,10)} />
                  </div>
                  <div>
                    <Label className="text-xs">To</Label>
                    <Input type="date" value={blockTo} onChange={(e) => setBlockTo(e.target.value)} className="h-8 w-36 mt-1" min={blockFrom || new Date().toISOString().slice(0,10)} />
                  </div>
                  <div>
                    <Label className="text-xs">Reason (optional)</Label>
                    <Input value={blockReason} onChange={(e) => setBlockReason(e.target.value)} placeholder="e.g. Annual leave" className="h-8 w-44 mt-1" />
                  </div>
                  <Button onClick={handleBlockDates} disabled={blocking || !blockFrom || !blockTo} variant="destructive" size="sm" className="gap-1.5">
                    {blocking ? <Loader2 size={13} className="animate-spin" /> : null}
                    {blocking ? "Blocking…" : "Block These Dates"}
                  </Button>
                </div>
              </div>

              {/* ── Generate Slots ── */}
              <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
                <div className="flex items-center gap-2">
                  <CalendarCog size={15} className="text-primary" />
                  <span className="text-sm font-semibold">Generate Slots for Calendar</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Creates individual time-slot records in the scheduling calendar based on this doctor's working days and session times.
                  Existing slots (with bookings) are preserved — only new slots are added.
                </p>
                <div className="flex gap-3 items-end flex-wrap">
                  <div>
                    <Label className="text-xs">From</Label>
                    <Input type="date" value={genFrom} onChange={(e) => setGenFrom(e.target.value)} className="h-8 w-36 mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">To</Label>
                    <Input type="date" value={genTo} onChange={(e) => setGenTo(e.target.value)} className="h-8 w-36 mt-1" />
                  </div>
                  <Button onClick={handleGenerateSlots} disabled={generating || !genFrom || !genTo} variant="outline" className="gap-1.5">
                    {generating ? <Loader2 size={13} className="animate-spin" /> : <CalendarCog size={13} />}
                    {generating ? "Generating…" : "Generate Slots"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </SettingsPageWrapper>
  );
};

export default SettingsDoctorSchedulesPage;
