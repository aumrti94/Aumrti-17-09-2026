import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, subDays, startOfMonth } from "date-fns";
import {
  Users, Bed, Activity, Scissors, IndianRupee, AlertCircle,
  Stethoscope, FlaskConical, ScanLine, RefreshCw, Clock, BarChart3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  BarChart, Bar, PieChart, Pie, Cell, ResponsiveContainer,
  XAxis, YAxis, Tooltip, Legend,
} from "recharts";
import { useQueryClient } from "@tanstack/react-query";
import DailyCensusSection from "@/components/analytics/DailyCensusSection";
import RevenueLeakDetector from "@/components/analytics/RevenueLeakDetector";
import { usePaymentModes } from "@/hooks/useAnalyticsData";
import type { DateRange } from "@/hooks/useAnalyticsData";

async function getHospitalContext(): Promise<{ id: string; name: string } | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: usr } = await supabase.from("users")
    .select("hospital_id").eq("auth_user_id", user.id).maybeSingle();
  if (!usr?.hospital_id) return null;
  const { data: hosp } = await supabase.from("hospitals")
    .select("id, name").eq("id", usr.hospital_id).maybeSingle();
  return hosp ? { id: hosp.id, name: hosp.name } : null;
}

// ─── KPI card ───────────────────────────────────────────────────────────────
interface KpiCardProps {
  label: string;
  value: string | number;
  sub?: string;
  delta?: string;
  deltaUp?: boolean;
  icon: React.ReactNode;
  onClick?: () => void;
  alert?: boolean;
}

