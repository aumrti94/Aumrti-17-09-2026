import React from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import {
  Users, Bed, TrendingUp, AlertTriangle, Package, FileText,
  Activity, DollarSign, Clock, CheckCircle
} from "lucide-react";
import { cn } from "@/lib/utils";

interface KPICardProps {
  label: string;
  value: string | number;
  icon: React.ElementType;
  color: string;
  bgColor: string;
  subtitle?: string;
  alert?: boolean;
}

const KPICard: React.FC<KPICardProps> = ({ label, value, icon: Icon, color, bgColor, subtitle, alert }) => (
  <div className={cn("bg-card border border-border rounded-xl p-4 flex items-start gap-3 hover:shadow-md transition-shadow", alert && "border-destructive/40 bg-destructive/5")}>
    <div className={cn("p-2.5 rounded-xl", bgColor)}>
      <Icon size={20} className={color} />
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-2xl font-bold text-foreground">{value}</p>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>}
    </div>
    {alert && <AlertTriangle size={16} className="text-destructive flex-shrink-0 mt-1" />}
  </div>
);

export default function HODDashboardPage() {
  const { hospitalId } = useHospitalId();

  const { data: opdToday } = useQuery({
    queryKey: ["hod-opd-today", hospitalId],
    queryFn: async () => {
      if (!hospitalId) return 0;
      const today = new Date().toISOString().split("T")[0];
      const { count } = await supabase.from("opd_tokens").select("*", { count: "exact", head: true })
        .eq("hospital_id", hospitalId).gte("created_at", today);
      return count ?? 0;
    },
    enabled: !!hospitalId,
    refetchInterval: 60000,
  });

  const { data: admissionsToday } = useQuery({
    queryKey: ["hod-admissions-today", hospitalId],
    queryFn: async () => {
      if (!hospitalId) return 0;
      const today = new Date().toISOString().split("T")[0];
      const { count } = await supabase.from("admissions").select("*", { count: "exact", head: true })
        .eq("hospital_id", hospitalId).gte("admission_date", today);
      return count ?? 0;
    },
    enabled: !!hospitalId,
    refetchInterval: 60000,
  });

  const { data: bedStats } = useQuery({
    queryKey: ["hod-beds", hospitalId],
    queryFn: async () => {
      if (!hospitalId) return { total: 0, occupied: 0 };
      const { data: beds } = await supabase.from("beds").select("status").eq("hospital_id", hospitalId);
      const total = beds?.length ?? 0;
      const occupied = beds?.filter((b) => b.status === "occupied").length ?? 0;
      return { total, occupied };
    },
    enabled: !!hospitalId,
    refetchInterval: 120000,
  });

  const { data: pendingNotes } = useQuery({
    queryKey: ["hod-pending-notes", hospitalId],
    queryFn: async () => {
      if (!hospitalId) return 0;
      const { count } = await supabase.from("obstetric_records").select("*", { count: "exact", head: true })
        .eq("hospital_id", hospitalId).eq("signoff_status", "draft");
      return count ?? 0;
    },
    enabled: !!hospitalId,
  });

  const { data: highRiskPatients } = useQuery({
    queryKey: ["hod-high-risk", hospitalId],
    queryFn: async () => {
      if (!hospitalId) return 0;
      const { count } = await supabase.from("obstetric_records").select("*", { count: "exact", head: true })
        .eq("hospital_id", hospitalId).eq("high_risk_status", true);
      return count ?? 0;
    },
    enabled: !!hospitalId,
  });

  const { data: lowStockItems } = useQuery({
    queryKey: ["hod-low-stock", hospitalId],
    queryFn: async () => {
      if (!hospitalId) return 0;
      const { count } = await supabase.from("procurement_recommendations").select("*", { count: "exact", head: true })
        .eq("hospital_id", hospitalId).eq("status", "pending");
      return count ?? 0;
    },
    enabled: !!hospitalId,
  });

  const { data: revenueToday } = useQuery({
    queryKey: ["hod-revenue-today", hospitalId],
    queryFn: async () => {
      if (!hospitalId) return 0;
      const today = new Date().toISOString().split("T")[0];
      const { data } = await supabase.from("bill_payments").select("amount")
        .eq("hospital_id", hospitalId).gte("payment_date", today);
      return data?.reduce((sum, p) => sum + (p.amount ?? 0), 0) ?? 0;
    },
    enabled: !!hospitalId,
    refetchInterval: 300000,
  });

  const { data: criticalAlerts } = useQuery({
    queryKey: ["hod-alerts", hospitalId],
    queryFn: async () => {
      if (!hospitalId) return 0;
      const { count } = await supabase.from("clinical_alerts").select("*", { count: "exact", head: true })
        .eq("hospital_id", hospitalId).eq("is_acknowledged", false).eq("severity", "critical");
      return count ?? 0;
    },
    enabled: !!hospitalId,
    refetchInterval: 30000,
  });

  const occupancyPct = bedStats
    ? bedStats.total > 0 ? Math.round((bedStats.occupied / bedStats.total) * 100) : 0
    : 0;

  return (
    <div className="h-[calc(100vh-56px)] overflow-y-auto">
      <div className="px-6 py-4">
        <div className="mb-5">
          <h1 className="text-xl font-bold text-foreground">HOD Command Dashboard</h1>
          <p className="text-sm text-muted-foreground">Real-time department overview — {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
        </div>

        {/* Row 1 – Critical banner if alerts exist */}
        {(criticalAlerts ?? 0) > 0 && (
          <div className="mb-4 p-3 rounded-xl bg-destructive/10 border border-destructive/30 flex items-center gap-3">
            <AlertTriangle size={20} className="text-destructive flex-shrink-0" />
            <div>
              <p className="text-sm font-bold text-destructive">{criticalAlerts} Critical Alert{(criticalAlerts ?? 0) > 1 ? "s" : ""} Pending</p>
              <p className="text-xs text-destructive/70">Review in the Inbox / Nursing module immediately</p>
            </div>
          </div>
        )}

        {/* Row 2 – Today's operational KPIs */}
        <div className="mb-3">
          <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-3">Today's Operational Snapshot</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KPICard label="OPD Visits Today" value={opdToday ?? "—"} icon={Users} color="text-blue-600" bgColor="bg-blue-50" />
            <KPICard label="Admissions Today" value={admissionsToday ?? "—"} icon={Activity} color="text-emerald-600" bgColor="bg-emerald-50" />
            <KPICard label="Bed Occupancy" value={`${occupancyPct}%`} icon={Bed} color="text-purple-600" bgColor="bg-purple-50"
              subtitle={`${bedStats?.occupied ?? 0} / ${bedStats?.total ?? 0} beds`}
              alert={occupancyPct >= 90} />
            <KPICard label="Revenue Today" value={`₹${(revenueToday ?? 0).toLocaleString("en-IN")}`} icon={DollarSign} color="text-teal-600" bgColor="bg-teal-50" />
          </div>
        </div>

        {/* Row 3 – Clinical quality */}
        <div className="mb-3">
          <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-3">Clinical Quality & Safety</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <KPICard label="High-Risk Patients" value={highRiskPatients ?? "—"} icon={AlertTriangle} color="text-red-600" bgColor="bg-red-50"
              alert={(highRiskPatients ?? 0) > 0} subtitle="Active obstetric high-risk cases" />
            <KPICard label="Unsigned Clinical Notes" value={pendingNotes ?? "—"} icon={FileText} color="text-amber-600" bgColor="bg-amber-50"
              alert={(pendingNotes ?? 0) > 0} subtitle="ANC notes awaiting sign-off" />
            <KPICard label="Critical Alerts" value={criticalAlerts ?? "—"} icon={AlertTriangle} color="text-destructive" bgColor="bg-destructive/10"
              alert={(criticalAlerts ?? 0) > 0} />
          </div>
        </div>

        {/* Row 4 – Inventory / procurement */}
        <div className="mb-3">
          <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-3">Inventory & Procurement</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <KPICard label="Pending Reorder Recommendations" value={lowStockItems ?? "—"} icon={Package} color="text-orange-600" bgColor="bg-orange-50"
              alert={(lowStockItems ?? 0) > 5} subtitle="Items awaiting procurement approval" />
            <div className="bg-card border border-border rounded-xl p-4 col-span-2 flex flex-col gap-2">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Quick Actions</p>
              <div className="flex gap-3">
                {[
                  { label: "Review ANC Notes", href: "/specialty/anc", icon: FileText },
                  { label: "Procurement Recs", href: "/inventory/procurement-recommendations", icon: Package },
                  { label: "Critical Alerts", href: "/inbox", icon: AlertTriangle },
                ].map(({ label, href, icon: Icon }) => (
                  <a key={label} href={href}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors">
                    <Icon size={15} className="text-muted-foreground" /> {label}
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Row 5 – Time indicator */}
        <div className="flex items-center justify-end gap-2 text-[11px] text-muted-foreground mt-4">
          <Clock size={12} />
          <span>Auto-refreshes every minute · Last updated: {new Date().toLocaleTimeString("en-IN")}</span>
        </div>
      </div>
    </div>
  );
}
