import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, FlaskConical, ScanLine } from "lucide-react";
import { cn } from "@/lib/utils";

// IPD per-admission investigations / lab + radiology results (lab plan Phase 9, radiology
// added in the Radiology completion plan Phase 3). Read-only chronological view of this
// admission's investigations — labs and imaging are rendered as separate per-date
// sub-tables since their row shapes differ (scalar lab result vs. prose radiology report).

interface ResultRow {
  id: string;
  test_name: string;
  result_value: string | null;
  result_unit: string | null;
  reference_range: string | null;
  result_flag: string | null;
  status: string;
  order_date: string;
  accession: string | null;
}

interface RadRow {
  id: string;
  study_name: string;
  modality_type: string | null;
  status: string;
  findings: string | null;
  impression: string | null;
  is_critical: boolean | null;
  critical_finding: string | null;
  is_signed: boolean | null;
  order_date: string;
  accession: string | null;
}

const FLAG_STYLE: Record<string, string> = {
  H: "text-amber-700 font-semibold",
  L: "text-blue-700 font-semibold",
  CH: "text-red-700 font-bold",
  CL: "text-indigo-700 font-bold",
  A: "text-purple-700 font-semibold",
};

const FLAG_LABEL: Record<string, string> = { H: "↑ H", L: "↓ L", CH: "↑↑ Critical", CL: "↓↓ Critical", A: "Abnormal" };
const RAD_DONE_STATUSES = ["reported", "validated"];

interface Props {
  admissionId: string;
  hospitalId: string;
  patientId?: string | null;
}

const InvestigationsTab: React.FC<Props> = ({ admissionId, hospitalId, patientId }) => {
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [radRows, setRadRows] = useState<RadRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [labRes, radRes] = await Promise.all([
      (supabase as any)
        .from("lab_orders")
        .select(`
          id, order_date, accession_number, status,
          lab_order_items(id, result_value, result_unit, reference_range, result_flag, status,
            lab_test_master:lab_test_master!lab_order_items_test_id_fkey(test_name))
        `)
        .eq("hospital_id", hospitalId)
        .eq("admission_id", admissionId)
        .neq("status", "cancelled")
        .order("order_date", { ascending: false })
        .limit(100),
      (supabase as any)
        .from("radiology_orders")
        .select(`
          id, order_date, accession_number, status, study_name, modality_type,
          radiology_reports(findings, impression, is_critical, critical_finding, is_signed, validated_at)
        `)
        .eq("hospital_id", hospitalId)
        .eq("admission_id", admissionId)
        .neq("status", "cancelled")
        .order("order_date", { ascending: false })
        .limit(100),
    ]);

    const flat: ResultRow[] = [];
    for (const o of labRes.data || []) {
      for (const it of o.lab_order_items || []) {
        flat.push({
          id: it.id,
          test_name: it.lab_test_master?.test_name || "—",
          result_value: it.result_value,
          result_unit: it.result_unit,
          reference_range: it.reference_range,
          result_flag: it.result_flag,
          status: it.status,
          order_date: o.order_date,
          accession: o.accession_number,
        });
      }
    }
    setRows(flat);

    const flatRad: RadRow[] = (radRes.data || []).map((o: any) => {
      const report = Array.isArray(o.radiology_reports) ? (o.radiology_reports[0] || null) : (o.radiology_reports || null);
      return {
        id: o.id,
        study_name: o.study_name,
        modality_type: o.modality_type,
        status: o.status,
        findings: report?.findings ?? null,
        impression: report?.impression ?? null,
        is_critical: report?.is_critical ?? null,
        critical_finding: report?.critical_finding ?? null,
        is_signed: report?.is_signed ?? null,
        order_date: o.order_date,
        accession: o.accession_number,
      };
    });
    setRadRows(flatRad);

    setLoading(false);
  }, [admissionId, hospitalId]);

  useEffect(() => { load(); }, [load]);

  // Group by order date
  const byDate = rows.reduce<Record<string, ResultRow[]>>((acc, r) => {
    (acc[r.order_date] ||= []).push(r);
    return acc;
  }, {});
  const radByDate = radRows.reduce<Record<string, RadRow[]>>((acc, r) => {
    (acc[r.order_date] ||= []).push(r);
    return acc;
  }, {});
  const allDates = Array.from(new Set([...Object.keys(byDate), ...Object.keys(radByDate)])).sort((a, b) => b.localeCompare(a));

  if (loading) {
    return <div className="flex items-center justify-center h-40"><Loader2 className="animate-spin text-muted-foreground" size={20} /></div>;
  }

  if (rows.length === 0 && radRows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
        <FlaskConical size={36} className="opacity-30 mb-2" />
        <p className="text-sm">No investigations for this admission yet.</p>
        <p className="text-xs opacity-70">Order labs or imaging from the Rx &amp; Orders tab.</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 space-y-5">
      {allDates.map((date) => {
        const dRows = byDate[date];
        const dRadRows = radByDate[date];
        return (
          <div key={date}>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">
              {new Date(date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
            </p>

            {dRows && dRows.length > 0 && (
              <div className="border border-border rounded-lg overflow-hidden mb-2">
                <table className="w-full text-[12px]">
                  <thead className="bg-muted/60">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Test</th>
                      <th className="px-3 py-2 text-left font-medium">Result</th>
                      <th className="px-3 py-2 text-left font-medium">Unit</th>
                      <th className="px-3 py-2 text-left font-medium">Ref. Range</th>
                      <th className="px-3 py-2 text-left font-medium">Flag</th>
                      <th className="px-3 py-2 text-left font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {dRows.map(r => (
                      <tr key={r.id} className={cn((r.result_flag === "CH" || r.result_flag === "CL") && "bg-red-50/50")}>
                        <td className="px-3 py-2 font-medium">{r.test_name}</td>
                        <td className={cn("px-3 py-2", r.result_flag && FLAG_STYLE[r.result_flag])}>{r.result_value || "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{r.result_unit || "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{r.reference_range || "—"}</td>
                        <td className={cn("px-3 py-2", r.result_flag && FLAG_STYLE[r.result_flag])}>
                          {r.result_flag ? FLAG_LABEL[r.result_flag] || r.result_flag : ""}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground capitalize">{r.status.replace(/_/g, " ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {dRadRows && dRadRows.length > 0 && (
              <div className="border border-border rounded-lg overflow-hidden">
                <div className="bg-muted/60 px-3 py-1.5 flex items-center gap-1.5">
                  <ScanLine size={12} className="text-muted-foreground" />
                  <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Imaging</span>
                </div>
                <table className="w-full text-[12px]">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Study</th>
                      <th className="px-3 py-2 text-left font-medium">Modality</th>
                      <th className="px-3 py-2 text-left font-medium">Status</th>
                      <th className="px-3 py-2 text-left font-medium">Impression</th>
                      <th className="px-3 py-2 text-left font-medium">Flag</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {dRadRows.map(r => {
                      const done = RAD_DONE_STATUSES.includes(r.status);
                      return (
                        <tr key={r.id} className={cn(r.is_critical && "bg-red-50/50")}>
                          <td className="px-3 py-2 font-medium">{r.study_name}</td>
                          <td className="px-3 py-2 text-muted-foreground uppercase">{r.modality_type || "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground capitalize">{r.status.replace(/_/g, " ")}</td>
                          <td className="px-3 py-2">{r.impression || (done ? "—" : "Pending")}</td>
                          <td className={cn("px-3 py-2", r.is_critical && "text-red-700 font-bold")}>
                            {r.is_critical ? "🔴 Critical" : done ? "" : "Pending"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default InvestigationsTab;
