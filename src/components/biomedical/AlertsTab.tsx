import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format, differenceInDays } from "date-fns";
import PredictiveMaintenanceSection from "./PredictiveMaintenanceSection";
import { useHospitalId } from '@/hooks/useHospitalId';


interface Props { onNavigate: (tab: string) => void; }

interface Alert {
  type: string;
  equipmentName: string;
  equipmentCode: string;
  dueDate: string;
  daysLeft: number;
  tab: string;
  extra?: string;
}

const AlertsTab: React.FC<Props> = ({ onNavigate }) => {
  const { hospitalId } = useHospitalId();
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    const load = async () => {
      const now = new Date();
      const allAlerts: Alert[] = [];

      // PM Overdue
      const { data: pmData } = await supabase.from("pm_schedules")
        .select("*, equipment_master(equipment_name, equipment_code)")
        .eq("hospital_id", hospitalId).eq("status", "overdue");
      (pmData || []).forEach((p: any) => allAlerts.push({
        type: "PM Overdue", equipmentName: p.equipment_master?.equipment_name || "",
        equipmentCode: p.equipment_master?.equipment_code || "", dueDate: p.next_due_at,
        daysLeft: differenceInDays(now, new Date(p.next_due_at)), tab: "maintenance",
      }));

      // PM due within 7 days
      const { data: pmSoon } = await supabase.from("pm_schedules")
        .select("*, equipment_master(equipment_name, equipment_code)")
        .eq("hospital_id", hospitalId).eq("status", "upcoming")
        .lte("next_due_at", new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0]);
      (pmSoon || []).forEach((p: any) => allAlerts.push({
        type: "PM Due Soon", equipmentName: p.equipment_master?.equipment_name || "",
        equipmentCode: p.equipment_master?.equipment_code || "", dueDate: p.next_due_at,
        daysLeft: differenceInDays(new Date(p.next_due_at), now), tab: "maintenance",
      }));

      // Calibration due within 90 days
      const { data: calData } = await supabase.from("calibration_records")
        .select("*, equipment_master(equipment_name, equipment_code)")
        .eq("hospital_id", hospitalId)
        .lte("next_due", new Date(Date.now() + 90 * 86400000).toISOString().split("T")[0]);
      (calData || []).forEach((c: any) => {
        const days = differenceInDays(new Date(c.next_due), now);
        if (days <= 90) allAlerts.push({
          type: "Calibration Due", equipmentName: c.equipment_master?.equipment_name || "",
          equipmentCode: c.equipment_master?.equipment_code || "", dueDate: c.next_due,
          daysLeft: days, tab: "calibration",
        });
      });

      // AMC Expiring within 60 days
      const { data: amcData } = await supabase.from("amc_contracts")
        .select("*, equipment_master(equipment_name, equipment_code)")
        .eq("hospital_id", hospitalId).eq("is_active", true)
        .lte("end_date", new Date(Date.now() + 60 * 86400000).toISOString().split("T")[0]);
      (amcData || []).forEach((a: any) => {
        const days = differenceInDays(new Date(a.end_date), now);
        allAlerts.push({
          type: "AMC Expiring", equipmentName: a.equipment_master?.equipment_name || "",
          equipmentCode: a.equipment_master?.equipment_code || "", dueDate: a.end_date,
          daysLeft: days, tab: "equipment", extra: `Vendor: ${a.vendor_name} | Cost: ₹${Number(a.annual_cost).toLocaleString("en-IN")}`,
        });
      });

      // AERB License Expiring (radiation equipment)
      const { data: aerbData } = await supabase.from("equipment_master")
        .select("equipment_name, equipment_code, aerb_license_no, aerb_expiry")
        .eq("hospital_id", hospitalId).eq("category", "radiation").not("aerb_expiry", "is", null);
      (aerbData || []).forEach((e: any) => {
        const days = differenceInDays(new Date(e.aerb_expiry), now);
        if (days <= 90) allAlerts.push({
          type: "AERB License Expiring", equipmentName: e.equipment_name,
          equipmentCode: e.equipment_code, dueDate: e.aerb_expiry,
          daysLeft: days, tab: "equipment", extra: `License: ${e.aerb_license_no || "N/A"}`,
        });
      });

      // Warranty expiring within 30 days
      const { data: warData } = await supabase.from("equipment_master")
        .select("equipment_name, equipment_code, warranty_expiry")
        .eq("hospital_id", hospitalId).not("warranty_expiry", "is", null);
      (warData || []).forEach((e: any) => {
        const days = differenceInDays(new Date(e.warranty_expiry), now);
        if (days <= 30 && days >= 0) allAlerts.push({
          type: "Warranty Expiring", equipmentName: e.equipment_name,
          equipmentCode: e.equipment_code, dueDate: e.warranty_expiry,
          daysLeft: days, tab: "equipment",
        });
      });

      allAlerts.sort((a, b) => a.daysLeft - b.daysLeft);
      setAlerts(allAlerts);
    };
    load();
  }, []);

  const typeColor = (type: string) => {
    if (type.includes("Overdue")) return "destructive";
    if (type.includes("AERB")) return "destructive";
    if (type.includes("Due") || type.includes("Expiring")) return "secondary";
    return "outline";
  };

  const rowBg = (days: number) => {
    if (days < 0) return "bg-red-50";
    if (days < 30) return "bg-amber-50";
    return "";
  };

  return (
    <div className="flex-1 overflow-auto space-y-4">
      {/* Predictive Maintenance AI Section */}
      <PredictiveMaintenanceSection />

      {/* Regular Alerts */}
      <div className="space-y-2">
      {alerts.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-3xl mb-2">✅</p>
          <p className="font-medium">No pending alerts — all equipment is compliant</p>
        </div>
      ) : (
        alerts.map((a, i) => (
          <div key={i} className={`rounded-lg border border-border p-3 flex items-center justify-between ${rowBg(a.daysLeft)}`}>
            <div>
              <div className="flex items-center gap-2">
                <Badge variant={typeColor(a.type) as any} className="text-[10px]">{a.type}</Badge>
                <span className="text-sm font-bold">{a.equipmentName}</span>
                <span className="text-xs font-mono text-muted-foreground">({a.equipmentCode})</span>
              </div>
              <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                <span>Due: {format(new Date(a.dueDate), "dd/MM/yyyy")}</span>
                <span className={a.daysLeft < 0 ? "text-red-600 font-bold" : a.daysLeft < 30 ? "text-amber-600 font-semibold" : ""}>
                  {a.daysLeft < 0 ? `${Math.abs(a.daysLeft)} days overdue` : `${a.daysLeft} days remaining`}
                </span>
                {a.extra && <span>{a.extra}</span>}
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={() => onNavigate(a.tab)}>Action →</Button>
          </div>
        ))
      )}
      </div>
    </div>
  );
};

export default AlertsTab;