const KpiCard: React.FC<KpiCardProps> = ({ label, value, sub, delta, deltaUp, icon, onClick, alert }) => (
  <button
    onClick={onClick}
    className={cn(
      "text-left border rounded-xl p-4 transition-all hover:shadow-md active:scale-[0.98]",
      alert ? "border-red-200 bg-red-50/60" : "border-border bg-card hover:border-primary/30",
      onClick ? "cursor-pointer" : "cursor-default",
    )}
  >
    <div className="flex items-start justify-between mb-2">
      <div className={cn("p-1.5 rounded-lg", alert ? "bg-red-100" : "bg-primary/10")}>
        {icon}
      </div>
      {delta && (
        <span className={cn(
          "text-[10px] font-semibold px-1.5 py-0.5 rounded-full",
          deltaUp ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700",
        )}>
          {delta}
        </span>
      )}
    </div>
    <p className={cn("text-2xl font-bold font-mono leading-none", alert ? "text-red-700" : "text-foreground")}>
      {value}
    </p>
    <p className="text-[11px] text-muted-foreground mt-1">{label}</p>
    {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
  </button>
);

// ─── Section wrapper ─────────────────────────────────────────────────────────
const Section: React.FC<{ title: string; subtitle?: string; children: React.ReactNode; action?: React.ReactNode }> = ({
  title, subtitle, children, action,
}) => (
  <div className="bg-card border border-border rounded-xl p-5">
    <div className="flex items-start justify-between mb-4">
      <div>
        <h2 className="text-sm font-bold text-foreground">{title}</h2>
        {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
    {children}
  </div>
);

// ─── Page ────────────────────────────────────────────────────────────────────
const ExecutiveDashboardPage: React.FC = () => {
  const navigate  = useNavigate();
  const qc        = useQueryClient();

  const today     = format(new Date(), "yyyy-MM-dd");
  const yesterday = format(subDays(new Date(), 1), "yyyy-MM-dd");
  const monthStart = format(startOfMonth(new Date()), "yyyy-MM-dd");
  const monthRange: DateRange = { from: monthStart, to: today };

  // ── Hospital context ──────────────────────────────────────────────────────
  const { data: hospital } = useQuery({
    queryKey: ["exec-hospital-ctx"],
    queryFn: getHospitalContext,
    staleTime: 10 * 60 * 1000,
  });

  // ── Today's KPIs ──────────────────────────────────────────────────────────
  const { data: kpis, isLoading: kpisLoading } = useQuery({
    queryKey: ["exec-kpis", hospital?.id, today],
    enabled: !!hospital?.id,
    queryFn: async () => {
      const hid      = hospital!.id;
      const start    = today + "T00:00:00";
      const startY   = yesterday + "T00:00:00";
      const endY     = yesterday + "T23:59:59";

      const [
        opdToday, opdYest,
        admToday, admYest,
        erToday,
        surgsToday,
        collToday, collYest,
        pendingBills,
        bedsAll, bedsOcc,
        icuWards,
        losData,
        labReportedToday, labOrderedToday,
        radValidatedToday, radOrderedToday,
      ] = await Promise.all([
        supabase.from("opd_tokens").select("id", { count: "exact", head: true })
          .eq("hospital_id", hid).gte("created_at", start),
        supabase.from("opd_tokens").select("id", { count: "exact", head: true })
          .eq("hospital_id", hid).gte("created_at", startY).lte("created_at", endY),

        supabase.from("admissions").select("id", { count: "exact", head: true })
          .eq("hospital_id", hid).gte("admitted_at", start),
        supabase.from("admissions").select("id", { count: "exact", head: true })
          .eq("hospital_id", hid).gte("admitted_at", startY).lte("admitted_at", endY),

        supabase.from("ed_visits").select("id", { count: "exact", head: true })
          .eq("hospital_id", hid).gte("arrival_time", start),

        supabase.from("ot_schedules").select("id", { count: "exact", head: true })
          .eq("hospital_id", hid).eq("status", "completed").gte("actual_end_time", start),

        supabase.from("bill_payments").select("amount")
          .eq("hospital_id", hid).gte("payment_date", today).lte("payment_date", today),
        supabase.from("bill_payments").select("amount")
          .eq("hospital_id", hid).gte("payment_date", yesterday).lte("payment_date", yesterday),

        supabase.from("bills").select("balance_due")
          .eq("hospital_id", hid).in("payment_status", ["unpaid", "partial"]),

        supabase.from("beds").select("id, ward_id").eq("hospital_id", hid).eq("is_active", true),
        supabase.from("beds").select("id, ward_id").eq("hospital_id", hid).eq("is_active", true).eq("status", "occupied"),

        supabase.from("wards").select("id")
          .eq("hospital_id", hid).eq("is_active", true).ilike("name", "%icu%"),

        supabase.from("admissions")
          .select("admitted_at, discharged_at")
          .eq("hospital_id", hid).eq("status", "discharged")
          .gte("discharged_at", monthStart)
          .not("admitted_at", "is", null).not("discharged_at", "is", null)
          .limit(500),

        supabase.from("lab_order_items").select("id", { count: "exact", head: true })
          .eq("hospital_id", hid).in("status", ["reported", "validated"]).gte("updated_at", start),
        supabase.from("lab_order_items").select("id", { count: "exact", head: true })
          .eq("hospital_id", hid).gte("created_at", start),

        supabase.from("radiology_orders").select("id", { count: "exact", head: true })
          .eq("hospital_id", hid).eq("status", "validated").gte("updated_at", start),
        supabase.from("radiology_orders").select("id", { count: "exact", head: true })
          .eq("hospital_id", hid).gte("created_at", start),
      ]);

      const sum = (rows: any[], f: string) => (rows || []).reduce((s, r) => s + (Number(r[f]) || 0), 0);
      const collToday_  = sum(collToday.data  || [], "amount");
      const collYest_   = sum(collYest.data   || [], "amount");
      const pending_    = sum(pendingBills.data || [], "balance_due");
      const pendingCount = pendingBills.data?.length || 0;

      const totalBeds  = bedsAll.data?.length || 0;
      const occBeds    = bedsOcc.data?.length || 0;
      const occPct     = totalBeds > 0 ? Math.round((occBeds / totalBeds) * 100) : 0;

      const icuWardIds = (icuWards.data || []).map((w: any) => w.id);
      const icuAll     = (bedsAll.data || []).filter((b: any) => icuWardIds.includes(b.ward_id));
      const icuOcc     = (bedsOcc.data || []).filter((b: any) => icuWardIds.includes(b.ward_id));
      const icuPct     = icuAll.length > 0 ? Math.round((icuOcc.length / icuAll.length) * 100) : 0;

      // Average LOS in days
      const losRows = (losData.data || []);
      const avgLos = losRows.length > 0
        ? Math.round(
            losRows.reduce((s, r) => {
              const diff = new Date(r.discharged_at!).getTime() - new Date(r.admitted_at!).getTime();
              return s + diff / 86400000;
            }, 0) / losRows.length * 10
          ) / 10
        : 0;

      const labTAT   = (labOrderedToday.count || 0) > 0
        ? Math.round(((labReportedToday.count || 0) / (labOrderedToday.count || 1)) * 100) : 0;
      const radTAT   = (radOrderedToday.count || 0) > 0
        ? Math.round(((radValidatedToday.count || 0) / (radOrderedToday.count || 1)) * 100) : 0;

      const collDelta = collYest_ > 0
        ? (collToday_ >= collYest_ ? "+" : "") + Math.round(((collToday_ - collYest_) / collYest_) * 100) + "%"
        : undefined;
      const opdDelta  = (opdYest.count || 0) > 0
        ? (opdToday.count! >= opdYest.count! ? "+" : "") + ((opdToday.count || 0) - (opdYest.count || 0))
        : undefined;

      return {
        opdToday: opdToday.count || 0,
        opdDelta, opdDeltaUp: (opdToday.count || 0) >= (opdYest.count || 0),
        admToday: admToday.count || 0,
        erToday:  erToday.count  || 0,
        surgsToday: surgsToday.count || 0,
        collToday: collToday_, collDelta, collDeltaUp: collToday_ >= collYest_,
        pending: pending_, pendingCount,
        occPct, occupiedBeds: occBeds, totalBeds,
        icuPct, icuOccupied: icuOcc.length, icuTotal: icuAll.length,
        avgLos,
        labTAT, radTAT,
      };
    },
    refetchInterval: 5 * 60 * 1000,
  });

  // ── Revenue by dept (this month) ─────────────────────────────────────────
  const { data: revByDept } = useQuery({
    queryKey: ["exec-rev-dept", hospital?.id, monthStart],
    enabled: !!hospital?.id,
    queryFn: async () => {
      const hid = hospital!.id;
      const { data: billIds } = await supabase.from("bills")
        .select("id").eq("hospital_id", hid)
        .gte("bill_date", monthStart).lte("bill_date", today)
        .limit(3000);
      if (!billIds?.length) return [];
      const ids = billIds.map(b => b.id);
      const { data } = await supabase.from("bill_line_items")
        .select("department, total_amount")
        .in("bill_id", ids).limit(10000);
      const deptMap: Record<string, number> = {};
      (data || []).forEach(r => {
        const d = (r.department as string) || "General";
        deptMap[d] = (deptMap[d] || 0) + (Number(r.total_amount) || 0);
      });
      return Object.entries(deptMap)
        .map(([name, value]) => ({ name, value: Math.round(value) }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 10);
    },
    refetchInterval: 15 * 60 * 1000,
  });

  // ── TPA ageing ───────────────────────────────────────────────────────────
  const { data: tpaAgeing } = useQuery({
    queryKey: ["exec-tpa-ageing", hospital?.id],
    enabled: !!hospital?.id,
    queryFn: async () => {
      const hid = hospital!.id;
      const { data } = await supabase.from("insurance_claims")
        .select("payer_type, claimed_amount, submission_date, status")
        .eq("hospital_id", hid)
        .not("status", "in", '("settled","rejected")')
        .not("submission_date", "is", null)
        .limit(2000) as any;

      const now  = new Date().getTime();
      const rows = (data || []) as Array<{ payer_type: string; claimed_amount: number; submission_date: string; status: string }>;
      const buckets: Record<string, { b0: number; b30: number; b60: number; b90: number; total: number }> = {};

      for (const r of rows) {
        const payer = r.payer_type || "Other";
        if (!buckets[payer]) buckets[payer] = { b0: 0, b30: 0, b60: 0, b90: 0, total: 0 };
        const amt  = Number(r.claimed_amount) || 0;
        const days = Math.floor((now - new Date(r.submission_date).getTime()) / 86400000);
        buckets[payer].total += amt;
        if (days <= 30)      buckets[payer].b0  += amt;
        else if (days <= 60) buckets[payer].b30 += amt;
        else if (days <= 90) buckets[payer].b60 += amt;
        else                  buckets[payer].b90 += amt;
      }

      return Object.entries(buckets)
        .map(([payer, vals]) => ({ payer, ...vals }))
        .sort((a, b) => b.total - a.total);
    },
    refetchInterval: 15 * 60 * 1000,
  });

  // ── Top 10 services this month ────────────────────────────────────────────
  const { data: topServices } = useQuery({
    queryKey: ["exec-top-services", hospital?.id, monthStart],
    enabled: !!hospital?.id,
    queryFn: async () => {
      const hid = hospital!.id;
      const { data: billIds } = await supabase.from("bills")
        .select("id").eq("hospital_id", hid)
        .gte("bill_date", monthStart).lte("bill_date", today).limit(3000);
      if (!billIds?.length) return [];
      const ids = billIds.map(b => b.id);
      const { data } = await supabase.from("bill_line_items")
        .select("item_name, total_amount").in("bill_id", ids).limit(10000);
      const svcMap: Record<string, number> = {};
      (data || []).forEach(r => {
        const n = (r.item_name as string) || "Unknown";
        svcMap[n] = (svcMap[n] || 0) + (Number(r.total_amount) || 0);
      });
      return Object.entries(svcMap)
        .map(([name, value]) => ({ name, value: Math.round(value) }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 10);
    },
    refetchInterval: 15 * 60 * 1000,
  });

  // ── Payment modes ─────────────────────────────────────────────────────────
  const { data: paymentModes } = usePaymentModes(monthRange);

  const fmtInr = (n: number) => n >= 100000
    ? `₹${(n / 100000).toFixed(1)}L`
    : `₹${Math.round(n).toLocaleString("en-IN")}`;

  const iconCls = "h-4 w-4";
  const muted   = "text-muted-foreground";

  const KPIs = kpis ? [
    {
      label: "OPD Patients Today",    value: kpis.opdToday,
      delta: kpis.opdDelta,           deltaUp: kpis.opdDeltaUp,
      icon: <Users className={cn(iconCls, muted)} />,
      onClick: () => navigate("/opd"),
    },
    {
      label: "IPD Admissions Today",  value: kpis.admToday,
      icon: <Bed className={cn(iconCls, muted)} />,
      onClick: () => navigate("/ipd"),
    },
    {
      label: "ER Visits Today",       value: kpis.erToday,
      icon: <Activity className={cn(iconCls, muted)} />,
      onClick: () => navigate("/emergency"),
    },
    {
      label: "Surgeries Today",       value: kpis.surgsToday,
      icon: <Scissors className={cn(iconCls, muted)} />,
      onClick: () => navigate("/ot"),
    },
    {
      label: "Collections Today",     value: fmtInr(kpis.collToday),
      delta: kpis.collDelta,          deltaUp: kpis.collDeltaUp,
      icon: <IndianRupee className={cn(iconCls, muted)} />,
      onClick: () => navigate("/billing"),
    },
    {
      label: "Pending Bills",         value: fmtInr(kpis.pending),
      sub: `${kpis.pendingCount} bills`,
      alert: kpis.pending > 1000000,
      icon: <AlertCircle className={cn(iconCls, kpis.pending > 1000000 ? "text-red-600" : muted)} />,
      onClick: () => navigate("/billing"),
    },
    {
      label: "Bed Occupancy",         value: `${kpis.occPct}%`,
      sub: `${kpis.occupiedBeds}/${kpis.totalBeds} beds`,
      alert: kpis.occPct >= 95,
      icon: <Bed className={cn(iconCls, kpis.occPct >= 95 ? "text-red-600" : muted)} />,
      onClick: () => navigate("/ipd"),
    },
    ...(kpis.icuTotal > 0 ? [{
      label: "ICU Occupancy",         value: `${kpis.icuPct}%`,
      sub: `${kpis.icuOccupied}/${kpis.icuTotal} beds`,
      alert: kpis.icuPct >= 90,
      icon: <Stethoscope className={cn(iconCls, kpis.icuPct >= 90 ? "text-red-600" : muted)} />,
      onClick: () => navigate("/nursing"),
    }] : []),
    {
      label: "Avg. Length of Stay",   value: `${kpis.avgLos}d`,
      sub: "Last 30 days",
      icon: <Clock className={cn(iconCls, muted)} />,
      onClick: () => navigate("/ipd"),
    },
    {
      label: "Lab TAT Compliance",    value: `${kpis.labTAT}%`,
      sub: "Reported today",
      alert: kpis.labTAT < 60,
      icon: <FlaskConical className={cn(iconCls, kpis.labTAT < 60 ? "text-red-600" : muted)} />,
      onClick: () => navigate("/lab"),
    },
    {
      label: "Radiology TAT",         value: `${kpis.radTAT}%`,
      sub: "Validated today",
      alert: kpis.radTAT < 60,
      icon: <ScanLine className={cn(iconCls, kpis.radTAT < 60 ? "text-red-600" : muted)} />,
      onClick: () => navigate("/radiology"),
    },
  ] : [];

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col overflow-hidden bg-background">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-border flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-foreground">Executive Dashboard</h1>
          <p className="text-xs text-muted-foreground">
            {hospital?.name || "Loading…"} &nbsp;·&nbsp; {format(new Date(), "EEEE, dd MMMM yyyy")}
          </p>
        </div>
        <Button
          variant="outline" size="sm" className="gap-1.5"
          onClick={() => {
            qc.invalidateQueries({ queryKey: ["exec-kpis"] });
            qc.invalidateQueries({ queryKey: ["daily-census-live"] });
          }}
        >
          <RefreshCw size={13} /> Refresh
        </Button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

        {/* ── KPI Cards ───────────────────────────────────────────────── */}
        <Section title="Today at a Glance" subtitle="Click any card to drill into the module">
          {kpisLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {Array.from({ length: 11 }).map((_, i) => (
                <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {KPIs.map((kpi, i) => (
                <KpiCard key={i} {...kpi} />
              ))}
            </div>
          )}
        </Section>

        {/* ── Daily Census ────────────────────────────────────────────── */}
        <Section
          title="Daily Census"
          subtitle={`Bed status and patient movement — ${format(new Date(), "dd MMM yyyy")}`}
        >
          {hospital ? (
            <DailyCensusSection hospitalId={hospital.id} hospitalName={hospital.name} />
          ) : (
            <div className="h-32 flex items-center justify-center text-muted-foreground text-sm">Loading…</div>
          )}
        </Section>

        {/* ── Revenue Analytics ────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

          {/* Revenue by department bar chart */}
          <Section title="Revenue by Department" subtitle={`${format(startOfMonth(new Date()), "MMM yyyy")} MTD`}>
            {(revByDept || []).length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No billing data</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={revByDept} layout="vertical" margin={{ left: 0, right: 16, top: 4, bottom: 4 }}>
                  <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `₹${(v / 1000).toFixed(0)}k`} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} width={90} />
                  <Tooltip
                    formatter={(v: number) => fmtInr(v)}
                    contentStyle={{ fontSize: 11, borderRadius: 6 }}
                  />
                  <Bar dataKey="value" fill="hsl(217, 91%, 60%)" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Section>

          {/* Collection by payment mode */}
          <Section title="Collection by Payment Mode" subtitle="Month to date">
            {(paymentModes || []).length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No payment data</div>
            ) : (
              <div className="flex items-center gap-4">
                <ResponsiveContainer width="55%" height={200}>
                  <PieChart>
                    <Pie data={paymentModes} cx="50%" cy="50%" innerRadius={50} outerRadius={80}
                      dataKey="total" paddingAngle={2}>
                      {(paymentModes || []).map((entry, i) => (
                        <Cell key={i} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => fmtInr(v)} contentStyle={{ fontSize: 11, borderRadius: 6 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-1.5">
                  {(paymentModes || []).slice(0, 6).map((m, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: m.fill }} />
                        <span className="text-foreground">{m.mode}</span>
                      </div>
                      <span className="font-mono font-semibold text-foreground">{fmtInr(m.total)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Section>
        </div>

        {/* TPA Ageing + Top Services */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

          {/* TPA Outstanding ageing */}
          <Section title="TPA Outstanding — Ageing" subtitle="Pending insurance claims by submission age">
            {(tpaAgeing || []).length === 0 ? (
              <div className="h-32 flex items-center justify-center text-muted-foreground text-sm">No pending claims</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left pb-2 font-semibold text-muted-foreground">Payer</th>
                      <th className="text-right pb-2 font-semibold text-emerald-700">0–30d</th>
                      <th className="text-right pb-2 font-semibold text-amber-700">30–60d</th>
                      <th className="text-right pb-2 font-semibold text-orange-700">60–90d</th>
                      <th className="text-right pb-2 font-semibold text-red-700">&gt;90d</th>
                      <th className="text-right pb-2 font-semibold text-foreground">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(tpaAgeing || []).map((r, i) => (
                      <tr key={i} className="border-b border-border/50 last:border-0">
                        <td className="py-2 font-medium uppercase">{r.payer}</td>
                        <td className="py-2 text-right text-emerald-700">{r.b0 > 0 ? fmtInr(r.b0) : "—"}</td>
                        <td className="py-2 text-right text-amber-700">{r.b30 > 0 ? fmtInr(r.b30) : "—"}</td>
                        <td className="py-2 text-right text-orange-700">{r.b60 > 0 ? fmtInr(r.b60) : "—"}</td>
                        <td className="py-2 text-right text-red-700 font-semibold">{r.b90 > 0 ? fmtInr(r.b90) : "—"}</td>
                        <td className="py-2 text-right font-bold">{fmtInr(r.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* Top 10 services */}
          <Section title="Top Revenue Services" subtitle={`${format(startOfMonth(new Date()), "MMM yyyy")} MTD`}>
            {(topServices || []).length === 0 ? (
              <div className="h-32 flex items-center justify-center text-muted-foreground text-sm">No service data</div>
            ) : (
              <div className="space-y-2">
                {(topServices || []).slice(0, 8).map((s, i) => {
                  const max = topServices![0].value;
                  const pct = Math.round((s.value / max) * 100);
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground w-4 text-right shrink-0">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-center mb-0.5">
                          <span className="text-xs truncate text-foreground">{s.name}</span>
                          <span className="text-xs font-mono font-semibold text-foreground ml-2 shrink-0">{fmtInr(s.value)}</span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-primary/70 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>
        </div>

        {/* ── AI Revenue Leak Detector ──────────────────────────────────── */}
        <Section
          title="AI Revenue Intelligence"
          subtitle="Identifies top revenue leakage patterns and recommends corrective actions"
          action={
            <div className="flex items-center gap-1.5 text-[10px] bg-primary/10 text-primary rounded-full px-2 py-1 font-semibold">
              <BarChart3 size={10} /> AI Powered
            </div>
          }
        >
          {hospital ? (
            <RevenueLeakDetector hospitalId={hospital.id} />
          ) : (
            <div className="h-32 flex items-center justify-center text-muted-foreground text-sm">Loading…</div>
          )}
        </Section>

      </div>
    </div>
  );
};

export default ExecutiveDashboardPage;
