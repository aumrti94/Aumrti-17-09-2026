import { supabase } from "@/integrations/supabase/client";
import { printDocument } from "@/lib/printUtils";

const esc = (s: any) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const fmt = (n: number) =>
  "₹" + (n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// EPF ECR (Electronic Challan cum Return) — CSV format per EPFO specification v2.0
export async function generateEPFECR(runId: string, month: string): Promise<void> {
  const { data: items } = await (supabase as any)
    .from("payroll_items")
    .select("*, users!payroll_items_user_id_fkey(full_name), staff_profiles!payroll_items_user_id_fkey(employee_id, uan_number, pan_number)")
    .eq("payroll_run_id", runId);

  if (!items?.length) return;

  const header = [
    "UAN",
    "Member Name",
    "Gross Wages",
    "EPF Wages",
    "EPS Wages",
    "EDLI Wages",
    "EPF Contribution (EE)",
    "EPS Contribution (ER)",
    "EPF Contribution (ER)",
    "NCP Days",
    "Refund of Advances",
  ].join(",");

  const rows = items.map((i: any) => {
    const uan = i.staff_profiles?.uan_number || "";
    const name = i.users?.full_name || "Unknown";
    const gross = Number(i.gross_salary || 0).toFixed(2);
    const epfWages = Number(i.basic || 0).toFixed(2);
    const epsWages = Math.min(Number(i.basic || 0), 15000).toFixed(2);
    const edliWages = Math.min(Number(i.basic || 0), 15000).toFixed(2);
    const eeEpf = Number(i.pf_employee || 0).toFixed(2);
    // ER EPS = 8.33% of basic capped at 15000
    const erEps = (Math.min(Number(i.basic || 0), 15000) * 0.0833).toFixed(2);
    // ER EPF = 3.67% of basic (12% - 8.33%)
    const erEpf = (Number(i.basic || 0) * 0.0367).toFixed(2);
    const ncpDays = Number(i.absent_days || 0);

    return [uan, `"${name}"`, gross, epfWages, epsWages, edliWages, eeEpf, erEps, erEpf, ncpDays, "0"].join(",");
  });

  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `EPF_ECR_${month}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Form 16 — Annual TDS Certificate (Part A + Part B) per IT Act Section 203
export async function generateForm16(
  runId: string,
  financialYear: string,
  hospitalName: string,
  hospitalAddress: string,
  hospitalPan?: string,
  hospitalTan?: string
): Promise<void> {
  // Fetch single run item (called per employee from the payslip view)
  const { data: item } = await (supabase as any)
    .from("payroll_items")
    .select("*, users!payroll_items_user_id_fkey(full_name), staff_profiles!payroll_items_user_id_fkey(employee_id, designation, pan_number, uan_number)")
    .eq("id", runId)
    .maybeSingle();

  if (!item) return;

  const empName = item.users?.full_name || "Employee";
  const empPan = item.staff_profiles?.pan_number || "—";
  const empDesig = item.staff_profiles?.designation || "—";
  const empId = item.staff_profiles?.employee_id || "—";

  // Annual figures — for a single month, multiply by 12 as an estimate;
  // in production the caller should pass aggregated annual data
  const gross = Number(item.gross_salary || 0);
  const basic = Number(item.basic || 0);
  const hra = Number(item.hra || 0);
  const da = Number(item.da || 0);
  const conv = Number(item.conveyance || 0);
  const med = Number(item.medical_allowance || 0);
  const tds = Number(item.tds || 0);

  const html = `<!DOCTYPE html>
<html><head><title>Form 16 — ${esc(empName)} — FY ${esc(financialYear)}</title>
<style>
  @page { size: A4; margin: 15mm; }
  body { font-family: Arial, sans-serif; font-size: 11px; color: #1e293b; }
  h2 { text-align: center; font-size: 15px; margin: 0 0 4px; }
  .sub { text-align: center; font-size: 12px; color: #475569; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  td, th { border: 1px solid #94a3b8; padding: 5px 8px; }
  th { background: #f1f5f9; font-weight: 600; text-align: left; }
  .section-head { background: #1A2F5A; color: white; font-weight: bold; padding: 6px 8px; font-size: 12px; }
  .right { text-align: right; }
  .footer { margin-top: 30px; font-size: 10px; color: #64748b; text-align: center; border-top: 1px dashed #cbd5e1; padding-top: 10px; }
  .sign-box { margin-top: 40px; display: flex; justify-content: space-between; font-size: 11px; }
  .sign-line { border-top: 1px solid #1e293b; width: 200px; text-align: center; padding-top: 4px; }
</style>
</head><body>
<h2>FORM 16</h2>
<div class="sub">Certificate under section 203 of the Income-tax Act, 1961<br/>
for tax deducted at source from income chargeable under the head "Salaries"</div>

<div class="section-head">PART A — Details of Tax Deducted and Deposited</div>
<table>
  <tr><th>Financial Year</th><td>${esc(financialYear)}</td><th>Assessment Year</th><td>${esc(financialYear.split("-").map((y, i) => i === 0 ? String(parseInt(y) + 1) : y).join("-"))}</td></tr>
  <tr><th>Employer PAN</th><td>${esc(hospitalPan || "—")}</td><th>Employer TAN</th><td>${esc(hospitalTan || "—")}</td></tr>
  <tr><th>Employer Name</th><td colspan="3">${esc(hospitalName)}</td></tr>
  <tr><th>Employer Address</th><td colspan="3">${esc(hospitalAddress)}</td></tr>
  <tr><th>Employee Name</th><td>${esc(empName)}</td><th>Employee PAN</th><td>${esc(empPan)}</td></tr>
  <tr><th>Employee ID</th><td>${esc(empId)}</td><th>Designation</th><td>${esc(empDesig)}</td></tr>
</table>

<table>
  <tr><th>Quarter</th><th class="right">Amount of TDS (₹)</th><th>Challan Identification Number</th></tr>
  <tr><td>Q1 (Apr–Jun)</td><td class="right">${fmt(tds * 3)}</td><td>—</td></tr>
  <tr><td>Q2 (Jul–Sep)</td><td class="right">${fmt(tds * 3)}</td><td>—</td></tr>
  <tr><td>Q3 (Oct–Dec)</td><td class="right">${fmt(tds * 3)}</td><td>—</td></tr>
  <tr><td>Q4 (Jan–Mar)</td><td class="right">${fmt(tds * 3)}</td><td>—</td></tr>
  <tr><th colspan="1">Total TDS Deducted</th><th class="right">${fmt(tds * 12)}</th><th></th></tr>
</table>

<div class="section-head">PART B — Details of Salary Paid and Deductions</div>
<table>
  <tr><th colspan="2">Gross Salary (Annual)</th></tr>
  <tr><td>Basic Salary</td><td class="right">${fmt(basic * 12)}</td></tr>
  <tr><td>House Rent Allowance (HRA)</td><td class="right">${fmt(hra * 12)}</td></tr>
  <tr><td>Dearness Allowance (DA)</td><td class="right">${fmt(da * 12)}</td></tr>
  <tr><td>Conveyance Allowance</td><td class="right">${fmt(conv * 12)}</td></tr>
  <tr><td>Medical Allowance</td><td class="right">${fmt(med * 12)}</td></tr>
  <tr><th>Gross Total Income</th><th class="right">${fmt(gross * 12)}</th></tr>
</table>

<table>
  <tr><th colspan="2">Deductions under Chapter VI-A</th></tr>
  <tr><td>Section 80C — EPF Employee Contribution</td><td class="right">${fmt(Number(item.pf_employee || 0) * 12)}</td></tr>
  <tr><td>Section 80D — Medical Insurance (if declared)</td><td class="right">—</td></tr>
  <tr><th>Total Deductions</th><th class="right">${fmt(Number(item.pf_employee || 0) * 12)}</th></tr>
</table>

<table>
  <tr><th>Taxable Income</th><th class="right">${fmt(Math.max(0, gross * 12 - Number(item.pf_employee || 0) * 12))}</th></tr>
  <tr><th>Tax Payable / TDS Deducted</th><th class="right">${fmt(tds * 12)}</th></tr>
</table>

<div class="sign-box">
  <div>
    <div class="sign-line">Employee Signature</div>
    <div style="margin-top:4px;">${esc(empName)}</div>
  </div>
  <div>
    <div class="sign-line">Employer / Authorised Signatory</div>
    <div style="margin-top:4px;">${esc(hospitalName)}</div>
  </div>
</div>

<div class="footer">
  This is a system-generated Form 16. Verify TDS amounts with actual challan details before filing ITR.<br/>
  Generated on ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })}
</div>
</body></html>`;

  printDocument(`Form16_${empName}_${financialYear}`, html, { width: 900, height: 750 });
}

// Form 16A — Quarterly TDS Certificate for Consultant/Professional fees (Section 194J)
export async function generateForm16A(
  payrollRunId: string,
  quarter: "Q1" | "Q2" | "Q3" | "Q4",
  financialYear: string,
  hospitalName: string,
  hospitalAddress: string,
  hospitalPan?: string,
  hospitalTan?: string
): Promise<void> {
  // Fetch all consultant payroll items for the run
  const { data: items } = await (supabase as any)
    .from("payroll_items")
    .select("*, users!payroll_items_user_id_fkey(full_name), staff_profiles!payroll_items_user_id_fkey(employee_id, designation, pan_number, employee_type)")
    .eq("payroll_run_id", payrollRunId)
    .eq("staff_profiles.employee_type", "consultant");

  const consultants = (items || []).filter((i: any) => i.staff_profiles?.employee_type === "consultant");

  if (!consultants.length) return;

  const quarterLabel: Record<string, string> = {
    Q1: "April to June", Q2: "July to September", Q3: "October to December", Q4: "January to March",
  };

  const rows = consultants.map((i: any) => {
    const gross = Number(i.gross_salary || 0);
    const tds = Math.round(gross * 0.1 * 100) / 100;
    return `<tr>
      <td>${esc(i.users?.full_name || "—")}</td>
      <td>${esc(i.staff_profiles?.pan_number || "—")}</td>
      <td>${esc(i.staff_profiles?.designation || "Consultant")}</td>
      <td class="right">${fmt(gross)}</td>
      <td class="right">10%</td>
      <td class="right">${fmt(tds)}</td>
    </tr>`;
  }).join("");

  const totalGross = consultants.reduce((s: number, i: any) => s + Number(i.gross_salary || 0), 0);
  const totalTds = Math.round(totalGross * 0.1 * 100) / 100;

  const html = `<!DOCTYPE html>
<html><head><title>Form 16A — ${quarter} FY ${esc(financialYear)}</title>
<style>
  @page { size: A4; margin: 15mm; }
  body { font-family: Arial, sans-serif; font-size: 11px; color: #1e293b; }
  h2 { text-align: center; font-size: 15px; margin: 0 0 4px; }
  .sub { text-align: center; font-size: 12px; color: #475569; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  td, th { border: 1px solid #94a3b8; padding: 5px 8px; }
  th { background: #f1f5f9; font-weight: 600; text-align: left; }
  .section-head { background: #1A2F5A; color: white; font-weight: bold; padding: 6px 8px; font-size: 12px; margin-bottom: 0; }
  .right { text-align: right; }
  .footer { margin-top: 20px; font-size: 10px; color: #64748b; text-align: center; border-top: 1px dashed #cbd5e1; padding-top: 10px; }
  .sign-box { margin-top: 30px; display: flex; justify-content: space-between; font-size: 11px; }
  .sign-line { border-top: 1px solid #1e293b; width: 200px; text-align: center; padding-top: 4px; }
</style></head><body>

<h2>FORM 16A</h2>
<div class="sub">
  Certificate under section 203 of the Income-tax Act, 1961 for tax deducted at source<br/>
  on income other than "Salaries" — Section 194J (Professional/Technical Fees)
</div>

<div class="section-head">Deductor (Employer) Details</div>
<table>
  <tr><th>Name</th><td>${esc(hospitalName)}</td><th>PAN</th><td>${esc(hospitalPan || "—")}</td></tr>
  <tr><th>Address</th><td>${esc(hospitalAddress)}</td><th>TAN</th><td>${esc(hospitalTan || "—")}</td></tr>
  <tr><th>Financial Year</th><td>${esc(financialYear)}</td><th>Quarter</th><td>${quarter} — ${quarterLabel[quarter]}</td></tr>
</table>

<div class="section-head">Deductee (Consultant) Details — TDS Summary</div>
<table>
  <thead>
    <tr>
      <th>Consultant Name</th>
      <th>PAN</th>
      <th>Nature of Work</th>
      <th class="right">Fees Paid (₹)</th>
      <th class="right">TDS Rate</th>
      <th class="right">TDS Deducted (₹)</th>
    </tr>
  </thead>
  <tbody>
    ${rows}
    <tr style="font-weight:700;background:#f1f5f9;">
      <td colspan="3">Total</td>
      <td class="right">${fmt(totalGross)}</td>
      <td></td>
      <td class="right">${fmt(totalTds)}</td>
    </tr>
  </tbody>
</table>

<p style="font-size:10px;color:#475569;">Section 194J — TDS at 10% on professional/technical service fees exceeding ₹30,000 per financial year.</p>

<div class="sign-box">
  <div><div class="sign-line">Authorised Signatory</div><div style="margin-top:4px;">${esc(hospitalName)}</div></div>
  <div><div class="sign-line">Date</div><div style="margin-top:4px;">${new Date().toLocaleDateString("en-IN")}</div></div>
</div>

<div class="footer">System-generated Form 16A. Verify challan details before submission. Generated: ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })}</div>
</body></html>`;

  printDocument(`Form16A_${quarter}_${financialYear}`, html, { width: 900, height: 700 });
}
