import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { Plus, Clock, BookOpen } from "lucide-react";
import { useNavigate } from "react-router-dom";
import EmptyState from "@/components/EmptyState";
import type { RadiologyOrder, Modality } from "@/pages/radiology/RadiologyPage";
import NABHBadge from "@/components/nabh/NABHBadge";

interface Props {
  orders: RadiologyOrder[];
  modalities: Modality[];
  selectedOrderId: string | null;
  onSelectOrder: (id: string) => void;
  filterModality: string;
  onFilterChange: (v: string) => void;
  selectedDate: string;
  onDateChange: (d: string) => void;
  statCounts: { pending: number; imaging: number; reporting: number; done: number };
  onNewOrder: () => void;
}

const MODALITY_ICONS: Record<string, string> = {
  xray: "🩻", usg: "🔊", ct: "🧲", mri: "🧲", echo: "🫀", ecg: "❤️",
  mammography: "🔬", dexa: "🦴", fluoroscopy: "📡", endoscopy: "🔭", other: "📋",
};

const STATUS_BORDER: Record<string, string> = {
  ordered: "border-l-slate-400",
  scheduled: "border-l-sky-400",
  patient_arrived: "border-l-amber-500",
  in_progress: "border-l-blue-500",
  images_acquired: "border-l-violet-500",
  reported: "border-l-emerald-500",
  validated: "border-l-emerald-800",
};

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  ordered: { label: "Ordered", cls: "bg-slate-100 text-slate-600" },
  scheduled: { label: "Scheduled", cls: "bg-sky-50 text-sky-700" },
  patient_arrived: { label: "Arrived", cls: "bg-amber-50 text-amber-700" },
  in_progress: { label: "Imaging", cls: "bg-blue-50 text-blue-700" },
  images_acquired: { label: "Awaiting Report", cls: "bg-violet-50 text-violet-700" },
  reported: { label: "Reported", cls: "bg-emerald-50 text-emerald-700" },
  validated: { label: "Validated ✓", cls: "bg-emerald-100 text-emerald-800" },
};

const MODALITY_TABS = [
  { key: "all", label: "All", icon: "📋" },
  { key: "xray", label: "X-Ray", icon: "🩻" },
  { key: "usg", label: "USG", icon: "🔊" },
  { key: "echo", label: "Echo", icon: "🫀" },
  { key: "ecg", label: "ECG", icon: "❤️" },
  { key: "ct", label: "CT", icon: "🧲" },
  { key: "mri", label: "MRI", icon: "🧲" },
];

function getAge(dob: string | null): string {
  if (!dob) return "";
  const diff = Date.now() - new Date(dob).getTime();
  const y = Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
  return `${y}y`;
}

function timeAgo(t: string): string {
  const mins = Math.floor((Date.now() - new Date(t).getTime()) / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "ordered", label: "Ordered" },
  { value: "scheduled", label: "Scheduled" },
  { value: "patient_arrived", label: "Arrived" },
  { value: "in_progress", label: "Imaging" },
  { value: "images_acquired", label: "Awaiting Report" },
  { value: "reported", label: "Reported" },
  { value: "validated", label: "Validated" },
];

