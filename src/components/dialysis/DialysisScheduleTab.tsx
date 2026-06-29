import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { format, addDays, startOfWeek } from "date-fns";

interface Props {
  showSchedule: boolean;
  onCloseSchedule: () => void;
  onRefresh: () => void;
}

const MACHINE_BG: Record<string, string> = {
  clean: "bg-green-50 border-green-200",
  hbv: "bg-amber-50 border-amber-200",
  hcv: "bg-red-50 border-red-200",
};

const DialysisScheduleTab: React.FC<Props> = ({ showSchedule, onCloseSchedule, onRefresh }) => {
  const { toast } = useToast();
  const [machines, setMachines] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [patients, setPatients] = useState<any[]>([]);
  const [weekStart, setWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));

  // Schedule form
  const [schedPatient, setSchedPatient] = useState("");
  const [schedDate, setSchedDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [schedTime, setSchedTime] = useState("08:00");

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const fetchData = async () => {
    const startDate = format(weekStart, "yyyy-MM-dd");
    const endDate = format(addDays(weekStart, 6), "yyyy-MM-dd");

    const [mRes, sRes, pRes] = await Promise.all([
      (supabase as any).from("dialysis_machines").select("*").eq("is_active", true).order("machine_name"),
      (supabase as any).from("dialysis_sessions").select("*, dialysis_patients(*, patients(full_name))").gte("session_date", startDate).lte("session_date", endDate),
      (supabase as any).from("dialysis_patients").select("*, patients(full_name, uhid)").eq("is_active", true),
    ]);
    if (mRes.data) setMachines(mRes.data);
    if (sRes.data) setSessions(sRes.data);
    if (pRes.data) setPatients(pRes.data);
  };

  useEffect(() => { fetchData(); }, [weekStart]);

  const scheduleSession = async () => {
    if (!schedPatient) { toast({ title: "Select a patient", variant: "destructive" }); return; }
    const { data: user } = await supabase.from("users").select("id, hospital_id").limit(1).maybeSingle();
    if (!user) return;

    const patient = patients.find(p => p.id === schedPatient);
    if (!patient) return;

    const pType = patient.machine_type_required;

    // Find compatible machine: exact match OR universal
    const compatibleMachines = machines.filter(m =>
      m.machine_type === pType || m.machine_type === "universal" ||
      (pType === "clean" && m.machine_type === "clean") ||
      (pType === "isolated" && m.machine_type !== "clean") // isolated can use any non-clean
    );

    if (compatibleMachines.length === 0) {
      toast({
        title: `No compatible machine available`,
        description: `Patient requires ${pType.toUpperCase()} machine. Please add a ${pType.toUpperCase()} dedicated machine first.`,
        variant: "destructive"
      });
      return;
    }

    const machineId = compatibleMachines[0].id;

    await (supabase as any).from("dialysis_sessions").insert({
      hospital_id: user.hospital_id,
      dialysis_patient_id: schedPatient,
      machine_id: machineId,
      session_date: schedDate,
      scheduled_start: schedTime,
      status: "scheduled",
    });

    toast({ title: "Session scheduled" });
    onCloseSchedule();
    fetchData();
    onRefresh();
  };

  const markMissed = async (session: any) => {
    const { data: user } = await supabase.from("users").select("id, hospital_id").limit(1).maybeSingle();
    await (supabase as any).from("dialysis_sessions").update({ status: "missed" }).eq("id", session.id);
    if (user) {
      await supabase.from("clinical_alerts").insert({
        hospital_id: user.hospital_id,
        alert_type: "missed_dialysis",
        severity: "high",
        alert_message: `Missed dialysis session: ${session.dialysis_patients?.patients?.full_name} — ${session.session_date}`,
      });
    }
    toast({ title: "Session marked as missed", variant: "destructive" });
    fetchData();
    onRefresh();
  };

  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setWeekStart(addDays(weekStart, -7))}>← Prev</Button>
          <span className="text-sm font-medium py-1">{format(weekStart, "dd MMM")} — {format(addDays(weekStart, 6), "dd MMM yyyy")}</span>
          <Button size="sm" variant="outline" onClick={() => setWeekStart(addDays(weekStart, 7))}>Next →</Button>
        </div>
      </div>

      {/* Weekly Grid */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="border border-border p-2 text-left bg-muted w-32">Machine</th>
              {days.map(d => (
                <th key={d.toISOString()} className={`border border-border p-2 text-center ${format(d, "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd") ? "bg-primary/10" : "bg-muted"}`}>
                  {format(d, "EEE dd/MM")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {machines.map(m => (
              <tr key={m.id}>
                <td className={`border border-border p-2 font-medium ${MACHINE_BG[m.machine_type] || ""}`}>
                  {m.machine_name}
                  <Badge className="text-[8px] ml-1" variant="outline">{m.machine_type}</Badge>
                </td>
                {days.map(d => {
                  const dayStr = format(d, "yyyy-MM-dd");
                  const daySessions = sessions.filter(s => s.machine_id === m.id && s.session_date === dayStr);
                  return (
                    <td key={dayStr} className="border border-border p-1 align-top min-w-[120px]">
                      {daySessions.map(s => (
                        <div key={s.id} className={`text-[10px] rounded px-1.5 py-1 mb-0.5 ${
                          s.status === "completed" ? "bg-green-100 text-green-700" :
                          s.status === "in_progress" ? "bg-blue-100 text-blue-700" :
                          s.status === "missed" ? "bg-red-100 text-red-700" :
                          "bg-muted text-muted-foreground"
                        }`}>
                          <span className="font-medium">{s.dialysis_patients?.patients?.full_name || "Patient"}</span>
                          <span className="block">{s.scheduled_start}</span>
                          {s.status === "scheduled" && new Date(`${dayStr}T${s.scheduled_start}`) < new Date() && (
                            <Button size="sm" variant="ghost" className="text-[9px] h-5 px-1 text-red-600" onClick={() => markMissed(s)}>Mark Missed</Button>
                          )}
                        </div>
                      ))}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Schedule Dialog */}
      <Dialog open={showSchedule} onOpenChange={onCloseSchedule}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Schedule Session</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Patient</Label>
              <Select value={schedPatient} onValueChange={setSchedPatient}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  {patients.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.patients?.full_name} ({p.machine_type_required})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">Date</Label><Input type="date" value={schedDate} onChange={e => setSchedDate(e.target.value)} className="h-9" /></div>
              <div><Label className="text-xs">Time</Label><Input type="time" value={schedTime} onChange={e => setSchedTime(e.target.value)} className="h-9" /></div>
            </div>
            {schedPatient && (
              <p className="text-xs text-muted-foreground">
                Machine auto-assigned: {patients.find(p => p.id === schedPatient)?.machine_type_required.toUpperCase()} type
              </p>
            )}
            <Button className="w-full" onClick={scheduleSession}>Schedule</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DialysisScheduleTab;
