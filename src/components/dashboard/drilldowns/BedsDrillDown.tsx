import React, { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";

interface WardRow {
  id: string;
  name: string;
  total: number;
  occupied: number;
  available: number;
  pct: number;
}

const BedsDrillDown: React.FC = () => {
  const [wards, setWards] = useState<WardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const fetch = useCallback(async () => {
    const { data: wardData } = await supabase.from("wards").select("id, name").eq("is_active", true);
    const { data: beds } = await supabase.from("beds").select("ward_id, status");

    const result: WardRow[] = (wardData || []).map((w) => {
      const wb = (beds || []).filter((b) => b.ward_id === w.id);
      const occ = wb.filter((b) => b.status === "occupied").length;
      return {
        id: w.id,
        name: w.name,
        total: wb.length,
        occupied: occ,
        available: wb.length - occ,
        pct: wb.length > 0 ? Math.round((occ / wb.length) * 100) : 0,
      };
    }).filter((w) => w.total > 0).sort((a, b) => b.pct - a.pct);

    setWards(result);
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  if (loading) {
    return <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-10 bg-muted animate-pulse rounded-lg" />)}</div>;
  }

  const barColor = (pct: number) => {
    if (pct > 90) return "bg-destructive";
    if (pct >= 70) return "bg-[hsl(var(--accent))]";
    return "bg-[hsl(var(--success))]";
  };

  const statusLabel = (pct: number) => {
    if (pct > 90) return { text: "Critical", cls: "text-destructive bg-destructive/10" };
    if (pct >= 70) return { text: "Busy", cls: "text-[hsl(var(--accent-foreground))] bg-[hsl(var(--accent))]/10" };
    return { text: "Normal", cls: "text-[hsl(var(--success))] bg-[hsl(var(--success))]/10" };
  };

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-[11px] font-bold uppercase text-muted-foreground tracking-wider mb-2">Ward-wise Occupancy</h4>
        <div className="space-y-2">
          {wards.map((w) => {
            const status = statusLabel(w.pct);
            return (
              <div
                key={w.id}
                className="border border-border rounded-lg px-3 py-2.5 hover:bg-muted/30 cursor-pointer transition-colors"
                onClick={() => navigate("/ipd")}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-medium text-foreground">{w.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-muted-foreground">{w.occupied}/{w.total}</span>
                    <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full", status.cls)}>{status.text}</span>
                  </div>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className={cn("h-full rounded-full transition-all", barColor(w.pct))} style={{ width: `${w.pct}%` }} />
                </div>
              </div>
            );
          })}
          {wards.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">No ward data</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default BedsDrillDown;
