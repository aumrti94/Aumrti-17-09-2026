import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { format } from "date-fns";
import { Plus, CheckCircle2 } from "lucide-react";

interface Props { hospitalId: string | null; }

const AREA_TYPES = ["ward", "ot", "icu", "emergency", "outpatient", "toilet", "corridor", "stairwell", "reception", "canteen"];
const FREQUENCIES = ["hourly", "every_4hrs", "every_shift", "daily", "weekly", "monthly"];

const SchedulesTab: React.FC<Props> = ({ hospitalId }) => {
  const [schedules, setSchedules] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [areaName, setAreaName] = useState("");
  const [areaType, setAreaType] = useState("ward");
  const [frequency, setFrequency] = useState("daily");
  const [wardId, setWardId] = useState("");
  const [wards, setWards] = useState<any[]>([]);

  const load = async () => {
    if (!hospitalId) return;
    const { data } = await supabase.from("cleaning_schedules").select("*, wards(name)").eq("hospital_id", hospitalId).eq("is_active", true).order("next_due_at", { ascending: true });
    setSchedules(data || []);
  };

  useEffect(() => {
    if (!hospitalId) return;
    load();
    supabase.from("wards").select("id, name").eq("hospital_id", hospitalId).then(({ data }) => setWards(data || []));
  }, [hospitalId]);

  const markDone = async (sched: any) => {
    const now = new Date();
    const freqMs: Record<string, number> = {
      hourly: 3600000, every_4hrs: 14400000, every_shift: 28800000,
      daily: 86400000, weekly: 604800000, monthly: 2592000000,
    };
    const nextDue = new Date(now.getTime() + (freqMs[sched.frequency] || 86400000));
    await supabase.from("cleaning_schedules").update({
      last_done_at: now.toISOString(), next_due_at: nextDue.toISOString(),
    } as any).eq("id", sched.id);
    toast.success("Marked as done");
    load();
  };

  const addSchedule = async () => {
    if (!hospitalId || !areaName) { toast.error("Fill area name"); return; }
    const freqMs: Record<string, number> = {
      hourly: 3600000, every_4hrs: 14400000, every_shift: 28800000,
      daily: 86400000, weekly: 604800000, monthly: 2592000000,
    };
    const nextDue = new Date(Date.now() + (freqMs[frequency] || 86400000));
    await supabase.from("cleaning_schedules").insert({
      hospital_id: hospitalId, area_name: areaName, area_type: areaType,
      frequency, ward_id: wardId || null, next_due_at: nextDue.toISOString(), is_active: true,
    } as any);
    toast.success("Schedule added");
    setShowAdd(false); setAreaName("");
    load();
  };

  const now = Date.now();

  return (
    <div className="h-full flex flex-col gap-3 overflow-hidden">
      <div className="flex justify-end">
        <Button size="sm" className="h-8 text-xs" onClick={() => setShowAdd(true)}><Plus className="h-3.5 w-3.5 mr-1" /> Add Schedule</Button>
      </div>

      <div className="flex-1 overflow-auto space-y-2">
        {schedules.map(s => {
          const isOverdue = s.next_due_at && new Date(s.next_due_at).getTime() < now;
          const isDueToday = s.next_due_at && !isOverdue && new Date(s.next_due_at).toDateString() === new Date().toDateString();
          return (
            <div key={s.id} className={`border rounded-lg p-3 flex items-center justify-between ${isOverdue ? 'bg-red-50 border-red-200' : isDueToday ? 'bg-amber-50 border-amber-200' : 'bg-card border-border'}`}>
              <div>
                <p className="text-sm font-semibold text-foreground">{s.area_name}</p>
                <div className="flex gap-2 mt-1">
                  <Badge variant="outline" className="text-[10px]">{s.area_type}</Badge>
                  <Badge variant="secondary" className="text-[10px]">{s.frequency?.replace(/_/g, " ")}</Badge>
                  {s.wards?.name && <Badge variant="outline" className="text-[10px]">{s.wards.name}</Badge>}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Last: {s.last_done_at ? format(new Date(s.last_done_at), "dd/MM HH:mm") : "Never"} | Next: {s.next_due_at ? format(new Date(s.next_due_at), "dd/MM HH:mm") : "—"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {isOverdue && <Badge className="bg-red-500 text-white text-[10px]">OVERDUE</Badge>}
                <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => markDone(s)}>
                  <CheckCircle2 className="h-3 w-3 mr-1" /> Mark Done
                </Button>
              </div>
            </div>
          );
        })}
        {schedules.length === 0 && <p className="text-xs text-muted-foreground text-center py-8">No schedules configured</p>}
      </div>

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-sm">Add Cleaning Schedule</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Area name" value={areaName} onChange={e => setAreaName(e.target.value)} className="text-xs h-8" />
            <Select value={areaType} onValueChange={setAreaType}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{AREA_TYPES.map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={frequency} onValueChange={setFrequency}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{FREQUENCIES.map(f => <SelectItem key={f} value={f} className="text-xs">{f.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={wardId || "none"} onValueChange={(v) => setWardId(v === "none" ? "" : v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Ward (optional)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="text-xs">None</SelectItem>
                {wards.map(w => <SelectItem key={w.id} value={w.id} className="text-xs">{w.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter><Button size="sm" className="text-xs" onClick={addSchedule}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SchedulesTab;
