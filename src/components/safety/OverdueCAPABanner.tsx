import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, ChevronRight, X } from "lucide-react";

interface Props {
  hospitalId: string | null;
}

const OverdueCAPABanner: React.FC<Props> = ({ hospitalId }) => {
  const navigate = useNavigate();
  const [count, setCount] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!hospitalId) return;
    setDismissed(false);
    const load = async () => {
      // Step 1 — get all event IDs for this hospital (RLS already scopes the CAPA query,
      // but safety_event_capa has no hospital_id column so we join via event IDs)
      const { data: evRows } = await (supabase as any)
        .from("safety_events")
        .select("id")
        .eq("hospital_id", hospitalId);

      const ids: string[] = (evRows || []).map((r: any) => r.id);
      if (ids.length === 0) return;

      const today = new Date().toISOString().split("T")[0];
      const { count: c } = await (supabase as any)
        .from("safety_event_capa")
        .select("id", { count: "exact", head: true })
        .in("safety_event_id", ids)
        .lt("due_date", today)
        .neq("status", "completed")
        .neq("status", "cancelled");

      setCount(c ?? 0);
    };
    load();
  }, [hospitalId]);

  if (count === 0 || dismissed) return null;

  return (
    <div className="flex-shrink-0 flex items-center gap-2.5 px-4 py-2 bg-amber-50 border-b border-amber-200 dark:bg-amber-950/20 dark:border-amber-800">
      <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
      <p className="flex-1 text-sm text-amber-800 dark:text-amber-200">
        <strong>{count}</strong> CAPA action{count !== 1 ? "s are" : " is"} overdue.
      </p>
      <button
        onClick={() => navigate("/quality/events?overdue_capa=1")}
        className="flex items-center gap-0.5 text-sm font-semibold text-amber-700 hover:underline dark:text-amber-400 whitespace-nowrap"
      >
        View <ChevronRight className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="ml-1 text-amber-500 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-200"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
};

export default OverdueCAPABanner;
