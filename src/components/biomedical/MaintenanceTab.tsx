import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { format, differenceInDays, addDays, addMonths, addWeeks } from "date-fns";
import { useHospitalId } from '@/hooks/useHospitalId';


const DEFAULT_CHECKLISTS: Record<string, string[]> = {
  therapeutic: ["Filter check", "Circuit check", "Alarm test", "Calibration verify"],
  surgical: ["Seal check", "Temperature verify", "BI indicator", "Cycle log"],
  monitoring: ["Lead check", "Alarm test", "Battery", "Screen clean"],
  diagnostic: ["Probe check", "Image quality", "Safety interlock", "Calibration verify"],
  radiation: ["Radiation leak test", "Collimator alignment", "Dose accuracy", "Safety interlock"],
};

interface Props { onRefresh: () => void; }

const MaintenanceTab: React.FC<Props> = ({ onRefresh }) => {
  const { hospitalId } = useHospitalId();
  const [schedules, setSchedules] = useState<any[]>([]);
  const [equipment, setEquipment] = useState<any[]>([]);
  const [filter, setFilter] = useState("all");
  const [showSchedule, setShowSchedule] = useState(false);
  const [showComplete, setShowComplete] = useState<any>(null);
  const [completionChecks, setCompletionChecks] = useState<Record<string, boolean>>({});
  const [observations, setObservations] = useState("");
  const [saving, setSaving] = useState(false);
  const [schedForm, setSchedForm] = useState({ equipment_id: "", frequency: "monthly", next_due_at: "", checklist: "" });

  const load = async () => {
    const [sRes, eRes] = await Promise.all([
      supabase.from("pm_schedules").select("*, equipment_master(equipment_name, equipment_code, category)").eq("hospital_id", hospitalId).order("next_due_at"),
      supabase.from("equipment_master").select("id, equipment_name, equipment_code, category").eq("hospital_id", hospitalId).eq("is_active", true),
    ]);
    setSchedules(sRes.data || []);
    setEquipment(eRes.data || []);
  };

  useEffect(() => { load(); }, []);

  const filtered = schedules.filter((s) => {
    if (filter === "overdue") return s.status === "overdue";
    if (filter === "due_week") return s.status === "upcoming" && differenceInDays(new Date(s.next_due_at), new Date()) <= 7;
    if (filter === "done") return s.status === "done";
    return true;
  });

  const getStatusDisplay = (s: any) => {
    if (s.status === "overdue") {
      const days = differenceInDays(new Date(), new Date(s.next_due_at));
      return <span className="text-red-600 font-semibold">🔴 OVERDUE by {days} days</span>;
    }
    if (s.status === "upcoming") {
      const days = differenceInDays(new Date(s.next_due_at), new Date());
      if (days <= 7) return <span className="text-amber-600 font-semibold">⚠️ Due in {days} days</span>;
      return <span className="text-foreground">📅 Due {format(new Date(s.next_due_at), "dd/MM/yyyy")}</span>;
    }
    if (s.status === "done") return <span className="text-emerald-600">✅ Done {s.done_at ? format(new Date(s.done_at), "dd/MM/yyyy") : ""}</span>;
    return <span>{s.status}</span>;
  };

  const openComplete = (s: any) => {
    const items = Array.isArray(s.checklist) ? s.checklist : [];
    const checks: Record<string, boolean> = {};
    items.forEach((i: any) => { checks[typeof i === "string" ? i : i.item] = false; });
    setCompletionChecks(checks);
    setObservations("");
    setShowComplete(s);
  };

  const allChecked = Object.values(completionChecks).every(Boolean);

  const handleComplete = async () => {
    if (!allChecked) return;
    setSaving(true);
    await supabase.from("pm_schedules").update({
      status: "done", done_at: new Date().toISOString(), observations,
      checklist: Object.entries(completionChecks).map(([item, done]) => ({ item, done })),
    }).eq("id", showComplete.id);

    // Schedule next PM
    const freq = showComplete.frequency;
    const base = new Date();
    let nextDue = addMonths(base, 1);
    if (freq === "weekly") nextDue = addWeeks(base, 1);
    else if (freq === "quarterly") nextDue = addMonths(base, 3);
    else if (freq === "biannual") nextDue = addMonths(base, 6);
    else if (freq === "annual") nextDue = addMonths(base, 12);

    await supabase.from("pm_schedules").insert({
      hospital_id: hospitalId, equipment_id: showComplete.equipment_id, frequency: freq,
      next_due_at: nextDue.toISOString().split("T")[0], last_done_at: new Date().toISOString().split("T")[0],
      checklist: Object.keys(completionChecks).map((item) => ({ item, done: false })),
    });

    await supabase.from("equipment_master").update({ status: "operational" }).eq("id", showComplete.equipment_id);

    setSaving(false);
    setShowComplete(null);
    load(); onRefresh();
  };

  const handleSchedule = async () => {
    if (!schedForm.equipment_id || !schedForm.next_due_at) return;
    const eq = equipment.find((e) => e.id === schedForm.equipment_id);
    const defaultChecks = DEFAULT_CHECKLISTS[eq?.category || ""] || ["General inspection", "Function test", "Cleaning"];
    const customChecks = schedForm.checklist ? schedForm.checklist.split("\n").filter(Boolean) : [];
    const checklist = (customChecks.length > 0 ? customChecks : defaultChecks).map((item) => ({ item, done: false }));

    await supabase.from("pm_schedules").insert({
      hospital_id: hospitalId, equipment_id: schedForm.equipment_id,
      frequency: schedForm.frequency, next_due_at: schedForm.next_due_at, checklist,
    });
    setShowSchedule(false);
    setSchedForm({ equipment_id: "", frequency: "monthly", next_due_at: "", checklist: "" });
    load(); onRefresh();
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex gap-2 pb-3 shrink-0">
        {["all", "overdue", "due_week", "done"].map((f) => (
          <Button key={f} variant={filter === f ? "default" : "outline"} size="sm" onClick={() => setFilter(f)}>
            {f === "all" ? "All" : f === "overdue" ? "Overdue" : f === "due_week" ? "Due This Week" : "Done"}
          </Button>
        ))}
        <div className="flex-1" />
        <Button size="sm" onClick={() => setShowSchedule(true)}><Plus size={14} className="mr-1" /> Schedule PM</Button>
      </div>

      <div className="flex-1 overflow-auto space-y-2">
        {filtered.map((s) => {
          const eq = s.equipment_master;
          const bgClass = s.status === "overdue" ? "bg-red-50 border-red-200" : s.status === "done" ? "bg-emerald-50 border-emerald-200" : (s.status === "upcoming" && differenceInDays(new Date(s.next_due_at), new Date()) <= 7) ? "bg-amber-50 border-amber-200" : "bg-background border-border";
          return (
            <div key={s.id} className={`rounded-lg border p-3 ${bgClass}`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold">{eq?.equipment_name} <span className="font-mono text-xs text-muted-foreground">({eq?.equipment_code})</span></p>
                  <div className="flex items-center gap-3 mt-1">
                    <Badge variant="outline" className="text-[10px]">{s.frequency}</Badge>
                    {getStatusDisplay(s)}
                  </div>
                </div>
                {s.status !== "done" && (
                  <Button size="sm" variant="outline" onClick={() => openComplete(s)}>Mark as Done</Button>
                )}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && <p className="text-center text-muted-foreground py-8">No PM schedules found</p>}
      </div>

      {/* Complete PM Dialog */}
      <Dialog open={!!showComplete} onOpenChange={() => setShowComplete(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Complete PM — {showComplete?.equipment_master?.equipment_name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="font-semibold">Checklist</Label>
              {Object.entries(completionChecks).map(([item, done]) => (
                <div key={item} className="flex items-center gap-2 py-1">
                  <Checkbox checked={done} onCheckedChange={(c) => setCompletionChecks((p) => ({ ...p, [item]: !!c }))} />
                  <span className="text-sm">{item}</span>
                </div>
              ))}
            </div>
            <div><Label>Observations</Label><Textarea value={observations} onChange={(e) => setObservations(e.target.value)} rows={2} /></div>
            <Button onClick={handleComplete} disabled={!allChecked || saving} className="w-full">
              {saving ? "Saving..." : allChecked ? "Save PM Record" : "Complete all checklist items"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Schedule PM Dialog */}
      <Dialog open={showSchedule} onOpenChange={setShowSchedule}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Schedule Preventive Maintenance</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Equipment</Label>
              <Select value={schedForm.equipment_id} onValueChange={(v) => setSchedForm((f) => ({ ...f, equipment_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>{equipment.map((e) => <SelectItem key={e.id} value={e.id}>{e.equipment_code} — {e.equipment_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Frequency</Label>
              <Select value={schedForm.frequency} onValueChange={(v) => setSchedForm((f) => ({ ...f, frequency: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["weekly","monthly","quarterly","biannual","annual"].map((f) => <SelectItem key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>First Due Date</Label><Input type="date" value={schedForm.next_due_at} onChange={(e) => setSchedForm((f) => ({ ...f, next_due_at: e.target.value }))} /></div>
            <div><Label>Checklist Items (one per line, leave blank for defaults)</Label><Textarea value={schedForm.checklist} onChange={(e) => setSchedForm((f) => ({ ...f, checklist: e.target.value }))} rows={3} placeholder="Filter check&#10;Alarm test&#10;..." /></div>
            <Button onClick={handleSchedule} className="w-full">Schedule PM</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MaintenanceTab;