const RadiologyWorklist: React.FC<Props> = ({
  orders, modalities, selectedOrderId, onSelectOrder,
  filterModality, onFilterChange, selectedDate, onDateChange,
  statCounts, onNewOrder,
}) => {
  const navigate = useNavigate();
  const [filterStatus, setFilterStatus] = useState("all");
  const today = new Date().toISOString().split("T")[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
  const visibleOrders = filterStatus === "all" ? orders : orders.filter(o => o.status === filterStatus);

  return (
    <div className="w-full bg-card border-r border-border flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-4 pt-3 pb-2 border-b border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-foreground">Radiology Worklist</h2>
          <NABHBadge standardCodes={["AAC.3", "COP.8", "QPS.2"]} />
        </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => navigate("/radiology/pcpndt-register")}
              title="PCPNDT Register"
              className="flex items-center gap-1 px-2 py-1 rounded-md border border-amber-300 bg-amber-50 text-amber-700 text-[11px] font-semibold hover:bg-amber-100 active:scale-[0.97] transition-all"
            >
              <BookOpen size={11} /> PCPNDT
            </button>
            <button
              onClick={onNewOrder}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[hsl(220,55%,23%)] text-white text-[11px] font-semibold hover:bg-[hsl(220,55%,30%)] active:scale-[0.97] transition-all"
            >
              <Plus size={12} /> New Study
            </button>
          </div>
        </div>

        {/* Filters row: modality + status */}
        <div className="mt-2 flex gap-1.5">
          <select
            value={filterModality}
            onChange={e => onFilterChange(e.target.value)}
            className="flex-1 text-[12px] bg-muted border border-border rounded-md px-2 py-1.5 text-foreground font-medium focus:outline-none focus:ring-1 focus:ring-[hsl(220,55%,23%)] cursor-pointer"
          >
            {MODALITY_TABS.map(t => (
              <option key={t.key} value={t.key}>{t.icon} {t.label}</option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="flex-1 text-[12px] bg-muted border border-border rounded-md px-2 py-1.5 text-foreground font-medium focus:outline-none focus:ring-1 focus:ring-[hsl(220,55%,23%)] cursor-pointer"
          >
            {STATUS_FILTER_OPTIONS.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Date filter */}
      <div className="shrink-0 bg-muted/50 border-b border-border px-4 py-1.5 flex items-center gap-1.5">
        {[
          { label: "Today", val: today },
          { label: "Yesterday", val: yesterday },
        ].map(d => (
          <button
            key={d.val}
            onClick={() => onDateChange(d.val)}
            className={cn(
              "px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors",
              selectedDate === d.val
                ? "bg-[hsl(220,55%,23%)] text-white"
                : "bg-card text-muted-foreground hover:bg-muted"
            )}
          >
            {d.label}
          </button>
        ))}
        <input
          type="date"
          value={selectedDate}
          onChange={e => onDateChange(e.target.value)}
          className="ml-auto text-[10px] bg-card border border-border rounded px-1.5 py-0.5 text-foreground"
        />
      </div>

      {/* Stats bar */}
      <div className="shrink-0 bg-muted/50 border-b border-border px-4 py-1 flex items-center gap-3 text-[11px]">
        <span className="text-muted-foreground">⏳ {statCounts.pending}</span>
        <span className="text-blue-600">📷 {statCounts.imaging}</span>
        <span className="text-violet-600">✍️ {statCounts.reporting}</span>
        <span className="text-emerald-600">✓ {statCounts.done}</span>
      </div>

      {/* Order list */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1.5">
        {visibleOrders.length === 0 && (
          <EmptyState
            icon="🩻"
            title="No studies in worklist"
            description="Radiology orders will appear here when created"
          />
        )}
        {visibleOrders.map(o => {
          const sel = o.id === selectedOrderId;
          const statusInfo = STATUS_LABEL[o.status] || STATUS_LABEL.ordered;
          const modIcon = MODALITY_ICONS[o.modality_type] || "📋";

          return (
            <button
              key={o.id}
              onClick={() => onSelectOrder(o.id)}
              className={cn(
                "w-full text-left p-2.5 rounded-lg border transition-all relative",
                "border-l-[3px]",
                STATUS_BORDER[o.status] || "border-l-slate-400",
                sel
                  ? "bg-[hsl(220,80%,96%)] border-[hsl(220,55%,23%)] ring-1 ring-[hsl(220,55%,23%)]/20"
                  : "bg-card border-border hover:shadow-sm"
              )}
            >
              {/* Modality badge */}
              <span className="absolute top-2 right-2 w-6 h-6 rounded-full bg-muted flex items-center justify-center text-sm">
                {modIcon}
              </span>

              {/* Row 1: Accession + Priority */}
              <div className="flex items-center justify-between pr-8">
                <span className="text-[10px] font-mono text-muted-foreground">
                  {o.accession_number || `RAD-${o.id.slice(0, 8).toUpperCase()}`}
                </span>
                {o.priority === "stat" && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-50 text-red-600">🔴 STAT</span>
                )}
                {o.priority === "urgent" && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">🟡 URGENT</span>
                )}
                {o.ai_flag === "critical" && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-50 text-red-600">🔴 AI:Crit</span>
                )}
                {o.ai_flag === "abnormal" && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-50 text-purple-700">🟣 AI:Abn</span>
                )}
                {o.ai_flag === "normal" && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">✓ AI:Nrm</span>
                )}
              </div>

              {/* Row 2: Patient */}
              <div className="flex items-center gap-2 mt-1">
                <div className="w-6 h-6 rounded-full bg-[hsl(220,55%,23%)] text-white flex items-center justify-center text-[10px] font-bold shrink-0">
                  {(o.patients?.full_name || "?").charAt(0)}
                </div>
                <span className="text-[13px] font-semibold text-foreground truncate">{o.patients?.full_name}</span>
              </div>

              {/* Row 3: UHID + Age */}
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono">{o.patients?.uhid}</span>
                <span className="text-[10px] text-muted-foreground">
                  {getAge(o.patients?.dob || null)} {o.patients?.gender || ""}
                </span>
              </div>

              {/* Row 4: Study name */}
              <p className="text-[12px] text-foreground/80 mt-1 truncate">{o.study_name}</p>

              {/* Row 5: Doctor + time */}
              <div className="flex items-center justify-between mt-0.5">
                <span className="text-[10px] text-muted-foreground">Dr. {o.ordered_by_user?.full_name}</span>
                <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                  <Clock size={9} /> {timeAgo(o.order_time)}
                </span>
              </div>

              {/* Row 6: Status + PCPNDT */}
              <div className="flex items-center gap-1.5 mt-1.5">
                <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full", statusInfo.cls)}>
                  {statusInfo.label}
                </span>
                {o.is_pcpndt && (
                  <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-700">
                    PCPNDT
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-border p-3">
        <button
          onClick={onNewOrder}
          className="w-full h-10 rounded-lg bg-[hsl(220,55%,23%)] text-white text-[13px] font-semibold hover:bg-[hsl(220,55%,30%)] active:scale-[0.97] transition-all"
        >
          + New Radiology Order
        </button>
      </div>
    </div>
  );
};

export default RadiologyWorklist;
