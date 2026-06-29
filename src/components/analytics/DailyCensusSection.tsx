import React from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Printer, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface Props {
  hospitalId: string;
  hospitalName?: string;
}

interface WardRow {
  name: string;
  ward_type: string;
  total: number;
  occupied: number;
  available: number;
  maintenance: number;
}

export const DailyCensusSection: React.FC<Props> = ({ hospitalId, hospitalName }) => {
  const today = format(new Date(), "yyyy-MM-dd");
  const startToday = today + "T00:00:00";
  const endToday   = today + "T23:59:59";

  const { data, isLoading } = useQuery({
    queryKey: ["daily-census-live", hospitalId, today],
    queryFn: async () => {
      const [bedsRes, wardsRes, admTodayRes, dischTodayRes] = await Promise.all([
        supabase.from("beds")
          .select("id, status, ward_id")
          .eq("hospital_id", hospitalId)
          .eq("is_active", true),
        supabase.from("wards")
          .select("id, name, ward_type")
          .eq("hospital_id", hospitalId)
          .eq("is_active", true),
        supabase.from("admissions")
          .select("id, transfer_in")
          .eq("hospital_id", hospitalId)
          .gte("admitted_at", startToday)
          .lte("admitted_at", endToday),
        supabase.from("admissions")
          .select("id, discharge_type")
          .eq("hospital_id", hospitalId)
          .gte("discharged_at", startToday)
          .lte("discharged_at", endToday),
      ]);

      const beds  = bedsRes.data  || [];
      const wards = wardsRes.data || [];
      const wardMap = new Map(wards.map(w => [w.id, w]));

      // Ward stats
      const wardStats: Record<string, WardRow> = {};
      for (const bed of beds) {
        const ward  = wardMap.get(bed.ward_id);
        const wName = ward?.name || "Unassigned";
        if (!wardStats[wName]) {
          wardStats[wName] = { name: wName, ward_type: ward?.ward_type || "general", total: 0, occupied: 0, available: 0, maintenance: 0 };
        }
        wardStats[wName].total++;
        if (bed.status === "occupied")     wardStats[wName].occupied++;
        else if (bed.status === "available")   wardStats[wName].available++;
        else if (bed.status === "maintenance") wardStats[wName].maintenance++;
      }

      const totalBeds       = beds.length;
      const occupiedBeds    = beds.filter(b => b.status === "occupied").length;
      const availableBeds   = beds.filter(b => b.status === "available").length;
      const maintenanceBeds = beds.filter(b => b.status === "maintenance").length;

      // ICU subset
      const icuWardIds = wards
        .filter(w => w.ward_type === "icu" || w.name?.toLowerCase().includes("icu"))
        .map(w => w.id);
      const icuBeds     = beds.filter(b => icuWardIds.includes(b.ward_id));
      const icuOccupied = icuBeds.filter(b => b.status === "occupied").length;
      const icuTotal    = icuBeds.length;

      const admissionsToday = admTodayRes.data || [];
      const dischargesToday = dischTodayRes.data || [];

      return {
        totalBeds, occupiedBeds, availableBeds, maintenanceBeds,
        icuOccupied, icuTotal,
        newAdmissions: admissionsToday.length,
        discharges:    dischargesToday.filter(a => a.discharge_type !== "transfer").length,
        transfers:     admissionsToday.filter(a => (a as any).transfer_in === true).length,
        deaths:        dischargesToday.filter(a => a.discharge_type === "death").length,
        wardRows: Object.values(wardStats).sort((a, b) => b.total - a.total),
        occupancyPct: totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0,
        icuPct: icuTotal > 0 ? Math.round((icuOccupied / icuTotal) * 100) : 0,
      };
    },
    refetchInterval: 5 * 60 * 1000,
  });

  const handlePrint = () => {
    if (!data) return;
    const printWin = window.open("", "_blank");
    if (!printWin) return;

    const wardRows = data.wardRows.map(w => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">${w.name}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:center;">${w.total}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:center;color:#16a34a;font-weight:600;">${w.occupied}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:center;">${w.available}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:center;color:#dc2626;">${w.maintenance}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:center;font-weight:600;">
          ${w.total > 0 ? Math.round((w.occupied / w.total) * 100) : 0}%
        </td>
      </tr>`).join("");

    printWin.document.write(`<html><head>
      <title>Daily Census — ${format(new Date(), "dd MMM yyyy")}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 32px; font-size: 13px; color: #1e293b; }
        h2 { color: #1A2F5A; border-bottom: 2px solid #1A2F5A; padding-bottom: 6px; }
        table { width: 100%; border-collapse: collapse; margin-top: 12px; }
        th { background: #f1f5f9; padding: 8px 10px; text-align: left; font-size: 11px; text-transform: uppercase; color: #64748b; }
        .stats { display: flex; gap: 16px; margin: 16px 0; }
        .stat { flex: 1; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; text-align: center; }
        .stat .val { font-size: 24px; font-weight: 700; color: #1A2F5A; }
        .stat .lbl { font-size: 11px; color: #64748b; margin-top: 2px; }
      </style>
    </head><body>
      <h2>Daily Census — ${hospitalName || "Hospital"}</h2>
      <p style="color:#64748b;margin-top:-8px;">Date: ${format(new Date(), "dd MMMM yyyy")} &nbsp;|&nbsp;
         Total Beds: ${data.totalBeds} &nbsp;|&nbsp; Occupancy: ${data.occupancyPct}%</p>
      <div class="stats">
        <div class="stat"><div class="val">${data.newAdmissions}</div><div class="lbl">New Admissions</div></div>
        <div class="stat"><div class="val">${data.discharges}</div><div class="lbl">Discharges</div></div>
        <div class="stat"><div class="val">${data.transfers}</div><div class="lbl">Transfers In</div></div>
        <div class="stat" style="border-color:#fca5a5;"><div class="val" style="color:#dc2626;">${data.deaths}</div><div class="lbl">Deaths</div></div>
        <div class="stat"><div class="val">${data.icuOccupied}/${data.icuTotal}</div><div class="lbl">ICU Occupied</div></div>
      </div>
      <table>
        <thead><tr>
          <th>Ward</th><th style="text-align:center;">Total</th><th style="text-align:center;">Occupied</th>
          <th style="text-align:center;">Available</th><th style="text-align:center;">Maintenance</th><th style="text-align:center;">Occupancy %</th>
        </tr></thead>
        <tbody>${wardRows}</tbody>
      </table>
      <p style="margin-top:20px;font-size:10px;color:#94a3b8;">Printed from Aumrti HMS &nbsp;|&nbsp; ${new Date().toLocaleString("en-IN")}</p>
      <script>window.print();</script>
    </body></html>`);
    printWin.document.close();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground text-sm gap-2">
        <Loader2 size={16} className="animate-spin" /> Loading census data…
      </div>
    );
  }

  if (!data) return null;

  const occPct = data.occupancyPct;
  const occColor = occPct >= 90 ? "text-red-600" : occPct >= 75 ? "text-amber-600" : "text-emerald-600";

  return (
    <div>
      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[
          { label: "New Admissions",  value: data.newAdmissions,  color: "text-blue-700",    bg: "bg-blue-50 border-blue-200" },
          { label: "Discharges",      value: data.discharges,     color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200" },
          { label: "Transfers In",    value: data.transfers,      color: "text-purple-700",  bg: "bg-purple-50 border-purple-200" },
          { label: "Deaths Today",    value: data.deaths,         color: "text-red-700",     bg: "bg-red-50 border-red-200" },
        ].map(s => (
          <div key={s.label} className={cn("border rounded-lg p-3 text-center", s.bg)}>
            <p className={cn("text-2xl font-bold font-mono", s.color)}>{s.value}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Overall occupancy bar */}
      <div className="flex items-center gap-3 mb-4 px-1">
        <span className="text-xs text-muted-foreground w-32 shrink-0">Overall Occupancy</span>
        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all", occPct >= 90 ? "bg-red-500" : occPct >= 75 ? "bg-amber-400" : "bg-emerald-500")}
            style={{ width: `${occPct}%` }}
          />
        </div>
        <span className={cn("text-sm font-bold w-10 text-right", occColor)}>{occPct}%</span>
        <span className="text-xs text-muted-foreground">{data.occupiedBeds}/{data.totalBeds}</span>
      </div>

      {data.icuTotal > 0 && (
        <div className="flex items-center gap-3 mb-4 px-1">
          <span className="text-xs text-muted-foreground w-32 shrink-0">ICU Occupancy</span>
          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={cn("h-full rounded-full", data.icuPct >= 90 ? "bg-red-500" : "bg-orange-400")}
              style={{ width: `${data.icuPct}%` }}
            />
          </div>
          <span className={cn("text-sm font-bold w-10 text-right", data.icuPct >= 90 ? "text-red-600" : "text-orange-600")}>
            {data.icuPct}%
          </span>
          <span className="text-xs text-muted-foreground">{data.icuOccupied}/{data.icuTotal}</span>
        </div>
      )}

      {/* Ward table */}
      {data.wardRows.length > 0 && (
        <div className="border border-border rounded-lg overflow-hidden mb-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/60 border-b border-border">
                <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Ward</th>
                <th className="text-center px-3 py-2 font-semibold text-muted-foreground">Total</th>
                <th className="text-center px-3 py-2 font-semibold text-muted-foreground">Occupied</th>
                <th className="text-center px-3 py-2 font-semibold text-muted-foreground">Available</th>
                <th className="text-center px-3 py-2 font-semibold text-muted-foreground">Maint.</th>
                <th className="text-center px-3 py-2 font-semibold text-muted-foreground">Occ. %</th>
              </tr>
            </thead>
            <tbody>
              {data.wardRows.map((w, i) => {
                const pct = w.total > 0 ? Math.round((w.occupied / w.total) * 100) : 0;
                return (
                  <tr key={w.name} className={i % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                    <td className="px-3 py-2 font-medium text-foreground">{w.name}</td>
                    <td className="px-3 py-2 text-center">{w.total}</td>
                    <td className="px-3 py-2 text-center font-semibold text-emerald-700">{w.occupied}</td>
                    <td className="px-3 py-2 text-center text-muted-foreground">{w.available}</td>
                    <td className="px-3 py-2 text-center text-red-600">{w.maintenance}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={cn("font-bold", pct >= 90 ? "text-red-600" : pct >= 75 ? "text-amber-600" : "text-emerald-600")}>
                        {pct}%
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Button variant="outline" size="sm" className="gap-1.5" onClick={handlePrint}>
        <Printer size={13} /> Print Daily Census
      </Button>
    </div>
  );
};

export default DailyCensusSection;
