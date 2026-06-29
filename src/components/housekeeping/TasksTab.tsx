import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { logNABHEvidence } from "@/lib/nabh-evidence";
import { Clock, User, Play, CheckCircle2, Star } from "lucide-react";

interface Props { hospitalId: string | null; }

const TASK_TYPE_COLORS: Record<string, string> = {
  bed_turnover: "bg-teal-100 text-teal-800",
  terminal_cleaning: "bg-red-100 text-red-800",
  routine_cleaning: "bg-blue-100 text-blue-800",
  spill_management: "bg-amber-100 text-amber-800",
  isolation_protocol: "bg-purple-100 text-purple-800",
  ot_cleaning: "bg-indigo-100 text-indigo-800",
  toilet_cleaning: "bg-gray-100 text-gray-800",
  other: "bg-gray-100 text-gray-700",
};

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "bg-red-500 text-white",
  high: "bg-amber-500 text-white",
  normal: "bg-blue-100 text-blue-800",
  low: "bg-gray-100 text-gray-700",
};

const TasksTab: React.FC<Props> = ({ hospitalId }) => {
  const [tasks, setTasks] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [wardFilter, setWardFilter] = useState("all");
  const [wards, setWards] = useState<any[]>([]);
  const [completing, setCompleting] = useState<any>(null);
  const [checklist, setChecklist] = useState<any[]>([]);
  const [qualityScore, setQualityScore] = useState(3);
  const [notes, setNotes] = useState("");

  const loadTasks = async () => {
    if (!hospitalId) return;
    let q = supabase.from("housekeeping_tasks").select("*, wards(name), beds(bed_number)").eq("hospital_id", hospitalId).order("created_at", { ascending: false });
    if (wardFilter !== "all") q = q.eq("ward_id", wardFilter);
    const { data } = await q;
    setTasks(data || []);
  };

  useEffect(() => {
    if (!hospitalId) return;
    loadTasks();
    supabase.from("users").select("id, full_name").eq("hospital_id", hospitalId).then(({ data }) => setStaff(data || []));
    supabase.from("wards").select("id, name").eq("hospital_id", hospitalId).then(({ data }) => setWards(data || []));
  }, [hospitalId, wardFilter]);

  const assignTask = async (taskId: string, userId: string) => {
    await supabase.from("housekeeping_tasks").update({ assigned_to: userId, status: "assigned" } as any).eq("id", taskId);
    toast.success("Task assigned");
    loadTasks();
  };

  const startTask = async (taskId: string) => {
    await supabase.from("housekeeping_tasks").update({ status: "in_progress", started_at: new Date().toISOString() } as any).eq("id", taskId);
    toast.success("Task started");
    loadTasks();
  };

  const openComplete = (task: any) => {
    setCompleting(task);
    setChecklist(Array.isArray(task.checklist) ? task.checklist : []);
    setQualityScore(3);
    setNotes("");
  };

  const completeTask = async () => {
    if (!completing) return;
    const allChecked = checklist.every((c: any) => c.done);
    if (!allChecked) { toast.error("Complete all checklist items first"); return; }

    const now = new Date().toISOString();
    const createdAt = new Date(completing.created_at).getTime();
    const tat = Math.round((Date.now() - createdAt) / 60000);

    await supabase.from("housekeeping_tasks").update({
      status: "completed", completed_at: now, tat_minutes: tat,
      quality_score: qualityScore, notes, checklist,
    } as any).eq("id", completing.id);

    // If bed_turnover, set bed to available
    if (completing.task_type === "bed_turnover" && completing.bed_id) {
      await supabase.from("beds").update({ status: "available" as any }).eq("id", completing.bed_id);
      toast.success(`Bed ${completing.beds?.bed_number || ''} now available`);
      if (hospitalId) {
        logNABHEvidence(hospitalId, "FMS.5",
          `Bed turnover: ${completing.wards?.name || "Ward"} Bed ${completing.beds?.bed_number || ""}, TAT: ${tat} min (target: <30 min)`);
      }
    } else {
      toast.success("Task completed");
    }

    setCompleting(null);
    loadTasks();
  };

  const toggleChecklist = (idx: number) => {
    setChecklist(prev => prev.map((c: any, i: number) => i === idx ? { ...c, done: !c.done } : c));
  };

  const columns = [
    { key: "pending", label: "Pending", color: "bg-amber-50 border-amber-200" },
    { key: "assigned", label: "Assigned", color: "bg-blue-50 border-blue-200" },
    { key: "in_progress", label: "In Progress", color: "bg-indigo-50 border-indigo-200" },
    { key: "completed", label: "Completed Today", color: "bg-emerald-50 border-emerald-200" },
  ];

  const today = new Date().toISOString().split("T")[0];

  return (
    <div className="h-full flex flex-col gap-2">
      {/* Filters */}
      <div className="flex gap-2 items-center">
        <Select value={wardFilter} onValueChange={setWardFilter}>
          <SelectTrigger className="w-40 h-8 text-xs"><SelectValue placeholder="All Wards" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Wards</SelectItem>
            {wards.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Kanban Board */}
      <div className="flex-1 grid grid-cols-4 gap-3 min-h-0 overflow-hidden">
        {columns.map(col => {
          const colTasks = tasks.filter(t => {
            if (col.key === "completed") return t.status === "completed" && t.completed_at?.startsWith(today);
            return t.status === col.key;
          });
          return (
            <div key={col.key} className={`${col.color} border rounded-lg flex flex-col min-h-0`}>
              <div className="px-3 py-2 border-b font-semibold text-xs flex items-center gap-1">
                {col.label} <Badge variant="secondary" className="text-[10px] h-4">{colTasks.length}</Badge>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {colTasks.map(task => (
                  <TaskCard key={task.id} task={task} staff={staff} onAssign={assignTask} onStart={startTask} onComplete={openComplete} />
                ))}
                {colTasks.length === 0 && <p className="text-[11px] text-muted-foreground text-center py-4">No tasks</p>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Completion Modal */}
      <Dialog open={!!completing} onOpenChange={() => setCompleting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="text-sm">Complete Task</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {completing?.task_type?.replace(/_/g, " ")} — {completing?.wards?.name} {completing?.beds?.bed_number && `Bed ${completing.beds.bed_number}`}
            </p>
            <div className="space-y-2">
              <p className="text-xs font-semibold">Checklist</p>
              {checklist.map((item: any, i: number) => (
                <label key={i} className="flex items-center gap-2 text-xs cursor-pointer">
                  <Checkbox checked={item.done} onCheckedChange={() => toggleChecklist(i)} />
                  {item.item}
                </label>
              ))}
            </div>
            <div>
              <p className="text-xs font-semibold mb-1">Quality Score</p>
              <div className="flex gap-1">
                {[1,2,3,4,5].map(s => (
                  <button key={s} onClick={() => setQualityScore(s)}>
                    <Star className={`h-5 w-5 ${s <= qualityScore ? 'text-amber-500 fill-amber-500' : 'text-gray-300'}`} />
                  </button>
                ))}
              </div>
            </div>
            <Textarea placeholder="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} className="text-xs h-16" />
          </div>
          <DialogFooter>
            <Button size="sm" onClick={completeTask} className="text-xs"><CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Mark Complete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const TaskCard: React.FC<{ task: any; staff: any[]; onAssign: (id: string, uid: string) => void; onStart: (id: string) => void; onComplete: (task: any) => void }> = ({ task, staff, onAssign, onStart, onComplete }) => {
  const elapsed = Math.round((Date.now() - new Date(task.created_at).getTime()) / 60000);
  const elapsedStr = elapsed < 60 ? `${elapsed} min ago` : `${Math.floor(elapsed / 60)}h ${elapsed % 60}m ago`;

  return (
    <div className="bg-card rounded-md border border-border p-2.5 space-y-1.5">
      <div className="flex items-center gap-1 flex-wrap">
        <Badge className={`text-[9px] px-1.5 py-0 ${TASK_TYPE_COLORS[task.task_type] || TASK_TYPE_COLORS.other}`}>
          {task.task_type?.replace(/_/g, " ")}
        </Badge>
        <Badge className={`text-[9px] px-1.5 py-0 ${PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.normal}`}>
          {task.priority}
        </Badge>
        {task.triggered_by === "discharge" && (
          <Badge className="text-[9px] px-1.5 py-0 bg-teal-100 text-teal-800">DISCHARGE</Badge>
        )}
      </div>
      <p className="text-xs font-semibold text-foreground">
        {task.wards?.name || "—"} {task.beds?.bed_number && `· Bed ${task.beds.bed_number}`}
      </p>
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
        <Clock className="h-3 w-3" /> {elapsedStr}
      </div>

      {task.status === "pending" && (
        <Select onValueChange={(uid) => onAssign(task.id, uid)}>
          <SelectTrigger className="h-7 text-[10px]"><SelectValue placeholder="Assign →" /></SelectTrigger>
          <SelectContent>
            {staff.map(s => <SelectItem key={s.id} value={s.id} className="text-xs">{s.full_name}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      {task.status === "assigned" && (
        <Button size="sm" variant="outline" className="w-full h-7 text-[10px]" onClick={() => onStart(task.id)}>
          <Play className="h-3 w-3 mr-1" /> Start
        </Button>
      )}
      {task.status === "in_progress" && (
        <Button size="sm" className="w-full h-7 text-[10px] bg-emerald-600 hover:bg-emerald-700" onClick={() => onComplete(task)}>
          <CheckCircle2 className="h-3 w-3 mr-1" /> Complete →
        </Button>
      )}
      {task.status === "completed" && task.quality_score && (
        <div className="flex gap-0.5">
          {[1,2,3,4,5].map(s => <Star key={s} className={`h-3 w-3 ${s <= task.quality_score ? 'text-amber-500 fill-amber-500' : 'text-gray-200'}`} />)}
        </div>
      )}
    </div>
  );
};

export default TasksTab;
