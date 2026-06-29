import React from "react";
import { cn } from "@/lib/utils";
import { Plus, Clock } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import { useHospitalContext } from "@/contexts/HospitalContext";
import { hasActionAccess } from "@/lib/tabPermissions";

interface LabOrder {
  id: string;
  priority: string;
  status: string;
  order_time: string;
  patients: { full_name: string; uhid: string; gender: string | null; dob: string | null } | null;
  lab_order_items: { id: string; status: string; test_id: string; validated_at: string | null; lab_test_master: { tat_minutes: number } | null }[];
}

interface Props {
  orders: LabOrder[];
  selectedOrderId: string | null;
  onSelectOrder: (id: string) => void;
  filterTab: string;
  onFilterChange: (tab: string) => void;
  selectedDate: string;
  onDateChange: (d: string) => void;
  statCount: number;
  urgentCount: number;
  routineCount: number;
  onNewOrder: () => void;
}

const FILTER_TABS = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "in_process", label: "In Process" },
  { key: "pending_validation", label: "Pending Validation" },
  { key: "ready", label: "Ready" },
  { key: "completed", label: "Completed" },
];

const STATUS_COLORS: Record<string, string> = {
  ordered: "border-l-muted-foreground/50",
  sample_collected: "border-l-amber-500",
  in_process: "border-l-blue-500",
  partial_results: "border-l-violet-500",
  pending_validation: "border-l-teal-500",
  completed: "border-l-emerald-500",
};

