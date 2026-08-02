/**
 * AdmissionLinker — resolves which admission an order should be billed to, when the order is
 * placed for an already-admitted patient from a standalone module (Lab / Radiology).
 *
 * WHY THIS EXISTS. Both order modals used to resolve the admission with
 * `.eq("status","active").limit(1)` and no ORDER BY. A patient with more than one active
 * admission — e.g. an inpatient stay AND a same-day day care visit — got an arbitrary one, so
 * lab/radiology charges silently landed on the wrong bill and never appeared on the stay the
 * clinician was looking at. It also clobbered an admission explicitly passed in.
 *
 * This component fetches ALL active admissions, defaults deterministically (an explicitly
 * requested one first, then a real inpatient admission over day care, then the most recent),
 * and — the important part — shows the choice and lets the user switch when it is ambiguous.
 */

import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Link2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { isDaycare, pickDefaultAdmission, type ActiveAdmission } from "@/lib/pickDefaultAdmission";

// Type-only re-export: existing importers keep working, and a type export does
// not trip react-refresh/only-export-components the way a value export does.
export type { ActiveAdmission };

interface Props {
  hospitalId: string;
  patientId: string | null;
  /** An admission the launcher already knows about — preferred as the default when present. */
  preferredAdmissionId?: string | null;
  /** Fires whenever the resolved admission changes (including the initial resolve, and null). */
  onChange: (admissionId: string | null) => void;
}

const AdmissionLinker: React.FC<Props> =({ hospitalId, patientId, preferredAdmissionId, onChange }) => {
  const [admissions, setAdmissions] = useState<ActiveAdmission[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!patientId) {
      setAdmissions([]);
      setSelectedId(null);
      onChange(null);
      return;
    }
    (async () => {
      const { data } = await (supabase as any)
        .from("admissions")
        .select("id, admission_number, admission_type")
        .eq("hospital_id", hospitalId)
        .eq("patient_id", patientId)
        .eq("status", "active")
        .order("admitted_at", { ascending: false });
      if (cancelled) return;
      const list = (data || []) as ActiveAdmission[];
      setAdmissions(list);
      const pick = pickDefaultAdmission(list, preferredAdmissionId);
      setSelectedId(pick?.id ?? null);
      onChange(pick?.id ?? null);
    })();
    return () => { cancelled = true; };
    // onChange intentionally omitted — parents pass an inline fn; re-running on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hospitalId, patientId, preferredAdmissionId]);

  const select = (id: string) => {
    setSelectedId(id);
    onChange(id);
  };

  if (!patientId || admissions.length === 0) return null;

  const label = (a: ActiveAdmission) =>
    `${a.admission_number || a.id.slice(0, 8)}${isDaycare(a) ? " · Day Care" : ""}`;

  return (
    <div className="mt-2 text-xs bg-blue-50 border-l-[3px] border-blue-500 text-blue-700 px-3 py-2 rounded-r space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Link2 size={12} />
        {admissions.length === 1
          ? <span>Charges bill to admission <span className="font-semibold">{label(admissions[0])}</span></span>
          : <span className="font-semibold">This patient has {admissions.length} active admissions — choose which to bill:</span>}
      </div>
      {admissions.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {admissions.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => select(a.id)}
              className={cn(
                "px-2 py-0.5 rounded-full border text-[11px] transition-colors",
                a.id === selectedId
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-blue-700 border-blue-300 hover:bg-blue-100"
              )}
            >
              {label(a)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdmissionLinker;
