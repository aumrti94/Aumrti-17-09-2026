import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Printer, Loader2, Users, CalendarCheck, Palmtree, DollarSign, ShieldAlert, GraduationCap, AlertTriangle } from "lucide-react";
import { printDocument, printHeader } from "@/lib/printUtils";
import { cn } from "@/lib/utils";

interface Report {
  headcount: number;
  byRole: { role: string; count: number }[];
  byDept: { dept: string; count: number }[];
  attPresent: number;
  attAbsent: number;
  attLeave: number;
  attMarked: number;
  leavePending: number;
  leaveApproved: number;
  payrollMonth: string | null;
  payrollNet: number;
  payrollStaff: number;
  credExpiring: number;
  credExpired: number;
  trainingDone: number;
  trainingTotal: number;
  injuries: number;
}

const HRReportsTab: React.FC<{ hospitalId: string }> = ({ hospitalId }) => {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const today = new Date().toISOString().split("T")[0];
    const monthStart = today.slice(0, 8) + "01";
    const yearStart = today.slice(0, 4) + "-01-01";
    const in30 = new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];

    const [usersRes, deptRes, attRes, leaveRes, payrollRes, credRes, trainRes, injRes] = await Promise.all([
      supabase.from("users").select("id, role, department_id").eq("hospital_id", hospitalId).eq("is_active", true),
      supabase.from("departments").select("id, name").eq("hospital_id", hospitalId),
      (supabase as any).from("staff_attendance").select("status").eq("hospital_id", hospitalId).eq("attendance_date", today),
      (supabase as any).from("leave_requests").select("status").eq("hospital_id", hospitalId).gte("from_date", yearStart),
      (supabase as any).from("payroll_runs").select("run_month, month, year, total_net, staff_count").eq("hospital_id", hospitalId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      (supabase as any).from("staff_credentials").select("expiry_date").eq("hospital_id", hospitalId).not("expiry_date", "is", null),
      (supabase as any).from("staff_training_records").select("completed").eq("hospital_id", hospitalId),
      (supabase as any).from("staff_injuries").select("id").eq("hospital_id", hospitalId).gte("incident_date", yearStart),
    ]);

    const users = usersRes.data || [];
    const deptMap = new Map((deptRes.data || []).map((d: any) => [d.id, d.name]));

    const roleCounts: Record<string, number> = {};
    const deptCounts: Record<string, number> = {};
    users.forEach((u: any) => {
      roleCounts[u.role || "unknown"] = (roleCounts[u.role || "unknown"] || 0) + 1;
      const dn = deptMap.get(u.department_id) || "Unassigned";
      deptCounts[dn] = (deptCounts[dn] || 0) + 1;
    });

    const att = attRes.data || [];
    const leave = leaveRes.data || [];
    const cred = credRes.data || [];
    const train = trainRes.data || [];

    setReport({
      headcount: users.length,
      byRole: Object.entries(roleCounts).map(([role, count]) => ({ role, count })).sort((a, b) => b.count - a.count),
      byDept: Object.entries(deptCounts).map(([dept, count]) => ({ dept, count })).sort((a, b) => b.count - a.count),
      attPresent: att.filter((a: any) => a.status === "present" || a.status === "late").length,
      attAbsent: att.filter((a: any) => a.status === "absent").length,
      attLeave: att.filter((a: any) => a.status === "on_leave").length,
      attMarked: att.length,
      leavePending: leave.filter((l: any) => l.status === "pending").length,
      leaveApproved: leave.filter((l: any) => l.status === "approved").length,
      payrollMonth: payrollRes.data ? (payrollRes.data.run_month || `${payrollRes.data.month}/${payrollRes.data.year}`) : null,
      payrollNet: Number(payrollRes.data?.total_net || 0),
      payrollStaff: Number(payrollRes.data?.staff_count || 0),
      credExpiring: cred.filter((c: any) => c.expiry_date > today && c.expiry_date <= in30).length,
      credExpired: cred.filter((c: any) => c.expiry_date <= today).length,
      trainingDone: train.filter((t: any) => t.completed).length,
      trainingTotal: train.length,
      injuries: (injRes.data || []).length,
    });
    setLoading(false);
    // avoid unused var lint on monthStart (kept for clarity of intent)
    void monthStart;
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);

  const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

  const printReport = async () => {
    if (!report) return;
    let hospitalName = "Hospital";
    const { data: h } = await (supabase as any).from("hospitals").select("name").eq("id", hospitalId).maybeSingle();
    if (h) hospitalName = h.name || "Hospital";
    const attPct = report.attMarked > 0 ? Math.round((report.attPresent / report.attMarked) * 100) : 0;
    const trainPct = report.trainingTotal > 0 ? Math.round((report.trainingDone / report.trainingTotal) * 100) : 0;
    const row = (k: string, v: string) => `<tr><td style="padding:4px 8px;color:#475569">${k}</td><td style="padding:4px 8px;font-weight:600;text-align:right">${v}</td></tr>`;
    const body = `
      ${printHeader(hospitalName, "HR & Staff Report", `<p style="font-size:11px;color:#64748b">Generated ${new Date().toLocaleDateString("en-IN")}</p>`)}
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:12px">
        ${row("Total Active Staff", String(report.headcount))}
        ${row("Attendance Today (present/marked)", `${report.attPresent}/${report.attMarked} (${attPct}%)`)}
        ${row("On Leave Today", String(report.attLeave))}
        ${row("Leave Requests (year) — Pending/Approved", `${report.leavePending}/${report.leaveApproved}`)}
        ${row("Last Payroll", report.payrollMonth ? `${report.payrollMonth} — ${inr(report.payrollNet)} net, ${report.payrollStaff} staff` : "None")}
        ${row("Credentials Expiring (≤30d) / Expired", `${report.credExpiring} / ${report.credExpired}`)}
        ${row("Training Compliance", `${report.trainingDone}/${report.trainingTotal} (${trainPct}%)`)}
        ${row("Staff Injuries (year)", String(report.injuries))}
      </table>`;
    printDocument("HR & Staff Report", body, { width: 900, height: 700 });
  };

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading report…</div>;
  }
  if (!report) return null;

  const attPct = report.attMarked > 0 ? Math.round((report.attPresent / report.attMarked) * 100) : 0;
  const trainPct = report.trainingTotal > 0 ? Math.round((report.trainingDone / report.trainingTotal) * 100) : 0;

  const kpis = [
    { label: "Active Staff", value: report.headcount, icon: Users, color: "text-primary" },
    { label: "Present Today", value: `${report.attPresent}/${report.attMarked}`, sub: `${attPct}%`, icon: CalendarCheck, color: "text-success" },
    { label: "On Leave Today", value: report.attLeave, icon: Palmtree, color: "text-accent-foreground" },
    { label: "Leave Pending", value: report.leavePending, icon: Palmtree, color: "text-amber-600" },
    { label: "Last Payroll Net", value: report.payrollMonth ? inr(report.payrollNet) : "—", sub: report.payrollMonth || "no runs", icon: DollarSign, color: "text-emerald-700" },
    { label: "Creds Expiring/Expired", value: `${report.credExpiring}/${report.credExpired}`, icon: ShieldAlert, color: "text-destructive" },
    { label: "Training Compliance", value: `${trainPct}%`, sub: `${report.trainingDone}/${report.trainingTotal}`, icon: GraduationCap, color: "text-blue-700" },
    { label: "Injuries (year)", value: report.injuries, icon: AlertTriangle, color: "text-orange-700" },
  ];

  const Bars: React.FC<{ title: string; data: { label: string; count: number }[] }> = ({ title, data }) => {
    const max = Math.max(1, ...data.map((d) => d.count));
    return (
      <div className="border border-border rounded-lg p-4 bg-card">
        <h3 className="text-sm font-semibold mb-3">{title}</h3>
        <div className="space-y-2">
          {data.map((d) => (
            <div key={d.label}>
              <div className="flex justify-between text-xs mb-0.5">
                <span className="text-muted-foreground capitalize">{d.label}</span>
                <span className="font-medium">{d.count}</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-primary" style={{ width: `${(d.count / max) * 100}%` }} />
              </div>
            </div>
          ))}
          {data.length === 0 && <p className="text-xs text-muted-foreground">No data</p>}
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 overflow-auto p-5 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold">HR & Staff Reports</h2>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={printReport}>
          <Printer className="h-3.5 w-3.5" /> Print / Export
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="border border-border rounded-lg p-3 bg-card">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Icon className={cn("h-4 w-4", k.color)} />
                <span className="text-[11px]">{k.label}</span>
              </div>
              <p className={cn("text-xl font-bold mt-1", k.color)}>{k.value}</p>
              {k.sub && <p className="text-[10px] text-muted-foreground">{k.sub}</p>}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Bars title="Headcount by Role" data={report.byRole.map((r) => ({ label: r.role, count: r.count }))} />
        <Bars title="Headcount by Department" data={report.byDept.map((d) => ({ label: d.dept, count: d.count }))} />
      </div>
    </div>
  );
};

export default HRReportsTab;
