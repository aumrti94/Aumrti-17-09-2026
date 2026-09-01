import React, { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useHospitalId } from "@/hooks/useHospitalId";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { autoPostJournalEntry } from "@/lib/accounting";
import { printPayslip } from "@/lib/payslipPrint";
import { printDocument, printHeader, printAmount } from "@/lib/printUtils";
import { generateEPFECR, generateForm16, generateForm16A } from "@/lib/payrollExports";
import { DollarSign, Download, CheckSquare, Loader2, FileText, AlertTriangle, Eye, Calculator } from "lucide-react";

interface StaffOption { id: string; user_id: string; full_name: string; joining_date: string | null; basic_salary: number; }
interface GratuityCalc { employee: StaffOption | null; serviceFrom: string; serviceTo: string; lastBasic: string; result: number | null; yearsOfService: number; }

/** Andhra Pradesh PT slab (default for unspecified states) */
function professionalTax(gross: number): number {
  if (gross <= 15000) return 0;
  if (gross <= 20000) return 150;
  return 200;
}

interface PayrollRun {
  id: string;
  run_month: string;
  run_date: string;
  total_gross: number;
  total_deductions: number;
  total_net: number;
  staff_count: number;
  status: string;
}

interface PayrollItem {
  id: string;
  user_id: string;
  full_name?: string;
  present_days: number;
  absent_days: number;
  leave_days: number;
  overtime_hours: number;
  basic: number;
  hra: number;
  da: number;
  conveyance: number;
  medical_allowance: number;
  overtime_amount: number;
  gross_salary: number;
  pf_employee: number;
  esic_employee: number;
  professional_tax: number;
  tds: number;
  total_deductions: number;
  net_salary: number;
  payment_status: string;
  salary_missing?: boolean;
}

