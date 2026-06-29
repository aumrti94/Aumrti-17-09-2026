import React, { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface WardBed {
  ward_name: string;
  total: number;
  occupied: number;
}

function barColor(pct: number) {
  if (pct > 90) return "bg-destructive";
  if (pct > 80) return "bg-[hsl(24,95%,53%)]";
  if (pct >= 60) return "bg-[hsl(38,92%,50%)]";
  return "bg-[hsl(var(--success))]";
}

function textColor(pct: number) {
  if (pct > 90) return "text-destructive";
  if (pct > 80) return "text-[hsl(24,95%,53%)]";
  if (pct >= 60) return "text-[hsl(38,92%,50%)]";
  return "text-[hsl(var(--success))]";
}

const BedOccupancy: React.FC = () => {
  const [wards, setWards] = useState<WardBed[]>([]);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  const fetch = useCallback(async () => {
    const { data: wardData } = await supabase.from("wards").select("id, name").eq("is_active", true);
    if (!wardData || wardData.length === 0) { setLoading(false); return; }

    const { data: beds } = await supabase.from("beds").select("ward_id, status");

    const result: WardBed[] = wardData.map((w) => {
      const wardBeds = beds?.filter((b) => b.ward_id === w.id) || [];
      return {
        ward_name: w.name,
        total: wardBeds.length,
        occupied: wardBeds.filter((b) => b.status === "occupied").length,
      };
    }).filter((w) => w.total > 0).sort((a, b) => b.occupied - a.occupied);

    setWards(result);
    setLoading(false);
    setTimeout(() => setMounted(true), 50);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const totals = wards.reduce(
    (acc, w) => {
      acc.occupied += w.occupied;
      acc.total += w.total;
      return acc;
    },
    { occupied: 0, total: 0 }
  );
  const available = totals.total - totals.occupied;

  if (loading) return <div className="h-full animate-pulse bg-muted rounded-xl" />;

  return (
    <div className="flex flex-col h-full bg-card rounded-xl border border-border overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/50 shrink-0">
        <span className="text-[13px] font-bold text-foreground">Bed Occupancy by Ward</span>
        <span className="flex items-center gap-1.5 text-xs text-[hsl(var(--success))]">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[hsl(var(--success))] opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[hsl(var(--success))]" />
          </span>
          Live
        </span>
      </div>

      {/* Ward bars */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-2.5">
        {wards.map((w, i) => {
          const pct = w.total > 0 ? Math.round((w.occupied / w.total) * 100) : 0;
          return (
            <div key={w.ward_name} className="flex items-center gap-2">
              <span className="w-[90px] text-xs text-foreground/80 truncate shrink-0">{w.ward_name}</span>
              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all duration-600 ease-out", barColor(pct))}
                  style={{
                    width: mounted ? `${pct}%` : "0%",
                    transitionDelay: `${i * 80}ms`,
                  }}
                />
              </div>
              <span className={cn("w-9 text-xs font-bold text-right shrink-0", textColor(pct))}>{pct}%</span>
              <span className="w-[50px] text-[11px] text-muted-foreground shrink-0">{w.occupied}/{w.total}</span>
            </div>
          );
        })}
        {wards.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">No ward data available</p>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-border/50 bg-muted/30 shrink-0">
        <span className="text-[11px] font-medium text-muted-foreground">
          Total: {totals.occupied} occupied · {available} available
        </span>
      </div>
    </div>
  );
};

export default BedOccupancy;
