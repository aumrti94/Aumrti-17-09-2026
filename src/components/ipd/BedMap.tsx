import React, { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus } from "lucide-react";
import type { BedData } from "@/pages/ipd/IPDPage";
import NABHBadge from "@/components/nabh/NABHBadge";
import { useHospitalContext } from "@/contexts/HospitalContext";
import { hasActionAccess } from "@/lib/tabPermissions";

interface Props {
  beds: BedData[];
  selectedBedId: string | null;
  onSelectBed: (id: string) => void;
  hospitalId: string | null;
  loading: boolean;
  onRefresh: () => void;
  onNewAdmission: () => void;
}

const statusColors: Record<string, { bg: string; border: string; hoverBorder: string }> = {
  available: { bg: "bg-green-50", border: "border-green-300", hoverBorder: "hover:border-green-500" },
  occupied: { bg: "bg-red-50", border: "border-red-300", hoverBorder: "hover:border-red-500" },
  cleaning: { bg: "bg-amber-50", border: "border-amber-300", hoverBorder: "hover:border-amber-500" },
  reserved: { bg: "bg-blue-50", border: "border-blue-300", hoverBorder: "hover:border-blue-500" },
  maintenance: { bg: "bg-slate-100", border: "border-slate-300", hoverBorder: "" },
};

