import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, ScanLine } from "lucide-react";
import { cn } from "@/lib/utils";

// Nursing radiology results view (Radiology completion plan Phase 4). Nursing previously had
// zero radiology visibility (only a lab collection workflow tab). Uses an independent active-
// admissions query rather than the page's `tasks` array — `tasks` is derived from due/overdue
// medication + vitals windows, so a stable admitted patient with nothing due right now can be
// silently absent from it, which would be wrong for a "did anyone order imaging on my ward"
// lookup tool a nurse might check at any point in a shift.

interface Admission {
  id: string;
  patient_id: string;
  patient_name: string;
  ward_id: string | null;
  ward_name: string;
  bed_label: string;
}

interface RadRow {
  id: string;
  study_name: string;
  modality_type: string | null;
  status: string;
  impression: string | null;
  is_critical: boolean | null;
  order_date: string;
  accession: string | null;
}

const RAD_DONE_STATUSES = ["reported", "validated"];

interface Props {
  hospitalId: string;
  wards: { id: string; name: string }[];
}

const NursingRadiologyResultsTab: React.FC<Props> = ({ hospitalId, wards }) => {
  const [selectedWard, setSelectedWard] = useState<string>("all");
  const [admissions, setAdmissions] = useState<Admission[]>([]);
  const [loadingAdmissions, setLoadingAdmissions] = useState(true);
  const [selectedAdmission, setSelectedAdmission] = useState<Admission | null>(null);
  const [radRows, setRadRows] = useState<RadRow[]>([]);
  const [loadingResults, setLoadingResults] = useState(false);

  const loadAdmissions = useCallback(async () => {
    if (!hospitalId) return;
    setLoadingAdmissions(true);
    let query = supabase
      .from("admissions")
      .select(`
        id, patient_id, ward_id,
        patients!admissions_patient_id_fkey(full_name),
        beds!admissions_bed_id_fkey(bed_number),
        wards!admissions_ward_id_fkey(id, name)
      `)
      .eq("hospital_id", hospitalId)
      .eq("status", "active")
      .order("id");

    if (selectedWard !== "all") query = query.eq("ward_id", selectedWard);

    const { data } = await query;
    setAdmissions((data || []).map((a: any) => ({
      id: a.id,
      patient_id: a.patient_id,
      patient_name: a.patients?.full_name || "Unknown",
      ward_id: a.wards?.id || a.ward_id,
      ward_name: a.wards?.name || "—",
      bed_label: `${a.wards?.name || "—"}-${a.beds?.bed_number || "?"}`,
    })));
    setLoadingAdmissions(false);
  }, [hospitalId, selectedWard]);

  useEffect(() => { loadAdmissions(); }, [loadAdmissions]);

  const loadResults = useCallback(async () => {
    if (!selectedAdmission || !hospitalId) { setRadRows([]); return; }
    setLoadingResults(true);
    const { data } = await (supabase as any)
      .from("radiology_orders")
      .select(`
        id, order_date, accession_number, status, study_name, modality_type,
        radiology_reports(impression, is_critical)
      `)
      .eq("hospital_id", hospitalId)
      .eq("admission_id", selectedAdmission.id)
      .neq("status", "cancelled")
      .order("order_date", { ascending: false })
      .limit(100);

    setRadRows((data || []).map((o: any) => {
      const report = Array.isArray(o.radiology_reports) ? (o.radiology_reports[0] || null) : (o.radiology_reports || null);
      return {
        id: o.id,
        study_name: o.study_name,
        modality_type: o.modality_type,
        status: o.status,
        impression: report?.impression ?? null,
        is_critical: report?.is_critical ?? null,
        order_date: o.order_date,
        accession: o.accession_number,
      };
    }));
    setLoadingResults(false);
  }, [selectedAdmission, hospitalId]);

  useEffect(() => { loadResults(); }, [loadResults]);

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Patient list */}
      <div className="w-52 border-r overflow-y-auto shrink-0 flex flex-col">
        <div className="px-3 py-2 border-b shrink-0">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1.5">Select Patient</p>
          <select
            value={selectedWard}
            onChange={(e) => setSelectedWard(e.target.value)}
            className="w-full text-[11px] bg-muted border border-border rounded px-1.5 py-1"
          >
            <option value="all">All Wards</option>
            {wards.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loadingAdmissions ? (
            <div className="flex items-center justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : admissions.length === 0 ? (
            <p className="text-xs text-muted-foreground px-3 py-4">No active admissions</p>
          ) : (
            admissions.map((a) => (
              <button
                key={a.id}
                onClick={() => setSelectedAdmission(a)}
                className={cn(
                  "w-full text-left px-3 py-2 border-b text-xs hover:bg-muted transition-colors",
                  selectedAdmission?.id === a.id && "bg-primary/10 font-semibold"
                )}
              >
                <p className="truncate font-medium">{a.patient_name}</p>
                <p className="text-[10px] text-muted-foreground truncate">{a.bed_label}</p>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Detail panel */}
      <div className="flex-1 overflow-y-auto p-4">
        {!selectedAdmission ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            Select a patient to view radiology results
          </div>
        ) : loadingResults ? (
          <div className="flex items-center justify-center h-40"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : radRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
            <ScanLine size={36} className="opacity-30 mb-2" />
            <p className="text-sm">No radiology results for this admission yet.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {radRows.map((r) => {
              const done = RAD_DONE_STATUSES.includes(r.status);
              return (
                <div
                  key={r.id}
                  className={cn(
                    "rounded-lg border p-3 text-xs",
                    r.is_critical ? "bg-red-50 border-red-200" : "bg-card border-border"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-[13px]">{r.study_name}</span>
                    {r.is_critical && <span className="text-[10px] font-bold text-red-700">🔴 Critical</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
                    <span className="font-mono">{r.accession || "—"}</span>
                    <span className="uppercase">{r.modality_type || ""}</span>
                    <span className="capitalize">{r.status.replace(/_/g, " ")}</span>
                    <span>{new Date(r.order_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
                  </div>
                  {r.impression ? (
                    <p className={cn("mt-1.5", r.is_critical ? "text-red-800 font-semibold" : "text-foreground")}>{r.impression}</p>
                  ) : !done ? (
                    <p className="mt-1.5 text-amber-600">Pending report</p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default NursingRadiologyResultsTab;
