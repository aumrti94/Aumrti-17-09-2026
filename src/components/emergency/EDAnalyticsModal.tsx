import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { BarChart3, Loader2 } from "lucide-react";

interface Props {
  hospitalId: string;
  onClose: () => void;
}

interface VisitRow {
  triage_category: string | null;
  disposition: string | null;
  arrival_time: string;
  disposition_time: string | null;
  is_active: boolean | null;
  mlc: boolean | null;
}

const RANGES = [
  { days: 7, label: "7d" },
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
];

const TRIAGE_META: { key: string; label: string; color: string }[] = [
  { key: "P1", label: "P1 Immediate", color: "#EF4444" },
  { key: "P2", label: "P2 Urgent", color: "#F97316" },
  { key: "P3", label: "P3 Delayed", color: "#EAB308" },
  { key: "P4", label: "P4 Minor", color: "#22C55E" },
];

const DISPOSITION_META: { key: string; label: string }[] = [
  { key: "admitted", label: "Admitted" },
  { key: "discharged", label: "Discharged" },
  { key: "referred_out", label: "Referred out" },
  { key: "lama", label: "LAMA" },
  { key: "dama", label: "DAMA" },
  { key: "lwbs", label: "LWBS" },
  { key: "absconded", label: "Absconded" },
  { key: "expired", label: "Expired" },
  { key: "awaiting", label: "Awaiting" },
];

const fmtDuration = (min: number) => {
  if (!isFinite(min) || min <= 0) return "—";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

/**
 * ED analytics (Phase 8) — read-only KPI panel computed from ed_visits + emergency bills.
 * Door-to-doctor time is not shown because no first-assessment timestamp is captured;
 * length-of-stay (arrival → disposition) is measured instead.
 */
const EDAnalyticsModal: React.FC<Props> = ({ hospitalId, onClose }) => {
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [revenue, setRevenue] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    const since = new Date(Date.now() - days * 86400000);
    const sinceIso = since.toISOString();
    const sinceDate = sinceIso.slice(0, 10);

    const [{ data: v }, { data: bills }] = await Promise.all([
      (supabase as any).from("ed_visits")
        .select("triage_category, disposition, arrival_time, disposition_time, is_active, mlc")
        .eq("hospital_id", hospitalId)
        .gte("arrival_time", sinceIso),
      (supabase as any).from("bills")
        .select("total_amount")
        .eq("hospital_id", hospitalId)
        .eq("bill_type", "emergency")
        .gte("bill_date", sinceDate),
    ]);

    setVisits((v as VisitRow[]) || []);
    setRevenue(((bills as any[]) || []).reduce((s, b) => s + Number(b.total_amount || 0), 0));
    setLoading(false);
  }, [hospitalId, days]);

  useEffect(() => { load(); }, [load]);

  const total = visits.length;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);

  const triageCounts = TRIAGE_META.map(t => ({ ...t, count: visits.filter(v => v.triage_category === t.key).length }));
  const dispositionCounts = DISPOSITION_META.map(d => ({ ...d, count: visits.filter(v => (v.disposition || "awaiting") === d.key).length }))
    .filter(d => d.count > 0);

  const closed = visits.filter(v => v.disposition_time);
  const avgLosMin = closed.length
    ? closed.reduce((s, v) => s + (new Date(v.disposition_time!).getTime() - new Date(v.arrival_time).getTime()) / 60000, 0) / closed.length
    : 0;

  const count = (k: string) => visits.filter(v => (v.disposition || "awaiting") === k).length;
  const activeNow = visits.filter(v => v.is_active).length;
  const mlcCount = visits.filter(v => v.mlc).length;
  const lamaDama = count("lama") + count("dama");

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" /> Emergency Department — Analytics
          </DialogTitle>
        </DialogHeader>

        {/* Range selector */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground mr-1">Period:</span>
          {RANGES.map(r => (
            <button key={r.days} onClick={() => setDays(r.days)}
              className={cn("px-2.5 h-7 rounded-full text-xs font-medium",
                days === r.days ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80")}>
              {r.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="py-12 flex items-center justify-center text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
          </div>
        ) : (
          <div className="space-y-4">
            {/* Stat tiles */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Tile label="Total visits" value={String(total)} />
              <Tile label="Active now" value={String(activeNow)} />
              <Tile label="Avg time in ED" value={fmtDuration(avgLosMin)} />
              <Tile label="ED revenue" value={`₹${revenue.toLocaleString("en-IN")}`} />
              <Tile label="Admitted" value={`${pct(count("admitted"))}%`} sub={`${count("admitted")} visits`} />
              <Tile label="Discharged" value={`${pct(count("discharged"))}%`} sub={`${count("discharged")} visits`} />
              <Tile label="LAMA / DAMA" value={`${pct(lamaDama)}%`} sub={`${lamaDama} visits`} tone="amber" />
              <Tile label="LWBS" value={`${pct(count("lwbs"))}%`} sub={`${count("lwbs")} visits`} tone="amber" />
              <Tile label="Mortality" value={`${pct(count("expired"))}%`} sub={`${count("expired")} expired`} tone="red" />
              <Tile label="MLC cases" value={String(mlcCount)} />
            </div>

            {/* Triage mix */}
            <div>
              <p className="text-xs font-semibold text-foreground mb-2">Triage mix</p>
              <div className="space-y-1.5">
                {triageCounts.map(t => (
                  <div key={t.key} className="flex items-center gap-2">
                    <span className="text-[11px] w-24 text-muted-foreground">{t.label}</span>
                    <div className="flex-1 h-4 rounded bg-muted overflow-hidden">
                      <div className="h-full rounded" style={{ width: `${pct(t.count)}%`, background: t.color }} />
                    </div>
                    <span className="text-[11px] w-16 text-right tabular-nums">{t.count} · {pct(t.count)}%</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Disposition breakdown */}
            <div>
              <p className="text-xs font-semibold text-foreground mb-2">Disposition breakdown</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {dispositionCounts.map(d => (
                  <div key={d.key} className="flex items-center justify-between rounded-md border border-border px-2.5 py-1.5">
                    <span className="text-[11px] text-muted-foreground">{d.label}</span>
                    <span className="text-xs font-semibold tabular-nums">{d.count} · {pct(d.count)}%</span>
                  </div>
                ))}
              </div>
            </div>

            <p className="text-[10px] text-muted-foreground">
              Length-of-stay is measured arrival → disposition. Door-to-doctor time is not shown (no first-assessment timestamp is captured). ED revenue is the total of emergency-type bills in the period.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

const Tile = ({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "amber" | "red" }) => (
  <div className={cn("rounded-lg border p-2.5",
    tone === "red" ? "border-red-200 bg-red-50" : tone === "amber" ? "border-amber-200 bg-amber-50" : "border-border bg-muted/30")}>
    <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">{label}</p>
    <p className={cn("text-lg font-bold tabular-nums mt-0.5",
      tone === "red" ? "text-red-700" : tone === "amber" ? "text-amber-700" : "text-foreground")}>{value}</p>
    {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
  </div>
);

export default EDAnalyticsModal;