const BedMap: React.FC<Props> = ({ beds, selectedBedId, onSelectBed, hospitalId, loading, onRefresh, onNewAdmission }) => {
  const { permissions, role } = useHospitalContext();
  const [wards, setWards] = useState<{ id: string; name: string }[]>([]);
  const [activeWard, setActiveWard] = useState<string>("all");
  const [activeDept, setActiveDept] = useState<string>("all");
  const [activeDoctor, setActiveDoctor] = useState<string>("all");

  useEffect(() => {
    if (!hospitalId) return;
    supabase.from("wards").select("id, name").eq("hospital_id", hospitalId).eq("is_active", true)
      .then(({ data }) => setWards(data || []));
  }, [hospitalId]);

  // Derive unique departments and doctors from currently occupied beds
  const { departments, doctors } = useMemo(() => {
    const deptSet = new Set<string>();
    const docSet = new Set<string>();
    beds.forEach((b) => {
      if (b.admission) {
        if (b.admission.doctor_department) deptSet.add(b.admission.doctor_department);
        if (b.admission.doctor_name && b.admission.doctor_name !== "—") docSet.add(b.admission.doctor_name);
      }
    });
    return {
      departments: Array.from(deptSet).sort(),
      doctors: Array.from(docSet).sort(),
    };
  }, [beds]);

  const filtered = useMemo(() => {
    return beds.filter((b) => {
      if (activeWard !== "all" && b.ward_id !== activeWard) return false;
      if (activeDept !== "all" && b.admission?.doctor_department !== activeDept) return false;
      if (activeDoctor !== "all" && b.admission?.doctor_name !== activeDoctor) return false;
      return true;
    });
  }, [beds, activeWard, activeDept, activeDoctor]);

  const hasActiveFilter = activeWard !== "all" || activeDept !== "all" || activeDoctor !== "all";

  const total = filtered.length;
  const occupied = filtered.filter((b) => b.status === "occupied").length;
  const available = filtered.filter((b) => b.status === "available").length;
  const cleaning = filtered.filter((b) => b.status === "cleaning").length;
  const reserved = filtered.filter((b) => b.status === "reserved").length;
  const occPct = total > 0 ? Math.round((occupied / total) * 100) : 0;

  const occPill = occPct < 70
    ? "bg-green-100 text-green-700"
    : occPct < 90 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700";

  return (
    <div className="w-full bg-white border-r border-slate-200 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 h-12 px-4 flex items-center justify-between border-b border-slate-100">
        <span className="text-sm font-bold text-slate-900">Bed Map</span>
        <div className="flex items-center gap-2">
          <NABHBadge standardCodes={["AAC.3", "AAC.7", "AAC.9", "COP.2"]} />
          <span className={cn("text-[11px] font-bold px-2.5 py-0.5 rounded-full", occPill)}>
            {occupied}/{total} Occupied
          </span>
        </div>
      </div>

      {/* Filters: Ward · Department · Doctor */}
      <div className="flex-shrink-0 border-b border-slate-100 px-3 py-2 space-y-1.5">
        <select
          value={activeWard}
          onChange={(e) => setActiveWard(e.target.value)}
          className="w-full h-7 text-xs border border-slate-200 rounded-md px-2 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#1A2F5A]/40"
        >
          <option value="all">All Wards</option>
          {wards.map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
        <select
          value={activeDept}
          onChange={(e) => setActiveDept(e.target.value)}
          className="w-full h-7 text-xs border border-slate-200 rounded-md px-2 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#1A2F5A]/40"
        >
          <option value="all">All Departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <div className="flex items-center gap-1.5">
          <select
            value={activeDoctor}
            onChange={(e) => setActiveDoctor(e.target.value)}
            className="flex-1 h-7 text-xs border border-slate-200 rounded-md px-2 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#1A2F5A]/40"
          >
            <option value="all">All Doctors</option>
            {doctors.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          {hasActiveFilter && (
            <button
              onClick={() => { setActiveWard("all"); setActiveDept("all"); setActiveDoctor("all"); }}
              className="h-7 px-2 text-[10px] text-slate-500 hover:text-[#1A2F5A] border border-slate-200 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
              title="Clear all filters"
            >
              ✕ Clear
            </button>
          )}
        </div>
      </div>

      {/* Occupancy summary */}
      <div className="flex-shrink-0 h-8 bg-slate-50 border-b border-slate-100 flex items-center gap-3 px-4">
        <span className="text-[11px] text-emerald-500 font-medium">🟢 {available} Free</span>
        <span className="text-[11px] text-red-500 font-medium">🔴 {occupied} Occupied</span>
        <span className="text-[11px] text-amber-500 font-medium">🟡 {cleaning} Cleaning</span>
        <span className="text-[11px] text-blue-500 font-medium">🔵 {reserved} Reserved</span>
      </div>

      {/* Bed grid */}
      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center gap-2">
            {hasActiveFilter ? (
              <>
                <span className="text-sm text-slate-400">No beds match the selected filters</span>
                <button
                  onClick={() => { setActiveWard("all"); setActiveDept("all"); setActiveDoctor("all"); }}
                  className="text-xs text-[#1A2F5A] font-medium hover:underline"
                >
                  Clear filters
                </button>
              </>
            ) : (
              <>
                <span className="text-sm text-slate-400">No wards or beds configured</span>
                <Link to="/settings/wards" className="text-xs text-[#1A2F5A] font-medium hover:underline">Go to Settings → Wards & Beds</Link>
              </>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {filtered.map((bed) => {
              const colors = statusColors[bed.status] || statusColors.maintenance;
              const isSelected = bed.id === selectedBedId;
              return (
                <button
                  key={bed.id}
                  onClick={() => onSelectBed(bed.id)}
                  className={cn(
                    "h-14 rounded-lg border-[1.5px] flex flex-col items-center justify-center transition-all relative",
                    colors.bg, colors.border, colors.hoverBorder,
                    isSelected && "ring-2 ring-[#1A2F5A]"
                  )}
                >
                  <span className="text-[11px] font-bold text-slate-700">{bed.bed_number}</span>
                  {bed.status === "occupied" && bed.admission ? (
                    <>
                      <span className="text-[14px] font-bold text-slate-800 leading-none">{bed.admission.patient_initials}</span>
                      <div className="flex items-center gap-0.5 flex-wrap justify-center">
                        <span className="text-[9px] text-slate-500">Day {bed.admission.los_days}</span>
                        {bed.admission.is_mlc && (
                          <span className="text-[8px] bg-red-600 text-white px-1 py-px rounded font-bold leading-none">MLC</span>
                        )}
                        {bed.admission.payer_type && bed.admission.payer_type !== "cash" && (
                          <span className={cn(
                            "text-[8px] px-1 py-px rounded font-bold leading-none",
                            bed.admission.payer_type === "corporate" ? "bg-blue-600 text-white" :
                            bed.admission.payer_type === "tpa" ? "bg-purple-600 text-white" :
                            bed.admission.payer_type === "pmjay" ? "bg-green-600 text-white" :
                            bed.admission.payer_type === "cghs" ? "bg-teal-600 text-white" :
                            bed.admission.payer_type === "esi" ? "bg-orange-600 text-white" :
                            bed.admission.payer_type === "state_scheme" ? "bg-indigo-600 text-white" :
                            "bg-slate-500 text-white"
                          )}>
                            {bed.admission.payer_type === "corporate" ? "Corp" :
                             bed.admission.payer_type === "tpa" ? "TPA" :
                             bed.admission.payer_type === "pmjay" ? "PMJAY" :
                             bed.admission.payer_type === "cghs" ? "CGHS" :
                             bed.admission.payer_type === "esi" ? "ESI" :
                             bed.admission.payer_type === "state_scheme" ? "State" :
                             bed.admission.payer_type === "credit" ? "Cr" : "Oth"}
                          </span>
                        )}
                        {bed.admission.abha_id
                          ? <span className="text-[8px] bg-emerald-100 text-emerald-700 px-1 py-px rounded font-bold leading-none">ABHA✓</span>
                          : <span className="text-[8px] bg-slate-100 text-slate-400 px-1 py-px rounded font-medium leading-none">No ABHA</span>
                        }
                      </div>
                    </>
                  ) : bed.status === "available" ? (
                    <Plus className="h-5 w-5 text-green-500" />
                  ) : bed.status === "cleaning" ? (
                    <span className="text-sm">🧹</span>
                  ) : bed.status === "reserved" ? (
                    <span className="text-[10px] text-blue-500 font-medium">Rsv</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      {hasActionAccess("ipd", "new_admission", permissions, role) && (
        <div className="flex-shrink-0 border-t border-slate-100 p-2">
          <button onClick={onNewAdmission} className="w-full h-9 bg-[#1A2F5A] text-white rounded-lg text-[13px] font-semibold hover:bg-[#152647] active:scale-[0.98] transition-all">
            + New Admission
          </button>
        </div>
      )}
    </div>
  );
};

export default BedMap;
