import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { useHospitalId } from '@/hooks/useHospitalId';


const ReportsTab: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const [downtimeReport, setDowntimeReport] = useState<any[]>([]);
  const [aerbReport, setAerbReport] = useState<any[]>([]);

  useEffect(() => {
    const load = async () => {
      // Downtime report
      const { data: bdData } = await supabase.from("breakdown_logs")
        .select("equipment_id, downtime_hrs, repair_cost, equipment_master(equipment_name, equipment_code)")
        .eq("hospital_id", hospitalId).eq("status", "resolved");

      const grouped: Record<string, { name: string; code: string; totalBreakdowns: number; totalDowntime: number; totalCost: number }> = {};
      (bdData || []).forEach((b: any) => {
        const key = b.equipment_id;
        if (!grouped[key]) grouped[key] = { name: b.equipment_master?.equipment_name || "", code: b.equipment_master?.equipment_code || "", totalBreakdowns: 0, totalDowntime: 0, totalCost: 0 };
        grouped[key].totalBreakdowns++;
        grouped[key].totalDowntime += Number(b.downtime_hrs || 0);
        grouped[key].totalCost += Number(b.repair_cost || 0);
      });
      setDowntimeReport(Object.values(grouped).sort((a, b) => b.totalDowntime - a.totalDowntime));

      // AERB report
      const { data: aerbData } = await supabase.from("equipment_master")
        .select("equipment_name, equipment_code, aerb_license_no, aerb_expiry, status")
        .eq("hospital_id", hospitalId).eq("category", "radiation").eq("is_active", true);
      setAerbReport(aerbData || []);
    };
    load();
  }, []);

  return (
    <div className="flex-1 overflow-auto space-y-6">
      {/* Downtime Report */}
      <div>
        <h3 className="text-sm font-bold mb-2">📊 Downtime Report</h3>
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">Equipment</th>
                <th className="px-3 py-2 font-medium text-right">Breakdowns</th>
                <th className="px-3 py-2 font-medium text-right">Total Downtime (hrs)</th>
                <th className="px-3 py-2 font-medium text-right">Avg Repair (hrs)</th>
                <th className="px-3 py-2 font-medium text-right">Total Cost</th>
              </tr>
            </thead>
            <tbody>
              {downtimeReport.map((r, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-3 py-2">{r.name} <span className="font-mono text-xs text-muted-foreground">({r.code})</span></td>
                  <td className="px-3 py-2 text-right font-mono">{r.totalBreakdowns}</td>
                  <td className="px-3 py-2 text-right font-mono">{r.totalDowntime.toFixed(1)}</td>
                  <td className="px-3 py-2 text-right font-mono">{r.totalBreakdowns > 0 ? (r.totalDowntime / r.totalBreakdowns).toFixed(1) : "—"}</td>
                  <td className="px-3 py-2 text-right font-mono">₹{r.totalCost.toLocaleString("en-IN")}</td>
                </tr>
              ))}
              {downtimeReport.length === 0 && <tr><td colSpan={5} className="text-center py-6 text-muted-foreground">No breakdown data</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* AERB Compliance */}
      <div>
        <h3 className="text-sm font-bold mb-2">☢️ AERB Compliance Report (Radiation Equipment)</h3>
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">Equipment</th>
                <th className="px-3 py-2 font-medium">License No</th>
                <th className="px-3 py-2 font-medium">Expiry</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {aerbReport.map((e, i) => {
                const expired = e.aerb_expiry && new Date(e.aerb_expiry) < new Date();
                return (
                  <tr key={i} className={`border-t border-border ${expired ? "bg-red-50" : ""}`}>
                    <td className="px-3 py-2">{e.equipment_name} <span className="font-mono text-xs text-muted-foreground">({e.equipment_code})</span></td>
                    <td className="px-3 py-2 font-mono">{e.aerb_license_no || "NOT SET"}</td>
                    <td className="px-3 py-2">{e.aerb_expiry ? format(new Date(e.aerb_expiry), "dd/MM/yyyy") : "—"}</td>
                    <td className="px-3 py-2">
                      <Badge variant={expired ? "destructive" : "default"} className="text-[10px]">
                        {expired ? "EXPIRED — CANNOT OPERATE" : e.aerb_license_no ? "Valid" : "License Missing"}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
              {aerbReport.length === 0 && <tr><td colSpan={4} className="text-center py-6 text-muted-foreground">No radiation equipment</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ReportsTab;
