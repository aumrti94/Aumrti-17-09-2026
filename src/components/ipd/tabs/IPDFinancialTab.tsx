import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { syncAdvanceToBill } from "@/lib/advanceBillSync";
import { resolveRoomRateFallback } from "@/lib/ipdBilling";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2, Plus, RefreshCw, ArrowUpCircle, ArrowDownCircle, Wallet } from "lucide-react";

interface Props {
  admissionId: string;
  patientId: string;
  hospitalId: string;
  userId: string | null;
  patientName?: string;
}

interface LedgerLine {
  date: string;
  description: string;
  amount: number;
  category: "room" | "pharmacy" | "lab" | "other";
}

interface AdvanceTx {
  id: string;
  transaction_type: string;
  amount: number;
  payment_mode: string | null;
  reference_no: string | null;
  description: string | null;
  created_at: string;
  collected_by_name: string | null;
}

const CATEGORY_COLORS: Record<string, string> = {
  room:     "bg-blue-50 text-blue-700",
  pharmacy: "bg-purple-50 text-purple-700",
  lab:      "bg-amber-50 text-amber-700",
  other:    "bg-slate-50 text-slate-600",
};

const TX_ICONS: Record<string, React.ReactElement> = {
  deposit:       <ArrowUpCircle className="h-3.5 w-3.5 text-emerald-600 shrink-0" />,
  refund:        <ArrowUpCircle className="h-3.5 w-3.5 text-blue-600 shrink-0" />,
  service_debit: <ArrowDownCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />,
  adjustment:    <ArrowUpCircle className="h-3.5 w-3.5 text-amber-600 shrink-0" />,
};

const fmt = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

// Map a bill_line_items.item_type to a ledger display category.
const categorizeItem = (itemType?: string | null): LedgerLine["category"] => {
  const t = (itemType || "").toLowerCase();
  if (t.includes("room") || t.includes("bed")) return "room";
  if (t.includes("pharm") || t.includes("drug") || t.includes("medic")) return "pharmacy";
  if (t.includes("lab") || t.includes("investig")) return "lab";
  return "other";
};