function getInitials(name: string) {
  return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

function getAge(dob: string | null): string {
  if (!dob) return "";
  const age = Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  return `${age}y`;
}

function getTatInfo(orderTime: string, items: LabOrder["lab_order_items"], isCompleted: boolean) {
  // For completed orders, freeze the TAT at the latest validated_at timestamp
  const latestValidated = isCompleted
    ? items.reduce<string | null>((latest, i) => {
        if (!i.validated_at) return latest;
        return !latest || i.validated_at > latest ? i.validated_at : latest;
      }, null)
    : null;
  const endMs = latestValidated ? new Date(latestValidated).getTime() : Date.now();
  const elapsed = (endMs - new Date(orderTime).getTime()) / 60000;
  const avgTat = items.length > 0
    ? items.reduce((s, i) => s + (i.lab_test_master?.tat_minutes || 60), 0) / items.length
    : 60;
  const hours = Math.floor(elapsed / 60);
  const mins = Math.floor(elapsed % 60);
  const label = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  const ratio = elapsed / avgTat;
  const color = isCompleted
    ? "text-emerald-600"
    : ratio > 1 ? "text-destructive font-bold"
    : ratio > 0.75 ? "text-amber-600"
    : "text-emerald-600";
  return { label, color };
}

const LabQueuePanel: React.FC<Props> = ({
  orders, selectedOrderId, onSelectOrder, filterTab, onFilterChange,
  selectedDate, onDateChange,
  statCount, urgentCount, routineCount, onNewOrder,
}) => {
  const { permissions, role } = useHospitalContext();
  const today = new Date().toISOString().split("T")[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];

  return (
    <div className="w-full bg-card border-r border-border flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-foreground shrink-0">Lab Queue</h2>
          <select
            value={filterTab}
            onChange={(e) => onFilterChange(e.target.value)}
            className="flex-1 text-[11px] font-medium rounded-md border border-border bg-muted text-foreground px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[hsl(var(--sidebar-background))] cursor-pointer"
          >
            {FILTER_TABS.map((t) => (
              <option key={t.key} value={t.key}>{t.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Date filter */}
      <div className="shrink-0 bg-muted/50 border-b border-border px-3 py-1.5 flex items-center gap-1.5">
        {[
          { label: "Today", val: today },
          { label: "Yesterday", val: yesterday },
        ].map((d) => (
          <button
            key={d.val}
            onClick={() => onDateChange(d.val)}
            className={cn(
              "px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors",
              selectedDate === d.val
                ? "bg-[hsl(var(--sidebar-background))] text-white"
                : "bg-card text-muted-foreground hover:bg-muted"
            )}
          >
            {d.label}
          </button>
        ))}
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => onDateChange(e.target.value)}
          className="ml-auto text-[10px] bg-card border border-border rounded px-1.5 py-0.5 text-foreground"
        />
      </div>

      {/* Stats bar */}
      <div className="h-8 shrink-0 bg-muted/50 border-b border-border flex items-center gap-4 px-4 text-[11px]">
        <span className="text-destructive">🔴 {statCount} STAT</span>
        <span className="text-amber-600">🟡 {urgentCount} Urgent</span>
        <span className="text-emerald-600">🟢 {routineCount} Routine</span>
      </div>

      {/* Order list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {orders.length === 0 && (
          <EmptyState
            icon="🔬"
            title="No pending lab orders"
            description="Lab orders from OPD and IPD will appear here"
          />
        )}
        {orders.map((order) => {
          const items = order.lab_order_items || [];
          const testCount = items.length;
          const reportedCount = items.filter((i) => i.status === "reported").length;
          const progress = testCount > 0 ? (reportedCount / testCount) * 100 : 0;
          const tat = getTatInfo(order.order_time, items, order.status === "completed");
          const patient = order.patients;
          const selected = order.id === selectedOrderId;

          return (
            <button
              key={order.id}
              onClick={() => onSelectOrder(order.id)}
              className={cn(
                "w-full text-left p-2.5 rounded-lg border-l-[3px] border transition-all",
                STATUS_COLORS[order.status] || "border-l-muted-foreground/30",
                selected
                  ? "bg-primary/5 border-primary/30"
                  : "border-border hover:shadow-sm"
              )}
            >
              {/* Row 1: Order ID + Priority */}
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground font-mono">
                  LAB-{order.id.slice(0, 8).toUpperCase()}
                </span>
                {order.priority === "stat" && (
                  <span className="text-[9px] font-bold bg-destructive/10 text-destructive px-1.5 py-0.5 rounded-full">🔴 STAT</span>
                )}
                {order.priority === "urgent" && (
                  <span className="text-[9px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">🟡 URGENT</span>
                )}
                {order.status === "pending_validation" && (
                  <span className="text-[9px] font-bold bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded-full">⏳ VALIDATION</span>
                )}
              </div>

              {/* Row 2: Patient */}
              {patient && (
                <div className="flex items-center gap-2 mt-1">
                  <div className="w-6 h-6 rounded-full bg-[hsl(var(--sidebar-background))] text-white flex items-center justify-center text-[10px] font-bold shrink-0">
                    {getInitials(patient.full_name)}
                  </div>
                  <span className="text-[13px] font-semibold text-foreground truncate">{patient.full_name}</span>
                </div>
              )}

              {/* Row 3: UHID + Age/Gender */}
              {patient && (
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{patient.uhid}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {getAge(patient.dob)} {patient.gender === "male" ? "M" : patient.gender === "female" ? "F" : ""}
                  </span>
                </div>
              )}

              {/* Row 4: Test count + TAT */}
              <div className="flex items-center justify-between mt-1">
                <span className="text-[11px] text-muted-foreground">
                  {reportedCount > 0 ? `${reportedCount}/${testCount} done` : `${testCount} test(s)`}
                </span>
                <span className={cn("text-[11px] flex items-center gap-0.5", tat.color)}>
                  <Clock size={10} /> {tat.label}
                </span>
              </div>

              {/* Row 5: Progress */}
              <div className="h-1 rounded-full bg-muted mt-1.5 overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    order.status === "completed" ? "bg-emerald-500" :
                    order.status === "in_process" ? "bg-blue-500" :
                    order.status === "partial_results" ? "bg-violet-500" : "bg-muted-foreground/30"
                  )}
                  style={{ width: `${progress}%` }}
                />
              </div>
            </button>
          );
        })}
      </div>

      {/* Footer */}
      {hasActionAccess("lab", "new_lab_order", permissions, role) && (
        <div className="p-3 border-t border-border shrink-0">
          <button
            onClick={onNewOrder}
            className="w-full h-10 rounded-lg bg-[hsl(var(--sidebar-background))] text-white text-[13px] font-semibold flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.98] transition-all"
          >
            <Plus size={16} /> New Lab Order
          </button>
        </div>
      )}
    </div>
  );
};

export default LabQueuePanel;
