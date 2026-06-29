import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Plus, TrendingUp, TrendingDown, Wallet, RefreshCw, ArrowUpCircle, ArrowDownCircle } from "lucide-react";

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

interface AdvanceBalance {
  balance: number;
  total_deposited: number;
  total_debited: number;
}

interface Props {
  admissionId: string;
  patientId: string;
  hospitalId: string;
  userId: string | null;
  patientName?: string;
}

export default function AdvanceManagement({ admissionId, patientId, hospitalId, userId, patientName }: Props) {
  const [balance, setBalance] = useState<AdvanceBalance>({ balance: 0, total_deposited: 0, total_debited: 0 });
  const [transactions, setTransactions] = useState<AdvanceTx[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDeposit, setShowDeposit] = useState(false);

  // Deposit form state
  const [depositAmount, setDepositAmount] = useState("");
  const [paymentMode, setPaymentMode] = useState("cash");
  const [referenceNo, setReferenceNo] = useState("");
  const [depositNote, setDepositNote] = useState("");
  const [saving, setSaving] = useState(false);



  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [balRes, txRes, receiptsRes] = await Promise.all([
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
        // Also fetch advance_receipts for this patient — covers deposits recorded
        // before the dual-write fix (those only exist in advance_receipts, not ipd_advances)
        (supabase as any)
          .from("advance_receipts")
          .select("id, amount, payment_mode, receipt_number, notes, created_at")
          .eq("hospital_id", hospitalId)
          .eq("patient_id", patientId)
          .order("created_at", { ascending: false }),
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

      // Receipts whose receipt_number is already stored as reference_no in ipd_advances
      // were mirrored by the dual-write path — skip them to avoid double-counting
      const mirroredRefs = new Set(ipdTxns.map((t) => t.reference_no).filter(Boolean));
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
      const ipdDebited  = Number(balRes.data?.total_debited)    || 0;

      setBalance({
        total_deposited: ipdDeposited + unmirroredTotal,
        total_debited:   ipdDebited,
        balance:         ipdDeposited + unmirroredTotal - ipdDebited,
      });

      const allTxns = [...ipdTxns, ...receiptTxns].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      setTransactions(allTxns);
    } finally {
      setLoading(false);
    }
  }, [admissionId, patientId, hospitalId]);

  useEffect(() => { load(); }, [load]);

  const handleDeposit = async () => {
    const amount = parseFloat(depositAmount);
    if (!amount || amount <= 0) { toast.error("Enter a valid amount"); return; }
    setSaving(true);
    try {
      const { error } = await (supabase as any).from("ipd_advances").insert({
        hospital_id: hospitalId,
        admission_id: admissionId,
        patient_id: patientId,
        amount,
        transaction_type: "deposit",
        payment_mode: paymentMode,
        reference_no: referenceNo || null,
        description: depositNote || "Advance deposit",
        collected_by: userId,
      });
      if (error) throw error;
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

  const balanceColor = balance.balance < 0 ? "text-red-600" : balance.balance < 2000 ? "text-amber-600" : "text-emerald-600";

  const TX_ICONS: Record<string, JSX.Element> = {
    deposit:       <ArrowUpCircle className="h-4 w-4 text-emerald-600" />,
    refund:        <ArrowUpCircle className="h-4 w-4 text-blue-600" />,
    service_debit: <ArrowDownCircle className="h-4 w-4 text-red-500" />,
    adjustment:    <ArrowUpCircle className="h-4 w-4 text-amber-600" />,
  };

  return (
    <div className="space-y-3">
      {/* Balance summary */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-xs text-muted-foreground">Current Balance</p>
            <p className={`text-xl font-bold ${balanceColor}`}>₹{balance.balance.toLocaleString("en-IN")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-xs text-muted-foreground">Total Deposited</p>
            <p className="text-xl font-bold text-emerald-600">₹{balance.total_deposited.toLocaleString("en-IN")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-xs text-muted-foreground">Services Charged</p>
            <p className="text-xl font-bold text-orange-600">₹{balance.total_debited.toLocaleString("en-IN")}</p>
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      <div className="flex justify-between items-center">
        <p className="text-sm font-semibold">Advance Ledger {patientName ? `— ${patientName}` : ""}</p>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button size="sm" onClick={() => setShowDeposit(true)}>
            <Plus className="h-4 w-4 mr-1" /> Collect Advance
          </Button>
        </div>
      </div>

      {/* Transaction ledger */}
      <div className="space-y-1.5 max-h-72 overflow-auto">
        {loading && (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {!loading && transactions.length === 0 && (
          <p className="text-center py-6 text-sm text-muted-foreground">No advance transactions yet</p>
        )}
        {!loading && transactions.map(tx => {
          const isCredit = tx.transaction_type === "deposit" || tx.transaction_type === "adjustment";
          return (
            <div key={tx.id} className="flex items-center gap-2 text-sm bg-muted/30 rounded px-3 py-2">
              {TX_ICONS[tx.transaction_type] || <Wallet className="h-4 w-4" />}
              <div className="flex-1 min-w-0">
                <p className="truncate">{tx.description || tx.transaction_type}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(tx.created_at).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
                  {tx.payment_mode && ` · ${tx.payment_mode}`}
                  {tx.reference_no && ` · ${tx.reference_no}`}
                  {tx.collected_by_name && ` · ${tx.collected_by_name}`}
                </p>
              </div>
              <span className={`font-semibold shrink-0 ${isCredit ? "text-emerald-600" : "text-red-600"}`}>
                {isCredit ? "+" : "-"}₹{tx.amount.toLocaleString("en-IN")}
              </span>
              <Badge variant="outline" className="text-xs shrink-0 capitalize">
                {tx.transaction_type.replace("_", " ")}
              </Badge>
            </div>
          );
        })}
      </div>

      {/* Deposit modal */}
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
                onChange={e => setDepositAmount(e.target.value)}
                placeholder="0"
                className="mt-1"
                autoFocus
              />
            </div>
            <div>
              <Label className="text-xs">Payment Mode</Label>
              <Select value={paymentMode} onValueChange={setPaymentMode}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
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
                <Input value={referenceNo} onChange={e => setReferenceNo(e.target.value)} className="mt-1" />
              </div>
            )}
            <div>
              <Label className="text-xs">Note</Label>
              <Input value={depositNote} onChange={e => setDepositNote(e.target.value)} placeholder="Optional note" className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeposit(false)}>Cancel</Button>
            <Button onClick={handleDeposit} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Collect ₹{parseFloat(depositAmount || "0").toLocaleString("en-IN")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
