import React, { useEffect, useState, useCallback } from "react";
import { formatINRExact } from "@/lib/currency";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Users,
  BedDouble,
  Activity,
  IndianRupee,
  Stethoscope,
  AlertTriangle,
  Database,
  RefreshCw,
} from "lucide-react";
import { useDashboardData } from "@/hooks/useDashboardData";
import { useHospitalId } from "@/hooks/useHospitalId";
import { hasAccess } from "@/lib/routeRoles";
import { useCountUp } from "@/hooks/useCountUp";
import { cn } from "@/lib/utils";
import RevenueChart from "@/components/dashboard/RevenueChart";
import BedOccupancy from "@/components/dashboard/BedOccupancy";
import AlertsPanel from "@/components/dashboard/AlertsPanel";
import DrillDownDrawer, { DrillDownConfig, KPIType } from "@/components/dashboard/DrillDownDrawer";
import RevenueDrillDown from "@/components/dashboard/drilldowns/RevenueDrillDown";
import BedsDrillDown from "@/components/dashboard/drilldowns/BedsDrillDown";
import OPDDrillDown from "@/components/dashboard/drilldowns/OPDDrillDown";
import AlertsDrillDown from "@/components/dashboard/drilldowns/AlertsDrillDown";
import DoctorsDrillDown from "@/components/dashboard/drilldowns/DoctorsDrillDown";
import { supabase } from "@/integrations/supabase/client";
import ChronicFollowupAlert from "@/components/dashboard/ChronicFollowupAlert";
import ChronicFollowupsStatCard from "@/components/dashboard/ChronicFollowupsStatCard";
import NABHReadinessCard from "@/components/dashboard/NABHReadinessCard";
import OverdueCAPABanner from "@/components/safety/OverdueCAPABanner";
import NABHQIAlertCard from "@/components/dashboard/NABHQIAlertCard";
import ABDMComplianceCard from "@/components/dashboard/ABDMComplianceCard";

const formatRevenue = formatINRExact;

