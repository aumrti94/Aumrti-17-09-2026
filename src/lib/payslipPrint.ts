/**
 * Payslip generator — A4 HTML payslip with browser print.
 * Statutory requirement under Payment of Wages Act.
 */

const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen"];
const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n: number): string {
  if (n < 20) return ones[n];
  const t = Math.floor(n / 10), o = n % 10;
  return tens[t] + (o ? "-" + ones[o] : "");
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100), r = n % 100;
  let s = "";
  if (h) s += ones[h] + " Hundred";
  if (r) s += (h ? " and " : "") + twoDigits(r);
  return s;
}

/** Convert number to Indian Rupee words. e.g. 45320 → "Forty-Five Thousand Three Hundred and Twenty Rupees Only" */
export function numberToWords(num: number): string {
  if (!num || num <= 0) return "Zero Rupees Only";
  const n = Math.floor(num);
  const paise = Math.round((num - n) * 100);

  if (n === 0 && paise === 0) return "Zero Rupees Only";

  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const remainder = n % 1000;

  const parts: string[] = [];
  if (crore) parts.push(twoDigits(crore) + " Crore");
  if (lakh) parts.push(twoDigits(lakh) + " Lakh");
  if (thousand) parts.push(twoDigits(thousand) + " Thousand");
  if (remainder) parts.push(threeDigits(remainder));

  let result = parts.join(" ").trim() + " Rupees";
  if (paise) result += " and " + twoDigits(paise) + " Paise";
  return result + " Only";
}

export interface PayslipStaff {
  full_name: string;
  employee_id?: string | null;
  designation?: string | null;
  department?: string | null;
  pan?: string | null;
  uan?: string | null;
  payment_mode?: string | null;
}

export interface PayslipRecord {
  month: string;          // "2025-04"
  working_days?: number;
  paid_days?: number;
  basic: number;
  hra: number;
  da?: number;
  conveyance?: number;
  medical_allowance?: number;
  special_allowance?: number;
  overtime_amount?: number;
  gross_salary: number;
  pf_employee: number;
  esic_employee: number;
  professional_tax?: number;
  tds?: number;
  total_deductions: number;
  net_salary: number;
}

export interface PayslipHospital {
  name: string;
  address?: string;
  gstin?: string;
}

