import React from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Pill, Activity, Handshake, ClipboardList } from "lucide-react";
import type { NursingTask } from "@/pages/nursing/NursingPage";

interface Props {
  tasks: NursingTask[];
  loading: boolean;
  selectedTaskId: string | null;
  onSelectTask: (task: NursingTask) => void;
  shift: { label: string; type: string };
  wards: { id: string; name: string }[];
  selectedWard: string;
  onWardChange: (id: string) => void;
  filter: string;
  onFilterChange: (f: string) => void;
  stats: { overdue: number; due_now: number; upcoming: number };
}

const typeIcons: Record<string, React.ElementType> = {
  medication: Pill,
  vitals: Activity,
  handover: Handshake,
};

const typeLabels: Record<string, string> = {
  medication: "Medication",
  vitals: "Vitals",
  handover: "Handover",
};

const filters = [
  { key: "all", label: "All" },
  { key: "overdue", label: "Overdue" },
  { key: "due_now", label: "Due Now" },
  { key: "upcoming", label: "Upcoming" },
  { key: "done", label: "Done" },
];

const NursingTaskList: React.FC<Props> = ({
  tasks,
  loading,
  selectedTaskId,
  onSelectTask,
  shift,
  wards,
  selectedWard,
  onWardChange,
  filter,
  onFilterChange,
  stats,
}) => {
  return (
    <div className="w-[300px] flex-shrink-0 flex flex-col border-r border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-foreground">My Tasks</h2>
          <span className="text-[11px] px-2.5 py-1 rounded-full bg-primary/10 text-primary font-medium">
            {shift.label}
          </span>
        </div>
        <div className="mt-2 flex gap-2">
          <select
            value={selectedWard}
            onChange={(e) => onWardChange(e.target.value)}
            className="flex-1 h-7 text-xs rounded-md border border-input bg-background px-2 text-foreground"
          >
            <option value="all">All Wards</option>
            {wards.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>
        {wards.length === 0 && (
          <Link to="/settings/wards" className="text-[10px] text-amber-600 hover:underline mt-1 block">No wards configured — add in Settings →</Link>
        )}
        <div className="mt-2 flex gap-1 flex-wrap">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => onFilterChange(f.key)}
              className={cn(
                "px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors",
                filter === f.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="h-8 flex items-center gap-3 px-4 border-b border-border bg-muted/50 flex-shrink-0 text-[11px]">
        <span className="text-destructive font-medium">🔴 {stats.overdue} Overdue</span>
        <span className="text-amber-600 font-medium">🟡 {stats.due_now} Due Now</span>
        <span className="text-muted-foreground">🟢 {stats.upcoming} Upcoming</span>
      </div>

      {/* Task List */}
      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">Loading tasks…</div>
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-center">
            <ClipboardList size={32} className="text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">No tasks for this filter</p>
          </div>
        ) : (
          tasks.map((task) => {
            const Icon = typeIcons[task.type] || ClipboardList;
            const selected = selectedTaskId === task.id;

            return (
              <button
                key={task.id}
                onClick={() => onSelectTask(task)}
                className={cn(
                  "w-full text-left rounded-lg p-3 mb-1.5 transition-all border-l-[3px] active:scale-[0.98]",
                  task.status === "overdue" && "bg-destructive/5 border-l-destructive",
                  task.status === "due_now" && "bg-amber-50 border-l-amber-500",
                  task.status === "upcoming" && "bg-muted/50 border-l-border",
                  task.status === "done" && "bg-green-50/70 border-l-green-400 opacity-70",
                  selected && "ring-2 ring-primary ring-offset-1"
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon size={14} className={cn(
                      task.status === "overdue" && "text-destructive",
                      task.status === "due_now" && "text-amber-600",
                      task.status === "upcoming" && "text-muted-foreground",
                      task.status === "done" && "text-green-600",
                    )} />
                    <span className={cn(
                      "text-xs font-semibold",
                      task.status === "overdue" && "text-destructive",
                      task.status === "due_now" && "text-amber-700",
                      task.status === "upcoming" && "text-foreground",
                      task.status === "done" && "text-green-700",
                    )}>
                      {typeLabels[task.type]}
                    </span>
                  </div>
                  <span className="text-[11px] text-muted-foreground">{task.scheduledTime}</span>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[13px] text-foreground font-medium truncate">{task.patientName}</span>
                  <span className="text-[11px] text-muted-foreground ml-2 flex-shrink-0">{task.bedLabel}</span>
                </div>
                {task.type === "medication" && task.drugName && (
                  <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                    {task.drugName} {task.dose}
                  </p>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};

export default NursingTaskList;
