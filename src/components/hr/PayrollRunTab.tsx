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
  Loader2, ChevronDown, ChevronRight, AlertCircle, FileText, Users, Wallet, Eye,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  calculatePayslip, generatePayslipHtml,
  type PayslipCalculation, type SalaryStructure, type AttendanceInput,
} from "@/lib/payrollEngine";
import { autoPostJournalEntry } from "@/lib/accounting";
import { generateEPFECRFromPayslips, generateForm16FromPayslip, generateForm16AFromPayslips } from "@/lib/payrollExports";
import { printDocument, printHeader } from "@/lib/printUtils";
import SalaryStructureSetup from "./SalaryStructureSetup";

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
  // derived from staff_attendance for the selected month
  att?: { paid_leaves: number; lop_days: number; ot_hours: number; hasRows: boolean };
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
  const [salarySetupOpen, setSalarySetupOpen] = useState(false);

  // View past run
  const [viewRun, setViewRun] = useState<PayrollRun | null>(null);
  const [viewSlips, setViewSlips] = useState<any[]>([]);
  const [viewLoading, setViewLoading] = useState(false);

  // Gratuity calculator
  const [showGratuity, setShowGratuity] = useState(false);
  const [gratuity, setGratuity] = useState({ staff_id: "", from: "", to: new Date().toISOString().split("T")[0], lastBasic: "", years: 0, result: null as number | null });

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

    // Attendance for the month → paid-leave / LOP / OT per staff (one query for all)
    const monthStart = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}-01`;
    const monthEnd = new Date(selectedYear, selectedMonth, 1).toISOString().split("T")[0]; // 1st of next month
    const { data: attRows } = await (supabase as any)
      .from("staff_attendance")
      .select("user_id, status, overtime_hours")
      .eq("hospital_id", hospitalId)
      .gte("attendance_date", monthStart)
      .lt("attendance_date", monthEnd);

    const attByUser = new Map<string, { paid_leaves: number; lop_days: number; ot_hours: number; hasRows: boolean }>();
    for (const a of (attRows || []) as any[]) {
      const cur = attByUser.get(a.user_id) || { paid_leaves: 0, lop_days: 0, ot_hours: 0, hasRows: false };
      cur.hasRows = true;
      if (a.status === "on_leave") cur.paid_leaves += 1;
      else if (a.status === "absent") cur.lop_days += 1;
      cur.ot_hours += parseFloat(a.overtime_hours) || 0;
      attByUser.set(a.user_id, cur);
    }
    for (const r of rows) r.att = attByUser.get(r.id) || { paid_leaves: 0, lop_days: 0, ot_hours: 0, hasRows: false };

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

      // Default from staff_attendance (manual overrides still win). Staff with no
      // attendance rows at all default to full presence (as legacy did) so payroll
      // never underpays where attendance simply isn't tracked.
      const override = attendanceOverrides[s.id] || {};
      const paid = override.paid_leaves ?? s.att?.paid_leaves ?? 0;
      const lop  = override.lop_days    ?? s.att?.lop_days    ?? 0;
      const total = override.total_days ?? workingDays;
      const present = override.present_days ?? Math.max(0, total - lop - paid);
      const attendance: AttendanceInput = {
        total_days:   total,
        present_days: present,
        paid_leaves:  paid,
        lop_days:     lop,
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

  // ── Approve a run + post to General Ledger ────────────────────────────────
  const approveRun = async (run: PayrollRun) => {
    const { data: u } = await supabase.auth.getUser();
    const { data: cu } = await supabase.from("users").select("id, hospital_id").eq("auth_user_id", u.user?.id || "").maybeSingle();
    if (!cu) { toast({ title: "User not resolved", variant: "destructive" }); return; }

    await (supabase as any).from("payroll_runs").update({ status: "approved", approved_by: cu.id, approved_at: new Date().toISOString() }).eq("id", run.id);

    // Summary posting via shared engine (respects posting rules)
    await autoPostJournalEntry({
      triggerEvent: "payroll_processed",
      sourceModule: "hr",
      sourceId: run.id,
      amount: Number(run.total_net || 0),
      description: `Payroll ${MONTHS[run.month - 1]} ${run.year} — net`,
      hospitalId: cu.hospital_id,
      postedBy: cu.id,
    });

    // Detailed double-entry journal (Salaries Dr; Net Payable + Statutory Cr)
    const totalGross = Number(run.total_gross || 0);
    const totalNet = Number(run.total_net || 0);
    const totalDed = Number(run.total_deductions || 0);
    if (totalGross > 0) {
      const { data: nextNum } = await supabase.rpc("get_next_journal_number", { p_hospital_id: cu.hospital_id });
      const { data: journal } = await (supabase as any).from("journal_entries").insert({
        hospital_id: cu.hospital_id,
        journal_number: nextNum || `JV-${Date.now()}`,
        entry_date: new Date().toISOString().split("T")[0],
        description: `Payroll: ${MONTHS[run.month - 1]} ${run.year}`,
        total_debit: totalGross, total_credit: totalGross,
        status: "posted", reference_type: "payroll", reference_id: run.id, created_by: cu.id,
      }).select("id").maybeSingle();

      if (journal) {
        const lines: any[] = [
          { journal_id: journal.id, hospital_id: cu.hospital_id, account_code: "5001", account_name: "Salaries & Wages", debit_amount: totalGross, credit_amount: 0, description: `Gross salary ${MONTHS[run.month - 1]} ${run.year}` },
          { journal_id: journal.id, hospital_id: cu.hospital_id, account_code: "2101", account_name: "Salaries Payable", debit_amount: 0, credit_amount: totalNet, description: "Net salary payable" },
        ];
        if (totalDed > 0) lines.push({ journal_id: journal.id, hospital_id: cu.hospital_id, account_code: "2102", account_name: "TDS / PF / ESI Payable", debit_amount: 0, credit_amount: totalDed, description: "Statutory deductions payable" });
        await (supabase as any).from("journal_entry_lines").insert(lines);
      }
    }
    toast({ title: "Payroll approved & posted to accounts" });
    fetchRuns();
  };

  const openViewRun = async (run: PayrollRun) => {
    setViewRun(run);
    setViewLoading(true);
    setViewSlips([]);
    const { data: slips } = await (supabase as any).from("payslips").select("*").eq("run_id", run.id);
    const ids = (slips || []).map((s: any) => s.staff_id);
    const { data: users } = ids.length ? await supabase.from("users").select("id, full_name").in("id", ids) : { data: [] };
    const nameMap = new Map((users || []).map((u: any) => [u.id, u.full_name]));
    setViewSlips((slips || []).map((s: any) => ({ ...s, full_name: nameMap.get(s.staff_id) || "Unknown" })));
    setViewLoading(false);
  };

  const printPastPayslip = (slip: any) => {
    const html = generatePayslipHtml({
      hospitalName: "Hospital", staffName: slip.full_name, designation: "Staff",
      month: MONTHS[(viewRun?.month || 1) - 1], year: viewRun?.year || selectedYear,
      pan: "", pf: "",
      calc: {
        basic: slip.basic, hra: slip.hra, da: slip.da, ta: slip.ta,
        special_allowance: slip.special_allowance, medical_allowance: slip.medical_allowance,
        other_allowances: slip.other_allowances || 0, gross_earned: slip.gross_earned,
        pf_employee: slip.pf_employee, esi_employee: slip.esi_employee, pt: slip.pt,
        tds_monthly: slip.tds_monthly, total_deductions: slip.total_deductions,
        pf_employer: slip.pf_employer, esi_employer: slip.esi_employer, net_pay: slip.net_pay,
      },
      attendance: { total_days: slip.total_days, present_days: slip.present_days, paid_leaves: slip.paid_leaves, lop_days: slip.lop_days },
    });
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); w.print(); }
  };

  const runExport = async (run: PayrollRun, kind: "ecr" | "16a") => {
    const monthLabel = `${run.year}-${String(run.month).padStart(2, "0")}`;
    const { data: h } = await (supabase as any).from("hospitals").select("name, address").eq("id", hospitalId).maybeSingle();
    if (kind === "ecr") { await generateEPFECRFromPayslips(run.id, monthLabel); return; }
    const fy = run.month >= 4 ? `${run.year}-${run.year + 1}` : `${run.year - 1}-${run.year}`;
    const q = run.month >= 4 && run.month <= 6 ? "Q1" : run.month >= 7 && run.month <= 9 ? "Q2" : run.month >= 10 && run.month <= 12 ? "Q3" : "Q4";
    await generateForm16AFromPayslips(run.id, q as any, fy, h?.name || "Hospital", h?.address || "");
  };

  const emitForm16 = async (slip: any) => {
    if (!viewRun) return;
    const fy = viewRun.month >= 4 ? `${viewRun.year}-${viewRun.year + 1}` : `${viewRun.year - 1}-${viewRun.year}`;
    const { data: h } = await (supabase as any).from("hospitals").select("name, address").eq("id", hospitalId).maybeSingle();
    await generateForm16FromPayslip(slip.id, fy, h?.name || "Hospital", h?.address || "");
  };

  // ── Gratuity (Payment of Gratuity Act, 1972) ──────────────────────────────
  const calcGratuity = () => {
    if (!gratuity.from || !gratuity.to || !gratuity.lastBasic) { toast({ title: "Fill service dates and last basic", variant: "destructive" }); return; }
    const years = (new Date(gratuity.to).getTime() - new Date(gratuity.from).getTime()) / (1000 * 60 * 60 * 24 * 365.25);
    if (years < 5) { toast({ title: "Gratuity needs ≥ 5 years of service", variant: "destructive" }); return; }
    const amount = Math.round((Number(gratuity.lastBasic) * 15 / 26) * Math.floor(years));
    setGratuity(g => ({ ...g, years: Math.floor(years), result: amount }));
  };

  const printGratuity = async () => {
    if (gratuity.result === null) return;
    const emp = staff.find(s => s.id === gratuity.staff_id);
    const { data: h } = await (supabase as any).from("hospitals").select("name, address").eq("id", hospitalId).maybeSingle();
    const body = `
      ${printHeader(h?.name || "Hospital", "Gratuity Payment Certificate")}
      <div style="margin:20px 0;padding:16px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;">
        <table style="width:100%;font-size:13px;border-collapse:collapse;">
          <tr><td style="padding:4px 8px;color:#64748b;width:40%">Employee</td><td style="font-weight:600">${emp?.full_name || "—"}</td></tr>
          <tr><td style="padding:4px 8px;color:#64748b">Date of Joining</td><td>${gratuity.from ? new Date(gratuity.from).toLocaleDateString("en-IN") : "—"}</td></tr>
          <tr><td style="padding:4px 8px;color:#64748b">Date of Leaving</td><td>${gratuity.to ? new Date(gratuity.to).toLocaleDateString("en-IN") : "—"}</td></tr>
          <tr><td style="padding:4px 8px;color:#64748b">Completed Years</td><td>${gratuity.years} years</td></tr>
          <tr><td style="padding:4px 8px;color:#64748b">Last Basic Salary</td><td>₹${Number(gratuity.lastBasic).toLocaleString("en-IN")}</td></tr>
          <tr style="background:#dbeafe;"><td style="padding:8px;color:#1e40af;font-weight:700">Gratuity Amount</td><td style="font-weight:700;font-size:15px;color:#1e40af">₹${gratuity.result.toLocaleString("en-IN")}</td></tr>
        </table>
        <p style="font-size:10px;color:#94a3b8;margin-top:12px;">Formula: (Last Basic × 15/26) × Years of Service — Payment of Gratuity Act, 1972</p>
      </div>
      <div style="margin-top:40px;display:flex;justify-content:space-between;font-size:12px;">
        <div style="text-align:center"><div style="border-top:1px solid #334155;width:160px;padding-top:4px;">Employee Signature</div></div>
        <div style="text-align:center"><div style="border-top:1px solid #334155;width:160px;padding-top:4px;">Authorised Signatory</div></div>
      </div>`;
    printDocument("Gratuity Certificate", body);
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
          onClick={() => setSalarySetupOpen(true)}
        >
          <Wallet size={14} /> Salary Setup
        </Button>
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

      <p className="text-[11px] text-muted-foreground -mt-2">
        Canonical payroll engine — salary structures → PF/ESI/TDS payslips, Form 16/16A, EPF ECR, and GL posting on approval. (The legacy Payroll tab is now read-only history.)
      </p>

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
              Click <button className="underline font-medium" onClick={() => setSalarySetupOpen(true)}>Salary Setup</button> to create a structure and assign salaries.
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
                      {(["present_days","paid_leaves","lop_days"] as const).map(key => {
                        const attDefault =
                          key === "present_days" ? Math.max(0, workDays - (s.att?.lop_days ?? 0) - (s.att?.paid_leaves ?? 0))
                          : key === "paid_leaves" ? (s.att?.paid_leaves ?? 0)
                          : (s.att?.lop_days ?? 0);
                        return (
                        <div key={key}>
                          <Label className="text-[10px] uppercase text-muted-foreground">
                            {key === "present_days" ? "Present Days" : key === "paid_leaves" ? "Paid Leaves" : "LOP Days"}
                          </Label>
                          <Input
                            type="number"
                            className="mt-0.5 h-7 text-xs"
                            value={override[key] ?? attDefault}
                            onChange={e => setAttendanceOverrides(prev => ({
                              ...prev,
                              [s.id]: { ...prev[s.id], [key]: Number(e.target.value) },
                            }))}
                          />
                        </div>
                      ); })}
                      <div>
                        <Label className="text-[10px] uppercase text-muted-foreground">Overtime Hrs</Label>
                        <Input type="number" className="mt-0.5 h-7 text-xs" value={s.att?.ot_hours ?? 0} readOnly title="Summed from approved attendance overtime" />
                      </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {s.att?.hasRows
                        ? "Defaults from this month's attendance (leave/absence auto-applied) — edit to override."
                        : "No attendance recorded this month — defaulting to full presence. Edit if needed."}
                    </p>

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
              <div key={r.id} className="flex items-center gap-3 px-4 py-2.5 flex-wrap">
                <div className="flex-1 min-w-[140px]">
                  <p className="text-[13px] font-semibold">{MONTHS[r.month - 1]} {r.year}</p>
                  <p className="text-[11px] text-muted-foreground">
                    Gross: {inr(r.total_gross)} · Net: {inr(r.total_net)}
                  </p>
                </div>
                <Badge className={cn("text-[10px]", STATUS_COLORS[r.status] || "")}>
                  {r.status}
                </Badge>
                <div className="flex gap-1.5 flex-wrap">
                  <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1" onClick={() => openViewRun(r)} title="View payslips"><Eye size={12} /> View</Button>
                  <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1" onClick={() => runExport(r, "ecr")} title="EPF ECR export"><FileText size={12} /> ECR</Button>
                  <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1" onClick={() => runExport(r, "16a")} title="Form 16A (consultants)"><FileText size={12} /> 16A</Button>
                  {r.status === "processed" && (
                    <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1" onClick={() => approveRun(r)} title="Approve & post to accounts"><CheckCircle2 size={12} /> Approve</Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Gratuity calculator ─── */}
      <div className="border border-border rounded-lg overflow-hidden">
        <button className="w-full flex items-center justify-between px-4 py-2.5 bg-muted/40 hover:bg-muted/60" onClick={() => setShowGratuity(v => !v)}>
          <span className="text-[13px] font-bold flex items-center gap-2"><Calculator size={14} /> Gratuity Calculator <span className="text-[11px] font-normal text-muted-foreground">(Act 1972)</span></span>
          {showGratuity ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        {showGratuity && (
          <div className="p-4 space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <Label className="text-[10px] uppercase text-muted-foreground">Employee</Label>
                <select className="w-full h-8 text-xs mt-0.5 border border-input rounded-md px-2 bg-background" value={gratuity.staff_id}
                  onChange={e => { const emp = staff.find(s => s.id === e.target.value); setGratuity(g => ({ ...g, staff_id: e.target.value, lastBasic: emp ? String(Math.round((emp.gross_monthly || 0) * 0.4)) : "", result: null })); }}>
                  <option value="">Select…</option>
                  {staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                </select>
              </div>
              <div><Label className="text-[10px] uppercase text-muted-foreground">Last Basic ₹/mo</Label><Input type="number" className="h-8 text-xs mt-0.5" value={gratuity.lastBasic} onChange={e => setGratuity(g => ({ ...g, lastBasic: e.target.value, result: null }))} /></div>
              <div><Label className="text-[10px] uppercase text-muted-foreground">Date of Joining</Label><Input type="date" className="h-8 text-xs mt-0.5" value={gratuity.from} onChange={e => setGratuity(g => ({ ...g, from: e.target.value, result: null }))} /></div>
              <div><Label className="text-[10px] uppercase text-muted-foreground">Date of Leaving</Label><Input type="date" className="h-8 text-xs mt-0.5" value={gratuity.to} onChange={e => setGratuity(g => ({ ...g, to: e.target.value, result: null }))} /></div>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <Button size="sm" onClick={calcGratuity}><Calculator size={13} className="mr-1" /> Calculate</Button>
              {gratuity.result !== null && (
                <>
                  <div className="flex-1 min-w-[200px] bg-blue-50 rounded-md px-3 py-2 text-xs text-blue-700">
                    Service: <strong>{gratuity.years} yrs</strong> · Gratuity: <strong className="text-sm">₹{gratuity.result.toLocaleString("en-IN")}</strong>
                  </div>
                  <Button size="sm" variant="outline" onClick={printGratuity}><FileText size={13} className="mr-1" /> Certificate</Button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── View past run dialog ─── */}
      <Dialog open={!!viewRun} onOpenChange={(o) => { if (!o) { setViewRun(null); setViewSlips([]); } }}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Payslips — {viewRun ? `${MONTHS[viewRun.month - 1]} ${viewRun.year}` : ""}</DialogTitle></DialogHeader>
          {viewLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…</div>
          ) : viewSlips.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-sm">No payslips for this run.</div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/40"><tr><th className="text-left px-3 py-2">Staff</th><th className="text-right px-3 py-2">Gross</th><th className="text-right px-3 py-2">PF</th><th className="text-right px-3 py-2">TDS</th><th className="text-right px-3 py-2">Net</th><th className="text-left px-3 py-2">Actions</th></tr></thead>
                <tbody>
                  {viewSlips.map((s) => (
                    <tr key={s.id} className="border-t border-border">
                      <td className="px-3 py-1.5 font-medium">{s.full_name}</td>
                      <td className="px-3 py-1.5 text-right">{inr(Number(s.gross_earned || 0))}</td>
                      <td className="px-3 py-1.5 text-right">{inr(Number(s.pf_employee || 0))}</td>
                      <td className="px-3 py-1.5 text-right">{inr(Number(s.tds_monthly || 0))}</td>
                      <td className="px-3 py-1.5 text-right font-semibold">{inr(Number(s.net_pay || 0))}</td>
                      <td className="px-3 py-1.5">
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => printPastPayslip(s)}><Printer size={11} className="mr-0.5" /> Payslip</Button>
                          <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => emitForm16(s)}>Form 16</Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {hospitalId && (
        <SalaryStructureSetup
          open={salarySetupOpen}
          onClose={() => setSalarySetupOpen(false)}
          hospitalId={hospitalId}
          onSaved={fetchStaff}
        />
      )}
    </div>
  );
};

export default PayrollRunTab;
