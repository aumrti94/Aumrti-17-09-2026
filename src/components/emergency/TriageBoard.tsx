import React from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import type { EDVisit } from "@/pages/emergency/EmergencyPage";
import { useHospitalContext } from "@/contexts/HospitalContext";
import { hasActionAccess } from "@/lib/tabPermissions";

interface Props {
  visits: EDVisit[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRegister: () => void;
  onTriageChange: (id: string, cat: string) => void;
  loading: boolean;
}

const columns = [
  { key: "P1", label: "🔴 IMMEDIATE", bg: "rgba(239,68,68,0.06)", border: "rgba(239,68,68,0.2)", header: "#EF4444", cardBg: "#1E293B", cardText: "text-white" },
  { key: "P2", label: "🟠 URGENT", bg: "rgba(249,115,22,0.06)", border: "rgba(249,115,22,0.2)", header: "#F97316", cardBg: "#1E293B", cardText: "text-white" },
  { key: "P3", label: "🟡 DELAYED", bg: "rgba(234,179,8,0.06)", border: "rgba(234,179,8,0.2)", header: "#EAB308", cardBg: "white", cardText: "text-slate-900" },
  { key: "P4", label: "🟢 MINOR", bg: "rgba(34,197,94,0.06)", border: "rgba(34,197,94,0.2)", header: "#22C55E", cardBg: "white", cardText: "text-slate-900" },
];

const borderLeftColors: Record<string, string> = {
  P1: "border-l-red-500",
  P2: "border-l-orange-500",
  P3: "border-l-yellow-500",
  P4: "border-l-green-500",
};

const TriageBoard: React.FC<Props> = ({ visits, selectedId, onSelect, onRegister, onTriageChange, loading }) => {
  const { permissions, role } = useHospitalContext();
  const handleDragStart = (e: React.DragEvent, visitId: string) => {
    e.dataTransfer.setData("visitId", visitId);
  };

  const handleDrop = (e: React.DragEvent, category: string) => {
    e.preventDefault();
    const visitId = e.dataTransfer.getData("visitId");
    if (visitId) onTriageChange(visitId, category);
  };

  return (
    <div className="h-full flex flex-col px-4 pt-2">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-2 flex-shrink-0">
        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Triage Board</span>
        {hasActionAccess("emergency", "register_patient", permissions, role) && (
          <button
            onClick={onRegister}
            className="h-9 px-5 rounded-lg text-[13px] font-bold text-white active:scale-[0.97] transition-all"
            style={{ background: "#22C55E" }}
          >
            + Register Emergency Patient
          </button>
        )}
      </div>

      {/* Columns */}
      <div className="flex-1 grid grid-cols-4 gap-2 min-h-0">
        {columns.map(col => {
          const colVisits = visits.filter(v => v.triage_category === col.key);
          return (
            <div key={col.key} className="flex flex-col min-h-0">
              {/* Column header */}
              <div className="flex-shrink-0 h-9 rounded-t-lg flex items-center justify-between px-3" style={{ background: col.header }}>
                <span className="text-xs font-bold text-white">{col.label}</span>
                <span className="text-[11px] bg-white/20 text-white px-2 py-0.5 rounded-full font-bold">{colVisits.length}</span>
              </div>

              {/* Column body */}
              <div
                className="flex-1 overflow-y-auto p-2 rounded-b-lg"
                style={{ background: col.bg, border: `1px solid ${col.border}`, borderTop: "none" }}
                onDragOver={e => e.preventDefault()}
                onDrop={e => handleDrop(e, col.key)}
              >
                {loading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-16 rounded-md" />
                    <Skeleton className="h-16 rounded-md" />
                  </div>
                ) : colVisits.length === 0 ? (
                  <p className="text-center text-xs text-slate-500 py-4">No patients</p>
                ) : (
                  <div className="space-y-1.5">
                    {colVisits.map(v => (
                      <div
                        key={v.id}
                        draggable
                        onDragStart={e => handleDragStart(e, v.id)}
                        onClick={() => onSelect(v.id)}
                        className={cn(
                          "rounded-md p-2 cursor-pointer border-l-[3px] transition-all hover:opacity-90 active:scale-[0.98]",
                          borderLeftColors[col.key],
                          selectedId === v.id && "ring-1 ring-blue-400",
                          col.cardText
                        )}
                        style={{ background: col.cardBg }}
                      >
                        <div className="flex items-center justify-between">
                          <span className={cn("text-[13px] font-bold truncate max-w-[120px]", col.cardText)}>{v.patient_name}</span>
                          <span className="text-[10px] text-slate-400">{formatTime(v.minutes_ago)}</span>
                        </div>
                        {v.chief_complaint && (
                          <p className="text-[11px] text-slate-400 truncate mt-0.5">{v.chief_complaint}</p>
                        )}
                        <div className="flex items-center gap-1 mt-1">
                          {v.mlc && (
                            <span className="text-[9px] bg-red-600 text-white px-1.5 py-px rounded-full font-bold">
                              {v.mlc_details?.mlc_number || "MLC"}
                            </span>
                          )}
                          {v.disposition !== "awaiting" && (
                            <span className="text-[9px] bg-slate-600 text-slate-300 px-1.5 py-px rounded-full capitalize">{v.disposition}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const formatTime = (mins: number) => {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m`;
};

export default TriageBoard;
