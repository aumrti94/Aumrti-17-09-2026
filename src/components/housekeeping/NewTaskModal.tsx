import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface Props { hospitalId: string; onClose: () => void; }

const TASK_TYPES = ["bed_turnover", "terminal_cleaning", "routine_cleaning", "spill_management", "isolation_protocol", "ot_cleaning", "toilet_cleaning", "other"];
const PRIORITIES = ["low", "normal", "high", "urgent"];

const NewTaskModal: React.FC<Props> = ({ hospitalId, onClose }) => {
  const [taskType, setTaskType] = useState("routine_cleaning");
  const [priority, setPriority] = useState("normal");
  const [wardId, setWardId] = useState("");
  const [bedId, setBedId] = useState("");
  const [notes, setNotes] = useState("");
  const [wards, setWards] = useState<any[]>([]);
  const [beds, setBeds] = useState<any[]>([]);

  useEffect(() => {
    supabase.from("wards").select("id, name").eq("hospital_id", hospitalId).then(({ data }) => setWards(data || []));
  }, [hospitalId]);

  useEffect(() => {
    if (wardId) {
      supabase.from("beds").select("id, bed_number").eq("ward_id", wardId).then(({ data }) => setBeds(data || []));
    } else { setBeds([]); }
  }, [wardId]);

  const save = async () => {
    const defaultChecklist = [
      { item: "Clean surfaces", done: false },
      { item: "Mop floor", done: false },
      { item: "Empty dustbin", done: false },
      { item: "Supervisor inspection", done: false },
    ];
    const { error } = await supabase.from("housekeeping_tasks").insert({
      hospital_id: hospitalId, task_type: taskType, priority,
      ward_id: wardId || null, bed_id: bedId || null,
      room_number: beds.find(b => b.id === bedId)?.bed_number || null,
      triggered_by: "manual", status: "pending",
      checklist: defaultChecklist, notes: notes || null,
    } as any);
    if (error) { toast.error(error.message); return; }
    toast.success("Task created");
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="text-sm">New Housekeeping Task</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Select value={taskType} onValueChange={setTaskType}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{TASK_TYPES.map(t => <SelectItem key={t} value={t} className="text-xs">{t.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{PRIORITIES.map(p => <SelectItem key={p} value={p} className="text-xs">{p}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={wardId} onValueChange={setWardId}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Ward" /></SelectTrigger>
            <SelectContent>{wards.map(w => <SelectItem key={w.id} value={w.id} className="text-xs">{w.name}</SelectItem>)}</SelectContent>
          </Select>
          {beds.length > 0 && (
            <Select value={bedId} onValueChange={setBedId}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Bed" /></SelectTrigger>
              <SelectContent>{beds.map(b => <SelectItem key={b.id} value={b.id} className="text-xs">{b.bed_number}</SelectItem>)}</SelectContent>
            </Select>
          )}
          <Textarea placeholder="Notes" value={notes} onChange={e => setNotes(e.target.value)} className="text-xs h-16" />
        </div>
        <DialogFooter><Button size="sm" className="text-xs" onClick={save}>Create Task</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default NewTaskModal;
