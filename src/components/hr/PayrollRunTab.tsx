import React, { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Calculator, PlayCircle, CheckCircle2, Download, Printer,
  Loader2, ChevronDown, ChevronRight, AlertCircle, FileText, Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  calculatePayslip, generatePayslipHtml,
  type PayslipCalculation, type SalaryStructure, type AttendanceInput,
} from "@/lib/payrollEngine";

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

interface StaffRow {
  id: string;
  full_name: string;
  designation: string | null;
  department: string | null;
  // from salary assignment
  gross_monthly: number;
  pan_number: string | null;
  pf_account_number: string | null;
  structure: SalaryStructure | null;
  // computed
  calc?: PayslipCalculation;
  attendance?: AttendanceInput;
  ytdGross?: number;
  ytdTds?: number;
}

interface PayrollRun {
  id: string;
  month: number;
  year: number;
  status: string;
  total_gross: number;
  total_net: number;
  total_deductions: number;
  processed_at: string | null;
  approved_at: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  draft:     "bg-slate-100 text-slate-600",
  processed: "bg-blue-50 text-blue-700",
  approved:  "bg-emerald-50 text-emerald-700",
  disbursed: "bg-green-100 text-green-800",
};

const PayrollRunTab: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();

  const today = new Date();
  const [selectedMonth, setSelectedMonth] = useState(today.getMonth() + 1);
  const [selectedYear, setSelectedYear]   = useState(today.getFullYear());

  const [runs, setRuns]       = useState<PayrollRun[]>([]);
  const [staff, setStaff]     = useState<StaffRow[]>([]);
  const [activeRun, setActiveRun] = useState<PayrollRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Editable attendance overrides per staff
  const [attendanceOverrides, setAttendanceOverrides] = useState<Record<string, Partial<AttendanceInput>>>({});

  const fetchRuns = useCallback(async () => {
    if (!hospitalId) return;
    const { data } = await (supabase as any)
      .from("payroll_runs")
      .select("*")
      .eq("hospital_id", hospitalId)
      .order("created_at", { ascending: false })
      .limit(12);
    if (data) setRuns(data.map((r: any) => ({
      ...r,
      year:  r.year  ?? (r.run_month ? parseInt(r.run_month.split("-")[0]) : 0),
      month: r.month ?? (r.run_month ? parseInt(r.run_month.split("-")[1]) : 0),
    })) as PayrollRun[]);
  }, [hospitalId]);

  const fetchStaff = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    // Get all active staff with their current salary assignment
    const { data: staffData } = await supabase
      .from("users")
      .select("id, full_name, department_id, departments(name)")
      .eq("hospital_id", hospitalId)
      .eq("is_active", true)
      .order("full_name");

    if (!staffData) { setLoading(false); return; }

    // For each staff, get current salary assignment + structure
    const rows: StaffRow[] = [];
    for (const s of staffData as any[]) {
      const { data: ssa } = await (supabase as any)
        .from("staff_salary_assignments")
        .select("*, salary_structures(*)")
        .eq("staff_id", s.id)
        .is("effective_to", null)
        .order("effective_from", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!ssa) continue; // staff without salary assignment → skip

      // YTD accumulators from prior payslips this FY
      const fyStart = selectedMonth >= 4
        ? `${selectedYear}-04-01`
        : `${selectedYear - 1}-04-01`;

      const { data: ytd } = await (supabase as any)
        .from("payslips")
        .select("gross_earned, tds_monthly")
        .eq("hospital_id", hospitalId)
        .eq("staff_id", s.id)
        .gte("created_at", fyStart);

      const ytdGross = ((ytd || []) as any[]).reduce((sum: number, p: any) => sum + (p.gross_earned || 0), 0);
      const ytdTds   = ((ytd || []) as any[]).reduce((sum: number, p: any) => sum + (p.tds_monthly || 0), 0);

      rows.push({
        id:             s.id,
        full_name:      s.full_name,
        designation:    null,
        department:     (s as any).departments?.name || null,
        gross_monthly:  ssa.gross_monthly,
        pan_number:     ssa.pan_number,
        pf_account_number: ssa.pf_account_number,
        structure:      ssa.salary_structures as SalaryStructure | null,
        ytdGross,
        ytdTds,
      });
    }

    setStaff(rows);
    setLoading(false);
  }, [hospitalId, selectedMonth, selectedYear]);

  useEffect(() => { fetchRuns(); fetchStaff(); }, [fetchRuns, fetchStaff]);

  // ── Compute all payslips in memory ────────────────────────────────────────
  const computeAll = () => {
    const daysInMonth = new Date(selectedYear, selectedMonth, 0).getDate();
    const workingDays = Math.min(26, daysInMonth); // standard 26 working days

    const computed = staff.map(s => {
      if (!s.structure) return s;

      const override = attendanceOverrides[s.id] || {};
      const attendance: AttendanceInput = {
        total_days:   override.total_days   ?? workingDays,
        present_days: override.present_days ?? workingDays,
        paid_leaves:  override.paid_leaves  ?? 0,
        lop_days:     override.lop_days     ?? 0,
      };

      const calc = calculatePayslip(
        s.structure,
        s.gross_monthly,
        attendance,
        s.ytdGross,
        s.ytdTds,
      );

      return { ...s, calc, attendance };
    });

    setStaff(computed);
    toast({ title: `Payslips computed for ${computed.filter(s => s.calc).length} staff` });
  };

  // ── Process payroll (save to DB) ──────────────────────────────────────────
  const processPayroll = async () => {
    const staffWithCalc = staff.filter(s => s.calc);
    if (staffWithCalc.length === 0) {
      toast({ title: "Compute payslips first", variant: "destructive" });
      return;
    }

    setProcessing(true);
    const totalGross       = staffWithCalc.reduce((s, r) => s + (r.calc?.gross_earned || 0), 0);
    const totalDeductions  = staffWithCalc.reduce((s, r) => s + (r.calc?.total_deductions || 0), 0);
    const totalNet         = staffWithCalc.reduce((s, r) => s + (r.calc?.net_pay || 0), 0);

    // Upsert payroll_runs
    const { data: runData, error: runErr } = await (supabase as any)
      .from("payroll_runs")
      .upsert({
        hospital_id:      hospitalId,
        month:            selectedMonth,
        year:             selectedYear,
        status:           "processed",
        processed_at:     new Date().toISOString(),
        total_gross:      totalGross,
        total_deductions: totalDeductions,
        total_net:        totalNet,
      }, { onConflict: "hospital_id,month,year" })
      .select("id")
      .maybeSingle();

    if (runErr || !runData) {
      toast({ title: "Failed to save payroll run", description: runErr?.message, variant: "destructive" });
      setProcessing(false);
      return;
    }

    const runId = runData.id;

    // Upsert payslips for each staff
    for (const s of staffWithCalc) {
      if (!s.calc || !s.attendance) continue;
      await (supabase as any)
        .from("payslips")
        .upsert({
          hospital_id:       hospitalId,
          run_id:            runId,
          staff_id:          s.id,
          total_days:        s.attendance.total_days,
          present_days:      s.attendance.present_days,
          paid_leaves:       s.attendance.paid_leaves,
          lop_days:          s.attendance.lop_days,
          basic:             s.calc.basic,
          hra:               s.calc.hra,
          da:                s.calc.da,
          ta:                s.calc.ta,
          special_allowance: s.calc.special_allowance,
          medical_allowance: s.calc.medical_allowance,
          gross_earned:      s.calc.gross_earned,
          pf_employee:       s.calc.pf_employee,
          esi_employee:      s.calc.esi_employee,
          pt:                s.calc.pt,
          tds_monthly:       s.calc.tds_monthly,
          total_deductions:  s.calc.total_deductions,
          pf_employer:       s.calc.pf_employer,
          esi_employer:      s.calc.esi_employer,
          net_pay:           s.calc.net_pay,
          ytd_gross:         (s.ytdGross || 0) + s.calc.gross_earned,
          ytd_tds:           (s.ytdTds || 0) + s.calc.tds_monthly,
        }, { onConflict: "run_id,staff_id" });
    }

    setProcessing(false);
    fetchRuns();
    toast({ title: `Payroll processed for ${MONTHS[selectedMonth - 1]} ${selectedYear} ✓` });
  };

  // ── Print single payslip ──────────────────────────────────────────────────
  const printPayslip = (s: StaffRow) => {
    if (!s.calc || !s.attendance) { toast({ title: "Compute first", variant: "destructive" }); return; }
    const html = generatePayslipHtml({
      hospitalName: "Hospital",
      staffName:    s.full_name,
      designation:  s.designation || "Staff",
      month:        MONTHS[selectedMonth - 1],
      year:         selectedYear,
      pan:          s.pan_number || "",
      pf:           s.pf_account_number || "",
      calc:         s.calc,
      attendance:   s.attendance,
    });
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); w.print(); }
  };

  // ── Export payroll CSV ────────────────────────────────────────────────────
  const exportCsv = () => {
    const headers = ["Name","Designation","Gross","Basic","HRA","DA","TA","Special","PF(Emp)","ESI(Emp)","PT","TDS","Deductions","Net Pay"];
    const rows = staff
      .filter(s => s.calc)
      .map(s => [
        s.full_name, s.designation || "",
        s.calc!.gross_earned, s.calc!.basic, s.calc!.hra, s.calc!.da, s.calc!.ta,
        s.calc!.special_allowance, s.calc!.pf_employee, s.calc!.esi_employee,
        s.calc!.pt, s.calc!.tds_monthly, s.calc!.total_deductions, s.calc!.net_pay,
      ].join(","));
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement("a"), { href: url, download: `Payroll_${MONTHS[selectedMonth-1]}_${selectedYear}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  };

  const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

  const totalGross      = staff.filter(s => s.calc).reduce((s, r) => s + (r.calc?.gross_earned || 0), 0);
  const totalNet        = staff.filter(s => s.calc).reduce((s, r) => s + (r.calc?.net_pay || 0), 0);
  const totalPf         = staff.filter(s => s.calc).reduce((s, r) => s + (r.calc?.pf_employee || 0) + (r.calc?.pf_employer || 0), 0);
  const totalTds        = staff.filter(s => s.calc).reduce((s, r) => s + (r.calc?.tds_monthly || 0), 0);

  return (
    <div className="p-4 space-y-5">
      {/* ── Month selector + actions ─── */}
      <div className="flex items-end gap-4 flex-wrap">
        <div>
          <Label className="text-xs">Month</Label>
          <select
            value={selectedMonth}
            onChange={e => setSelectedMonth(Number(e.target.value))}
            className="mt-1 h-9 text-sm border border-border rounded-md px-2 bg-background w-36"
          >
            {MONTHS.map((m, i) => (
              <option key={i} value={i + 1}>{m}</option>
            ))}
          </select>
        </div>
        <div>
          <Label className="text-xs">Year</Label>
          <Input
            type="number"
            value={selectedYear}
            onChange={e => setSelectedYear(Number(e.target.value))}
            className="mt-1 h-9 text-sm w-24"
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-9 gap-1.5"
          onClick={computeAll}
          disabled={loading}
        >
          <Calculator size={14} /> Compute Payslips
        </Button>
        {staff.some(s => s.calc) && (
          <>
            <Button
              size="sm"
              className="h-9 gap-1.5 bg-emerald-600 hover:bg-emerald-700"
              onClick={processPayroll}
              disabled={processing}
            >
              {processing
                ? <><Loader2 size={14} className="animate-spin" /> Processing...</>
                : <><PlayCircle size={14} /> Process & Save</>}
            </Button>
            <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={exportCsv}>
              <Download size={14} /> Export CSV
            </Button>
          </>
        )}
      </div>

      {/* ── Summary cards ─── */}
      {staff.some(s => s.calc) && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Total Gross", value: inr(totalGross), color: "text-foreground" },
            { label: "Total Net Pay", value: inr(totalNet), color: "text-emerald-700 font-bold" },
            { label: "PF (Emp + Employer)", value: inr(totalPf), color: "text-blue-700" },
            { label: "TDS This Month", value: inr(totalTds), color: "text-orange-700" },
          ].map(c => (
            <div key={c.label} className="border border-border rounded-lg p-3 bg-card">
              <p className="text-[11px] text-muted-foreground">{c.label}</p>
              <p className={cn("text-[18px] mt-0.5", c.color)}>{c.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Payroll staff table ─── */}
      <div className="border border-border rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border-b border-border">
          <Users size={14} className="text-muted-foreground" />
          <span className="text-[13px] font-bold">
            Staff ({staff.filter(s => s.structure).length} with salary assigned)
          </span>
          {loading && <Loader2 size={13} className="animate-spin text-muted-foreground" />}
        </div>

        {staff.length === 0 && !loading && (
          <div className="px-4 py-8 text-center">
            <AlertCircle size={28} className="text-amber-400 mx-auto mb-2" />
            <p className="text-[13px] text-muted-foreground">No staff with salary assignments found.</p>
            <p className="text-[12px] text-muted-foreground/70 mt-1">
              Go to Staff → assign salary structures to run payroll.
            </p>
          </div>
        )}

        <div className="divide-y divide-border">
          {staff.filter(s => s.structure).map(s => {
            const isExpanded = expanded.has(s.id);
            const override   = attendanceOverrides[s.id] || {};
            const daysInMo   = new Date(selectedYear, selectedMonth, 0).getDate();
            const workDays   = Math.min(26, daysInMo);

            return (
              <div key={s.id}>
                <div
                  className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/30 cursor-pointer"
                  onClick={() => setExpanded(prev => {
                    const n = new Set(prev);
                    n.has(s.id) ? n.delete(s.id) : n.add(s.id);
                    return n;
                  })}
                >
                  <span className="text-muted-foreground shrink-0">
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-foreground truncate">{s.full_name}</p>
                    <p className="text-[11px] text-muted-foreground">{s.designation || "Staff"}</p>
                  </div>
                  <div className="text-right text-[12px] shrink-0">
                    <p className="text-muted-foreground">Gross: {inr(s.gross_monthly)}</p>
                    {s.calc && (
                      <p className="text-emerald-700 font-semibold">Net: {inr(s.calc.net_pay)}</p>
                    )}
                  </div>
                  {s.calc && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-[11px] shrink-0"
                      onClick={e => { e.stopPropagation(); printPayslip(s); }}
                    >
                      <Printer size={12} /> Payslip
                    </Button>
                  )}
                </div>

                {/* Expanded: attendance override + breakdown */}
                {isExpanded && (
                  <div className="px-8 py-3 bg-muted/20 border-t border-border/50 space-y-3">
                    {/* Attendance */}
                    <div className="grid grid-cols-4 gap-3">
                      {(["present_days","paid_leaves","lop_days"] as const).map(key => (
                        <div key={key}>
                          <Label className="text-[10px] uppercase text-muted-foreground">
                            {key === "present_days" ? "Present Days" : key === "paid_leaves" ? "Paid Leaves" : "LOP Days"}
                          </Label>
                          <Input
                            type="number"
                            className="mt-0.5 h-7 text-xs"
                            value={override[key] ?? (key === "present_days" ? workDays : 0)}
                            onChange={e => setAttendanceOverrides(prev => ({
                              ...prev,
                              [s.id]: { ...prev[s.id], [key]: Number(e.target.value) },
                            }))}
                          />
                        </div>
                      ))}
                    </div>

                    {/* Breakdown table */}
                    {s.calc && (
                      <div className="grid grid-cols-2 gap-4 text-[12px]">
                        <div>
                          <p className="font-bold text-emerald-700 mb-1">Earnings</p>
                          {[
                            ["Basic", s.calc.basic], ["HRA", s.calc.hra], ["DA", s.calc.da],
                            ["Transport", s.calc.ta], ["Special Allowance", s.calc.special_allowance],
                            ["Medical Allowance", s.calc.medical_allowance],
                            ["Gross Earned", s.calc.gross_earned],
                          ].map(([k, v]) => (
                            <div key={k as string} className="flex justify-between border-b border-border/50 py-0.5">
                              <span className={k === "Gross Earned" ? "font-bold" : "text-muted-foreground"}>{k}</span>
                              <span className={k === "Gross Earned" ? "font-bold" : ""}>{inr(v as number)}</span>
                            </div>
                          ))}
                        </div>
                        <div>
                          <p className="font-bold text-red-600 mb-1">Deductions</p>
                          {[
                            ["PF (Employee 12%)", s.calc.pf_employee],
                            ["ESI (Employee 0.75%)", s.calc.esi_employee],
                            ["Professional Tax", s.calc.pt],
                            ["TDS (Income Tax)", s.calc.tds_monthly],
                            ["Total Deductions", s.calc.total_deductions],
                          ].map(([k, v]) => (
                            <div key={k as string} className="flex justify-between border-b border-border/50 py-0.5">
                              <span className={k === "Total Deductions" ? "font-bold" : "text-muted-foreground"}>{k}</span>
                              <span className={k === "Total Deductions" ? "font-bold text-red-600" : ""}>{inr(v as number)}</span>
                            </div>
                          ))}
                          <div className="flex justify-between pt-1 font-bold text-emerald-700">
                            <span>NET PAY</span>
                            <span>{inr(s.calc.net_pay)}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Past runs ─── */}
      {runs.length > 0 && (
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border-b border-border">
            <FileText size={14} className="text-muted-foreground" />
            <span className="text-[13px] font-bold">Past Payroll Runs</span>
          </div>
          <div className="divide-y divide-border">
            {runs.map(r => (
              <div key={r.id} className="flex items-center gap-4 px-4 py-2.5">
                <div className="flex-1">
                  <p className="text-[13px] font-semibold">{MONTHS[r.month - 1]} {r.year}</p>
                  <p className="text-[11px] text-muted-foreground">
                    Gross: {inr(r.total_gross)} · Net: {inr(r.total_net)}
                  </p>
                </div>
                <Badge className={cn("text-[10px]", STATUS_COLORS[r.status] || "")}>
                  {r.status}
                </Badge>
                {r.processed_at && (
                  <p className="text-[10px] text-muted-foreground shrink-0">
                    {new Date(r.processed_at).toLocaleDateString("en-IN")}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default PayrollRunTab;
