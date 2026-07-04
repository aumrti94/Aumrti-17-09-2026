import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";

// IPD per-admission investigations / lab results (lab plan Phase 9). Read-only
// chronological view of this admission's lab results with flags color-coded — the
// results view IPD never had (labs were only orderable via Rx & Orders, never shown).

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

const FLAG_STYLE: Record<string, string> = {
  H: "text-amber-700 font-semibold",
  L: "text-blue-700 font-semibold",
  CH: "text-red-700 font-bold",
  CL: "text-indigo-700 font-bold",
  A: "text-purple-700 font-semibold",
};

const FLAG_LABEL: Record<string, string> = { H: "↑ H", L: "↓ L", CH: "↑↑ Critical", CL: "↓↓ Critical", A: "Abnormal" };

interface Props {
  admissionId: string;
  hospitalId: string;
  patientId?: string | null;
}

const InvestigationsTab: React.FC<Props> = ({ admissionId, hospitalId, patientId }) => {
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase as any)
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
      .limit(100);

    const flat: ResultRow[] = [];
    for (const o of data || []) {
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
    setLoading(false);
  }, [admissionId, hospitalId]);

  useEffect(() => { load(); }, [load]);

  // Group by order date
  const byDate = rows.reduce<Record<string, ResultRow[]>>((acc, r) => {
    (acc[r.order_date] ||= []).push(r);
    return acc;
  }, {});

  if (loading) {
    return <div className="flex items-center justify-center h-40"><Loader2 className="animate-spin text-muted-foreground" size={20} /></div>;
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
        <FlaskConical size={36} className="opacity-30 mb-2" />
        <p className="text-sm">No lab investigations for this admission yet.</p>
        <p className="text-xs opacity-70">Order labs from the Rx &amp; Orders tab.</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 space-y-5">
      {Object.entries(byDate).map(([date, dRows]) => (
        <div key={date}>
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">
            {new Date(date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
          </p>
          <div className="border border-border rounded-lg overflow-hidden">
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
        </div>
      ))}
    </div>
  );
};

export default InvestigationsTab;
