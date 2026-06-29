import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle } from "lucide-react";

interface Props {
  patientId: string;
}

const OverdueFollowupBanner: React.FC<Props> = ({ patientId }) => {
  const [overdue, setOverdue] = useState<{ condition_label: string; next_followup: string }[]>([]);

  useEffect(() => {
    const today = new Date().toISOString().split("T")[0];
    (async () => {
      // If patient already has an OPD token today, they're here for their visit — hide banner
      const { data: token } = await (supabase as any)
        .from("opd_tokens")
        .select("id")
        .eq("patient_id", patientId)
        .eq("visit_date", today)
        .neq("status", "cancelled")
        .limit(1)
        .maybeSingle();
      if (token) { setOverdue([]); return; }

      const { data } = await (supabase as any)
        .from("chronic_disease_programs")
        .select("condition_label, next_followup")
        .eq("patient_id", patientId)
        .eq("is_active", true)
        .lt("next_followup", today);
      setOverdue(data || []);
    })();
  }, [patientId]);

  if (overdue.length === 0) return null;

  return (
    <div className="flex-shrink-0 bg-[hsl(48,96%,89%,0.5)] border border-[hsl(38,92%,50%,0.4)] rounded-lg px-3 py-2 mb-2 flex items-center gap-2">
      <AlertTriangle size={14} className="text-[hsl(38,92%,50%)] flex-shrink-0" />
      <div className="text-xs text-[hsl(28,80%,44%)]">
        {overdue.map((o, i) => (
          <span key={i}>
            {i > 0 && " · "}
            ⚠️ {o.condition_label} follow-up overdue since {new Date(o.next_followup).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
          </span>
        ))}
      </div>
    </div>
  );
};

export default OverdueFollowupBanner;