const IPDFinancialTab: React.FC<Props> = ({ admissionId, patientId, hospitalId, userId, patientName }) => {
  const [chargeLines, setChargeLines] = useState<LedgerLine[]>([]);
  const [advanceTxns, setAdvanceTxns] = useState<AdvanceTx[]>([]);
  const [totalDeposited, setTotalDeposited] = useState(0);
  const [totalDebited, setTotalDebited] = useState(0);
  const [loading, setLoading] = useState(true);
  // true = charges shown are a pre-bill estimate; false = read from the real IPD bill.
  const [isEstimate, setIsEstimate] = useState(false);
  const [noDiagnosis, setNoDiagnosis] = useState(false);

  // Deposit form
  const [showDeposit, setShowDeposit] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [paymentMode, setPaymentMode] = useState("cash");
  const [referenceNo, setReferenceNo] = useState("");
  const [depositNote, setDepositNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    let charges: LedgerLine[] = [];

    // Admission meta — room-rate inputs + diagnosis (for the soft pre-billing warning)
    const { data: adm } = await (supabase as any)
      .from("admissions")
      .select("admitted_at, admitting_diagnosis, wards(rate_per_day), beds!admissions_bed_id_fkey(bed_category)")
      .eq("id", admissionId)
      .maybeSingle();
    setNoDiagnosis(!adm?.admitting_diagnosis);

    // Authoritative IPD bill? If one exists, the ledger mirrors it exactly — room, lab,
    // pharmacy etc. are already priced and deduped server-side by autoPullAdmissionCharges.
    const { data: ipdBill, error: billErr } = await (supabase as any)
      .from("bills")
      .select("id")
      .eq("hospital_id", hospitalId)
      .eq("admission_id", admissionId)
      .eq("bill_type", "ipd")
      .neq("payment_status", "cancelled")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (billErr) console.error("IPD ledger: bill lookup failed:", billErr.message);

    if (ipdBill?.id) {
      // ── Authoritative path: render the real bill's line items ──
      const { data: lineItems, error: liErr } = await (supabase as any)
        .from("bill_line_items")
        .select("description, total_amount, item_type, created_at")
        .eq("bill_id", ipdBill.id)
        .order("created_at", { ascending: true });
      if (liErr) console.error("IPD ledger: bill line items failed:", liErr.message);
      charges = (lineItems || [])
        .filter((li: any) => Number(li.total_amount))
        .map((li: any) => ({
          date: (li.created_at || "").split("T")[0],
          description: li.description || "Service charge",
          amount: Number(li.total_amount),
          category: categorizeItem(li.item_type),
        }));
      setIsEstimate(false);
    } else {
      // ── Estimate path (no bill yet): live estimate; labs are priced at billing ──
      setIsEstimate(true);

      if (adm?.admitted_at) {
        const days = Math.max(1, Math.ceil(
          (Date.now() - new Date(adm.admitted_at).getTime()) / 86400000
        ));
        const cat = adm.beds?.bed_category || "general";
        // Ward's configured Rate Per Day (Settings → Wards & Beds), else the category
        // default — shared with ipdBilling.ts so the estimate matches the eventual bill.
        const rate = resolveRoomRateFallback(adm.wards?.rate_per_day, cat);
        charges.push({
          date: new Date(adm.admitted_at).toISOString().split("T")[0],
          description: `Room — ${cat.replace("_", " ")} × ${days} day${days !== 1 ? "s" : ""} @ ₹${rate.toLocaleString("en-IN")}`,
          amount: rate * days,
          category: "room",
        });
      }

      // Pharmacy
      const { data: pharm } = await (supabase as any)
        .from("pharmacy_dispensing_records")
        .select("total_amount, dispensed_at, notes")
        .eq("admission_id", admissionId)
        .order("dispensed_at", { ascending: true });

      (pharm || []).forEach((r: any) => {
        if (r.total_amount) {
          charges.push({
            date: (r.dispensed_at || "").split("T")[0],
            description: `Pharmacy${r.notes ? ` — ${r.notes}` : ""}`,
            amount: Number(r.total_amount),
            category: "pharmacy",
          });
        }
      });

      // Lab orders — priced when the IPD bill is generated
      const { data: labs } = await (supabase as any)
        .from("lab_orders")
        .select("order_date, id")
        .eq("admission_id", admissionId)
        .neq("status", "cancelled");

      (labs || []).forEach((l: any) => {
        charges.push({
          date: l.order_date,
          description: `Lab Order — ${l.id.slice(0, 8).toUpperCase()}`,
          amount: 0,
          category: "lab",
        });
      });
    }

    charges.sort((a, b) => a.date.localeCompare(b.date));
    setChargeLines(charges);

    // Advances — ipd_advances (primary) + unmirrored advance_receipts (legacy)
    const [balRes, txRes, receiptsRes, ipdAdvRefs] = await Promise.all([
      (supabase as any)
        .from("ipd_advance_balances")
        .select("balance, total_deposited, total_debited")
        .eq("admission_id", admissionId)
        .maybeSingle(),
      (supabase as any)
        .from("ipd_advances")
        .select("id, transaction_type, amount, payment_mode, reference_no, description, created_at, users(full_name)")
        .eq("admission_id", admissionId)
        .order("created_at", { ascending: false }),
      (supabase as any)
        .from("advance_receipts")
        .select("id, amount, payment_mode, receipt_number, notes, created_at")
        .eq("hospital_id", hospitalId)
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false }),
      (supabase as any)
        .from("ipd_advances")
        .select("reference_no")
        .eq("admission_id", admissionId)
        .not("reference_no", "is", null),
    ]);

    const ipdTxns: AdvanceTx[] = (txRes.data || []).map((t: any) => ({
      id: t.id,
      transaction_type: t.transaction_type,
      amount: Number(t.amount),
      payment_mode: t.payment_mode,
      reference_no: t.reference_no,
      description: t.description,
      created_at: t.created_at,
      collected_by_name: t.users?.full_name || null,
    }));

    const mirroredRefs = new Set(
      (ipdAdvRefs.data || []).map((r: any) => r.reference_no)
    );
    const unmirroredReceipts = (receiptsRes.data || []).filter(
      (r: any) => !mirroredRefs.has(r.receipt_number)
    );
    const receiptTxns: AdvanceTx[] = unmirroredReceipts.map((r: any) => ({
      id: r.id,
      transaction_type: "deposit",
      amount: Number(r.amount),
      payment_mode: r.payment_mode,
      reference_no: r.receipt_number,
      description: r.notes || "Advance deposit",
      created_at: r.created_at,
      collected_by_name: null,
    }));

    const unmirroredTotal = unmirroredReceipts.reduce(
      (s: number, r: any) => s + Number(r.amount || 0), 0
    );
    const ipdDeposited = Number(balRes.data?.total_deposited) || 0;
    const ipdDebited   = Number(balRes.data?.total_debited)   || 0;

    setTotalDeposited(ipdDeposited + unmirroredTotal);
    setTotalDebited(ipdDebited);

    const all = [...ipdTxns, ...receiptTxns].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    setAdvanceTxns(all);
    setLoading(false);
  }, [admissionId, patientId, hospitalId]);

  useEffect(() => { load(); }, [load]);

  const handleDeposit = async () => {
    const amount = parseFloat(depositAmount);
    if (!amount || amount <= 0) { toast.error("Enter a valid amount"); return; }
    setSaving(true);
    try {
      const { error } = await (supabase as any).from("ipd_advances").insert({
        hospital_id:      hospitalId,
        admission_id:     admissionId,
        patient_id:       patientId,
        amount,
        transaction_type: "deposit",
        payment_mode:     paymentMode,
        reference_no:     referenceNo || null,
        description:      depositNote || "Advance deposit",
        collected_by:     userId,
      });
      if (error) throw error;

      // Sync to bill_payments so billing, analytics and dashboard reflect the receipt
      await syncAdvanceToBill({
        admissionId,
        hospitalId,
        amount,
        paymentMode,
        userId,
        referenceNo: referenceNo || null,
        notes:       depositNote || "Advance deposit",
      });

      toast.success(`₹${amount.toLocaleString("en-IN")} advance collected`);
      setShowDeposit(false);
      setDepositAmount(""); setReferenceNo(""); setDepositNote("");
      load();
    } catch (e: any) {
      toast.error(e.message || "Failed to record advance");
    } finally {
      setSaving(false);
    }
  };

  const totalCharges  = chargeLines.reduce((s, l) => s + l.amount, 0);
  const balanceDue    = totalCharges - totalDeposited;
  const isRefund      = balanceDue < 0;
  const balanceColor  = balanceDue > 0 ? "text-amber-700" : isRefund ? "text-blue-700" : "text-emerald-700";
  const balanceBg     = balanceDue > 0 ? "bg-amber-50"   : isRefund ? "bg-blue-50"    : "bg-emerald-50";

  return (
    <div className="h-full flex flex-col overflow-hidden p-4 gap-3">

      {/* ── Summary row ── */}
      <div className="grid grid-cols-3 gap-3 flex-shrink-0">
        <div className="bg-muted/50 rounded-lg p-3">
          <p className="text-[11px] text-muted-foreground">Total Charges</p>
          <p className="text-lg font-bold">{fmt(totalCharges)}</p>
        </div>
        <div className="bg-emerald-50 rounded-lg p-3">
          <p className="text-[11px] text-emerald-700">Advance Paid</p>
          <p className="text-lg font-bold text-emerald-700">{fmt(totalDeposited)}</p>
          {totalDebited > 0 && (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Applied: {fmt(totalDebited)} · Balance: {fmt(totalDeposited - totalDebited)}
            </p>
          )}
        </div>
        <div className={`rounded-lg p-3 ${balanceBg}`}>
          <p className={`text-[11px] ${balanceColor}`}>
            {isRefund ? "⬅ Refund Due" : "Balance Due"}
          </p>
          <p className={`text-lg font-bold ${balanceColor}`}>
            {balanceDue > 0 ? fmt(balanceDue) : isRefund ? fmt(Math.abs(balanceDue)) : "Nil"}
          </p>
          {isRefund && (
            <p className="text-[10px] text-blue-600 mt-0.5">Patient overpaid — refund required</p>
          )}
        </div>
      </div>

      {/* ── Two-panel body ── */}
      <div className="flex-1 flex gap-3 overflow-hidden min-h-0">

        {/* Left: Charges ledger */}
        <div className="flex-1 flex flex-col overflow-hidden rounded-lg border border-border">
          <div className="flex-shrink-0 px-3 py-2 bg-muted/40 border-b border-border space-y-1">
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Charges</p>
              {!loading && isEstimate && (
                <span className="text-[10px] font-semibold px-1.5 py-px rounded-full bg-amber-50 text-amber-700">
                  Estimate — IPD bill not yet generated
                </span>
              )}
              {!loading && !isEstimate && (
                <span className="text-[10px] font-semibold px-1.5 py-px rounded-full bg-emerald-50 text-emerald-700">
                  From IPD bill
                </span>
              )}
            </div>
            {!loading && noDiagnosis && (
              <p className="text-[10px] text-amber-700">
                ⚠ No admitting diagnosis recorded — add a provisional diagnosis before finalising billing.
              </p>
            )}
          </div>
          {loading ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
            </div>
          ) : chargeLines.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              No charges recorded
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/70 backdrop-blur z-10">
                  <tr className="text-[10px] font-semibold text-muted-foreground uppercase">
                    <th className="text-left py-2 px-3">Date</th>
                    <th className="text-left py-2 px-3">Description</th>
                    <th className="text-center py-2 px-3">Type</th>
                    <th className="text-right py-2 px-3">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {chargeLines.map((l, i) => (
                    <tr key={i} className="hover:bg-muted/20 transition-colors">
                      <td className="py-2 px-3 text-xs tabular-nums text-muted-foreground whitespace-nowrap">
                        {l.date
                          ? new Date(l.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })
                          : "—"}
                      </td>
                      <td className="py-2 px-3 text-xs">{l.description}</td>
                      <td className="py-2 px-3 text-center">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold capitalize ${CATEGORY_COLORS[l.category]}`}>
                          {l.category}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums font-semibold text-sm">
                        {l.amount > 0
                          ? fmt(l.amount)
                          : <span className="text-muted-foreground text-xs">Pending</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-border">
                  <tr className="bg-muted/30 font-bold">
                    <td colSpan={3} className="py-2 px-3 text-xs text-right text-muted-foreground uppercase">Total</td>
                    <td className="py-2 px-3 text-right text-sm tabular-nums">{fmt(totalCharges)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        {/* Right: Advance panel */}
        <div className="w-72 flex flex-col overflow-hidden rounded-lg border border-border">
          <div className="flex-shrink-0 flex items-center justify-between px-3 py-2 bg-muted/40 border-b border-border">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Advance{patientName ? ` — ${patientName}` : ""}
            </p>
            <div className="flex gap-1">
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={load} disabled={loading}>
                <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
              </Button>
              <Button size="sm" className="h-6 px-2 text-xs" onClick={() => setShowDeposit(true)}>
                <Plus className="h-3 w-3 mr-1" /> Collect
              </Button>
            </div>
          </div>

          {loading ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : advanceTxns.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground px-3 text-center">
              No advance transactions yet
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto divide-y divide-border/40">
              {advanceTxns.map((tx) => {
                const isCredit = tx.transaction_type === "deposit" || tx.transaction_type === "adjustment";
                return (
                  <div key={tx.id} className="flex items-start gap-2 px-3 py-2 hover:bg-muted/20 transition-colors">
                    {TX_ICONS[tx.transaction_type] ?? <Wallet className="h-3.5 w-3.5 shrink-0 mt-0.5" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs truncate">{tx.description || tx.transaction_type}</p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {new Date(tx.created_at).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
                        {tx.payment_mode && ` · ${tx.payment_mode}`}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-xs font-semibold ${isCredit ? "text-emerald-600" : "text-red-600"}`}>
                        {isCredit ? "+" : "−"}₹{tx.amount.toLocaleString("en-IN")}
                      </p>
                      <Badge variant="outline" className="text-[9px] py-0 px-1 capitalize mt-0.5">
                        {tx.transaction_type.replace("_", " ")}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Advance balance footer */}
          <div className="flex-shrink-0 border-t border-border bg-muted/30 px-3 py-2 space-y-0.5">
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>Total Deposited</span>
              <span className="font-semibold text-emerald-700">{fmt(totalDeposited)}</span>
            </div>
            {totalDebited > 0 && (
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>Applied to Bill</span>
                <span className="font-semibold text-red-600">−{fmt(totalDebited)}</span>
              </div>
            )}
            <div className="flex justify-between text-[11px] font-bold border-t border-border/60 pt-1 mt-1">
              <span>Advance Balance</span>
              <span className={totalDeposited - totalDebited >= 0 ? "text-emerald-700" : "text-red-600"}>
                {fmt(totalDeposited - totalDebited)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Collect Advance modal */}
      <Dialog open={showDeposit} onOpenChange={setShowDeposit}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Collect Advance</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Amount (₹) *</Label>
              <Input
                type="number"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder="0"
                className="mt-1"
                autoFocus
              />
            </div>
            <div>
              <Label className="text-xs">Payment Mode</Label>
              <Select value={paymentMode} onValueChange={setPaymentMode}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="upi">UPI</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="neft">NEFT/RTGS</SelectItem>
                  <SelectItem value="cheque">Cheque</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {paymentMode !== "cash" && (
              <div>
                <Label className="text-xs">Reference / Transaction No.</Label>
                <Input value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} className="mt-1" />
              </div>
            )}
            <div>
              <Label className="text-xs">Note</Label>
              <Input value={depositNote} onChange={(e) => setDepositNote(e.target.value)} placeholder="Optional" className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeposit(false)}>Cancel</Button>
            <Button onClick={handleDeposit} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Collect ₹{parseFloat(depositAmount || "0").toLocaleString("en-IN")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default IPDFinancialTab;
