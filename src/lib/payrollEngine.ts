/**
 * Statutory Payroll Calculation Engine
 * Covers: PF, ESI, Professional Tax, TDS (New Regime FY 2025-26)
 * References: Income Tax Act, EPF Act, ESI Act, PT state slabs
 */

export interface SalaryStructure {
  basic_pct: number;
  hra_pct: number;          // % of basic
  da_pct: number;           // % of basic
  ta_fixed: number;         // fixed ₹
  special_allowance_pct: number; // residual % of gross
  medical_allowance: number; // fixed ₹ (exempt up to ₹15k/yr)
  lta_annual: number;
  pf_employee_pct: number;  // default 12
  pf_employer_pct: number;  // default 12
  esi_employee_pct: number; // default 0.75
  esi_employer_pct: number; // default 3.25
  pt_state: string | null;
}

export interface AttendanceInput {
  total_days: number;   // working days in month (typically 26)
  present_days: number;
  paid_leaves: number;  // approved paid leaves
  lop_days: number;     // loss of pay days
}

export interface PayslipCalculation {
  // Earnings
  basic: number;
  hra: number;
  da: number;
  ta: number;
  special_allowance: number;
  medical_allowance: number;
  other_allowances: number;
  gross_earned: number;

  // Deductions
  pf_employee: number;
  esi_employee: number;
  pt: number;
  tds_monthly: number;
  total_deductions: number;

  // Employer cost
  pf_employer: number;
  esi_employer: number;

  // Net
  net_pay: number;
}

// ── Professional Tax slabs (major states) ──────────────────────────────────
const PT_SLABS: Record<string, Array<{ upTo: number; monthly: number }>> = {
  KA: [ // Karnataka
    { upTo: 15000, monthly: 0 },
    { upTo: 999999, monthly: 200 },
  ],
  MH: [ // Maharashtra
    { upTo: 7500,  monthly: 0 },
    { upTo: 10000, monthly: 175 },
    { upTo: 999999, monthly: 200 },
  ],
  TN: [ // Tamil Nadu
    { upTo: 3500,  monthly: 0 },
    { upTo: 4999,  monthly: 42 },
    { upTo: 6999,  monthly: 83 },
    { upTo: 9999,  monthly: 125 },
    { upTo: 14999, monthly: 167 },
    { upTo: 999999,monthly: 208 },
  ],
  AP: [ // Andhra Pradesh
    { upTo: 15000, monthly: 0 },
    { upTo: 20000, monthly: 150 },
    { upTo: 999999,monthly: 200 },
  ],
  TS: [ // Telangana (same as AP)
    { upTo: 15000, monthly: 0 },
    { upTo: 20000, monthly: 150 },
    { upTo: 999999,monthly: 200 },
  ],
  GJ: [ // Gujarat
    { upTo: 5999,  monthly: 0 },
    { upTo: 7999,  monthly: 80 },
    { upTo: 9999,  monthly: 150 },
    { upTo: 11999, monthly: 200 },
    { upTo: 999999,monthly: 200 },
  ],
  WB: [ // West Bengal
    { upTo: 8500,  monthly: 0 },
    { upTo: 10000, monthly: 90 },
    { upTo: 15000, monthly: 110 },
    { upTo: 25000, monthly: 130 },
    { upTo: 40000, monthly: 150 },
    { upTo: 999999,monthly: 200 },
  ],
};

function getProfessionalTax(stateCode: string | null, monthlyGross: number): number {
  if (!stateCode) return 0;
  const slabs = PT_SLABS[stateCode.toUpperCase()];
  if (!slabs) return 0;
  for (const slab of slabs) {
    if (monthlyGross <= slab.upTo) return slab.monthly;
  }
  return 0;
}

// ── TDS / Income Tax (New Regime FY 2025-26) ──────────────────────────────
// Slabs effective 1 Feb 2025 Budget
const NEW_REGIME_SLABS_2526 = [
  { upTo: 300000,  rate: 0 },
  { upTo: 700000,  rate: 0.05 },
  { upTo: 1000000, rate: 0.10 },
  { upTo: 1200000, rate: 0.15 },
  { upTo: 1500000, rate: 0.20 },
  { upTo: Infinity, rate: 0.30 },
];

const STANDARD_DEDUCTION = 75000; // FY 2025-26 new regime
const REBATE_87A_LIMIT   = 700000; // Rebate if net taxable ≤ ₹7L

export function calculateAnnualTax(annualTaxableIncome: number): number {
  const taxable = Math.max(0, annualTaxableIncome - STANDARD_DEDUCTION);
  if (taxable <= 0) return 0;

  let tax = 0;
  let prev = 0;
  for (const slab of NEW_REGIME_SLABS_2526) {
    if (taxable <= prev) break;
    const chunk = Math.min(taxable, slab.upTo) - prev;
    tax += chunk * slab.rate;
    prev = slab.upTo;
    if (slab.upTo === Infinity) break;
  }

  // Rebate u/s 87A — no tax if taxable ≤ ₹7L
  if (taxable <= REBATE_87A_LIMIT) tax = 0;

  // Health & Education Cess 4%
  tax = tax * 1.04;

  return Math.round(tax);
}