const fmt = (n: number) =>
  "₹" + (n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const escapeHtml = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function monthLabel(monthStr: string): { name: string; year: string; days: number } {
  const [y, m] = monthStr.split("-").map(Number);
  const name = new Date(y, (m || 1) - 1, 1).toLocaleString("en-IN", { month: "long" });
  const days = new Date(y, m || 1, 0).getDate();
  return { name, year: String(y), days };
}

export function printPayslip(
  staff: PayslipStaff,
  rec: PayslipRecord,
  hospital: PayslipHospital
) {
  const { name: monthName, year, days } = monthLabel(rec.month);

  const earnings: Array<[string, number]> = [
    ["Basic Salary", rec.basic],
    ["HRA", rec.hra],
    ["DA", rec.da || 0],
    ["Conveyance", rec.conveyance || 0],
    ["Medical Allowance", rec.medical_allowance || 0],
    ["Special Allowance", rec.special_allowance || 0],
    ["Overtime", rec.overtime_amount || 0],
  ].filter(([, v]) => (v as number) > 0) as Array<[string, number]>;

  const deductions: Array<[string, number]> = [
    ["PF (12%)", rec.pf_employee],
    ["ESIC (0.75%)", rec.esic_employee],
    ["Professional Tax", rec.professional_tax || 0],
    ["TDS", rec.tds || 0],
  ].filter(([, v]) => (v as number) > 0) as Array<[string, number]>;

  const earnRows = earnings.map(([k, v]) =>
    `<tr><td>${escapeHtml(k)}</td><td class="amt">${fmt(v)}</td></tr>`).join("");
  const dedRows = deductions.map(([k, v]) =>
    `<tr><td>${escapeHtml(k)}</td><td class="amt">${fmt(v)}</td></tr>`).join("");

  // Pad shorter column to align rows
  const maxRows = Math.max(earnings.length, deductions.length);
  const earnPadding = Array(maxRows - earnings.length).fill(`<tr><td>&nbsp;</td><td></td></tr>`).join("");
  const dedPadding = Array(maxRows - deductions.length).fill(`<tr><td>&nbsp;</td><td></td></tr>`).join("");

  const html = `<!DOCTYPE html>
<html><head><title>Payslip — ${escapeHtml(staff.full_name)} — ${monthName} ${year}</title>
<style>
  @page { size: A4; margin: 18mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1e293b; margin: 0; padding: 0; font-size: 12px; }
  .slip { max-width: 760px; margin: 0 auto; border: 2px solid #1A2F5A; }
  .header { background: #1A2F5A; color: white; padding: 14px 20px; display: flex; justify-content: space-between; align-items: center; }
  .header h1 { margin: 0; font-size: 18px; }
  .header .sub { font-size: 11px; opacity: 0.85; margin-top: 2px; }
  .header .badge { background: white; color: #1A2F5A; padding: 6px 14px; font-weight: bold; font-size: 14px; letter-spacing: 1px; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 20px; padding: 12px 20px; border-bottom: 1px solid #cbd5e1; background: #f8fafc; font-size: 12px; }
  .meta .label { color: #64748b; font-size: 10px; text-transform: uppercase; }
  .meta .value { font-weight: 600; color: #0f172a; }
  .empinfo { padding: 12px 20px; border-bottom: 1px solid #cbd5e1; display: grid; grid-template-columns: 1fr 1fr; gap: 8px 20px; }
  .empinfo .row { display: flex; justify-content: space-between; font-size: 12px; }
  .empinfo .k { color: #64748b; }
  .empinfo .v { font-weight: 600; }
  .columns { display: grid; grid-template-columns: 1fr 1fr; }
  .col { padding: 0; }
  .col h3 { margin: 0; padding: 8px 14px; background: #f1f5f9; font-size: 11px; text-transform: uppercase; color: #1A2F5A; border-bottom: 1px solid #cbd5e1; letter-spacing: 0.5px; }
  .col table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .col td { padding: 6px 14px; border-bottom: 1px solid #f1f5f9; }
  .col td.amt { text-align: right; font-family: 'Courier New', monospace; font-weight: 600; }
  .col:first-child { border-right: 1px solid #cbd5e1; }
  .totals { display: grid; grid-template-columns: 1fr 1fr; background: #f1f5f9; font-weight: bold; }
  .totals div { padding: 10px 14px; display: flex; justify-content: space-between; font-size: 13px; }
  .totals div:first-child { border-right: 1px solid #cbd5e1; }
  .net { background: #1A2F5A; color: white; padding: 14px 20px; }
  .net .row { display: flex; justify-content: space-between; align-items: center; }
  .net .label { font-size: 13px; opacity: 0.9; }
  .net .amount { font-size: 22px; font-weight: bold; }
  .net .words { margin-top: 6px; font-size: 11px; font-style: italic; opacity: 0.95; }
  .footer { padding: 10px 20px; font-size: 10px; color: #64748b; text-align: center; border-top: 1px dashed #cbd5e1; }
  @media print { body { background: white; } .slip { border: 2px solid #1A2F5A; } .no-print { display: none; } }
</style>
</head><body>
<div class="slip">
  <div class="header">
    <div>
      <h1>${escapeHtml(hospital.name)}</h1>
      ${hospital.address ? `<div class="sub">${escapeHtml(hospital.address)}</div>` : ""}
      ${hospital.gstin ? `<div class="sub">GSTIN: ${escapeHtml(hospital.gstin)}</div>` : ""}
    </div>
    <div class="badge">PAYSLIP</div>
  </div>

  <div class="meta">
    <div><span class="label">Month</span> &nbsp; <span class="value">${monthName} ${year}</span></div>
    <div><span class="label">Pay Period</span> &nbsp; <span class="value">1 – ${days} ${monthName}</span></div>
    <div><span class="label">Working Days</span> &nbsp; <span class="value">${rec.working_days ?? "—"}</span></div>
    <div><span class="label">Paid Days</span> &nbsp; <span class="value">${rec.paid_days ?? "—"}</span></div>
  </div>

  <div class="empinfo">
    <div class="row"><span class="k">Employee Name</span><span class="v">${escapeHtml(staff.full_name)}</span></div>
    <div class="row"><span class="k">Employee ID</span><span class="v">${escapeHtml(staff.employee_id || "—")}</span></div>
    <div class="row"><span class="k">Department</span><span class="v">${escapeHtml(staff.department || "—")}</span></div>
    <div class="row"><span class="k">Designation</span><span class="v">${escapeHtml(staff.designation || "—")}</span></div>
    <div class="row"><span class="k">PAN</span><span class="v">${escapeHtml(staff.pan || "—")}</span></div>
    <div class="row"><span class="k">UAN</span><span class="v">${escapeHtml(staff.uan || "—")}</span></div>
  </div>

  <div class="columns">
    <div class="col">
      <h3>Earnings</h3>
      <table><tbody>${earnRows}${earnPadding}</tbody></table>
    </div>
    <div class="col">
      <h3>Deductions</h3>
      <table><tbody>${dedRows}${dedPadding}</tbody></table>
    </div>
  </div>

  <div class="totals">
    <div><span>GROSS EARNINGS</span><span>${fmt(rec.gross_salary)}</span></div>
    <div><span>TOTAL DEDUCTIONS</span><span>${fmt(rec.total_deductions)}</span></div>
  </div>

  <div class="net">
    <div class="row">
      <span class="label">NET PAY</span>
      <span class="amount">${fmt(rec.net_salary)}</span>
    </div>
    <div class="words">${escapeHtml(numberToWords(rec.net_salary))}</div>
    <div style="margin-top:8px;font-size:11px;opacity:0.9;">Payment Mode: ${escapeHtml(staff.payment_mode || "Bank Transfer")}</div>
  </div>

  <div class="footer">
    This is a computer-generated payslip and does not require a signature.<br/>
    Generated on ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
  </div>
</div>
</body></html>`;

  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) {
    alert("Please allow popups to download the payslip.");
    return;
  }
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => {
    win.print();
  }, 400);
}
