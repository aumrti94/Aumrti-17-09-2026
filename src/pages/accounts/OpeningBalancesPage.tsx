import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, ChevronRight, ChevronLeft, Landmark, Wallet, FileText, Building2, CreditCard } from "lucide-react";
import { toast } from "sonner";

const STEPS = [
  { title: "Opening Date", icon: FileText, desc: "When are you starting accounting in HMS?" },
  { title: "Cash & Bank", icon: Wallet, desc: "Enter cash and bank balances" },
  { title: "Receivables", icon: CreditCard, desc: "Outstanding amounts from patients & insurance" },
  { title: "Payables", icon: Building2, desc: "Outstanding amounts to vendors" },
  { title: "Loans", icon: Landmark, desc: "Any outstanding loans" },
];

const OpeningBalancesPage: React.FC = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [openingDate, setOpeningDate] = useState(new Date().toISOString().split("T")[0]);
  const [balances, setBalances] = useState({
    cash_in_hand: 0, main_bank: 0, savings: 0,
    patient_receivable: 0, insurance_receivable: 0, pmjay_receivable: 0,
    vendor_payable: 0, drug_payable: 0, patient_advance: 0,
    bank_loan: 0, equipment_loan: 0,
  });

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from("users").select("id, hospital_id").eq("auth_user_id", user.id).maybeSingle();
      if (data) { setHospitalId(data.hospital_id); setUserId(data.id); }
    })();
  }, []);

  const setVal = (key: keyof typeof balances, val: string) => {
    setBalances(p => ({ ...p, [key]: parseFloat(val) || 0 }));
  };

  const fmt = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

  const handleSubmit = async () => {
    if (!hospitalId || !userId) { toast.error("Not logged in"); return; }
    setSaving(true);

    try {
      // Get account IDs by code
      const { data: accounts } = await (supabase as any)
        .from("chart_of_accounts")
        .select("id, code, name")
        .eq("hospital_id", hospitalId);

      const codeToId: Record<string, string> = {};
      (accounts || []).forEach((a: any) => { codeToId[a.code] = a.id; });

      // Build line items: debit assets, credit liabilities
      const lines: { code: string; debit: number; credit: number }[] = [];

      // Assets (debit)
      if (balances.cash_in_hand > 0) lines.push({ code: "1001", debit: balances.cash_in_hand, credit: 0 });
      if (balances.main_bank > 0) lines.push({ code: "1002", debit: balances.main_bank, credit: 0 });
      if (balances.savings > 0) lines.push({ code: "1003", debit: balances.savings, credit: 0 });
      if (balances.patient_receivable > 0) lines.push({ code: "1010", debit: balances.patient_receivable, credit: 0 });
      if (balances.insurance_receivable > 0) lines.push({ code: "1011", debit: balances.insurance_receivable, credit: 0 });
      if (balances.pmjay_receivable > 0) lines.push({ code: "1012", debit: balances.pmjay_receivable, credit: 0 });

      // Liabilities (credit)
      if (balances.vendor_payable > 0) lines.push({ code: "2001", debit: 0, credit: balances.vendor_payable });
      if (balances.drug_payable > 0) lines.push({ code: "2002", debit: 0, credit: balances.drug_payable });
      if (balances.patient_advance > 0) lines.push({ code: "2030", debit: 0, credit: balances.patient_advance });
      if (balances.bank_loan > 0) lines.push({ code: "2100", debit: 0, credit: balances.bank_loan });
      if (balances.equipment_loan > 0) lines.push({ code: "2101", debit: 0, credit: balances.equipment_loan });

      // Balance to Capital Account (equity = assets - liabilities)
      const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
      const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
      const diff = totalDebit - totalCredit;
      if (Math.abs(diff) > 0.01) {
        lines.push({ code: "3001", debit: diff < 0 ? Math.abs(diff) : 0, credit: diff > 0 ? diff : 0 });
      }

      if (lines.length === 0) { toast.error("No balances entered"); setSaving(false); return; }

      // Create journal entry
      const { count } = await supabase.from("journal_entries").select("*", { count: "exact", head: true }).eq("hospital_id", hospitalId);
      const entryNumber = `JE-OB-${String((count || 0) + 1).padStart(4, "0")}`;
      const finalDebit = lines.reduce((s, l) => s + l.debit, 0);
      const finalCredit = lines.reduce((s, l) => s + l.credit, 0);

      const { data: entry, error: entryErr } = await (supabase as any).from("journal_entries").insert({
        hospital_id: hospitalId,
        entry_number: entryNumber,
        entry_date: openingDate,
        description: `Opening balances as at ${openingDate}`,
        entry_type: "opening_balance",
        source_module: "accounts",
        total_debit: finalDebit,
        total_credit: finalCredit,
        is_balanced: Math.abs(finalDebit - finalCredit) < 0.01,
        posted_by: userId,
      }).select("id").maybeSingle();

      if (entryErr) throw entryErr;

      // Insert line items
      const accountNames: Record<string, string> = {};
      (accounts || []).forEach((a: any) => { accountNames[a.code] = a.name || a.code; });

      const lineItemRows = lines.map(l => ({
        journal_entry_id: entry.id,
        journal_id: entry.id,
        hospital_id: hospitalId,
        account_id: codeToId[l.code] || null,
        account_code: l.code,
        account_name: accountNames[l.code] || l.code,
        debit_amount: l.debit,
        credit_amount: l.credit,
      }));

      const { error: liErr } = await (supabase as any).from("journal_line_items").insert(lineItemRows);
      if (liErr) throw liErr;

      // Update opening_balance on chart_of_accounts
      for (const l of lines) {
        if (codeToId[l.code]) {
          await (supabase as any).from("chart_of_accounts").update({ opening_balance: l.debit > 0 ? l.debit : -l.credit }).eq("id", codeToId[l.code]);
        }
      }

      toast.success(`Opening balances recorded — ${entryNumber}`);
      navigate("/accounts");
    } catch (err: any) {
      toast.error("Failed: " + (err?.message || "Unknown error"));
    }
    setSaving(false);
  };

  const InputRow = ({ label, field, icon }: { label: string; field: keyof typeof balances; icon?: string }) => (
    <div className="flex items-center gap-3">
      <label className="text-xs text-foreground flex-1">{label}</label>
      <div className="relative w-48">
        <span className="absolute left-3 top-2 text-xs text-muted-foreground">₹</span>
        <Input
          type="number"
          className="pl-7 h-9 text-xs text-right font-mono"
          value={balances[field] || ""}
          onChange={e => setVal(field, e.target.value)}
          placeholder="0.00"
        />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-xl">
        {/* Progress */}
        <div className="flex items-center gap-2 mb-6">
          {STEPS.map((s, i) => (
            <React.Fragment key={i}>
              <div className={`flex items-center gap-1.5 ${i <= step ? "text-primary" : "text-muted-foreground"}`}>
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${i < step ? "bg-primary text-primary-foreground" : i === step ? "border-2 border-primary text-primary" : "border border-border text-muted-foreground"}`}>
                  {i < step ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
                </div>
                <span className="text-[10px] hidden sm:inline">{s.title}</span>
              </div>
              {i < STEPS.length - 1 && <div className={`flex-1 h-px ${i < step ? "bg-primary" : "bg-border"}`} />}
            </React.Fragment>
          ))}
        </div>

        <Card className="border-border">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              {React.createElement(STEPS[step].icon, { className: "h-5 w-5 text-primary" })}
              <CardTitle className="text-base">{STEPS[step].title}</CardTitle>
            </div>
            <p className="text-xs text-muted-foreground">{STEPS[step].desc}</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {step === 0 && (
              <div>
                <label className="text-xs text-muted-foreground block mb-2">When are you starting accounting in HMS?</label>
                <Input type="date" className="w-60 h-9 text-xs" value={openingDate} onChange={e => setOpeningDate(e.target.value)} />
                <p className="text-[10px] text-muted-foreground mt-2">All journal entries will be recorded from this date onwards. Historical data before this date should be entered as opening balances.</p>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-3">
                <InputRow label="Cash in Hand" field="cash_in_hand" />
                <InputRow label="Main Bank Account" field="main_bank" />
                <InputRow label="Savings Account (optional)" field="savings" />
              </div>
            )}

            {step === 2 && (
              <div className="space-y-3">
                <InputRow label="Outstanding Patient Dues" field="patient_receivable" />
                <InputRow label="Insurance Outstanding" field="insurance_receivable" />
                <InputRow label="PMJAY Outstanding" field="pmjay_receivable" />
              </div>
            )}

            {step === 3 && (
              <div className="space-y-3">
                <InputRow label="Outstanding Vendor Dues" field="vendor_payable" />
                <InputRow label="Drug Supplier Dues" field="drug_payable" />
                <InputRow label="Advance from Patients" field="patient_advance" />
              </div>
            )}

            {step === 4 && (
              <div className="space-y-3">
                <InputRow label="Bank Loan Outstanding" field="bank_loan" />
                <InputRow label="Equipment Loan" field="equipment_loan" />

                {/* Summary */}
                <div className="mt-4 p-4 bg-muted/30 rounded-md space-y-1.5 text-xs">
                  <p className="font-semibold mb-2">Opening Balance Summary</p>
                  <div className="flex justify-between"><span>Total Assets</span><span className="font-mono font-medium">{fmt(balances.cash_in_hand + balances.main_bank + balances.savings + balances.patient_receivable + balances.insurance_receivable + balances.pmjay_receivable)}</span></div>
                  <div className="flex justify-between"><span>Total Liabilities</span><span className="font-mono font-medium">{fmt(balances.vendor_payable + balances.drug_payable + balances.patient_advance + balances.bank_loan + balances.equipment_loan)}</span></div>
                  <div className="border-t border-border pt-1.5 flex justify-between font-semibold">
                    <span>Capital (Equity)</span>
                    <span className="font-mono">{fmt((balances.cash_in_hand + balances.main_bank + balances.savings + balances.patient_receivable + balances.insurance_receivable + balances.pmjay_receivable) - (balances.vendor_payable + balances.drug_payable + balances.patient_advance + balances.bank_loan + balances.equipment_loan))}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Navigation */}
            <div className="flex justify-between pt-4">
              <Button variant="outline" size="sm" disabled={step === 0} onClick={() => setStep(s => s - 1)}>
                <ChevronLeft className="h-4 w-4 mr-1" /> Back
              </Button>
              {step < STEPS.length - 1 ? (
                <Button size="sm" onClick={() => setStep(s => s + 1)}>
                  Next <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              ) : (
                <Button size="sm" onClick={handleSubmit} disabled={saving}>
                  {saving ? "Saving..." : "Save Opening Balances"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default OpeningBalancesPage;