// ── Main calculation function ──────────────────────────────────────────────
export function calculatePayslip(
  structure: SalaryStructure,
  grossMonthly: number,
  attendance: AttendanceInput,
  ytdGross: number = 0,       // gross earned so far this financial year
  ytdTds: number = 0,         // TDS already deducted this financial year
): PayslipCalculation {

  // Proration factor
  const payDays = attendance.present_days + attendance.paid_leaves;
  const prorateRatio = attendance.total_days > 0
    ? Math.min(payDays / attendance.total_days, 1)
    : 1;

  const grossEarned = round2(grossMonthly * prorateRatio);

  // Breakup of gross
  const basic            = round2(grossEarned * (structure.basic_pct / 100));
  const hra              = round2(basic * (structure.hra_pct / 100));
  const da               = round2(basic * (structure.da_pct / 100));
  const ta               = round2(Math.min(structure.ta_fixed, grossEarned) * prorateRatio);
  const medicalAllowance = round2(Math.min(structure.medical_allowance, grossEarned) * prorateRatio);
  const specialAllowance = round2(
    grossEarned - basic - hra - da - ta - medicalAllowance
  );

  // ── Statutory deductions ────────────────────────────────────────────────

  // PF: 12% of basic, capped at ₹1800/month (₹15000 ceiling wage)
  const pfCeilingBasic  = Math.min(basic, 15000);
  const pfEmployee      = round2(pfCeilingBasic * (structure.pf_employee_pct / 100));
  const pfEmployer      = round2(pfCeilingBasic * (structure.pf_employer_pct / 100));

  // ESI: only if grossEarned ≤ ₹21,000
  let esiEmployee = 0;
  let esiEmployer = 0;
  if (grossEarned <= 21000) {
    esiEmployee = round2(grossEarned * (structure.esi_employee_pct / 100));
    esiEmployer = round2(grossEarned * (structure.esi_employer_pct / 100));
  }

  // Professional Tax
  const pt = getProfessionalTax(structure.pt_state, grossEarned);

  // TDS: annualise remaining income and compute tax for balance months
  // Estimate remaining months in FY (Apr=1 to Mar=12)
  const today = new Date();
  const fiscalMonth = today.getMonth() >= 3
    ? today.getMonth() - 3 + 1   // Apr=1, May=2 ...
    : today.getMonth() + 10;     // Jan=10, Feb=11, Mar=12
  const monthsRemaining = Math.max(1, 13 - fiscalMonth);

  const projectedAnnualGross = ytdGross + (grossEarned * monthsRemaining);
  const annualPf80C          = pfEmployee * 12; // PF is deductible u/s 80C in old regime
                                                   // New regime: no 80C. Standard deduction only.
  const annualTaxable        = projectedAnnualGross;
  const totalAnnualTax       = calculateAnnualTax(annualTaxable);
  const balanceTax           = Math.max(0, totalAnnualTax - ytdTds);
  const tdsMonthly           = round2(balanceTax / monthsRemaining);

  const totalDeductions = round2(pfEmployee + esiEmployee + pt + tdsMonthly);
  const netPay          = round2(grossEarned - totalDeductions);

  return {
    basic,
    hra,
    da,
    ta,
    special_allowance: specialAllowance,
    medical_allowance: medicalAllowance,
    other_allowances:  0,
    gross_earned:      grossEarned,

    pf_employee:   pfEmployee,
    esi_employee:  esiEmployee,
    pt,
    tds_monthly:   tdsMonthly,
    total_deductions: totalDeductions,

    pf_employer:   pfEmployer,
    esi_employer:  esiEmployer,

    net_pay: netPay,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Form 16 / Annual TDS summary ──────────────────────────────────────────
export function computeForm16(
  grossSalary: number,
  pfEmployee: number,
  ptPaid: number,
  ltaExempted: number = 0,
  section80D: number = 0,
): {
  grossTaxable: number;
  standardDeduction: number;
  netTaxableIncome: number;
  taxPayable: number;
  tdsRemark: string;
} {
  const standardDeduction = STANDARD_DEDUCTION; // ₹75k new regime
  const netTaxableIncome  = Math.max(0, grossSalary - standardDeduction);
  const taxPayable        = calculateAnnualTax(netTaxableIncome + standardDeduction);

  return {
    grossTaxable: grossSalary,
    standardDeduction,
    netTaxableIncome,
    taxPayable,
    tdsRemark: taxPayable === 0 ? "No TDS liability (New Regime + 87A Rebate applied)" : "",
  };
}

// ── Payslip HTML for printing ──────────────────────────────────────────────
export function generatePayslipHtml(params: {
  hospitalName: string;
  staffName: string;
  designation: string;
  month: string;
  year: number;
  pan: string;
  pf: string;
  calc: PayslipCalculation;
  attendance: AttendanceInput;
}): string {
  const { hospitalName, staffName, designation, month, year, pan, pf, calc, attendance } = params;

  const inr = (n: number) =>
    `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Payslip — ${staffName} — ${month} ${year}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 12px; color: #111; margin: 0; padding: 20px; }
  h1 { font-size: 16px; margin-bottom: 2px; }
  h2 { font-size: 13px; color: #444; margin: 0 0 16px; }
  .section { display: flex; gap: 24px; margin-bottom: 16px; }
  .col { flex: 1; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th, td { border: 1px solid #ccc; padding: 5px 8px; text-align: left; }
  th { background: #f0f4f8; font-weight: 600; }
  .total-row td { font-weight: bold; background: #f9fafb; }
  .net-row td { font-weight: bold; font-size: 14px; background: #e8f5e9; color: #1b5e20; }
  .kv { display: flex; justify-content: space-between; border-bottom: 1px solid #eee; padding: 3px 0; }
  .kv span:first-child { color: #666; }
  .footer { margin-top: 24px; font-size: 11px; color: #777; border-top: 1px solid #ddd; padding-top: 8px; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
<h1>${hospitalName}</h1>
<h2>Payslip for ${month} ${year}</h2>
<hr/>
<div class="section">
  <div class="col">
    <div class="kv"><span>Employee Name</span><strong>${staffName}</strong></div>
    <div class="kv"><span>Designation</span><span>${designation}</span></div>
    <div class="kv"><span>PAN</span><span>${pan || "—"}</span></div>
    <div class="kv"><span>UAN (PF)</span><span>${pf || "—"}</span></div>
  </div>
  <div class="col">
    <div class="kv"><span>Working Days</span><span>${attendance.total_days}</span></div>
    <div class="kv"><span>Present Days</span><span>${attendance.present_days}</span></div>
    <div class="kv"><span>Paid Leaves</span><span>${attendance.paid_leaves}</span></div>
    <div class="kv"><span>LOP Days</span><span>${attendance.lop_days}</span></div>
  </div>
</div>

<table>
  <tr><th colspan="2">Earnings</th><th colspan="2">Deductions</th></tr>
  <tr>
    <td>Basic Salary</td><td>${inr(calc.basic)}</td>
    <td>Provident Fund (Employee)</td><td>${inr(calc.pf_employee)}</td>
  </tr>
  <tr>
    <td>HRA</td><td>${inr(calc.hra)}</td>
    <td>ESI (Employee)</td><td>${inr(calc.esi_employee)}</td>
  </tr>
  <tr>
    <td>DA</td><td>${inr(calc.da)}</td>
    <td>Professional Tax</td><td>${inr(calc.pt)}</td>
  </tr>
  <tr>
    <td>Transport Allowance</td><td>${inr(calc.ta)}</td>
    <td>TDS (Income Tax)</td><td>${inr(calc.tds_monthly)}</td>
  </tr>
  <tr>
    <td>Special Allowance</td><td>${inr(calc.special_allowance)}</td>
    <td>Other Deductions</td><td>₹0.00</td>
  </tr>
  <tr>
    <td>Medical Allowance</td><td>${inr(calc.medical_allowance)}</td>
    <td></td><td></td>
  </tr>
  <tr class="total-row">
    <td>Gross Earnings</td><td>${inr(calc.gross_earned)}</td>
    <td>Total Deductions</td><td>${inr(calc.total_deductions)}</td>
  </tr>
  <tr class="net-row">
    <td colspan="3"><strong>NET PAY (Take Home)</strong></td>
    <td><strong>${inr(calc.net_pay)}</strong></td>
  </tr>
</table>

<table>
  <tr><th colspan="2">Employer Contributions (Not deducted from salary)</th></tr>
  <tr><td>Employer PF Contribution</td><td>${inr(calc.pf_employer)}</td></tr>
  <tr><td>Employer ESI Contribution</td><td>${inr(calc.esi_employer)}</td></tr>
  <tr class="total-row">
    <td>Cost to Company (CTC) — This Month</td>
    <td>${inr(calc.gross_earned + calc.pf_employer + calc.esi_employer)}</td>
  </tr>
</table>

<p style="font-size:11px;color:#555;font-style:italic;">
  This is a computer-generated payslip and does not require a signature.
  TDS computed under New Tax Regime (FY ${new Date().getFullYear()}-${(new Date().getFullYear() + 1).toString().slice(2)}).
</p>
<div class="footer">
  Generated by Aumrti HMS · ${new Date().toLocaleDateString("en-IN")}
</div>
</body>
</html>`;
}