function revenueChange(current: number, last: number) {
  if (last === 0) return { text: "First month", positive: true };
  const pct = ((current - last) / last) * 100;
  return { text: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% vs last month`, positive: pct >= 0 };
}

function occupancyColor(pct: number) {
  if (pct > 85) return "text-destructive";
  if (pct >= 70) return "text-[hsl(38,92%,50%)]";
  return "text-[hsl(var(--success))]";
}

function alertValueColor(count: number) {
  if (count === 0) return "text-[hsl(var(--success))]";
  if (count <= 2) return "text-[hsl(38,92%,50%)]";
  return "text-destructive";
}

const CountUpValue: React.FC<{ value: number; className?: string }> = ({ value, className }) => {
  const animated = useCountUp(value);
  return <span className={className}>{animated.toLocaleString("en-IN")}</span>;
};

const RevenueCountUp: React.FC<{ value: number }> = ({ value }) => {
  const animated = useCountUp(value);
  return <span>{formatRevenue(animated)}</span>;
};

function useLastUpdated(loading: boolean) {
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [label, setLabel] = useState("just now");

  useEffect(() => {
    if (!loading) setLastUpdated(new Date());
  }, [loading]);

  useEffect(() => {
    const tick = () => {
      const diff = Math.floor((Date.now() - lastUpdated.getTime()) / 1000);
      if (diff < 60) setLabel("just now");
      else if (diff < 120) setLabel("1 min ago");
      else setLabel(`${Math.floor(diff / 60)} mins ago`);
    };
    tick();
    const id = setInterval(tick, 10000);
    return () => clearInterval(id);
  }, [lastUpdated]);

  return label;
}

const Dashboard: React.FC = () => {
  const { kpis, loading, seeding, seedData, refetch } = useDashboardData();
  const { hospitalId, role, permissions, loading: roleLoading } = useHospitalId();
  const navigate = useNavigate();
  const [refreshing, setRefreshing] = useState(false);
  const lastUpdated = useLastUpdated(loading);

  // Redirect admin users to onboarding wizard if setup not complete
  useEffect(() => {
    if (roleLoading || !hospitalId) return;
    if (role !== "super_admin" && role !== "hospital_admin") return;
    supabase
      .from("hospitals")
      .select("setup_complete")
      .eq("id", hospitalId)
      .maybeSingle()
      .then(({ data }) => {
        if (data && data.setup_complete === false) {
          navigate("/setup/onboarding", { replace: true });
        }
      });
  }, [hospitalId, role, roleLoading, navigate]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerConfig, setDrawerConfig] = useState<DrillDownConfig | null>(null);

  const occupancyPct = kpis.bedsTotal > 0 ? Math.round((kpis.bedsOccupied / kpis.bedsTotal) * 100) : 0;
  const revChange = revenueChange(kpis.revenueMTD, kpis.revenueLastMonth);
  const isNewHospital = !loading && kpis.totalPatients === 0 && kpis.bedsTotal === 0;

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const openDrillDown = (type: KPIType) => {
    const configs: Record<KPIType, DrillDownConfig> = {
      revenue: {
        type: "revenue",
        title: "💰 Today's Revenue",
        icon: "💰",
        period: "This Month",
        currentValue: formatRevenue(kpis.revenueMTD),
        changeText: revChange.text,
        changePositive: revChange.positive,
        aiPrompt: `Hospital revenue MTD is ₹${kpis.revenueMTD.toLocaleString()}. Last month was ₹${kpis.revenueLastMonth.toLocaleString()}. Write 2-sentence insight on revenue performance and what needs attention.`,
        reportLink: "/billing",
        reportLabel: "View Full Billing →",
        hospitalId: hospitalId || undefined,
      },
      beds: {
        type: "beds",
        title: "🛏️ Bed Occupancy",
        icon: "🛏️",
        period: "Live",
        currentValue: `${kpis.bedsOccupied}/${kpis.bedsTotal}`,
        changeText: `${occupancyPct}% occupancy`,
        changePositive: occupancyPct < 85,
        aiPrompt: `Bed occupancy is ${occupancyPct}%. ${kpis.bedsOccupied} of ${kpis.bedsTotal} beds occupied. Write 2-sentence insight on occupancy health and what's blocking beds.`,
        reportLink: "/ipd",
        reportLabel: "View IPD Bed Map →",
        hospitalId: hospitalId || undefined,
      },
      opd: {
        type: "opd",
        title: "🏥 OPD Today",
        icon: "🏥",
        period: "Today",
        currentValue: String(kpis.opdActive),
        changeText: `${kpis.opdWaiting} waiting · ${kpis.opdSeen} seen`,
        changePositive: true,
        aiPrompt: `OPD had ${kpis.opdActive} patients today. ${kpis.opdWaiting} still waiting, ${kpis.opdSeen} already seen. Write 2-sentence insight on OPD performance.`,
        reportLink: "/opd",
        reportLabel: "View OPD Queue →",
        hospitalId: hospitalId || undefined,
      },
      alerts: {
        type: "alerts",
        title: "🚨 Clinical Alerts",
        icon: "🚨",
        period: "Active",
        currentValue: String(kpis.criticalAlerts),
        changeText: kpis.criticalAlerts > 0 ? "Requires attention" : "All clear",
        changePositive: kpis.criticalAlerts === 0,
        aiPrompt: `${kpis.criticalAlerts} unacknowledged clinical alerts. Write 2-sentence risk assessment.`,
        reportLink: "/analytics",
        reportLabel: "View Analytics →",
        hospitalId: hospitalId || undefined,
      },
      doctors: {
        type: "doctors",
        title: "👥 Staff Today",
        icon: "👥",
        period: "Today",
        currentValue: String(kpis.doctorsOnDuty),
        changeText: `${kpis.doctorsOnLeave} on leave`,
        changePositive: true,
        aiPrompt: `${kpis.doctorsOnDuty} doctors on duty, ${kpis.doctorsOnLeave} on leave. Write 2-sentence insight on staffing adequacy.`,
        reportLink: "/hr",
        reportLabel: "View HR Dashboard →",
        hospitalId: hospitalId || undefined,
      },
      discounts: {
        type: "discounts",
        title: "🎫 Discounts Today",
        icon: "🎫",
        period: "Today",
        currentValue: "—",
        aiPrompt: "Summarize discount activity today in 2 sentences.",
        reportLink: "/billing",
        reportLabel: "View Billing →",
        hospitalId: hospitalId || undefined,
      },
      followups: {
        type: "followups",
        title: "📅 Follow-ups Due",
        icon: "📅",
        period: "Next 7 Days",
        currentValue: "Loading...", // Will be updated by child or kept static
        aiPrompt: "Write a 2-sentence summary about chronic disease follow-up needs for the next week based on current patient data.",
        reportLink: "/patients",
        reportLabel: "View All Patients →",
        hospitalId: hospitalId || undefined,
      },
    };
    setDrawerConfig(configs[type]);
    setDrawerOpen(true);
  };

  const drillDownContent = () => {
    if (!drawerConfig) return null;
    switch (drawerConfig.type) {
      case "revenue": return <RevenueDrillDown />;
      case "beds": return <BedsDrillDown />;
      case "opd": return <OPDDrillDown />;
      case "alerts": return <AlertsDrillDown />;
      case "doctors": return <DoctorsDrillDown />;
      case "followups": return <ChronicFollowupAlert hospitalId={hospitalId} />;
      default: return null;
    }
  };

  return (
    <div className="h-full flex flex-col p-4 overflow-hidden">
      {/* Header row */}
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-foreground">Dashboard</h1>
          {!loading && (
            <span className="flex items-center gap-1.5 text-xs text-[hsl(var(--success))]">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[hsl(var(--success))] opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[hsl(var(--success))]" />
              </span>
              Live
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">Updated {lastUpdated}</span>
          <button
            onClick={handleRefresh}
            className="p-1.5 rounded-md hover:bg-muted transition-colors active:scale-95"
            aria-label="Refresh dashboard"
          >
            <RefreshCw size={14} className={cn("text-muted-foreground", refreshing && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* Overdue CAPA banner — shown regardless of data state */}
      {hasAccess("/quality/events", role, permissions) && (
        <div className="-mx-4 mb-3 shrink-0">
          <OverdueCAPABanner hospitalId={hospitalId} />
        </div>
      )}

      {/* NABH QI Anomaly Alerts — weekly AI-detected indicator deviations */}
      {hasAccess("/nabh/compliance", role, permissions) && (
        <div className="mb-3 shrink-0">
          <NABHQIAlertCard hospitalId={hospitalId} role={role} />
        </div>
      )}

      {/* Welcome banner for brand-new hospitals — non-blocking */}
      {isNewHospital && (
        <div className="mb-3 shrink-0 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Database size={18} className="text-primary shrink-0" />
            <div>
              <p className="text-sm font-semibold text-foreground">Welcome to Aumrti HMS!</p>
              <p className="text-xs text-muted-foreground">Complete your hospital setup to start tracking patients, beds, and revenue.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={seedData} disabled={seeding} className="text-xs">
              {seeding ? "Loading..." : "Load Sample Data"}
            </Button>
            <Button size="sm" onClick={() => navigate("/setup/onboarding")} className="text-xs">
              Complete Setup →
            </Button>
          </div>
        </div>
      )}

      {/* ROW 1 — KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-4 xl:grid-cols-8 gap-3 shrink-0 mb-3">
            {/* Card 1 - Patients */}
            {hasAccess("/opd", role, permissions) && (
              <Card
                className="shadow-sm hover:shadow-md transition-shadow cursor-pointer group"
                onClick={() => openDrillDown("opd")}
              >
                <CardHeader className="flex flex-row items-center justify-between pb-1 space-y-0 p-3">
                  <CardTitle className="text-[11px] font-medium text-muted-foreground">Total Patients</CardTitle>
                  <Users size={16} className="text-muted-foreground group-hover:text-primary transition-colors" />
                </CardHeader>
                <CardContent className="p-3 pt-0">
                  {loading ? <Skeleton className="h-6 w-16" /> : (
                    <>
                      <div className="text-lg font-bold text-foreground"><CountUpValue value={kpis.totalPatients} /></div>
                      <p className="text-[10px] text-muted-foreground">+{kpis.patientsToday} today</p>
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Card 2 - Beds */}
            {hasAccess("/ipd", role, permissions) && (
              <Card
                className="shadow-sm hover:shadow-md transition-shadow cursor-pointer group"
                onClick={() => openDrillDown("beds")}
              >
                <CardHeader className="flex flex-row items-center justify-between pb-1 space-y-0 p-3">
                  <CardTitle className="text-[11px] font-medium text-muted-foreground">Beds Occupied</CardTitle>
                  <BedDouble size={16} className="text-muted-foreground group-hover:text-primary transition-colors" />
                </CardHeader>
                <CardContent className="p-3 pt-0">
                  {loading ? <Skeleton className="h-6 w-16" /> : (
                    <>
                      <div className="text-lg font-bold text-foreground">
                        <CountUpValue value={kpis.bedsOccupied} />/{kpis.bedsTotal}
                      </div>
                      <p className={cn("text-[10px]", occupancyColor(occupancyPct))}>{occupancyPct}% occupancy</p>
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Card 3 - OPD */}
            {hasAccess("/opd", role, permissions) && (
              <Card
                className="shadow-sm hover:shadow-md transition-shadow cursor-pointer group"
                onClick={() => openDrillDown("opd")}
              >
                <CardHeader className="flex flex-row items-center justify-between pb-1 space-y-0 p-3">
                  <CardTitle className="text-[11px] font-medium text-muted-foreground">OPD Tokens</CardTitle>
                  <Activity size={16} className="text-muted-foreground group-hover:text-primary transition-colors" />
                </CardHeader>
                <CardContent className="p-3 pt-0">
                  {loading ? <Skeleton className="h-6 w-16" /> : (
                    <>
                      <div className="text-lg font-bold text-foreground"><CountUpValue value={kpis.opdActive} /></div>
                      <p className="text-[10px] text-muted-foreground">{kpis.opdWaiting} waiting · {kpis.opdSeen} seen</p>
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Card 4 - Revenue */}
            {hasAccess("/billing", role, permissions) && (
              <Card
                className="shadow-sm hover:shadow-md transition-shadow cursor-pointer group"
                onClick={() => openDrillDown("revenue")}
              >
                <CardHeader className="flex flex-row items-center justify-between pb-1 space-y-0 p-3">
                  <CardTitle className="text-[11px] font-medium text-muted-foreground">Revenue (MTD)</CardTitle>
                  <IndianRupee size={16} className="text-muted-foreground group-hover:text-primary transition-colors" />
                </CardHeader>
                <CardContent className="p-3 pt-0">
                  {loading ? <Skeleton className="h-6 w-16" /> : (
                    <>
                      <div className="text-lg font-bold text-foreground"><RevenueCountUp value={kpis.revenueMTD || 0} /></div>
                      <p className={cn("text-[10px]", revChange.positive ? "text-[hsl(var(--success))]" : "text-destructive")}>{revChange.text}</p>
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Card 5 - Doctors */}
            {hasAccess("/hr", role, permissions) && (
              <Card
                className="shadow-sm hover:shadow-md transition-shadow cursor-pointer group"
                onClick={() => openDrillDown("doctors")}
              >
                <CardHeader className="flex flex-row items-center justify-between pb-1 space-y-0 p-3">
                  <CardTitle className="text-[11px] font-medium text-muted-foreground">Doctors On Duty</CardTitle>
                  <Stethoscope size={16} className="text-muted-foreground group-hover:text-primary transition-colors" />
                </CardHeader>
                <CardContent className="p-3 pt-0">
                  {loading ? <Skeleton className="h-6 w-16" /> : (
                    <>
                      <div className="text-lg font-bold text-foreground"><CountUpValue value={kpis.doctorsOnDuty} /></div>
                      <p className="text-[10px] text-muted-foreground">{kpis.doctorsOnLeave} on leave</p>
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Card 6 - Alerts */}
            {hasAccess("/analytics", role, permissions) && (
              <Card
                className={cn("shadow-sm hover:shadow-md transition-shadow cursor-pointer group", kpis.criticalAlerts > 0 && !loading && "border-l-[3px] border-l-destructive")}
                onClick={() => openDrillDown("alerts")}
              >
                <CardHeader className="flex flex-row items-center justify-between pb-1 space-y-0 p-3">
                  <CardTitle className="text-[11px] font-medium text-muted-foreground">Critical Alerts</CardTitle>
                  <AlertTriangle size={16} className="text-muted-foreground group-hover:text-primary transition-colors" />
                </CardHeader>
                <CardContent className="p-3 pt-0">
                  {loading ? <Skeleton className="h-6 w-16" /> : (
                    <>
                      <div className={cn("text-lg font-bold", alertValueColor(kpis.criticalAlerts))}><CountUpValue value={kpis.criticalAlerts} /></div>
                      <p className={cn("text-[10px]", kpis.criticalAlerts > 0 ? "text-destructive" : "text-[hsl(var(--success))]")}>
                        {kpis.criticalAlerts > 0 ? "Requires attention" : "All clear"}
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>
            )}
 
            {/* Card 7 - Follow-ups Due */}
            {hasAccess("/opd", role, permissions) && (
              <ChronicFollowupsStatCard
                hospitalId={hospitalId}
                onClick={() => openDrillDown("followups")}
              />
            )}

            {/* Card 8 - NABH Readiness */}
            {hasAccess("/nabh/compliance", role, permissions) && (
              <NABHReadinessCard hospitalId={hospitalId} />
            )}

            {/* Card 9 - ABDM Compliance (spans 2 cols so horizontal layout fits) */}
            {hasAccess("/abdm", role, permissions) && hospitalId && (
              <div className="col-span-2">
                <ABDMComplianceCard hospitalId={hospitalId} />
              </div>
            )}
          </div>

      {/* ROW 2 — Three panels */}
      <div className="grid grid-cols-1 lg:grid-cols-[3fr_3fr_2fr] gap-3 flex-1 min-h-0">
        <RevenueChart />
        <BedOccupancy />
        <AlertsPanel kpis={kpis} />
      </div>

      {/* Drill-Down Drawer */}
      <DrillDownDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        config={drawerConfig}
      >
        {drillDownContent()}
      </DrillDownDrawer>
    </div>
  );
};

export default Dashboard;
