import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, CheckCircle2, FlaskConical } from "lucide-react";

// Pre-op lab clearance banner (lab plan Phase 9). SOFT gate, following the PAC-gate
// precedent: surfaces pending lab orders and unacknowledged critical values for the
// patient before surgery; the surgeon can acknowledge-and-proceed (emergency override).
// No hard block — consistent with the existing PAC pattern.

interface Props {
  patientId: string;
  hospitalId: string;
}

interface PendingLab { accession: string | null; status: string; test_names: string[]; }
interface CriticalValue { test_name: string; result_value: string; unit: string | null; }

const PENDING_STATUSES = ["ordered", "sample_collected", "in_process", "partial_results", "result_entered", "pending_validation"];

const PreOpLabsBanner: React.FC<Props> = ({ patientId, hospitalId }) => {
  const [pending, setPending] = useState<PendingLab[]>([]);
  const [criticals, setCriticals] = useState<CriticalValue[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      // Pending lab orders for this patient
      const { data: orders } = await (supabase as any)
        .from("lab_orders")
        .select(`accession_number, status, lab_order_items(lab_test_master:lab_test_master!lab_order_items_test_id_fkey(test_name))`)
        .eq("hospital_id", hospitalId)
        .eq("patient_id", patientId)
        .in("status", PENDING_STATUSES)
        .order("order_time", { ascending: false })
        .limit(20);
      setPending((orders || []).map((o: any) => ({
        accession: o.accession_number,
        status: o.status,
        test_names: (o.lab_order_items || []).map((i: any) => i.lab_test_master?.test_name).filter(Boolean),
      })));

      // Unacknowledged critical values
      const { data: crit } = await (supabase as any)
        .from("lab_order_items")
        .select(`result_value, result_unit, result_flag, lab_test_master:lab_test_master!lab_order_items_test_id_fkey(test_name), lab_orders!inner(patient_id, hospital_id)`)
        .eq("lab_orders.patient_id", patientId)
        .eq("lab_orders.hospital_id", hospitalId)
        .in("result_flag", ["CH", "CL"])
        .eq("critical_acknowledged", false)
        .limit(20);
      setCriticals((crit || []).map((i: any) => ({
        test_name: i.lab_test_master?.test_name || "—",
        result_value: i.result_value || "",
        unit: i.result_unit,
      })));
      setLoaded(true);
    })();
  }, [patientId, hospitalId]);

  if (!loaded || acknowledged) return null;
  if (pending.length === 0 && criticals.length === 0) return null;

  const hasCritical = criticals.length > 0;

  return (
    <div className={`border-b px-5 py-3 flex-shrink-0 ${hasCritical ? "bg-red-50 border-red-300" : "bg-amber-50 border-amber-300"}`}>
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className={`mt-0.5 shrink-0 ${hasCritical ? "text-red-600" : "text-amber-600"}`} />
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-bold ${hasCritical ? "text-red-800" : "text-amber-800"}`}>
            Pre-op lab review {hasCritical ? "— UNACKNOWLEDGED CRITICAL VALUES" : "— pending investigations"}
          </p>

          {criticals.length > 0 && (
            <div className="mt-1.5">
              <p className="text-[11px] font-semibold text-red-700 uppercase tracking-wide">Critical values</p>
              <ul className="mt-0.5 space-y-0.5">
                {criticals.map((c, i) => (
                  <li key={i} className="text-xs text-red-800 flex items-center gap-1.5">
                    <span className="font-bold">{c.test_name}:</span> {c.result_value} {c.unit || ""}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {pending.length > 0 && (
            <div className="mt-1.5">
              <p className="text-[11px] font-semibold text-amber-700 uppercase tracking-wide flex items-center gap-1">
                <FlaskConical size={12} /> Pending results ({pending.length})
              </p>
              <ul className="mt-0.5 space-y-0.5">
                {pending.slice(0, 6).map((o, i) => (
                  <li key={i} className="text-xs text-amber-800">
                    <span className="font-mono text-[10px]">{o.accession || "—"}</span> · {o.test_names.slice(0, 4).join(", ") || o.status}
                    <span className="text-amber-600"> ({o.status.replace(/_/g, " ")})</span>
                  </li>
                ))}
                {pending.length > 6 && <li className="text-[11px] text-amber-600">…and {pending.length - 6} more</li>}
              </ul>
            </div>
          )}

          <button
            onClick={() => setAcknowledged(true)}
            className={`mt-2 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md text-white font-semibold active:scale-95 transition-all ${hasCritical ? "bg-red-600 hover:bg-red-700" : "bg-amber-600 hover:bg-amber-700"}`}
          >
            <CheckCircle2 size={13} />
            Reviewed — proceed
          </button>
        </div>
      </div>
    </div>
  );
};

export default PreOpLabsBanner;
