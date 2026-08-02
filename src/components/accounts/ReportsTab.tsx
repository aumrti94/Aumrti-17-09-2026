import React, { useEffect, useState, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Printer, FileSpreadsheet, FileText, Bot, CheckCircle2, XCircle, ChevronDown, ChevronRight, Loader2, Download, Mail, RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { callAI } from "@/lib/aiProvider";
import { fetchLedgerLines, type RawLedgerLine } from "@/lib/financialStatements";
import { splitGst } from "@/lib/gst";
import * as XLSX from "xlsx";
import TrialBalanceTab from "./TrialBalanceTab";
import {
  generateSalesVouchers,
  generateReceiptVouchers,
  generatePurchaseVouchers,
  generateJournalVouchers,
  wrapTDMLEnvelope,
  type TallyBill,
  type TallyPayment,
  type TallyDrugBatch,
  type TallyJournalLine,
  type TallyLedgerMapping,
} from "@/lib/tallyXmlGenerator";
import { useToast } from "@/hooks/use-toast";
import { printDocument } from "@/lib/printUtils";

interface Props {
  hospitalId: string | null;
  dateRange: { start: string; end: string };
}

interface Account {
  id: string;
  code: string;
  name: string;
  account_type: string;
  account_subtype: string | null;
  is_control: boolean;
  is_system: boolean;
  opening_balance: number | null;
}

interface JournalLineDetail {
  id: string;
  account_code: string;
  account_id: string;
  debit_amount: number;
  credit_amount: number;
  created_at: string;
}

interface JournalEntry {
  id: string;
  entry_number: string;
  entry_date: string;
  description: string;
  entry_type: string;
  source_module: string;
}

// ─── P&L account code → label mapping (ordered) ───
const PNL_REVENUE = [
  { code: "4001", label: "OPD Consultation Revenue" },
  { code: "4002", label: "IPD Room & Nursing" },
  { code: "4003", label: "Surgical / OT Revenue" },
  { code: "4004", label: "Laboratory Revenue" },
  { code: "4005", label: "Radiology Revenue" },
  { code: "4006", label: "Pharmacy Revenue - IP" },
  { code: "4007", label: "Pharmacy Revenue - Retail" },
  { code: "4008", label: "Procedure Revenue" },
  { code: "4009", label: "Emergency Revenue" },
  { code: "4010", label: "Insurance / TPA Revenue" },
  { code: "4011", label: "PMJAY / CGHS Revenue" },
];

const PNL_OTHER_INCOME = [{ code: "4020", label: "Other Income" }];

// Module scope: depends on nothing in the component, so hoisting keeps it out of
// every hook's dependency array and stops it being re-allocated each render.
const TDS_CATEGORIES: Record<string, { section: string; rate: number }> = {
  professional_fees: { section: "194J", rate: 10 },
  rent: { section: "194I", rate: 10 },
  contractors: { section: "194C", rate: 2 },
};

const PNL_COS = [
  { code: "5010", label: "Pharmacy Purchase - Drugs" },
  { code: "5011", label: "Medical Consumables" },
  { code: "5012", label: "Surgical Items" },
];

const PNL_PERSONNEL = [
  { code: "5001", label: "Salaries - Doctors" },
  { code: "5002", label: "Salaries - Nurses" },
  { code: "5003", label: "Salaries - Administrative" },
  { code: "5004", label: "Salaries - Support Staff" },
  { code: "5005", label: "PF Employer Contribution" },
  { code: "5006", label: "ESIC Employer Contribution" },
];

const PNL_INFRA = [
  { code: "5020", label: "Rent" },
  { code: "5021", label: "Electricity & Power" },
  { code: "5022", label: "Water Charges" },
  { code: "5023", label: "Telephone & Internet" },
];

const PNL_MAINT = [
  { code: "5030", label: "Equipment Maintenance" },
  { code: "5031", label: "Building Maintenance" },
  { code: "5032", label: "Housekeeping Expenses" },
];

const PNL_ADMIN = [
  { code: "5040", label: "Professional Fees" },
  { code: "5041", label: "Marketing & Advertising" },
  { code: "5042", label: "Printing & Stationery" },
  { code: "5043", label: "Bank Charges" },
  { code: "5051", label: "Insurance Premium" },
  { code: "5060", label: "Miscellaneous" },
];

const PNL_NONCASH = [{ code: "5050", label: "Depreciation" }];

// ─── Balance Sheet structure ───
// Codes must match seed_hospital_defaults() chart_of_accounts exactly — a
// mismatch here silently drops or mislabels real ledger balances.
const BS_CURRENT_ASSETS = [
  { code: "1001", label: "Cash in Hand" },
  { code: "1002", label: "Cash in Bank" },
  { code: "1003", label: "Bank - Savings" },
  { code: "1010", label: "Accounts Receivable" },
  { code: "1011", label: "Insurance Receivable" },
  { code: "1012", label: "PMJAY Receivable" },
  { code: "1020", label: "Advance Payments (Unbilled)" },
  { code: "1030", label: "Pharmacy Stock" },
  { code: "1031", label: "Medical Consumables Stock" },
  { code: "1032", label: "Surgical Items Stock" },
  { code: "1040", label: "Prepaid Expenses" },
  { code: "1050", label: "GST Input Tax Credit" },
];

const BS_FIXED_ASSETS = [
  { code: "1101", label: "Medical Equipment" },
  { code: "1102", label: "Furniture & Fixtures" },
  { code: "1103", label: "Computers & IT Equipment" },
  { code: "1104", label: "Vehicles" },
  { code: "1105", label: "Building / Leasehold Improvements" },
  { code: "1110", label: "Less: Accumulated Depreciation", negate: true },
];

const BS_CURRENT_LIABILITIES = [
  { code: "2001", label: "Accounts Payable - Vendors" },
  { code: "2002", label: "Accounts Payable - Drugs" },
  { code: "2010", label: "Salaries Payable" },
  { code: "2011", label: "PF Payable" },
  { code: "2012", label: "ESIC Payable" },
  { code: "2013", label: "TDS Payable" },
  { code: "2020", label: "GST Payable (CGST)" },
  { code: "2021", label: "GST Payable (SGST)" },
  { code: "2030", label: "Advance from Patients" },
  { code: "2031", label: "Security Deposits Received" },
];

const BS_LT_LIABILITIES = [
  { code: "2101", label: "Bank Loan" },
  { code: "2102", label: "Equipment Finance Loan" },
];

const BS_EQUITY = [
  { code: "3001", label: "Capital Account" },
  { code: "3002", label: "Retained Earnings" },
];

const fmt = (n: number) => `₹${Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
const pct = (num: number, den: number) => den === 0 ? "0.0" : ((num / den) * 100).toFixed(1);

const ReportsTab: React.FC<Props> = ({ hospitalId, dateRange }) => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  // Period-scoped (entry_date within dateRange) — feeds P&L, GSTR-3B, Dept P&L.
  const [lineItems, setLineItems] = useState<RawLedgerLine[]>([]);
  // Cumulative (inception → dateRange.end) — feeds the Balance Sheet only; a
  // balance sheet is a point-in-time snapshot, never a period-only sum.
  const [cumulativeLineItems, setCumulativeLineItems] = useState<RawLedgerLine[]>([]);
  const [hospitalStateCode, setHospitalStateCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  // Account Statement state
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [acctEntries, setAcctEntries] = useState<(JournalLineDetail & { entry: JournalEntry })[]>([]);

  // Department P&L state
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [deptBillItems, setDeptBillItems] = useState<any[]>([]);
  const [showOverhead, setShowOverhead] = useState(false);

  // GSTR/TDS state
  const [gstBillItems, setGstBillItems] = useState<any[]>([]);
  const [expenseRecords, setExpenseRecords] = useState<any[]>([]);
  const [journalEntriesForExport, setJournalEntriesForExport] = useState<any[]>([]);
  const [exportLineItems, setExportLineItems] = useState<any[]>([]);

  // Tally export state
  const [includeSales, setIncludeSales] = useState(true);
  const [includeReceipts, setIncludeReceipts] = useState(true);
  const [includePurchases, setIncludePurchases] = useState(false);
  const [includeJournals, setIncludeJournals] = useState(true);
  const [tallyBills, setTallyBills] = useState<TallyBill[]>([]);
  const [tallyPayments, setTallyPayments] = useState<TallyPayment[]>([]);
  const [tallyBatches, setTallyBatches] = useState<TallyDrugBatch[]>([]);
  const [tallyLedgerMap, setTallyLedgerMap] = useState<TallyLedgerMapping[]>([]);
  const [exportLogs, setExportLogs] = useState<any[]>([]);
  const [tallyDataLoading, setTallyDataLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const { toast } = useToast();


  const loadData = useCallback(async () => {
    setLoading(true);
    const [
      { data: accts },
      { data: hosp },
      periodLines,
      cumulativeLines,
      { data: depts },
      { data: billItems },
      { data: gstItems },
      { data: expenses },
      { data: jeForExport },
      { data: liForExport },
    ] = await Promise.all([
      (supabase as any).from("chart_of_accounts").select("*").eq("hospital_id", hospitalId!).eq("is_active", true).order("code"),
      (supabase as any).from("hospitals").select("gstin, state_code").eq("id", hospitalId!).maybeSingle(),
      // Period (entry_date within dateRange) — P&L, GSTR-3B, Dept P&L direct expenses.
      fetchLedgerLines(hospitalId!, dateRange.start, dateRange.end),
      // Cumulative (inception → dateRange.end) — Balance Sheet only.
      fetchLedgerLines(hospitalId!, null, dateRange.end),
      supabase.from("departments").select("id, name").eq("hospital_id", hospitalId!).eq("is_active", true).order("name", { ascending: true }),
      supabase.from("bill_line_items").select("department, total_amount").eq("hospital_id", hospitalId!)
        .gte("created_at", dateRange.start).lte("created_at", dateRange.end + "T23:59:59"),
      // GSTR-1: bill_line_items with GST
      supabase.from("bill_line_items").select("hsn_code, description, gst_percent, taxable_amount, gst_amount, bill_id").eq("hospital_id", hospitalId!)
        .gte("created_at", dateRange.start).lte("created_at", dateRange.end + "T23:59:59"),
      // TDS: expense_records
      (supabase as any).from("expense_records").select("*").eq("hospital_id", hospitalId!)
        .gte("expense_date", dateRange.start).lte("expense_date", dateRange.end),
      // Tally: journal entries
      (supabase as any).from("journal_entries").select("id, entry_number, entry_date, description, entry_type, source_module").eq("hospital_id", hospitalId!)
        .gte("entry_date", dateRange.start).lte("entry_date", dateRange.end).order("entry_date"),
      // Tally: all line items
      (supabase as any).from("journal_line_items").select("journal_entry_id, account_code, debit_amount, credit_amount").eq("hospital_id", hospitalId!)
        .gte("created_at", dateRange.start).lte("created_at", dateRange.end + "T23:59:59"),
    ]);
    setAccounts(accts || []);
    setHospitalStateCode(hosp?.state_code || (hosp?.gstin ? String(hosp.gstin).slice(0, 2) : null));
    setLineItems(periodLines);
    setCumulativeLineItems(cumulativeLines);
    setDepartments(depts || []);
    setDeptBillItems(billItems || []);
    setGstBillItems(gstItems || []);
    setExpenseRecords(expenses || []);
    setJournalEntriesForExport(jeForExport || []);
    setExportLineItems(liForExport || []);
    setLoading(false);
  }, [hospitalId, dateRange]);

  useEffect(() => {
    if (!hospitalId) return;
    loadData();
  }, [loadData, hospitalId]);

  // ─── Balance helpers ───
  // Two independent maps: `lineItems` (period, entry_date within dateRange) feeds
  // P&L, GSTR-3B, and Dept P&L — all of which report movement WITHIN a period.
  // `cumulativeLineItems` (inception → dateRange.end) feeds the Balance Sheet —
  // a point-in-time snapshot must include every balance ever posted, not just
  // this period's.
  const periodBalanceByCode = useMemo(() => {
    const map: Record<string, { debit: number; credit: number }> = {};
    for (const li of lineItems) {
      if (!map[li.account_code]) map[li.account_code] = { debit: 0, credit: 0 };
      map[li.account_code].debit += Number(li.debit_amount || 0);
      map[li.account_code].credit += Number(li.credit_amount || 0);
    }
    return map;
  }, [lineItems]);

  const cumulativeBalanceByCode = useMemo(() => {
    const map: Record<string, { debit: number; credit: number }> = {};
    for (const li of cumulativeLineItems) {
      if (!map[li.account_code]) map[li.account_code] = { debit: 0, credit: 0 };
      map[li.account_code].debit += Number(li.debit_amount || 0);
      map[li.account_code].credit += Number(li.credit_amount || 0);
    }
    return map;
  }, [cumulativeLineItems]);

  // Revenue = credit - debit (credit-normal). P&L is always period-scoped.
  const revenueBalance = (code: string) => {
    const b = periodBalanceByCode[code];
    return b ? b.credit - b.debit : 0;
  };

  // Expense = debit - credit (debit-normal). P&L is always period-scoped.
  const expenseBalance = (code: string) => {
    const b = periodBalanceByCode[code];
    return b ? b.debit - b.credit : 0;
  };

  // Asset = debit - credit (debit-normal). Balance Sheet only — cumulative.
  const assetBalance = (code: string) => {
    const b = cumulativeBalanceByCode[code];
    return b ? b.debit - b.credit : 0;
  };

  // Liability/Equity = credit - debit (credit-normal). Balance Sheet only — cumulative.
  const liabilityBalance = (code: string) => {
    const b = cumulativeBalanceByCode[code];
    return b ? b.credit - b.debit : 0;
  };

  // Period-scoped asset/liability reads — for GSTR-3B, which reports THIS
  // return period's output tax and ITC movement, not the lifetime GL balance.
  const periodAssetBalance = (code: string) => {
    const b = periodBalanceByCode[code];
    return b ? b.debit - b.credit : 0;
  };
  const periodLiabilityBalance = (code: string) => {
    const b = periodBalanceByCode[code];
    return b ? b.credit - b.debit : 0;
  };

  const sumGroup = (items: { code: string }[], fn: (code: string) => number) =>
    items.reduce((s, i) => s + fn(i.code), 0);

  // ─── P&L calculations ───
  const totalRevOps = sumGroup(PNL_REVENUE, revenueBalance);
  const totalOtherIncome = sumGroup(PNL_OTHER_INCOME, revenueBalance);
  const totalIncome = totalRevOps + totalOtherIncome;
  const totalCOS = sumGroup(PNL_COS, expenseBalance);
  const grossProfit = totalIncome - totalCOS;
  const totalPersonnel = sumGroup(PNL_PERSONNEL, expenseBalance);
  const totalInfra = sumGroup(PNL_INFRA, expenseBalance);
  const totalMaint = sumGroup(PNL_MAINT, expenseBalance);
  const totalAdmin = sumGroup(PNL_ADMIN, expenseBalance);
  const totalNonCash = sumGroup(PNL_NONCASH, expenseBalance);
  const totalExpenses = totalCOS + totalPersonnel + totalInfra + totalMaint + totalAdmin + totalNonCash;
  const netProfit = totalIncome - totalExpenses;

  // ─── Balance Sheet calculations ───
  const totalCurrentAssets = sumGroup(BS_CURRENT_ASSETS, assetBalance);
  const totalFixedAssets = BS_FIXED_ASSETS.reduce((s, i) => {
    const bal = assetBalance(i.code);
    return s + ((i as any).negate ? -Math.abs(bal) : bal);
  }, 0);
  const totalAssets = totalCurrentAssets + totalFixedAssets;

  const totalCurrentLiab = sumGroup(BS_CURRENT_LIABILITIES, liabilityBalance);
  const totalLTLiab = sumGroup(BS_LT_LIABILITIES, liabilityBalance);
  const totalEquityAccounts = sumGroup(BS_EQUITY, liabilityBalance);
  const totalEquity = totalEquityAccounts + netProfit; // Current year P&L flows into equity
  const totalLiabEquity = totalCurrentLiab + totalLTLiab + totalEquity;
  const balanceDiff = Math.abs(totalAssets - totalLiabEquity);

  // ─── Account Statement ───
  const loadAccountStatement = useCallback(async (accountId: string) => {
    if (!hospitalId || !accountId) return;
    setSelectedAccountId(accountId);
    const { data } = await supabase
      .from("journal_line_items")
      .select("id, account_code, account_id, debit_amount, credit_amount, created_at, journal_entry_id")
      .eq("hospital_id", hospitalId)
      .eq("account_id", accountId)
      .order("created_at", { ascending: true });

    if (!data || data.length === 0) { setAcctEntries([]); return; }

    const entryIds = [...new Set(data.map((d: any) => d.journal_entry_id))];
    const { data: entries } = await (supabase as any)
      .from("journal_entries")
      .select("id, entry_number, entry_date, description, entry_type, source_module")
      .in("id", entryIds);

    const entryMap: Record<string, JournalEntry> = {};
    (entries || []).forEach((e: JournalEntry) => { entryMap[e.id] = e; });

    setAcctEntries(data.map((d: any) => ({ ...d, entry: entryMap[d.journal_entry_id] || { id: "", entry_number: "—", entry_date: "", description: "", entry_type: "", source_module: "" } })));
  }, [hospitalId]);

  // ─── AI Analysis ───
  const runAIAnalysis = async () => {
    if (!hospitalId) return;
    setAiLoading(true);
    try {
      const prompt = `Hospital P&L for ${dateRange.start} to ${dateRange.end}:
Revenue: ${fmt(totalIncome)}
Cost of Services: ${fmt(totalCOS)}
Gross Profit: ${fmt(grossProfit)} (${pct(grossProfit, totalIncome)}% margin)
Total Expenses: ${fmt(totalExpenses)}
Net Profit: ${fmt(netProfit)} (${pct(netProfit, totalIncome)}% margin)
Personnel Costs: ${fmt(totalPersonnel)}
Infrastructure: ${fmt(totalInfra)}

Write a 5-point CFO-level financial analysis:
1. Profitability assessment
2. Revenue trend analysis
3. Expense efficiency commentary
4. Working capital observation
5. One specific recommendation`;

      const res = await callAI({ featureKey: "financial_analysis", prompt, hospitalId, maxTokens: 800 });
      if (res.text) {
        setAiAnalysis(res.text);
      } else {
        setAiAnalysis("AI analysis unavailable. Please configure an AI provider in Settings → API Configuration Hub (/settings/api-hub) with a valid API key.");
      }
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (msg.toLowerCase().includes("no ai provider") || msg.toLowerCase().includes("not configured")) {
        setAiAnalysis("No AI provider configured. Go to Settings → API Configuration Hub (/settings/api-hub) to add an API key for Claude, GPT-4o, or Gemini.");
      } else {
        setAiAnalysis(`AI analysis failed: ${msg}. Check Settings → API Configuration Hub.`);
      }
    }
    setAiLoading(false);
  };

  // ─── GSTR-1 computed data ───
  const gstr1Data = useMemo(() => {
    const grouped: Record<string, { hsn_code: string; description: string; gst_percent: number; taxable_value: number; total_gst: number; cgst: number; sgst: number; igst: number; invoice_count: number; bill_ids: Set<string> }> = {};
    for (const item of gstBillItems) {
      const key = `${item.hsn_code || "NONE"}_${item.gst_percent || 0}`;
      if (!grouped[key]) grouped[key] = { hsn_code: item.hsn_code || "", description: item.description || "", gst_percent: Number(item.gst_percent || 0), taxable_value: 0, total_gst: 0, cgst: 0, sgst: 0, igst: 0, invoice_count: 0, bill_ids: new Set() };
      const taxable = Number(item.taxable_amount || item.total_amount || 0);
      const gstAmount = Number(item.gst_amount || 0);
      // Split the ALREADY-STORED gst_amount (gstPercent: 100 makes splitGst's
      // internal amount*rate/100 resolve to gstAmount exactly — no recompute
      // drift). Buyer state isn't captured per bill line, so this defaults to
      // intra-state (CGST+SGST) via splitGst's safe fallback — the same
      // canonical split the e-invoice generator and outward register use, so
      // all three agree. Becomes correctly inter-state (IGST) the moment buyer
      // state is captured, with no change needed here.
      const split = splitGst({ amount: gstAmount, gstPercent: 100, sellerStateCode: hospitalStateCode, buyerStateCode: null });
      grouped[key].taxable_value += taxable;
      grouped[key].total_gst += gstAmount;
      grouped[key].cgst += split.cgst;
      grouped[key].sgst += split.sgst;
      grouped[key].igst += split.igst;
      if (item.bill_id) grouped[key].bill_ids.add(item.bill_id);
    }
    return Object.values(grouped).map(g => ({ ...g, invoice_count: g.bill_ids.size })).sort((a, b) => b.taxable_value - a.taxable_value);
  }, [gstBillItems, hospitalStateCode]);

  const gstr1Json = useMemo(() => ({
    gstin: "", fp: dateRange.start.slice(0, 7).replace("-", ""),
    hsn: { data: gstr1Data.filter(r => r.gst_percent > 0).map(r => ({ hsn_sc: r.hsn_code, desc: r.description, uqc: "NOS", qty: r.invoice_count, txval: r.taxable_value, camt: r.cgst, samt: r.sgst, rt: r.gst_percent })) }
  }), [gstr1Data, dateRange]);

  // ─── TDS computed data ───
  const tdsData = useMemo(() => {
    return expenseRecords
      .filter((e: any) => TDS_CATEGORIES[e.category])
      .map((e: any) => {
        const tdsInfo = TDS_CATEGORIES[e.category];
        const amount = Number(e.amount || 0);
        return { date: e.expense_date, vendor: e.vendor_name || e.description || "—", category: e.category, section: tdsInfo.section, amount, tds_rate: tdsInfo.rate, tds_amount: amount * (tdsInfo.rate / 100) };
      });
  }, [expenseRecords]);

  // ─── Tally XML generator ───
  const generateTallyXML = useCallback(() => {
    const accountMap: Record<string, string> = {};
    accounts.forEach(a => { accountMap[a.code] = a.name; });

    const vouchers = journalEntriesForExport.map((je: any) => {
      const lines = exportLineItems.filter((li: any) => li.journal_entry_id === je.id);
      const ledgerEntries = lines.map((li: any) => {
        const dr = Number(li.debit_amount || 0);
        const cr = Number(li.credit_amount || 0);
        const isDeemedPositive = dr > 0 ? "Yes" : "No";
        const amount = dr > 0 ? -dr : cr; // Tally: debit = negative
        return `              <ALLLEDGERENTRIES.LIST>
                <LEDGERNAME>${accountMap[li.account_code] || li.account_code}</LEDGERNAME>
                <ISDEEMEDPOSITIVE>${isDeemedPositive}</ISDEEMEDPOSITIVE>
                <AMOUNT>${amount}</AMOUNT>
              </ALLLEDGERENTRIES.LIST>`;
      }).join("\n");

      return `          <TALLYMESSAGE>
            <VOUCHER VCHTYPE="Journal" ACTION="Create">
              <DATE>${(je.entry_date || "").replace(/-/g, "")}</DATE>
              <NARRATION>${je.description || ""}</NARRATION>
${ledgerEntries}
            </VOUCHER>
          </TALLYMESSAGE>`;
    }).join("\n");

    return `<ENVELOPE>
  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME></REQUESTDESC>
      <REQUESTDATA>
${vouchers}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
  }, [journalEntriesForExport, exportLineItems, accounts]);

  // ─── Tally data loader (lazy — called on demand from the Tally tab) ───
  const loadTallyData = useCallback(async () => {
    if (!hospitalId) return;
    setTallyDataLoading(true);
    try {
      const [
        { data: billsRaw },
        { data: paymentsRaw },
        { data: batchesRaw },
        { data: mappingsRaw },
        { data: logsRaw },
      ] = await Promise.all([
        (supabase as any)
          .from("bills")
          .select("id, bill_number, bill_date, bill_type, total_amount, taxable_amount, gst_amount, patients(full_name)")
          .eq("hospital_id", hospitalId)
          .eq("bill_status", "final")
          .gte("bill_date", dateRange.start)
          .lte("bill_date", dateRange.end)
          .order("bill_date"),
        supabase
          .from("bill_payments")
          .select("id, bill_id, payment_mode, amount, payment_date, transaction_id")
          .eq("hospital_id", hospitalId)
          .gte("payment_date", dateRange.start)
          .lte("payment_date", dateRange.end)
          .order("payment_date"),
        (supabase as any)
          .from("drug_batches")
          .select("id, batch_number, purchase_date, supplier_name, quantity_received, cost_price, gst_percent")
          .eq("hospital_id", hospitalId)
          .gte("purchase_date", dateRange.start)
          .lte("purchase_date", dateRange.end)
          .not("purchase_date", "is", null),
        (supabase as any)
          .from("tally_ledger_mapping")
          .select("aumrti_revenue_head, tally_ledger_name")
          .eq("hospital_id", hospitalId),
        (supabase as any)
          .from("tally_export_log")
          .select("id, export_type, date_from, date_to, voucher_count, delivery_method, delivery_status, exported_at")
          .eq("hospital_id", hospitalId)
          .order("exported_at", { ascending: false })
          .limit(10),
      ]);

      const bills: TallyBill[] = (billsRaw || []).map((b: any) => ({
        id: b.id,
        bill_number: b.bill_number || "",
        bill_date: b.bill_date || "",
        patient_name: (b.patients as any)?.full_name || "Patient",
        bill_type: b.bill_type || "opd",
        total_amount: Number(b.total_amount || 0),
        taxable_amount: Number(b.taxable_amount || 0),
        gst_amount: Number(b.gst_amount || 0),
      }));

      // Build bill lookup for enriching payments with bill_number + patient_name
      const billMap: Record<string, TallyBill> = {};
      bills.forEach((b) => { billMap[b.id] = b; });

      const payments: TallyPayment[] = (paymentsRaw || []).map((p: any) => ({
        id: p.id,
        bill_id: p.bill_id,
        bill_number: billMap[p.bill_id]?.bill_number || p.bill_id?.slice(0, 8) || "",
        patient_name: billMap[p.bill_id]?.patient_name || "Patient",
        payment_date: p.payment_date || "",
        payment_mode: p.payment_mode || "cash",
        amount: Number(p.amount || 0),
        transaction_id: p.transaction_id,
      }));

      const batches: TallyDrugBatch[] = (batchesRaw || []).map((b: any) => ({
        id: b.id,
        drug_name: b.batch_number || "Drug",
        batch_number: b.batch_number || "",
        purchase_date: b.purchase_date || "",
        supplier_name: b.supplier_name || "",
        quantity_received: Number(b.quantity_received || 0),
        cost_price: Number(b.cost_price || 0),
        gst_percent: Number(b.gst_percent || 0),
      }));

      setTallyBills(bills);
      setTallyPayments(payments);
      setTallyBatches(batches);
      setTallyLedgerMap(mappingsRaw || []);
      setExportLogs(logsRaw || []);
    } catch (err) {
      console.error("loadTallyData error:", err);
    }
    setTallyDataLoading(false);
  }, [hospitalId, dateRange]);

  // ─── Build & download Tally XML bundle ───
  const handleTallyExport = useCallback(async (deliveryMethod: "download" | "email") => {
    setExporting(true);
    try {
      const journalLines: TallyJournalLine[] = exportLineItems.map((li: any) => ({
        journal_entry_id: li.journal_entry_id,
        account_code: li.account_code,
        account_name: accounts.find((a) => a.code === li.account_code)?.name || li.account_code,
        debit_amount: Number(li.debit_amount || 0),
        credit_amount: Number(li.credit_amount || 0),
      }));

      const fragments: string[] = [];
      if (includeSales) fragments.push(generateSalesVouchers(tallyBills, tallyLedgerMap));
      if (includeReceipts) fragments.push(generateReceiptVouchers(tallyPayments));
      if (includePurchases) fragments.push(generatePurchaseVouchers(tallyBatches));
      if (includeJournals) fragments.push(generateJournalVouchers(journalEntriesForExport, journalLines));

      const xml = wrapTDMLEnvelope(fragments);
      const voucherCount =
        (includeSales ? tallyBills.length : 0) +
        (includeReceipts ? tallyPayments.length : 0) +
        (includePurchases ? tallyBatches.length : 0) +
        (includeJournals ? journalEntriesForExport.length : 0);

      const exportTypes = [
        includeSales && "sales",
        includeReceipts && "receipts",
        includePurchases && "purchases",
        includeJournals && "journals",
      ].filter(Boolean).join("+");

      if (deliveryMethod === "download") {
        const blob = new Blob([xml], { type: "application/xml" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `HMS_Tally_Export_${dateRange.start}_${dateRange.end}.xml`;
        a.click();
        // Log download
        await (supabase as any).from("tally_export_log").insert({
          hospital_id: hospitalId,
          export_type: exportTypes,
          date_from: dateRange.start,
          date_to: dateRange.end,
          voucher_count: voucherCount,
          delivery_method: "download",
          delivery_status: "sent",
          xml_size_bytes: new TextEncoder().encode(xml).length,
        });
        toast({ title: `Downloaded: ${voucherCount} vouchers ✓` });
        await loadTallyData();
      } else {
        const { error } = await supabase.functions.invoke("email-tally-xml", {
          body: {
            hospital_id: hospitalId,
            xml_content: xml,
            date_start: dateRange.start,
            date_end: dateRange.end,
            export_type: exportTypes,
            voucher_count: voucherCount,
          },
        });
        if (error) throw new Error(error.message);
        toast({ title: `Tally XML emailed — ${voucherCount} vouchers ✓` });
        await loadTallyData();
      }
    } catch (err: any) {
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    }
    setExporting(false);
  }, [includeSales, includeReceipts, includePurchases, includeJournals, tallyBills, tallyPayments, tallyBatches, tallyLedgerMap, journalEntriesForExport, exportLineItems, accounts, hospitalId, dateRange, loadTallyData, toast]);

  // ─── Render helpers ───
  const SectionRow = ({ label, className }: { label: string; className?: string }) => (
    <TableRow className={className}><TableCell colSpan={2} className="text-xs font-bold py-2">{label}</TableCell></TableRow>
  );

  const AmountRow = ({ label, amount, indent = false }: { label: string; amount: number; indent?: boolean }) => (
    amount !== 0 ? (
      <TableRow>
        <TableCell className={`text-xs py-1.5 ${indent ? "pl-8" : "pl-4"}`}>{label}</TableCell>
        <TableCell className="text-xs text-right py-1.5 font-mono">{fmt(amount)}</TableCell>
      </TableRow>
    ) : null
  );

  const SubtotalRow = ({ label, amount, color }: { label: string; amount: number; color?: string }) => (
    <TableRow className="border-t border-border">
      <TableCell className="text-xs font-semibold py-2 pl-4">{label}</TableCell>
      <TableCell className={`text-xs text-right font-bold py-2 font-mono ${color || ""}`}>{fmt(amount)}</TableCell>
    </TableRow>
  );

  const selectedAccount = accounts.find(a => a.id === selectedAccountId);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="p-5 space-y-4">
      <Tabs defaultValue="pnl">
        <TabsList className="h-9 flex-wrap gap-0.5">
          <TabsTrigger value="pnl" className="text-xs">P&L Statement</TabsTrigger>
          <TabsTrigger value="bs" className="text-xs">Balance Sheet</TabsTrigger>
          <TabsTrigger value="tb" className="text-xs">Trial Balance</TabsTrigger>
          <TabsTrigger value="acct" className="text-xs">Account Statement</TabsTrigger>
          <TabsTrigger value="dept" className="text-xs">Department P&L</TabsTrigger>
          <TabsTrigger value="gstr1" className="text-xs">GSTR-1</TabsTrigger>
          <TabsTrigger value="gstr3b" className="text-xs">GSTR-3B</TabsTrigger>
          <TabsTrigger value="tds" className="text-xs">TDS</TabsTrigger>
          <TabsTrigger value="tally" className="text-xs">Tally Export</TabsTrigger>
        </TabsList>

        {/* ═══ P&L STATEMENT ═══ */}
        <TabsContent value="pnl">
          <Card className="border-border mt-4">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm">Profit & Loss Statement</CardTitle>
                <p className="text-xs text-muted-foreground">{dateRange.start} to {dateRange.end}</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => {
                  const mkRow = (label: string, amount: number, bold = false) => `<div class="row" style="${bold ? "font-weight:bold;font-size:14px;" : ""}"><span>${label}</span><span class="amount">₹${Math.abs(amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span></div>`;
                  const body = `<h2 style="color:#1A2F5A">Profit & Loss Statement</h2><p class="label">${dateRange.start} to ${dateRange.end}</p>
                    <p class="section-title">Revenue from Operations</p>${PNL_REVENUE.map(r => mkRow(r.label, revenueBalance(r.code))).join("")}${mkRow("Total Revenue", totalRevOps, true)}
                    <p class="section-title">Cost of Services</p>${PNL_COS.map(r => mkRow(r.label, expenseBalance(r.code))).join("")}${mkRow("Gross Profit", grossProfit, true)}
                    <p class="section-title">Operating Expenses</p>${[...PNL_PERSONNEL, ...PNL_INFRA, ...PNL_MAINT, ...PNL_ADMIN].map(r => mkRow(r.label, expenseBalance(r.code))).join("")}
                    ${mkRow("Net Profit", netProfit, true)}`;
                  printDocument("Profit & Loss Statement", body);
                }}><Printer className="h-3 w-3 mr-1" />Print</Button>
                <Button size="sm" variant="outline" className="text-xs h-7"><FileText className="h-3 w-3 mr-1" />PDF</Button>
                <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => {
                  const rows = [
                    { Section: "REVENUE FROM OPERATIONS", Account: "", Amount: "" },
                    ...PNL_REVENUE.map(r => ({ Section: "", Account: r.label, Amount: revenueBalance(r.code) })),
                    { Section: "Total Revenue from Operations", Account: "", Amount: totalRevOps },
                    { Section: "OTHER INCOME", Account: "", Amount: "" },
                    ...PNL_OTHER_INCOME.map(r => ({ Section: "", Account: r.label, Amount: revenueBalance(r.code) })),
                    { Section: "TOTAL INCOME", Account: "", Amount: totalIncome },
                    { Section: "COST OF SERVICES", Account: "", Amount: "" },
                    ...PNL_COS.map(r => ({ Section: "", Account: r.label, Amount: expenseBalance(r.code) })),
                    { Section: "Gross Profit", Account: "", Amount: grossProfit },
                    { Section: "PERSONNEL COSTS", Account: "", Amount: "" },
                    ...PNL_PERSONNEL.map(r => ({ Section: "", Account: r.label, Amount: expenseBalance(r.code) })),
                    { Section: "INFRASTRUCTURE COSTS", Account: "", Amount: "" },
                    ...PNL_INFRA.map(r => ({ Section: "", Account: r.label, Amount: expenseBalance(r.code) })),
                    { Section: "MAINTENANCE", Account: "", Amount: "" },
                    ...PNL_MAINT.map(r => ({ Section: "", Account: r.label, Amount: expenseBalance(r.code) })),
                    { Section: "ADMINISTRATIVE", Account: "", Amount: "" },
                    ...PNL_ADMIN.map(r => ({ Section: "", Account: r.label, Amount: expenseBalance(r.code) })),
                    { Section: "Total Expenses", Account: "", Amount: totalExpenses },
                    { Section: "NET PROFIT / (LOSS)", Account: "", Amount: netProfit },
                  ];
                  const ws = XLSX.utils.json_to_sheet(rows);
                  const wb = XLSX.utils.book_new();
                  XLSX.utils.book_append_sheet(wb, ws, "P&L");
                  XLSX.writeFile(wb, `PnL_${dateRange.start}_${dateRange.end}.xlsx`);
                }}><FileSpreadsheet className="h-3 w-3 mr-1" />Excel</Button>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow><TableHead className="text-xs">Particulars</TableHead><TableHead className="text-xs text-right w-40">Amount (₹)</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {/* REVENUE */}
                  <SectionRow label="REVENUE FROM OPERATIONS" className="bg-emerald-50/50 dark:bg-emerald-950/10" />
                  {PNL_REVENUE.map(r => <AmountRow key={r.code} label={r.label} amount={revenueBalance(r.code)} indent />)}
                  <SubtotalRow label="Total Revenue from Operations" amount={totalRevOps} color="text-emerald-700 dark:text-emerald-400" />

                  <SectionRow label="OTHER INCOME" className="bg-emerald-50/30 dark:bg-emerald-950/5" />
                  {PNL_OTHER_INCOME.map(r => <AmountRow key={r.code} label={r.label} amount={revenueBalance(r.code)} indent />)}
                  <SubtotalRow label="TOTAL INCOME" amount={totalIncome} color="text-emerald-700 dark:text-emerald-400" />

                  {/* COST OF SERVICES */}
                  <SectionRow label="COST OF SERVICES" className="bg-red-50/50 dark:bg-red-950/10" />
                  {PNL_COS.map(r => <AmountRow key={r.code} label={r.label} amount={expenseBalance(r.code)} indent />)}
                  <SubtotalRow label="Total Cost of Services" amount={totalCOS} color="text-red-500" />

                  {/* GROSS PROFIT */}
                  <TableRow className="bg-primary/5 border-t-2 border-b-2">
                    <TableCell className="text-sm font-bold py-2">GROSS PROFIT</TableCell>
                    <TableCell className={`text-sm text-right font-bold py-2 font-mono ${grossProfit >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-500"}`}>
                      {fmt(grossProfit)} <span className="text-xs font-normal text-muted-foreground ml-1">({pct(grossProfit, totalIncome)}%)</span>
                    </TableCell>
                  </TableRow>

                  {/* PERSONNEL */}
                  <SectionRow label="PERSONNEL COSTS" className="bg-muted/50" />
                  {PNL_PERSONNEL.map(r => <AmountRow key={r.code} label={r.label} amount={expenseBalance(r.code)} indent />)}
                  <SubtotalRow label="Total Personnel Costs" amount={totalPersonnel} />

                  {/* INFRASTRUCTURE */}
                  <SectionRow label="INFRASTRUCTURE COSTS" className="bg-muted/50" />
                  {PNL_INFRA.map(r => <AmountRow key={r.code} label={r.label} amount={expenseBalance(r.code)} indent />)}
                  <SubtotalRow label="Total Infrastructure" amount={totalInfra} />

                  {/* MAINTENANCE */}
                  <SectionRow label="MAINTENANCE & OPERATIONS" className="bg-muted/50" />
                  {PNL_MAINT.map(r => <AmountRow key={r.code} label={r.label} amount={expenseBalance(r.code)} indent />)}
                  <SubtotalRow label="Total Maintenance" amount={totalMaint} />

                  {/* ADMINISTRATIVE */}
                  <SectionRow label="ADMINISTRATIVE" className="bg-muted/50" />
                  {PNL_ADMIN.map(r => <AmountRow key={r.code} label={r.label} amount={expenseBalance(r.code)} indent />)}
                  <SubtotalRow label="Total Administrative" amount={totalAdmin} />

                  {/* NON-CASH */}
                  <SectionRow label="NON-CASH" className="bg-muted/50" />
                  {PNL_NONCASH.map(r => <AmountRow key={r.code} label={r.label} amount={expenseBalance(r.code)} indent />)}

                  {/* TOTAL EXPENSES */}
                  <TableRow className="border-t-2">
                    <TableCell className="text-xs font-bold py-2">TOTAL EXPENSES</TableCell>
                    <TableCell className="text-xs text-right font-bold py-2 font-mono text-red-500">{fmt(totalExpenses)}</TableCell>
                  </TableRow>

                  {/* NET PROFIT */}
                  <TableRow className="bg-primary/5 border-t-4">
                    <TableCell className="text-base font-bold py-3">NET {netProfit >= 0 ? "PROFIT" : "LOSS"}</TableCell>
                    <TableCell className={`text-base text-right font-bold py-3 font-mono ${netProfit >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-500"}`}>
                      {netProfit < 0 && "("}
                      {fmt(netProfit)}
                      {netProfit < 0 && ")"}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-xs text-muted-foreground">Net Profit Margin</TableCell>
                    <TableCell className="text-xs text-right text-muted-foreground font-mono">{pct(netProfit, totalIncome)}%</TableCell>
                  </TableRow>
                </TableBody>
              </Table>

              {/* AI Analysis */}
              <div className="mt-4">
                <Button size="sm" variant="outline" onClick={runAIAnalysis} disabled={aiLoading} className="text-xs">
                  {aiLoading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Bot className="h-3 w-3 mr-1" />}
                  AI Financial Analysis
                </Button>
                {aiAnalysis && (
                  <Card className="mt-3 bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
                    <CardContent className="pt-4">
                      <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 mb-2 flex items-center gap-1"><Bot className="h-3.5 w-3.5" /> AI Financial Analysis</p>
                      <p className="text-xs text-foreground whitespace-pre-line leading-relaxed">{aiAnalysis}</p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══ BALANCE SHEET ═══ */}
        <TabsContent value="bs">
          <Card className="border-border mt-4">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm">Balance Sheet</CardTitle>
                <p className="text-xs text-muted-foreground">As at {dateRange.end}</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => {
                  const mkRow = (label: string, amount: number, bold = false) => `<div class="row" style="${bold ? "font-weight:bold;font-size:14px;" : ""}"><span>${label}</span><span class="amount">₹${Math.abs(amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span></div>`;
                  const body = `<h2 style="color:#1A2F5A">Balance Sheet</h2><p class="label">As at ${dateRange.end}</p>
                    <p class="section-title">Assets</p>${BS_CURRENT_ASSETS.map(r => mkRow(r.label, assetBalance(r.code))).join("")}${mkRow("Total Current Assets", totalCurrentAssets, true)}
                    ${BS_FIXED_ASSETS.map(r => mkRow(r.label, assetBalance(r.code))).join("")}${mkRow("Total Assets", totalAssets, true)}
                    <p class="section-title">Liabilities</p>${BS_CURRENT_LIABILITIES.map(r => mkRow(r.label, liabilityBalance(r.code))).join("")}
                    <p class="section-title">Equity</p>${BS_EQUITY.map(r => mkRow(r.label, liabilityBalance(r.code))).join("")}${mkRow("Net Profit (Current Year)", netProfit)}${mkRow("Total Liabilities & Equity", totalLiabEquity, true)}`;
                  printDocument("Balance Sheet", body);
                }}><Printer className="h-3 w-3 mr-1" />Print</Button>
                <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => {
                  const rows = [
                    { Side: "ASSETS", Account: "CURRENT ASSETS", Amount: "" },
                    ...BS_CURRENT_ASSETS.map(a => ({ Side: "", Account: a.label, Amount: assetBalance(a.code) })),
                    { Side: "", Account: "Total Current Assets", Amount: totalCurrentAssets },
                    { Side: "", Account: "FIXED ASSETS", Amount: "" },
                    ...BS_FIXED_ASSETS.map(a => ({ Side: "", Account: a.label, Amount: assetBalance(a.code) })),
                    { Side: "", Account: "TOTAL ASSETS", Amount: totalAssets },
                    { Side: "LIABILITIES & EQUITY", Account: "CURRENT LIABILITIES", Amount: "" },
                    ...BS_CURRENT_LIABILITIES.map(a => ({ Side: "", Account: a.label, Amount: liabilityBalance(a.code) })),
                    { Side: "", Account: "LONG TERM LIABILITIES", Amount: "" },
                    ...BS_LT_LIABILITIES.map(a => ({ Side: "", Account: a.label, Amount: liabilityBalance(a.code) })),
                    { Side: "", Account: "EQUITY", Amount: "" },
                    ...BS_EQUITY.map(a => ({ Side: "", Account: a.label, Amount: liabilityBalance(a.code) })),
                    { Side: "", Account: "Current Year P&L", Amount: netProfit },
                    { Side: "", Account: "TOTAL LIABILITIES + EQUITY", Amount: totalLiabEquity },
                  ];
                  const ws = XLSX.utils.json_to_sheet(rows);
                  const wb = XLSX.utils.book_new();
                  XLSX.utils.book_append_sheet(wb, ws, "Balance Sheet");
                  XLSX.writeFile(wb, `BalanceSheet_${dateRange.end}.xlsx`);
                }}><FileSpreadsheet className="h-3 w-3 mr-1" />Excel</Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* ASSETS */}
                <div>
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead colSpan={2} className="text-xs font-bold text-blue-700 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-950/10">ASSETS</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      <SectionRow label="CURRENT ASSETS" className="bg-muted/30" />
                      {BS_CURRENT_ASSETS.map(a => <AmountRow key={a.code} label={a.label} amount={assetBalance(a.code)} indent />)}
                      <SubtotalRow label="Total Current Assets" amount={totalCurrentAssets} color="text-blue-700 dark:text-blue-400" />

                      <SectionRow label="FIXED ASSETS" className="bg-muted/30" />
                      {BS_FIXED_ASSETS.map(a => {
                        const bal = assetBalance(a.code);
                        const display = (a as any).negate ? -Math.abs(bal) : bal;
                        return display !== 0 ? (
                          <TableRow key={a.code}>
                            <TableCell className="text-xs py-1.5 pl-8">{a.label}</TableCell>
                            <TableCell className="text-xs text-right py-1.5 font-mono">{(a as any).negate && bal !== 0 ? `(${fmt(bal)})` : fmt(display)}</TableCell>
                          </TableRow>
                        ) : null;
                      })}
                      <SubtotalRow label="Total Fixed Assets" amount={totalFixedAssets} />

                      <TableRow className="bg-blue-50/50 dark:bg-blue-950/10 border-t-2">
                        <TableCell className="text-sm font-bold py-2">TOTAL ASSETS</TableCell>
                        <TableCell className="text-sm text-right font-bold py-2 font-mono text-blue-700 dark:text-blue-400">{fmt(totalAssets)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>

                {/* LIABILITIES & EQUITY */}
                <div>
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead colSpan={2} className="text-xs font-bold text-amber-700 dark:text-amber-400 bg-amber-50/50 dark:bg-amber-950/10">LIABILITIES & EQUITY</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      <SectionRow label="CURRENT LIABILITIES" className="bg-muted/30" />
                      {BS_CURRENT_LIABILITIES.map(a => <AmountRow key={a.code} label={a.label} amount={liabilityBalance(a.code)} indent />)}
                      <SubtotalRow label="Total Current Liabilities" amount={totalCurrentLiab} />

                      <SectionRow label="LONG TERM LIABILITIES" className="bg-muted/30" />
                      {BS_LT_LIABILITIES.map(a => <AmountRow key={a.code} label={a.label} amount={liabilityBalance(a.code)} indent />)}
                      <SubtotalRow label="Total Long Term Liabilities" amount={totalLTLiab} />

                      <SectionRow label="EQUITY" className="bg-muted/30" />
                      {BS_EQUITY.map(a => <AmountRow key={a.code} label={a.label} amount={liabilityBalance(a.code)} indent />)}
                      <AmountRow label="Current Year Profit/(Loss)" amount={netProfit} indent />
                      <SubtotalRow label="Total Equity" amount={totalEquity} />

                      <TableRow className="bg-amber-50/50 dark:bg-amber-950/10 border-t-2">
                        <TableCell className="text-sm font-bold py-2">TOTAL LIABILITIES + EQUITY</TableCell>
                        <TableCell className="text-sm text-right font-bold py-2 font-mono text-amber-700 dark:text-amber-400">{fmt(totalLiabEquity)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Balance Check */}
              <div className={`mt-4 p-3 rounded-md flex items-center gap-2 text-xs font-medium ${balanceDiff < 0.01 ? "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400" : "bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400"}`}>
                {balanceDiff < 0.01 ? <><CheckCircle2 className="h-4 w-4" /> Balanced — Assets equal Liabilities + Equity</> : <><XCircle className="h-4 w-4" /> Out of balance by {fmt(balanceDiff)}</>}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══ TRIAL BALANCE ═══ */}
        <TabsContent value="tb">
          <TrialBalanceTab hospitalId={hospitalId} />
        </TabsContent>

        {/* ═══ ACCOUNT STATEMENT ═══ */}
        <TabsContent value="acct">
          <Card className="border-border mt-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Account Statement</CardTitle>
              <p className="text-xs text-muted-foreground">Select an account to view all transactions</p>
            </CardHeader>
            <CardContent>
              <Select value={selectedAccountId} onValueChange={(v) => loadAccountStatement(v)}>
                <SelectTrigger className="w-80 h-8 text-xs mb-4">
                  <SelectValue placeholder="Select account..." />
                </SelectTrigger>
                <SelectContent>
                  {accounts.filter(a => !a.is_control && !a.is_system).map(a => (
                    <SelectItem key={a.id} value={a.id} className="text-xs">{a.code} — {a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {selectedAccount && (
                <>
                  <div className="flex items-center gap-3 mb-3">
                    <Badge variant="outline" className="text-xs capitalize">{selectedAccount.account_type}</Badge>
                    <span className="text-xs text-muted-foreground">Opening Balance: {fmt(selectedAccount.opening_balance || 0)}</span>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs w-24">Date</TableHead>
                        <TableHead className="text-xs w-28">Entry #</TableHead>
                        <TableHead className="text-xs">Description</TableHead>
                        <TableHead className="text-xs text-right w-28">Debit (₹)</TableHead>
                        <TableHead className="text-xs text-right w-28">Credit (₹)</TableHead>
                        <TableHead className="text-xs text-right w-32">Balance (₹)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(() => {
                        let running = selectedAccount.opening_balance || 0;
                        const isDebitNormal = ["asset", "expense"].includes(selectedAccount.account_type);
                        return acctEntries.map((e) => {
                          const dr = Number(e.debit_amount || 0);
                          const cr = Number(e.credit_amount || 0);
                          running += isDebitNormal ? (dr - cr) : (cr - dr);
                          return (
                            <TableRow key={e.id}>
                              <TableCell className="text-xs font-mono">{e.entry?.entry_date || e.created_at?.split("T")[0]}</TableCell>
                              <TableCell className="text-xs font-mono">{e.entry?.entry_number || "—"}</TableCell>
                              <TableCell className="text-xs">{e.entry?.description || "—"}</TableCell>
                              <TableCell className="text-xs text-right font-mono">{dr > 0 ? fmt(dr) : "—"}</TableCell>
                              <TableCell className="text-xs text-right font-mono">{cr > 0 ? fmt(cr) : "—"}</TableCell>
                              <TableCell className={`text-xs text-right font-mono font-medium ${running >= 0 ? "" : "text-red-500"}`}>{running < 0 ? `(${fmt(running)})` : fmt(running)}</TableCell>
                            </TableRow>
                          );
                        });
                      })()}
                      {acctEntries.length === 0 && (
                        <TableRow><TableCell colSpan={6} className="text-xs text-center text-muted-foreground py-8">No transactions found for this account</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══ GSTR-1 ═══ */}
        <TabsContent value="gstr1">
          <Card className="border-border mt-4">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm">GSTR-1 — Outward Supplies Summary</CardTitle>
                <p className="text-xs text-muted-foreground">{dateRange.start} to {dateRange.end}</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => {
                  const blob = new Blob([JSON.stringify(gstr1Json, null, 2)], { type: "application/json" });
                  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `GSTR1_${dateRange.start}_${dateRange.end}.json`; a.click();
                }}><Download className="h-3 w-3 mr-1" />GSTR-1 JSON</Button>
                <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => {
                  const ws = XLSX.utils.json_to_sheet(gstr1Data);
                  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "GSTR-1");
                  XLSX.writeFile(wb, `GSTR1_${dateRange.start}_${dateRange.end}.xlsx`);
                }}><FileSpreadsheet className="h-3 w-3 mr-1" />Excel</Button>
              </div>
            </CardHeader>
            <CardContent>
              {/* HSN-wise Taxable */}
              <p className="text-xs font-semibold mb-2">HSN/SAC-wise Summary (Taxable Supplies)</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">HSN/SAC</TableHead>
                    <TableHead className="text-xs">Description</TableHead>
                    <TableHead className="text-xs text-right">Rate %</TableHead>
                    <TableHead className="text-xs text-right">Taxable Value</TableHead>
                    <TableHead className="text-xs text-right">CGST</TableHead>
                    <TableHead className="text-xs text-right">SGST</TableHead>
                    <TableHead className="text-xs text-right">Total GST</TableHead>
                    <TableHead className="text-xs text-right">Invoices</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {gstr1Data.filter(r => r.gst_percent > 0).map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs font-mono">{r.hsn_code || "—"}</TableCell>
                      <TableCell className="text-xs">{r.description}</TableCell>
                      <TableCell className="text-xs text-right">{r.gst_percent}%</TableCell>
                      <TableCell className="text-xs text-right font-mono">{fmt(r.taxable_value)}</TableCell>
                      <TableCell className="text-xs text-right font-mono">{fmt(r.cgst)}</TableCell>
                      <TableCell className="text-xs text-right font-mono">{fmt(r.sgst)}</TableCell>
                      <TableCell className="text-xs text-right font-mono">{fmt(r.total_gst)}</TableCell>
                      <TableCell className="text-xs text-right">{r.invoice_count}</TableCell>
                    </TableRow>
                  ))}
                  {gstr1Data.filter(r => r.gst_percent > 0).length === 0 && (
                    <TableRow><TableCell colSpan={8} className="text-center text-xs text-muted-foreground py-6">No taxable supplies found</TableCell></TableRow>
                  )}
                  {/* Totals */}
                  <TableRow className="border-t-2 bg-muted/30 font-bold">
                    <TableCell colSpan={3} className="text-xs font-bold">TOTALS</TableCell>
                    <TableCell className="text-xs text-right font-mono font-bold">{fmt(gstr1Data.filter(r => r.gst_percent > 0).reduce((s, r) => s + r.taxable_value, 0))}</TableCell>
                    <TableCell className="text-xs text-right font-mono font-bold">{fmt(gstr1Data.filter(r => r.gst_percent > 0).reduce((s, r) => s + r.cgst, 0))}</TableCell>
                    <TableCell className="text-xs text-right font-mono font-bold">{fmt(gstr1Data.filter(r => r.gst_percent > 0).reduce((s, r) => s + r.sgst, 0))}</TableCell>
                    <TableCell className="text-xs text-right font-mono font-bold">{fmt(gstr1Data.filter(r => r.gst_percent > 0).reduce((s, r) => s + r.total_gst, 0))}</TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                </TableBody>
              </Table>

              {/* Exempt */}
              <div className="mt-6 p-4 bg-muted/30 rounded-md">
                <p className="text-xs font-semibold mb-1">Exempt Services (GST @ 0%)</p>
                <p className="text-[10px] text-muted-foreground mb-2">Healthcare services exempt under GST Notification 12/2017 — OPD, IPD, Lab, Radiology</p>
                <p className="text-sm font-bold font-mono text-foreground">
                  Total Exempt Value: {fmt(gstr1Data.filter(r => !r.gst_percent || r.gst_percent === 0).reduce((s, r) => s + r.taxable_value, 0))}
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══ GSTR-3B ═══ */}
        <TabsContent value="gstr3b">
          <Card className="border-border mt-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">GSTR-3B — Monthly Return Summary</CardTitle>
              <p className="text-xs text-muted-foreground">{dateRange.start} to {dateRange.end}</p>
            </CardHeader>
            <CardContent className="space-y-6">
              {(() => {
                // Output GST = CGST (2020) + SGST (2021) charged this period.
                // ITC = GST Input Tax Credit (1050) claimed this period.
                // Period-scoped (not cumulative) — a GSTR-3B return reports this
                // filing period's movement, not the lifetime GL balance.
                const outputGST = periodLiabilityBalance("2020") + periodLiabilityBalance("2021");
                const inputITC = periodAssetBalance("1050");
                const taxableSupplies = gstr1Data.filter(r => r.gst_percent > 0).reduce((s, r) => s + r.taxable_value, 0);
                const taxOnTaxable = gstr1Data.filter(r => r.gst_percent > 0).reduce((s, r) => s + r.total_gst, 0);
                const exemptSupplies = gstr1Data.filter(r => !r.gst_percent || r.gst_percent === 0).reduce((s, r) => s + r.taxable_value, 0);
                const netPayable = outputGST - inputITC;

                return (
                  <>
                    {/* 3.1 Outward Supplies */}
                    <div>
                      <p className="text-xs font-bold mb-2">3.1 Details of Outward Supplies</p>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Nature of Supplies</TableHead>
                            <TableHead className="text-xs text-right">Taxable Value (₹)</TableHead>
                            <TableHead className="text-xs text-right">Tax (₹)</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          <TableRow><TableCell className="text-xs">a) Taxable outward supplies</TableCell><TableCell className="text-xs text-right font-mono">{fmt(taxableSupplies)}</TableCell><TableCell className="text-xs text-right font-mono">{fmt(taxOnTaxable)}</TableCell></TableRow>
                          <TableRow><TableCell className="text-xs">b) Zero rated supplies</TableCell><TableCell className="text-xs text-right font-mono">{fmt(0)}</TableCell><TableCell className="text-xs text-right font-mono">{fmt(0)}</TableCell></TableRow>
                          <TableRow><TableCell className="text-xs">c) Exempt supplies (Healthcare)</TableCell><TableCell className="text-xs text-right font-mono">{fmt(exemptSupplies)}</TableCell><TableCell className="text-xs text-right font-mono">—</TableCell></TableRow>
                          <TableRow><TableCell className="text-xs">e) Non-GST supplies</TableCell><TableCell className="text-xs text-right font-mono">{fmt(0)}</TableCell><TableCell className="text-xs text-right font-mono">—</TableCell></TableRow>
                        </TableBody>
                      </Table>
                    </div>

                    {/* 4. ITC */}
                    <div>
                      <p className="text-xs font-bold mb-2">4. Eligible ITC (Input Tax Credit)</p>
                      <Table>
                        <TableBody>
                          <TableRow><TableCell className="text-xs">Inward supplies from registered persons</TableCell><TableCell className="text-xs text-right font-mono">{fmt(inputITC)}</TableCell></TableRow>
                          <TableRow className="bg-muted/30"><TableCell className="text-xs font-semibold">Net ITC Available</TableCell><TableCell className="text-xs text-right font-mono font-bold">{fmt(inputITC)}</TableCell></TableRow>
                        </TableBody>
                      </Table>
                      <p className="text-[10px] text-muted-foreground mt-1">Note: ITC on medicines for patient care is blocked under Section 17(5). Only ITC on equipment maintenance, IT, office supplies is eligible.</p>
                    </div>

                    {/* Net Tax Payable */}
                    <Card className={`border-2 ${netPayable > 0 ? "border-red-200 dark:border-red-800" : "border-emerald-200 dark:border-emerald-800"}`}>
                      <CardContent className="pt-4">
                        <p className="text-xs font-bold mb-3">NET TAX PAYABLE</p>
                        <div className="space-y-1.5 text-xs">
                          <div className="flex justify-between"><span>Output GST</span><span className="font-mono">{fmt(outputGST)}</span></div>
                          <div className="flex justify-between"><span>Less: ITC</span><span className="font-mono">({fmt(inputITC)})</span></div>
                          <div className="border-t border-border pt-1.5 flex justify-between font-bold text-sm">
                            <span>Net Payable</span>
                            <span className={`font-mono ${netPayable > 0 ? "text-red-500" : "text-emerald-700 dark:text-emerald-400"}`}>{netPayable > 0 ? fmt(netPayable) : `(${fmt(netPayable)}) Refundable`}</span>
                          </div>
                          {netPayable > 0 && (
                            <div className="grid grid-cols-2 gap-4 mt-2 pt-2 border-t border-border">
                              <div className="flex justify-between"><span>CGST</span><span className="font-mono">{fmt(netPayable / 2)}</span></div>
                              <div className="flex justify-between"><span>SGST</span><span className="font-mono">{fmt(netPayable / 2)}</span></div>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </>
                );
              })()}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══ TDS ═══ */}
        <TabsContent value="tds">
          <Card className="border-border mt-4">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm">TDS Summary — Form 26Q Preparation</CardTitle>
                <p className="text-xs text-muted-foreground">{dateRange.start} to {dateRange.end}</p>
              </div>
              <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => {
                const ws = XLSX.utils.json_to_sheet(tdsData);
                const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "TDS-26Q");
                XLSX.writeFile(wb, `TDS_26Q_${dateRange.start}_${dateRange.end}.xlsx`);
              }}><FileSpreadsheet className="h-3 w-3 mr-1" />Download 26Q Data</Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Date</TableHead>
                    <TableHead className="text-xs">Payee / Vendor</TableHead>
                    <TableHead className="text-xs">Category</TableHead>
                    <TableHead className="text-xs">Section</TableHead>
                    <TableHead className="text-xs text-right">Amount Paid</TableHead>
                    <TableHead className="text-xs text-right">TDS Rate</TableHead>
                    <TableHead className="text-xs text-right">TDS Deducted</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tdsData.map((t, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs font-mono">{t.date}</TableCell>
                      <TableCell className="text-xs">{t.vendor}</TableCell>
                      <TableCell className="text-xs capitalize">{t.category}</TableCell>
                      <TableCell className="text-xs font-mono">{t.section}</TableCell>
                      <TableCell className="text-xs text-right font-mono">{fmt(t.amount)}</TableCell>
                      <TableCell className="text-xs text-right">{t.tds_rate}%</TableCell>
                      <TableCell className="text-xs text-right font-mono">{fmt(t.tds_amount)}</TableCell>
                    </TableRow>
                  ))}
                  {tdsData.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-center text-xs text-muted-foreground py-6">No TDS-applicable expenses found</TableCell></TableRow>
                  )}
                  {tdsData.length > 0 && (
                    <TableRow className="border-t-2 bg-muted/30 font-bold">
                      <TableCell colSpan={4} className="text-xs font-bold">QUARTER TOTAL</TableCell>
                      <TableCell className="text-xs text-right font-mono font-bold">{fmt(tdsData.reduce((s, t) => s + t.amount, 0))}</TableCell>
                      <TableCell></TableCell>
                      <TableCell className="text-xs text-right font-mono font-bold">{fmt(tdsData.reduce((s, t) => s + t.tds_amount, 0))}</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══ TALLY EXPORT ═══ */}
        <TabsContent value="tally">
          <div className="space-y-4 mt-4">
            {/* Period + Load */}
            <Card className="border-border">
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-sm">Tally Prime Export</CardTitle>
                  <p className="text-xs text-muted-foreground">Period: {dateRange.start} to {dateRange.end}</p>
                </div>
                <Button size="sm" variant="outline" onClick={loadTallyData} disabled={tallyDataLoading} className="text-xs">
                  {tallyDataLoading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                  {tallyBills.length === 0 && !tallyDataLoading ? "Load Data" : "Refresh"}
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Voucher type selection */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { key: "sales", label: "Sales Vouchers", desc: "Finalised bills", count: tallyBills.length, checked: includeSales, set: setIncludeSales },
                    { key: "receipts", label: "Receipt Vouchers", desc: "Payments received", count: tallyPayments.length, checked: includeReceipts, set: setIncludeReceipts },
                    { key: "purchases", label: "Purchase Vouchers", desc: "Drug batches bought", count: tallyBatches.length, checked: includePurchases, set: setIncludePurchases },
                    { key: "journals", label: "Journal Entries", desc: "Manual / adjustment", count: journalEntriesForExport.length, checked: includeJournals, set: setIncludeJournals },
                  ].map(({ key, label, desc, count, checked, set }) => (
                    <label key={key} className={`flex items-start gap-2 p-3 rounded-md border cursor-pointer transition-colors ${checked ? "border-primary bg-primary/5" : "border-border bg-muted/20"}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => set(e.target.checked)}
                        className="mt-0.5 rounded"
                      />
                      <div>
                        <p className="text-xs font-semibold text-foreground">{label}</p>
                        <p className="text-[10px] text-muted-foreground">{desc}</p>
                        {tallyBills.length > 0 || tallyPayments.length > 0 ? (
                          <Badge variant="secondary" className="text-[9px] mt-1">{count} records</Badge>
                        ) : null}
                      </div>
                    </label>
                  ))}
                </div>

                {tallyDataLoading && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> Loading data from Supabase…
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => handleTallyExport("download")}
                    disabled={exporting || tallyDataLoading || tallyBills.length + tallyPayments.length + journalEntriesForExport.length === 0}
                  >
                    {exporting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
                    Download XML
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleTallyExport("email")}
                    disabled={exporting || tallyDataLoading}
                  >
                    <Mail className="h-4 w-4 mr-1" /> Email to Billing
                  </Button>
                </div>

                {/* Import instructions */}
                <div className="p-3 border border-border rounded-md bg-muted/20">
                  <p className="text-xs font-semibold mb-1">Import into Tally Prime</p>
                  <ol className="text-xs text-muted-foreground space-y-0.5 list-decimal pl-4">
                    <li>Open Tally Prime → Gateway of Tally → Import → Data</li>
                    <li>Select the downloaded XML file</li>
                    <li>All vouchers import automatically (Sales, Receipts, Journals)</li>
                  </ol>
                </div>
              </CardContent>
            </Card>

            {/* Export history */}
            {exportLogs.length > 0 && (
              <Card className="border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Export History</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Date</TableHead>
                        <TableHead className="text-xs">Type</TableHead>
                        <TableHead className="text-xs">Period</TableHead>
                        <TableHead className="text-xs text-right">Vouchers</TableHead>
                        <TableHead className="text-xs">Method</TableHead>
                        <TableHead className="text-xs">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {exportLogs.map((log: any) => (
                        <TableRow key={log.id}>
                          <TableCell className="text-xs font-mono">{new Date(log.exported_at).toLocaleDateString("en-IN")}</TableCell>
                          <TableCell className="text-xs">{log.export_type}</TableCell>
                          <TableCell className="text-xs font-mono">{log.date_from} – {log.date_to}</TableCell>
                          <TableCell className="text-xs text-right">{log.voucher_count}</TableCell>
                          <TableCell><Badge variant="outline" className="text-[9px]">{log.delivery_method}</Badge></TableCell>
                          <TableCell>
                            <Badge variant={log.delivery_status === "sent" ? "default" : "destructive"} className="text-[9px]">
                              {log.delivery_status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* ═══ DEPARTMENT P&L ═══ */}
        <TabsContent value="dept">
          <Card className="border-border mt-4">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm">Department-wise Profit & Loss</CardTitle>
                <p className="text-xs text-muted-foreground">{dateRange.start} to {dateRange.end}</p>
              </div>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={showOverhead} onChange={e => setShowOverhead(e.target.checked)} className="rounded" />
                Allocate shared overheads
              </label>
            </CardHeader>
            <CardContent>
              {(() => {
                // Calculate dept-level P&L
                const totalSharedExpenses = sumGroup([...PNL_INFRA, ...PNL_ADMIN], expenseBalance);
                const deptResults = departments.map(dept => {
                  // Revenue: from bill_line_items attributed to this department
                  const revenue = deptBillItems
                    .filter((bi: any) => bi.department === dept.name)
                    .reduce((s: number, bi: any) => s + Number(bi.total_amount || 0), 0);

                  // Direct expenses: from this period's journal lines tagged to this
                  // department's cost centre (entry_date-filtered, via `lineItems`).
                  const directExpenses = lineItems
                    .filter((li) => li.cost_centre_id === dept.id && li.account_code?.startsWith("5"))
                    .reduce((s: number, li) => s + Number(li.debit_amount || 0) - Number(li.credit_amount || 0), 0);

                  // Overhead allocation: proportional by revenue
                  const overheadShare = showOverhead && totalIncome > 0
                    ? (revenue / totalIncome) * totalSharedExpenses
                    : 0;

                  const profit = revenue - directExpenses - overheadShare;
                  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

                  return { ...dept, revenue, directExpenses, overheadShare, profit, margin };
                }).sort((a, b) => b.profit - a.profit);

                const maxRevenue = Math.max(...deptResults.map(d => d.revenue), 1);

                return (
                  <>
                    {/* Comparison Table */}
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Department</TableHead>
                          <TableHead className="text-xs text-right">Revenue (₹)</TableHead>
                          <TableHead className="text-xs text-right">Direct Exp (₹)</TableHead>
                          {showOverhead && <TableHead className="text-xs text-right">Overhead (₹)</TableHead>}
                          <TableHead className="text-xs text-right">Profit (₹)</TableHead>
                          <TableHead className="text-xs text-right w-20">Margin</TableHead>
                          <TableHead className="text-xs w-32">Performance</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {deptResults.map(d => (
                          <TableRow key={d.id}>
                            <TableCell className="text-xs font-medium">{d.name}</TableCell>
                            <TableCell className="text-xs text-right font-mono">{fmt(d.revenue)}</TableCell>
                            <TableCell className="text-xs text-right font-mono">{fmt(d.directExpenses)}</TableCell>
                            {showOverhead && <TableCell className="text-xs text-right font-mono text-muted-foreground">{fmt(d.overheadShare)}</TableCell>}
                            <TableCell className={`text-xs text-right font-mono font-semibold ${d.profit >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-500"}`}>
                              {d.profit < 0 ? `(${fmt(d.profit)})` : fmt(d.profit)}
                            </TableCell>
                            <TableCell className={`text-xs text-right font-mono ${d.margin >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-500"}`}>
                              {d.margin.toFixed(1)}%
                            </TableCell>
                            <TableCell>
                              <div className="w-full bg-muted rounded-full h-2">
                                <div
                                  className={`h-2 rounded-full ${d.margin >= 20 ? "bg-emerald-500" : d.margin >= 0 ? "bg-amber-500" : "bg-red-500"}`}
                                  style={{ width: `${Math.min((d.revenue / maxRevenue) * 100, 100)}%` }}
                                />
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                        {deptResults.length === 0 && (
                          <TableRow><TableCell colSpan={showOverhead ? 7 : 6} className="text-center text-xs text-muted-foreground py-8">No department data available. Ensure billing line items have department attribution.</TableCell></TableRow>
                        )}
                        {deptResults.length > 0 && (
                          <TableRow className="border-t-2 bg-muted/30 font-bold">
                            <TableCell className="text-xs font-bold">TOTAL</TableCell>
                            <TableCell className="text-xs text-right font-mono font-bold">{fmt(deptResults.reduce((s, d) => s + d.revenue, 0))}</TableCell>
                            <TableCell className="text-xs text-right font-mono font-bold">{fmt(deptResults.reduce((s, d) => s + d.directExpenses, 0))}</TableCell>
                            {showOverhead && <TableCell className="text-xs text-right font-mono font-bold">{fmt(deptResults.reduce((s, d) => s + d.overheadShare, 0))}</TableCell>}
                            <TableCell className="text-xs text-right font-mono font-bold">{fmt(deptResults.reduce((s, d) => s + d.profit, 0))}</TableCell>
                            <TableCell colSpan={2}></TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </>
                );
              })()}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ReportsTab;
