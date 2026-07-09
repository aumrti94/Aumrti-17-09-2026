import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, CheckCircle2, FlaskConical, ScanLine } from "lucide-react";

// Pre-op lab + radiology clearance banner (lab plan Phase 9, extended to radiology in the
// Radiology completion plan Phase 1). SOFT gate, following the PAC-gate precedent: surfaces
// pending lab/imaging orders and unacknowledged critical findings for the patient before
// surgery; the surgeon can acknowledge-and-proceed (emergency override). No hard block —
// consistent with the existing PAC pattern.

interface Props {
  patientId: string;
  hospitalId: string;
}

interface PendingLab { accession: string | null; status: string; test_names: string[]; }
interface CriticalValue { test_name: string; result_value: string; unit: string | null; }
interface PendingRad { accession: string | null; status: string; study_name: string; }
interface CriticalRadFinding { study_name: string; critical_finding: string; }

const PENDING_STATUSES = ["ordered", "sample_collected", "in_process", "partial_results", "result_entered", "pending_validation"];
const RAD_PENDING_STATUSES = ["ordered", "scheduled", "patient_arrived", "in_progress", "images_acquired"];

const PreOpLabsBanner: React.FC<Props> = ({ patientId, hospitalId }) => {
  const [pending, setPending] = useState<PendingLab[]>([]);
  const [criticals, setCriticals] = useState<CriticalValue[]>([]);
  const [pendingRad, setPendingRad] = useState<PendingRad[]>([]);
  const [criticalRad, setCriticalRad] = useState<CriticalRadFinding[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const [ordersRes, critRes, radOrdersRes, radCritRes] = await Promise.all([
        // Pending lab orders for this patient
        (supabase as any)
          .from("lab_orders")
          .select(`accession_number, status, lab_order_items(lab_test_master:lab_test_master!lab_order_items_test_id_fkey(test_name))`)
          .eq("hospital_id", hospitalId)
          .eq("patient_id", patientId)
          .in("status", PENDING_STATUSES)
          .order("order_time", { ascending: false })
          .limit(20),
        // Unacknowledged critical lab values
        (supabase as any)
          .from("lab_order_items")
          .select(`result_value, result_unit, result_flag, lab_test_master:lab_test_master!lab_order_items_test_id_fkey(test_name), lab_orders!inner(patient_id, hospital_id)`)
          .eq("lab_orders.patient_id", patientId)
          .eq("lab_orders.hospital_id", hospitalId)
          .in("result_flag", ["CH", "CL"])
          .eq("critical_acknowledged", false)
          .limit(20),
        // Pending radiology orders for this patient
        (supabase as any)
          .from("radiology_orders")
          .select("accession_number, status, study_name")
          .eq("hospital_id", hospitalId)
          .eq("patient_id", patientId)
          .in("status", RAD_PENDING_STATUSES)
          .order("order_date", { ascending: false })
          .limit(20),
        // Unresolved critical radiology findings
        (supabase as any)
          .from("radiology_reports")
          .select(`critical_finding, radiology_orders!inner(study_name, patient_id, hospital_id)`)
          .eq("radiology_orders.patient_id", patientId)
          .eq("radiology_orders.hospital_id", hospitalId)
          .eq("is_critical", true)
          .limit(20),
      ]);

      setPending((ordersRes.data || []).map((o: any) => ({
        accession: o.accession_number,
        status: o.status,
        test_names: (o.lab_order_items || []).map((i: any) => i.lab_test_master?.test_name).filter(Boolean),
      })));

      setCriticals((critRes.data || []).map((i: any) => ({
        test_name: i.lab_test_master?.test_name || "—",
        result_value: i.result_value || "",
        unit: i.result_unit,
      })));

      setPendingRad((radOrdersRes.data || []).map((o: any) => ({
        accession: o.accession_number,
        status: o.status,
        study_name: o.study_name,
      })));

      setCriticalRad((radCritRes.data || [])
        .filter((r: any) => !!r.critical_finding)
        .map((r: any) => ({
          study_name: r.radiology_orders?.study_name || "—",
          critical_finding: r.critical_finding,
        })));

      setLoaded(true);
    })();
  }, [patientId, hospitalId]);

  if (!loaded || acknowledged) return null;
  if (pending.length === 0 && criticals.length === 0 && pendingRad.length === 0 && criticalRad.length === 0) return null;

  const hasCritical = criticals.length > 0 || criticalRad.length > 0;

  return (
    <div className={`border-b px-5 py-3 flex-shrink-0 ${hasCritical ? "bg-red-50 border-red-300" : "bg-amber-50 border-amber-300"}`}>
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className={`mt-0.5 shrink-0 ${hasCritical ? "text-red-600" : "text-amber-600"}`} />
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-bold ${hasCritical ? "text-red-800" : "text-amber-800"}`}>
            Pre-op review {hasCritical ? "— UNACKNOWLEDGED CRITICAL VALUES" : "— pending investigations"}
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

          {criticalRad.length > 0 && (
            <div className="mt-1.5">
              <p className="text-[11px] font-semibold text-red-700 uppercase tracking-wide">Critical imaging findings</p>
              <ul className="mt-0.5 space-y-0.5">
                {criticalRad.map((c, i) => (
                  <li key={i} className="text-xs text-red-800 flex items-center gap-1.5">
                    <span className="font-bold">{c.study_name}:</span> {c.critical_finding}
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

          {pendingRad.length > 0 && (
            <div className="mt-1.5">
              <p className="text-[11px] font-semibold text-amber-700 uppercase tracking-wide flex items-center gap-1">
                <ScanLine size={12} /> Pending imaging ({pendingRad.length})
              </p>
              <ul className="mt-0.5 space-y-0.5">
                {pendingRad.slice(0, 6).map((o, i) => (
                  <li key={i} className="text-xs text-amber-800">
                    <span className="font-mono text-[10px]">{o.accession || "—"}</span> · {o.study_name}
                    <span className="text-amber-600"> ({o.status.replace(/_/g, " ")})</span>
                  </li>
                ))}
                {pendingRad.length > 6 && <li className="text-[11px] text-amber-600">…and {pendingRad.length - 6} more</li>}
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