const PayrollTab: React.FC = () => {
  const { toast } = useToast();
  const { hospitalId } = useHospitalId();
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [workingDays, setWorkingDays] = useState(26);
  const [calculatedItems, setCalculatedItems] = useState<PayrollItem[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [viewItems, setViewItems] = useState<PayrollItem[]>([]);
  const [showViewDialog, setShowViewDialog] = useState(false);
  const [viewLoading, setViewLoading] = useState(false);
  const [staffCount, setStaffCount] = useState(0);
  const [attendanceCount, setAttendanceCount] = useState(0);
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);
  const [gratuity, setGratuity] = useState<GratuityCalc>({
    employee: null, serviceFrom: "", serviceTo: new Date().toISOString().split("T")[0],
    lastBasic: "", result: null, yearsOfService: 0,
  });
  const [showGratuity, setShowGratuity] = useState(false);


  const loadStaffOptions = useCallback(async () => {
    if (!hospitalId) return;
    const { data } = await (supabase as any)
      .from("staff_profiles")
      .select("id, user_id, basic_salary, created_at, users!staff_profiles_user_id_fkey(full_name)")
      .eq("hospital_id", hospitalId).eq("is_active", true);
    setStaffOptions((data || []).map((s: any) => ({
      id: s.id, user_id: s.user_id,
      full_name: s.users?.full_name || "Unknown",
      joining_date: s.created_at ? s.created_at.split("T")[0] : null,
      basic_salary: Number(s.basic_salary) || 0,
    })));
  }, [hospitalId]);

  const loadRuns = useCallback(async () => {
    if (!hospitalId) return;
    const { data } = await (supabase as any)
      .from("payroll_runs")
      .select("*")
      .eq("hospital_id", hospitalId)
      .order("created_at", { ascending: false });
    setRuns(data || []);
  }, [hospitalId]);

  useEffect(() => {
    if (hospitalId) { loadRuns(); loadStaffOptions(); }
  }, [selectedMonth, hospitalId, loadRuns, loadStaffOptions]);

  const openRunModal = async () => {
    if (!hospitalId) {
      toast({ title: "Hospital not loaded yet", variant: "destructive" });
      return;
    }
    // Count staff and attendance for the month
    const { data: staff } = await (supabase as any)
      .from("staff_profiles")
      .select("user_id")
      .eq("hospital_id", hospitalId)
      .eq("is_active", true);
    setStaffCount(staff?.length || 0);

    const monthStart = `${selectedMonth}-01`;
    const nextMonth = new Date(parseInt(selectedMonth.split("-")[0]), parseInt(selectedMonth.split("-")[1]), 1);
    const monthEnd = nextMonth.toISOString().split("T")[0];

    const { data: att } = await (supabase as any)
      .from("staff_attendance")
      .select("user_id")
      .eq("hospital_id", hospitalId)
      .gte("attendance_date", monthStart)
      .lt("attendance_date", monthEnd);

    const uniqueUsers = new Set((att || []).map((a: any) => a.user_id));
    setAttendanceCount(uniqueUsers.size);

    // Calculate working days (exclude Sundays)
    const year = parseInt(selectedMonth.split("-")[0]);
    const month = parseInt(selectedMonth.split("-")[1]) - 1;
    let wd = 0;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      if (new Date(year, month, d).getDay() !== 0) wd++;
    }
    setWorkingDays(wd);
    setCalculatedItems([]);
    setShowModal(true);
  };

  const calculatePayroll = async () => {
    if (!hospitalId) return;
    setProcessing(true);
    try {
      const { data: profiles } = await (supabase as any)
        .from("staff_profiles")
        .select("*, users!staff_profiles_user_id_fkey(full_name)")
        .eq("hospital_id", hospitalId)
        .eq("is_active", true);

      if (!profiles?.length) {
        toast({ title: "No active staff profiles found", variant: "destructive" });
        setProcessing(false);
        return;
      }

      const monthStart = `${selectedMonth}-01`;
      const nextMonth = new Date(parseInt(selectedMonth.split("-")[0]), parseInt(selectedMonth.split("-")[1]), 1);
      const monthEnd = nextMonth.toISOString().split("T")[0];

      const { data: allAttendance } = await (supabase as any)
        .from("staff_attendance")
        .select("user_id, status, overtime_hours")
        .eq("hospital_id", hospitalId)
        .gte("attendance_date", monthStart)
        .lt("attendance_date", monthEnd);

      const items: PayrollItem[] = profiles.map((sp: any) => {
        const userAtt = (allAttendance || []).filter((a: any) => a.user_id === sp.user_id);
        const presentDays = userAtt.filter((a: any) => a.status === "present" || a.status === "late").length;
        const leaveDays = userAtt.filter((a: any) => a.status === "on_leave").length;
        const absentDaysExplicit = userAtt.filter((a: any) => a.status === "absent").length;
        const otHours = userAtt.reduce((sum: number, a: any) => sum + (parseFloat(a.overtime_hours) || 0), 0);

        // FIX: missing attendance rows = "assume present". Only explicit "absent" rows reduce paid days.
        const paidDays = Math.max(0, workingDays - absentDaysExplicit);
        const displayPresent = userAtt.length === 0 ? workingDays : presentDays;
        const displayAbsent = absentDaysExplicit;

        const basicSalary = Number(sp.basic_salary) || 0;
        const salaryMissing = basicSalary <= 0;

        const perDay = basicSalary / workingDays;
        const basic = Math.round(paidDays * perDay * 100) / 100;
        const hra = Math.round(basic * ((sp.hra_percent || 20) / 100) * 100) / 100;
        const da = Math.round(basic * ((sp.da_percent || 10) / 100) * 100) / 100;
        const conv = absentDaysExplicit > 3 ? Math.round((sp.conveyance || 1600) * (paidDays / workingDays) * 100) / 100 : (sp.conveyance || 1600);
        const med = sp.medical_allowance || 1250;
        const otAmount = Math.round(otHours * (perDay / 8) * 1.5 * 100) / 100;
        const gross = salaryMissing ? 0 : basic + hra + da + conv + med + otAmount;

        const pfEmp = !salaryMissing && sp.pf_applicable ? Math.min(Math.round(basic * 0.12 * 100) / 100, 1800) : 0;
        const esicEmp = !salaryMissing && sp.esic_applicable && gross <= 21000 ? Math.round(gross * 0.0075 * 100) / 100 : 0;
        const pt = salaryMissing ? 0 : professionalTax(gross);
        const totalDed = pfEmp + esicEmp + pt;
        const net = Math.round((gross - totalDed) * 100) / 100;

        return {
          id: sp.id,
          user_id: sp.user_id,
          full_name: sp.users?.full_name || "Unknown",
          present_days: displayPresent,
          absent_days: displayAbsent,
          leave_days: leaveDays,
          overtime_hours: otHours,
          basic, hra, da, conveyance: salaryMissing ? 0 : conv, medical_allowance: salaryMissing ? 0 : med,
          overtime_amount: otAmount,
          gross_salary: gross,
          pf_employee: pfEmp,
          esic_employee: esicEmp,
          professional_tax: pt,
          tds: 0,
          total_deductions: totalDed,
          net_salary: net,
          payment_status: "pending",
          salary_missing: salaryMissing,
        };
      });

      setCalculatedItems(items);
    } catch (err) {
      toast({ title: "Error calculating payroll", variant: "destructive" });
    }
    setProcessing(false);
  };

  const savePayroll = async () => {
    setProcessing(true);
    try {
      const { data: user } = await supabase.auth.getUser();
      const { data: currentUser } = await supabase.from("users").select("id, hospital_id").eq("auth_user_id", user.user?.id || "").maybeSingle();
      if (!currentUser) throw new Error("No user");

      // Skip staff with missing salary master — never insert ₹0 payslips silently
      const validItems = calculatedItems.filter((i) => !i.salary_missing);
      if (validItems.length === 0) {
        toast({ title: "No staff with salary configured. Set Basic Salary in Staff Directory first.", variant: "destructive" });
        setProcessing(false);
        return;
      }

      const totalGross = validItems.reduce((s, i) => s + i.gross_salary, 0);
      const totalDed = validItems.reduce((s, i) => s + i.total_deductions, 0);
      const totalNet = validItems.reduce((s, i) => s + i.net_salary, 0);

      const { data: run, error: runErr } = await (supabase as any).from("payroll_runs").insert({
        hospital_id: currentUser.hospital_id,
        run_month: selectedMonth,
        total_gross: totalGross,
        total_deductions: totalDed,
        total_net: totalNet,
        staff_count: validItems.length,
        status: "processed",
        processed_by: currentUser.id,
      }).select().maybeSingle();

      if (runErr) throw runErr;

      const items = validItems.map((i) => ({
        hospital_id: currentUser.hospital_id,
        payroll_run_id: run.id,
        user_id: i.user_id,
        present_days: i.present_days,
        absent_days: i.absent_days,
        leave_days: i.leave_days,
        overtime_hours: i.overtime_hours,
        basic: i.basic, hra: i.hra, da: i.da,
        conveyance: i.conveyance, medical_allowance: i.medical_allowance,
        overtime_amount: i.overtime_amount,
        gross_salary: i.gross_salary,
        pf_employee: i.pf_employee, pf_employer: 0,
        esic_employee: i.esic_employee, esic_employer: 0,
        tds: i.tds, total_deductions: i.total_deductions,
        net_salary: i.net_salary,
        payment_status: "pending",
      }));

      await (supabase as any).from("payroll_items").insert(items);

      const skipped = calculatedItems.length - validItems.length;
      toast({
        title: `Payroll processed for ${validItems.length} staff${skipped > 0 ? ` (${skipped} skipped — salary not set)` : ""}`,
      });
      setShowModal(false);
      setCalculatedItems([]);
      loadRuns();
    } catch (err: any) {
      toast({ title: "Error saving payroll: " + err.message, variant: "destructive" });
    }
    setProcessing(false);
  };

  const viewRun = async (runId: string) => {
    setActiveRunId(runId);
    setShowViewDialog(true);
    setViewLoading(true);
    setViewItems([]);
    const { data, error } = await (supabase as any)
      .from("payroll_items")
      .select("*, users!payroll_items_user_id_fkey(full_name), staff_profiles!payroll_items_user_id_fkey(employee_id, designation, departments(name))")
      .eq("payroll_run_id", runId);

    if (error) {
      toast({ title: "Failed to load payroll details", description: error.message, variant: "destructive" });
      setViewLoading(false);
      return;
    }

    setViewItems((data || []).map((d: any) => ({
      ...d,
      full_name: d.users?.full_name || "Unknown",
      _employee_id: d.staff_profiles?.employee_id || null,
      _designation: d.staff_profiles?.designation || null,
      _department: d.staff_profiles?.departments?.name || null,
    })));
    setViewLoading(false);
  };

  const downloadPayrollPDF = async (runId: string) => {
    const run = runs.find((r) => r.id === runId);
    if (!run) return;

    const { data: items } = await (supabase as any)
      .from("payroll_items")
      .select("*, users!payroll_items_user_id_fkey(full_name), staff_profiles!payroll_items_user_id_fkey(employee_id, departments(name))")
      .eq("payroll_run_id", runId);

    if (!items || items.length === 0) {
      toast({ title: "No payroll details to export", variant: "destructive" });
      return;
    }

    let hospitalName = "Hospital";
    let hospitalAddress = "";
    if (hospitalId) {
      const { data: h } = await (supabase as any).from("hospitals").select("name, address").eq("id", hospitalId).maybeSingle();
      if (h) { hospitalName = h.name || "Hospital"; hospitalAddress = h.address || ""; }
    }

    const totalGross = items.reduce((s: number, i: any) => s + Number(i.gross_salary || 0), 0);
    const totalBasic = items.reduce((s: number, i: any) => s + Number(i.basic || 0), 0);
    const totalPF = items.reduce((s: number, i: any) => s + Number(i.pf_employee || 0), 0);
    const totalESIC = items.reduce((s: number, i: any) => s + Number(i.esic_employee || 0), 0);
    const totalDed = items.reduce((s: number, i: any) => s + Number(i.total_deductions || 0), 0);
    const totalNet = items.reduce((s: number, i: any) => s + Number(i.net_salary || 0), 0);

    const esc = (s: any) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const rows = items.map((it: any, idx: number) => `
      <tr>
        <td>${idx + 1}</td>
        <td>${esc(it.staff_profiles?.employee_id || "—")}</td>
        <td>${esc(it.users?.full_name || "Unknown")}</td>
        <td>${esc(it.staff_profiles?.departments?.name || "—")}</td>
        <td style="text-align:center">${it.present_days || 0}/${it.absent_days || 0}/${it.leave_days || 0}</td>
        <td class="amount" style="text-align:right">${printAmount(Number(it.basic || 0))}</td>
        <td class="amount" style="text-align:right">${printAmount(Number(it.gross_salary || 0))}</td>
        <td class="amount" style="text-align:right">${printAmount(Number(it.pf_employee || 0))}</td>
        <td class="amount" style="text-align:right">${printAmount(Number(it.esic_employee || 0))}</td>
        <td class="amount" style="text-align:right">${printAmount(Number(it.total_deductions || 0))}</td>
        <td class="amount" style="text-align:right;font-weight:700">${printAmount(Number(it.net_salary || 0))}</td>
      </tr>`).join("");

    const body = `
      ${printHeader(hospitalName, "Payroll Register", `<p style="font-size:12px;color:#475569;margin-top:4px;">${esc(hospitalAddress)}</p>`)}
      <div style="display:flex;justify-content:space-between;margin-bottom:12px;font-size:12px;flex-wrap:wrap;gap:8px;">
        <div><strong>Pay Month:</strong> ${esc(run.run_month)}</div>
        <div><strong>Run Date:</strong> ${new Date(run.run_date || Date.now()).toLocaleDateString("en-IN")}</div>
        <div><strong>Status:</strong> <span class="badge">${esc(run.status)}</span></div>
        <div><strong>Total Staff:</strong> ${run.staff_count}</div>
      </div>
      <table>
        <thead>
          <tr>
            <th>#</th><th>Emp ID</th><th>Name</th><th>Dept</th>
            <th style="text-align:center">P/A/L</th>
            <th style="text-align:right">Basic</th>
            <th style="text-align:right">Gross</th>
            <th style="text-align:right">PF</th>
            <th style="text-align:right">ESIC</th>
            <th style="text-align:right">Deductions</th>
            <th style="text-align:right">Net Pay</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
          <tr style="background:#f1f5f9;font-weight:bold;border-top:2px solid #1A2F5A;">
            <td colspan="5" style="text-align:right">TOTAL</td>
            <td class="amount" style="text-align:right">${printAmount(totalBasic)}</td>
            <td class="amount" style="text-align:right">${printAmount(totalGross)}</td>
            <td class="amount" style="text-align:right">${printAmount(totalPF)}</td>
            <td class="amount" style="text-align:right">${printAmount(totalESIC)}</td>
            <td class="amount" style="text-align:right">${printAmount(totalDed)}</td>
            <td class="amount" style="text-align:right">${printAmount(totalNet)}</td>
          </tr>
        </tbody>
      </table>
      <div style="margin-top:20px;font-size:11px;color:#64748b;">
        <p>To save as PDF: in the print dialog, set destination to <strong>"Save as PDF"</strong>.</p>
      </div>
    `;

    printDocument(`Payroll Register — ${run.run_month}`, body, { width: 1100, height: 800 });
  };

  const downloadPayslip = async (item: any) => {
    const run = runs.find((r) => r.id === activeRunId);
    if (!run) {
      toast({ title: "Payroll run not found", variant: "destructive" });
      return;
    }
    // Fetch hospital info
    const { data: u } = await supabase.auth.getUser();
    const { data: cu } = await supabase.from("users").select("hospital_id").eq("auth_user_id", u.user?.id || "").maybeSingle();
    let hospitalName = "Hospital";
    let hospitalAddress: string | undefined;
    let hospitalGstin: string | undefined;
    if (cu?.hospital_id) {
      const { data: h } = await (supabase as any).from("hospitals").select("name, address, gstin").eq("id", cu.hospital_id).maybeSingle();
      if (h) { hospitalName = h.name || "Hospital"; hospitalAddress = h.address; hospitalGstin = h.gstin; }
    }
    const pf = Number(item.pf_employee) || 0;
    const esic = Number(item.esic_employee) || 0;
    const tds = Number(item.tds) || 0;
    const totalDed = Number(item.total_deductions) || 0;
    const pt = Math.max(0, Math.round((totalDed - pf - esic - tds) * 100) / 100);

    printPayslip(
      {
        full_name: item.full_name,
        employee_id: item._employee_id,
        designation: item._designation,
        department: item._department,
        payment_mode: "Bank Transfer",
      },
      {
        month: run.run_month,
        working_days: undefined,
        paid_days: (item.present_days || 0) + (item.leave_days || 0),
        basic: Number(item.basic) || 0,
        hra: Number(item.hra) || 0,
        da: Number(item.da) || 0,
        conveyance: Number(item.conveyance) || 0,
        medical_allowance: Number(item.medical_allowance) || 0,
        overtime_amount: Number(item.overtime_amount) || 0,
        gross_salary: Number(item.gross_salary) || 0,
        pf_employee: pf,
        esic_employee: esic,
        professional_tax: pt,
        tds,
        total_deductions: totalDed,
        net_salary: Number(item.net_salary) || 0,
      },
      { name: hospitalName, address: hospitalAddress, gstin: hospitalGstin }
    );
  };

  const approveRun = async (runId: string) => {
    await (supabase as any).from("payroll_runs").update({ status: "approved" }).eq("id", runId);
    
    // Auto-post journal entry for payroll
    const run = runs.find(r => r.id === runId);
    if (run) {
      const { data: userData } = await supabase.from("users").select("id, hospital_id").limit(1).maybeSingle();
      if (userData) {
        await autoPostJournalEntry({
          triggerEvent: "payroll_processed",
          sourceModule: "hr",
          sourceId: runId,
          amount: run.total_net,
          description: `Payroll ${run.run_month} - ${run.staff_count} staff`,
          hospitalId: userData.hospital_id,
          postedBy: userData.id,
        });

        // Post the payroll journal entry.
        //
        // This used to be assembled here in the browser against a schema that does not exist
        // (journal_number/status/reference_type, and a "journal_entry_lines" table that is
        // actually journal_line_items), with every error discarded — so payroll silently never
        // reached the GL while this code reported success. Worse, the account codes were
        // hardcoded and wrong for the seeded chart of accounts: 2101 is "Bank Loan" and 2102 is
        // "Equipment Finance Loan", not Salaries/TDS Payable.
        //
        // Posting now happens in post_payroll_journal(), which resolves accounts from the
        // hospital's configured 'payroll_processed' auto_posting_rule — the same mechanism
        // auto_post_bill_journal() already uses for billing — and writes header and lines in one
        // transaction so they can never diverge. It is idempotent per run.
        const totalGross = Number(run.total_gross || 0);

        if (totalGross > 0) {
          const { data: journalId, error: journalError } = await (supabase as any).rpc(
            "post_payroll_journal",
            { p_run_id: runId },
          );

          if (journalError) {
            // Payroll itself is already approved; surface the accounting failure rather than
            // claiming success, so it can be corrected instead of silently going missing.
            toast({
              title: "Payroll approved, but the journal entry was not posted",
              description: journalError.message,
              variant: "destructive",
            });
          } else if (journalId) {
            toast({ title: "Payroll journal entry posted to accounts" });
          } else {
            // No 'payroll_processed' auto-posting rule configured for this hospital. The RPC
            // deliberately does not fail in this case, so approval is not blocked by an
            // accounting misconfiguration.
            toast({
              title: "Payroll approved — no journal entry posted",
              description:
                "No 'payroll_processed' auto-posting rule is configured for this hospital. Set one up in Accounts to post payroll to the ledger.",
            });
          }
        }
      }
    }

    toast({ title: "Payroll approved" });
    loadRuns();
  };

  const toggleHold = async (itemId: string, current: string) => {
    const next = current === "hold" ? "pending" : "hold";
    await (supabase as any).from("payroll_items").update({ payment_status: next }).eq("id", itemId);
    if (activeRunId) viewRun(activeRunId);
  };

  const calculateGratuity = () => {
    const { employee, serviceFrom, serviceTo, lastBasic } = gratuity;
    if (!serviceFrom || !serviceTo || !lastBasic) {
      toast({ title: "Please fill all fields", variant: "destructive" }); return;
    }
    const from = new Date(serviceFrom);
    const to = new Date(serviceTo);
    const msPerYear = 1000 * 60 * 60 * 24 * 365.25;
    const years = (to.getTime() - from.getTime()) / msPerYear;
    if (years < 5) {
      toast({ title: "Gratuity requires minimum 5 years of service", variant: "destructive" }); return;
    }
    const basic = Number(lastBasic);
    const amount = Math.round((basic * 15 / 26) * Math.floor(years));
    setGratuity(g => ({ ...g, result: amount, yearsOfService: Math.floor(years) }));
  };

  const printGratuityCertificate = async () => {
    const { employee, serviceFrom, serviceTo, result, yearsOfService, lastBasic } = gratuity;
    if (result === null) return;
    let hospitalName = "Hospital", hospitalAddress = "";
    if (hospitalId) {
      const { data: h } = await (supabase as any).from("hospitals").select("name, address").eq("id", hospitalId).maybeSingle();
      if (h) { hospitalName = h.name; hospitalAddress = h.address || ""; }
    }
    const body = `
      ${printHeader(hospitalName, "Gratuity Payment Certificate", `<p style="font-size:11px;color:#64748b;">${hospitalAddress}</p>`)}
      <div style="margin:20px 0;padding:16px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;">
        <h3 style="font-size:14px;font-weight:700;color:#1e293b;margin-bottom:12px;">Certificate of Gratuity Payment</h3>
        <table style="width:100%;font-size:13px;border-collapse:collapse;">
          <tr><td style="padding:4px 8px;color:#64748b;width:40%">Employee Name</td><td style="font-weight:600">${employee?.full_name || "—"}</td></tr>
          <tr><td style="padding:4px 8px;color:#64748b">Date of Joining</td><td>${serviceFrom ? new Date(serviceFrom).toLocaleDateString("en-IN") : "—"}</td></tr>
          <tr><td style="padding:4px 8px;color:#64748b">Date of Leaving</td><td>${serviceTo ? new Date(serviceTo).toLocaleDateString("en-IN") : "—"}</td></tr>
          <tr><td style="padding:4px 8px;color:#64748b">Completed Years of Service</td><td>${yearsOfService} years</td></tr>
          <tr><td style="padding:4px 8px;color:#64748b">Last Basic Salary</td><td>₹${Number(lastBasic).toLocaleString("en-IN")}</td></tr>
          <tr style="background:#dbeafe;"><td style="padding:8px;color:#1e40af;font-weight:700">Gratuity Amount</td><td style="font-weight:700;font-size:15px;color:#1e40af">₹${result.toLocaleString("en-IN")}</td></tr>
        </table>
        <p style="font-size:10px;color:#94a3b8;margin-top:12px;">Formula: (Last Basic × 15/26) × Years of Service — as per Payment of Gratuity Act, 1972</p>
      </div>
      <div style="margin-top:40px;display:flex;justify-content:space-between;font-size:12px;">
        <div style="text-align:center"><div style="border-top:1px solid #334155;width:160px;padding-top:4px;">Employee Signature</div></div>
        <div style="text-align:center"><div style="border-top:1px solid #334155;width:160px;padding-top:4px;">Authorized Signatory</div></div>
      </div>`;
    printDocument("Gratuity Certificate", body);
  };

  const fmt = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  const statusColor = (s: string) => {
    switch (s) {
      case "draft": return "secondary";
      case "processed": return "default";
      case "approved": return "default";
      case "paid": return "default";
      default: return "secondary";
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Retired-engine banner */}
      <div className="flex-shrink-0 bg-amber-50 border-b border-amber-200 flex items-start gap-2 px-5 py-2">
        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
        <span className="text-xs text-amber-800">
          <strong>Retired engine — read-only history.</strong> New payroll is now processed in the{" "}
          <strong>Payroll Run (PF/ESI/TDS)</strong> tab (proper TDS + salary structures + GL posting). Past runs below
          remain viewable and exportable.
        </span>
      </div>

      {/* Header (running new legacy payroll disabled) */}
      <div className="h-12 flex-shrink-0 bg-card border-b border-border flex items-center gap-3 px-5">
        <Input
          type="month"
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
          className="w-44 h-8 text-sm"
          disabled
        />
        <Button size="sm" onClick={openRunModal} disabled title="Use the Payroll Run (PF/ESI/TDS) tab">
          <DollarSign className="h-4 w-4 mr-1" /> Run Payroll (retired)
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-5 space-y-4">
        {/* Previous runs */}
        {runs.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-2">Payroll History</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead>Staff</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Deductions</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.run_month}</TableCell>
                    <TableCell>{r.staff_count}</TableCell>
                    <TableCell className="text-right">{fmt(r.total_gross)}</TableCell>
                    <TableCell className="text-right">{fmt(r.total_deductions)}</TableCell>
                    <TableCell className="text-right font-semibold">{fmt(r.total_net)}</TableCell>
                    <TableCell>
                      <Badge variant={statusColor(r.status)}>{r.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2 flex-wrap">
                        <Button size="sm" variant="outline" onClick={() => viewRun(r.id)} title="View payroll details">
                          <Eye className="h-3 w-3 mr-1" /> View
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => downloadPayrollPDF(r.id)} title="Download payroll register as PDF">
                          <Download className="h-3 w-3 mr-1" /> PDF
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => generateEPFECR(r.id, r.run_month)} title="EPF ECR export for EPFO portal">
                          <FileText className="h-3 w-3 mr-1" /> ECR
                        </Button>
                        <Button size="sm" variant="outline" title="Form 16A — Quarterly TDS cert for consultants" onClick={async () => {
                          const [y, m] = r.run_month.split("-").map(Number);
                          const fy = m >= 4 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
                          const q = m >= 4 && m <= 6 ? "Q1" : m >= 7 && m <= 9 ? "Q2" : m >= 10 && m <= 12 ? "Q3" : "Q4";
                          const { data: h } = await (supabase as any).from("hospitals").select("name, address").eq("id", hospitalId).maybeSingle();
                          await generateForm16A(r.id, q as any, fy, h?.name || "Hospital", h?.address || "");
                        }}>
                          <FileText className="h-3 w-3 mr-1" /> 16A
                        </Button>
                        {r.status === "processed" && (
                          <Button size="sm" variant="outline" onClick={() => approveRun(r.id)}>
                            <CheckSquare className="h-3 w-3 mr-1" /> Approve
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {runs.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <DollarSign className="h-12 w-12 mx-auto mb-3 opacity-40" />
              <p className="text-sm font-medium">No payroll runs yet</p>
              <p className="text-xs mt-1">Click "Run Payroll" to process salaries</p>
            </div>
          </div>
        )}

        {/* Gratuity Calculator */}
        <div className="border border-border rounded-lg overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
            onClick={() => setShowGratuity(v => !v)}
          >
            <div className="flex items-center gap-2">
              <Calculator className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Gratuity Calculator</span>
              <span className="text-xs text-muted-foreground">(Payment of Gratuity Act, 1972)</span>
            </div>
            <span className="text-xs text-muted-foreground">{showGratuity ? "▲" : "▼"}</span>
          </button>
          {showGratuity && (
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Employee</label>
                  <select
                    className="w-full h-8 mt-1 rounded-md border border-input bg-background px-2 text-xs"
                    value={gratuity.employee?.user_id || ""}
                    onChange={e => {
                      const emp = staffOptions.find(s => s.user_id === e.target.value) || null;
                      setGratuity(g => ({
                        ...g, employee: emp,
                        serviceFrom: emp?.joining_date || "",
                        lastBasic: emp ? String(emp.basic_salary) : "",
                        result: null,
                      }));
                    }}
                  >
                    <option value="">Select employee…</option>
                    {staffOptions.map(s => <option key={s.user_id} value={s.user_id}>{s.full_name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Last Basic Salary (₹/month)</label>
                  <input
                    type="number"
                    className="w-full h-8 mt-1 rounded-md border border-input bg-background px-2 text-xs"
                    value={gratuity.lastBasic}
                    onChange={e => setGratuity(g => ({ ...g, lastBasic: e.target.value, result: null }))}
                    placeholder="e.g. 25000"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Date of Joining</label>
                  <input
                    type="date"
                    className="w-full h-8 mt-1 rounded-md border border-input bg-background px-2 text-xs"
                    value={gratuity.serviceFrom}
                    onChange={e => setGratuity(g => ({ ...g, serviceFrom: e.target.value, result: null }))}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Date of Leaving / Today</label>
                  <input
                    type="date"
                    className="w-full h-8 mt-1 rounded-md border border-input bg-background px-2 text-xs"
                    value={gratuity.serviceTo}
                    onChange={e => setGratuity(g => ({ ...g, serviceTo: e.target.value, result: null }))}
                  />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button size="sm" onClick={calculateGratuity}>
                  <Calculator className="h-3.5 w-3.5 mr-1" /> Calculate
                </Button>
                {gratuity.result !== null && (
                  <>
                    <div className="flex-1 bg-blue-50 rounded-md px-3 py-2 flex items-center gap-4">
                      <span className="text-xs text-blue-700">Service: <strong>{gratuity.yearsOfService} years</strong></span>
                      <span className="text-xs text-blue-700">Gratuity Payable: <strong className="text-base">₹{gratuity.result.toLocaleString("en-IN")}</strong></span>
                      <span className="text-xs text-blue-500">= ({gratuity.lastBasic} × 15/26) × {gratuity.yearsOfService}</span>
                    </div>
                    <Button size="sm" variant="outline" onClick={printGratuityCertificate}>
                      <FileText className="h-3.5 w-3.5 mr-1" /> Certificate
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* View Payroll Details Dialog */}
      <Dialog open={showViewDialog} onOpenChange={(open) => { setShowViewDialog(open); if (!open) { setViewItems([]); setActiveRunId(null); } }}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>Payroll Details — {runs.find(r => r.id === activeRunId)?.run_month || ""}</span>
              {activeRunId && (
                <Button size="sm" variant="outline" onClick={() => downloadPayrollPDF(activeRunId)} className="mr-6">
                  <Download className="h-3 w-3 mr-1" /> Download PDF
                </Button>
              )}
            </DialogTitle>
          </DialogHeader>

          {viewLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Loading payroll details...</span>
            </div>
          ) : viewItems.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">No payroll items found for this run.</div>
          ) : (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Staff</TableHead>
                    <TableHead className="text-center">Days (P/A/L)</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">PF</TableHead>
                    <TableHead className="text-right">ESIC</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {viewItems.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.full_name}</TableCell>
                      <TableCell className="text-center text-xs">{item.present_days}/{item.absent_days}/{item.leave_days}</TableCell>
                      <TableCell className="text-right">{fmt(item.gross_salary)}</TableCell>
                      <TableCell className="text-right">{fmt(item.pf_employee)}</TableCell>
                      <TableCell className="text-right">{fmt(item.esic_employee)}</TableCell>
                      <TableCell className="text-right font-semibold">{fmt(item.net_salary)}</TableCell>
                      <TableCell>
                        <Badge variant={item.payment_status === "hold" ? "destructive" : "secondary"}>
                          {item.payment_status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant="ghost" onClick={() => toggleHold(item.id, item.payment_status)}>
                            {item.payment_status === "hold" ? "Release" : "Hold"}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => downloadPayslip(item)} title="Download Payslip">
                            <FileText className="h-3 w-3 mr-1" /> Payslip
                          </Button>
                          <Button size="sm" variant="outline" title="Form 16 (TDS Certificate)" onClick={async () => {
                            const run = runs.find((r) => r.id === activeRunId);
                            if (!run) return;
                            const [y, m] = run.run_month.split("-").map(Number);
                            const fy = m >= 4 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
                            const { data: h } = await (supabase as any).from("hospitals").select("name, address").eq("id", hospitalId).maybeSingle();
                            await generateForm16(item.id, fy, h?.name || "Hospital", h?.address || "");
                          }}>
                            Form 16
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/50 font-semibold">
                    <TableCell>TOTAL</TableCell>
                    <TableCell />
                    <TableCell className="text-right">{fmt(viewItems.reduce((s, i) => s + i.gross_salary, 0))}</TableCell>
                    <TableCell className="text-right">{fmt(viewItems.reduce((s, i) => s + i.pf_employee, 0))}</TableCell>
                    <TableCell className="text-right">{fmt(viewItems.reduce((s, i) => s + i.esic_employee, 0))}</TableCell>
                    <TableCell className="text-right">{fmt(viewItems.reduce((s, i) => s + i.net_salary, 0))}</TableCell>
                    <TableCell colSpan={2} />
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Run Payroll Modal */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Process Payroll — {selectedMonth}</DialogTitle>
          </DialogHeader>

          {calculatedItems.length === 0 ? (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                <p className="text-sm">
                  Attendance marked for <span className="font-semibold text-foreground">{attendanceCount}</span> of{" "}
                  <span className="font-semibold text-foreground">{staffCount}</span> staff
                </p>
                {staffCount > attendanceCount && (
                  <p className="text-xs text-destructive">
                    Missing attendance for {staffCount - attendanceCount} staff — will be treated as absent
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium">Working days this month:</label>
                <Input
                  type="number"
                  value={workingDays}
                  onChange={(e) => setWorkingDays(parseInt(e.target.value) || 26)}
                  className="w-20 h-8"
                />
              </div>
              <Button onClick={calculatePayroll} disabled={processing} className="w-full">
                {processing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Calculate Payroll →
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="overflow-auto max-h-[50vh]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Staff</TableHead>
                      <TableHead className="text-center">P/A/L</TableHead>
                      <TableHead className="text-right">Basic</TableHead>
                      <TableHead className="text-right">Gross</TableHead>
                      <TableHead className="text-right">PF</TableHead>
                      <TableHead className="text-right">ESIC</TableHead>
                      <TableHead className="text-right">Net</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {calculatedItems.map((item) => (
                      <TableRow key={item.user_id} className={item.salary_missing ? "opacity-60" : ""}>
                        <TableCell className="font-medium text-sm">
                          <div className="flex items-center gap-2">
                            <span>{item.full_name}</span>
                            {item.salary_missing && (
                              <Link to="/settings/staff" className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-destructive/10 text-destructive font-medium hover:underline">
                                <AlertTriangle className="h-3 w-3" />
                                Salary not set
                              </Link>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-center text-xs">{item.present_days}/{item.absent_days}/{item.leave_days}</TableCell>
                        <TableCell className="text-right text-sm">{item.salary_missing ? "—" : fmt(item.basic)}</TableCell>
                        <TableCell className="text-right text-sm">{item.salary_missing ? "—" : fmt(item.gross_salary)}</TableCell>
                        <TableCell className="text-right text-sm">{item.salary_missing ? "—" : fmt(item.pf_employee)}</TableCell>
                        <TableCell className="text-right text-sm">{item.salary_missing ? "—" : fmt(item.esic_employee)}</TableCell>
                        <TableCell className="text-right text-sm font-semibold">{item.salary_missing ? "—" : fmt(item.net_salary)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/50 font-bold">
                      <TableCell>TOTAL ({calculatedItems.filter((i) => !i.salary_missing).length} staff{calculatedItems.some((i) => i.salary_missing) ? `, ${calculatedItems.filter((i) => i.salary_missing).length} skipped` : ""})</TableCell>
                      <TableCell />
                      <TableCell className="text-right">{fmt(calculatedItems.reduce((s, i) => s + i.basic, 0))}</TableCell>
                      <TableCell className="text-right">{fmt(calculatedItems.reduce((s, i) => s + i.gross_salary, 0))}</TableCell>
                      <TableCell className="text-right">{fmt(calculatedItems.reduce((s, i) => s + i.pf_employee, 0))}</TableCell>
                      <TableCell className="text-right">{fmt(calculatedItems.reduce((s, i) => s + i.esic_employee, 0))}</TableCell>
                      <TableCell className="text-right">{fmt(calculatedItems.reduce((s, i) => s + i.net_salary, 0))}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setCalculatedItems([])} className="flex-1">← Recalculate</Button>
                <Button onClick={savePayroll} disabled={processing} className="flex-1">
                  {processing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Save & Process Payroll
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PayrollTab;
