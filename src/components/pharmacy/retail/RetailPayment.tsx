import React, { useState, useEffect } from "react";
import { generateBillNumber } from "@/hooks/useBillNumber";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Banknote, Smartphone, CreditCard, Building2, Printer, MessageSquare, RotateCcw, Check, Loader2 } from "lucide-react";
import type { CartItem } from "./RetailCart";
import { findPatientByPhone } from "@/lib/patient-records";
import { autoPostJournalEntry } from "@/lib/accounting";
import { sendWhatsApp } from "@/lib/whatsapp-send";

type PaymentMode = "cash" | "upi" | "card" | "credit";

const PRESETS = [100, 200, 500, 1000];

interface ReceiptData {
  dispensingNumber: string;
  billId: string | null;
  items: CartItem[];
  subtotal: number;
  discountAmount: number;
  gstAmount: number;
  netTotal: number;
  paymentMode: string;
  amountReceived: number;
  change: number;
  customerName: string;
  date: string;
}

interface Props {
  hospitalId: string;
  items: CartItem[];
  customerId: string | null;
  subtotal: number;
  discountPercent: number;
  discountAmount: number;
  gstAmount: number;
  netTotal: number;
  customerPhone: string;
  customerName: string;
  onSaleComplete: () => void;
}

const RetailPayment: React.FC<Props> = ({
  hospitalId, items, customerId, subtotal, discountPercent, discountAmount, gstAmount, netTotal,
  customerPhone, customerName, onSaleComplete,
}) => {
  const { toast } = useToast();
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("cash");
  const [amountReceived, setAmountReceived] = useState<number>(0);
  const [processing, setProcessing] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [pharmacistUsers, setPharmacistUsers] = useState<{ id: string; full_name: string; role: string; email: string }[]>([]);
  const [secondPharmacistId, setSecondPharmacistId] = useState("");
  // Re-authentication for the NDPS second-signature — see the password field's own comment
  // below for why this exists (KNOWN-BUG, found live: picking a name from this dropdown used
  // to be the entire "sign-off", with no verification the named person was even present).
  const [secondPharmacistPassword, setSecondPharmacistPassword] = useState("");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from("users").select("id").eq("auth_user_id", user.id).maybeSingle()
        .then(({ data }) => setCurrentUserId(data?.id || null));
    });
  }, []);

  const billableItems = items.filter(i => !i.out_of_stock);
  const change = Math.max(0, amountReceived - netTotal);
  const hasScheduleH = billableItems.some(i => i.drug_schedule === "H" || i.drug_schedule === "H1");
  // NDPS/Schedule-X drugs need a dual-pharmacist sign-off at the point of sale, same control
  // the IP dispensing workspace already enforces — H1 does not require this, only NDPS does.
  const hasNdpsItem = billableItems.some(i => i.is_ndps);
  // A selected name is no longer sufficient on its own — the password field must also be
  // filled, and handleCompleteSale re-authenticates it for real before the sale proceeds.
  const canComplete = billableItems.length > 0 && netTotal > 0 && (!hasNdpsItem || (!!secondPharmacistId && !!secondPharmacistPassword));

  useEffect(() => {
    if (!hasNdpsItem) return;
    // app_role enum has no senior_pharmacist/chief_pharmacist value. `email` is fetched now
    // (it wasn't before) because re-authenticating this person by password needs it.
    (supabase as any)
      .from("users")
      .select("id, full_name, role, email")
      .eq("hospital_id", hospitalId)
      .in("role", ["pharmacist", "hospital_admin"])
      .then(({ data, error }: any) => {
        if (error) console.error("fetch pharmacists for NDPS sign-off failed:", error.message);
        setPharmacistUsers(data || []);
      });
  }, [hasNdpsItem, hospitalId]);

  const handleCompleteSale = async () => {
    if (!canComplete) return;
    setProcessing(true);

    try {
      // NDPS second-signature re-authentication (KNOWN-BUG, found live) — this used to be a
      // bare name picked from a dropdown, with nothing verifying the named pharmacist was
      // actually present and consenting. Mirrors the IP dispensing workspace's own pattern
      // (NDPSDualSignoffModal.tsx): sign in as the named person to prove the password is
      // genuinely theirs, then restore the cashier's own session regardless of outcome —
      // this must never leave the browser logged in as the second pharmacist.
      if (hasNdpsItem) {
        const signer = pharmacistUsers.find(p => p.id === secondPharmacistId);
        if (!signer?.email) throw new Error("Confirming pharmacist not found");

        const { data: { session: cashierSession } } = await supabase.auth.getSession();
        const { error: signerAuthErr } = await supabase.auth.signInWithPassword({
          email: signer.email,
          password: secondPharmacistPassword,
        });
        if (cashierSession) {
          await supabase.auth.setSession({
            access_token: cashierSession.access_token,
            refresh_token: cashierSession.refresh_token,
          });
        }
        if (signerAuthErr) {
          throw new Error(`Confirming pharmacist's password is incorrect: ${signerAuthErr.message}`);
        }
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { data: userData } = await supabase
        .from("users")
        .select("id")
        .eq("auth_user_id", user.id)
        .maybeSingle();
      if (!userData) throw new Error("User not found");

      let patientId = customerId;
      let resolvedCustomerName = customerName.trim() || "Walk-in Customer";

      if (!patientId && customerPhone.length >= 10) {
        const existing = await findPatientByPhone(hospitalId, customerPhone);
        if (existing) {
          patientId = existing.id;
          resolvedCustomerName = existing.full_name;
        }
      }
      // Walk-in retail sales are allowed with patientId = null — do NOT create phantom patient records

      const dispNum = await generateBillNumber(hospitalId, "RET");

      const { data: disp, error: dispErr } = await supabase
        .from("pharmacy_dispensing")
        .insert({
          hospital_id: hospitalId,
          dispensing_number: dispNum,
          patient_id: patientId,
          dispensed_by: userData.id,
          dispensing_type: "retail",
          status: "dispensed",
          total_amount: subtotal,
          discount_percent: discountPercent,
          discount_amount: discountAmount,
          gst_amount: gstAmount,
          net_amount: netTotal,
          payment_mode: paymentMode,
        })
        .select("id")
        .maybeSingle();

      if (dispErr) throw dispErr;

      // Create bills + bill_payments so analytics/dashboard picks up pharmacy revenue
      const { data: pharmBill, error: billErr2 } = await supabase.from("bills").insert({
        hospital_id: hospitalId,
        patient_id: patientId,
        bill_number: dispNum,
        bill_type: "pharmacy",
        bill_date: new Date().toISOString().split("T")[0],
        subtotal,
        gst_amount: gstAmount,
        discount_amount: discountAmount,
        total_amount: netTotal,
        patient_payable: netTotal,
        paid_amount: netTotal,
        balance_due: 0,
        payment_status: "paid",
        bill_status: "final",
        created_by: userData.id,
      } as any).select("id").maybeSingle();
      if (billErr2) console.error("Pharmacy bill insert failed:", billErr2.message);

      if (pharmBill) {
        await supabase.from("bill_payments").insert({
          hospital_id: hospitalId,
          bill_id: pharmBill.id,
          payment_mode: paymentMode,
          amount: netTotal,
          received_by: userData.id,
        });

        // Post itemised bill_line_items so the shared structured bill (printBillById) shows
        // every drug. unit_price is GST-INCLUSIVE (MRP), so GST is extracted OUT of the line
        // total and the bill-level discount_amount carries the sale discount — this makes the
        // printed Total Payable reconcile exactly to netTotal (= subtotal − discount).
        const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
        const lineItemRows = billableItems.map((item) => {
          const gross = item.unit_price * item.qty;
          const gst = item.gst_percent > 0 ? gross * (item.gst_percent / (100 + item.gst_percent)) : 0;
          return {
            hospital_id: hospitalId,
            bill_id: pharmBill.id,
            description: item.batch_number ? `${item.drug_name} (Batch ${item.batch_number})` : item.drug_name,
            item_type: "pharmacy",
            unit_rate: item.unit_price,
            quantity: item.qty,
            taxable_amount: r2(gross - gst),
            gst_percent: item.gst_percent,
            gst_amount: r2(gst),
            total_amount: r2(gross),
            source_module: "pharmacy_retail",
          };
        });
        if (lineItemRows.length > 0) {
          await (supabase as any).from("bill_line_items").insert(lineItemRows);
        }
      }

      // Insert items and deduct stock (skip out-of-stock placeholders)
      for (const item of billableItems) {
        await supabase.from("pharmacy_dispensing_items").insert({
          hospital_id: hospitalId,
          dispensing_id: disp.id,
          drug_id: item.drug_id,
          batch_id: item.batch_id,
          drug_name: item.drug_name,
          batch_number: item.batch_number,
          expiry_date: item.expiry_date,
          quantity_requested: item.qty,
          quantity_dispensed: item.qty,
          unit_price: item.unit_price,
          gst_percent: item.gst_percent,
          total_price: item.unit_price * item.qty,
          is_ndps: item.is_ndps,
        });

        // Deduct batch stock
        const { data: batch } = await supabase
          .from("drug_batches")
          .select("quantity_available")
          .eq("id", item.batch_id)
          .maybeSingle();

        if (batch) {
          await supabase
            .from("drug_batches")
            .update({ quantity_available: Math.max(0, batch.quantity_available - item.qty) })
            .eq("id", item.batch_id);
        }

        // NDPS/Schedule-H1 register — H1 (Rule 65) needs register logging too, but never
        // the NDPS dual-signoff step.
        if (item.is_ndps || item.drug_schedule === "H1") {
          const { data: lastEntry } = await supabase
            .from("ndps_register")
            .select("balance_after")
            .eq("drug_id", item.drug_id)
            .eq("hospital_id", hospitalId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          // Result checked deliberately (KNOWN-BUG, found live) — an unchecked failure here
          // (e.g. the ndps_different_pharmacists CHECK constraint) would let the sale complete
          // with stock already deducted and no legally-mandated register entry, with nothing
          // telling anyone.
          const { error: ndpsErr } = await supabase.from("ndps_register").insert({
            hospital_id: hospitalId,
            drug_id: item.drug_id,
            drug_name: item.drug_name,
            drug_schedule: item.drug_schedule || "X",
            transaction_type: "issue",
            quantity: item.qty,
            balance_after: Math.max(0, Number(lastEntry?.balance_after || 0) - item.qty),
            patient_name: resolvedCustomerName,
            pharmacist_id: userData.id,
            ...(item.is_ndps && secondPharmacistId
              ? {
                  second_pharmacist_id: secondPharmacistId,
                  countersigned_by: secondPharmacistId,
                  countersigned_at: new Date().toISOString(),
                }
              : {}),
          });
          if (ndpsErr) {
            throw new Error(`NDPS register entry for ${item.drug_name} failed to save (${ndpsErr.message}) — this sale has NOT been completed. Do not hand over the drug; contact your pharmacy admin.`);
          }
        }
      }

      setReceipt({
        dispensingNumber: dispNum,
        billId: pharmBill?.id ?? null,
        items: billableItems,
        subtotal,
        discountAmount,
        gstAmount,
        netTotal,
        paymentMode,
        amountReceived: paymentMode === "cash" ? amountReceived : netTotal,
        change: paymentMode === "cash" ? change : 0,
        customerName: resolvedCustomerName,
        date: new Date().toLocaleString("en-IN"),
      });

      toast({ title: `✓ Sale complete — ₹${netTotal.toFixed(0)}` });

      // Auto-post journal entry for retail sale
      if (pharmBill) {
        await autoPostJournalEntry({
          triggerEvent: `bill_payment_${paymentMode}`,
          sourceModule: "pharmacy",
          sourceId: pharmBill.id,
          amount: netTotal,
          description: `Retail Sale ${dispNum}`,
          hospitalId,
          postedBy: userData.id,
        });
      }
    } catch (err: any) {
      toast({ title: "Sale failed", description: err.message, variant: "destructive" });
    } finally {
      setProcessing(false);
    }
  };

  const handleWhatsApp = async () => {
    if (!receipt || !customerPhone) return;
    const lines = receipt.items.map(i => `• ${i.drug_name} ×${i.qty} = ₹${(i.unit_price * i.qty).toFixed(0)}`);
    const msg = `🏥 *Pharmacy Receipt*\n*${receipt.dispensingNumber}*\nDate: ${receipt.date}\n\n💊 *Items:*\n${lines.join("\n")}\n\n💰 *Total: ₹${receipt.netTotal.toFixed(0)}*\n${receipt.paymentMode.toUpperCase()}\n${receipt.change > 0 ? `Change: ₹${receipt.change.toFixed(0)}` : ""}\n\nThank you! 🙏`;
    await sendWhatsApp({ hospitalId, phone: `91${customerPhone.replace(/\D/g, "")}`, message: msg });
  };

  const handlePrint = async () => {
    if (!receipt) return;
    if (!receipt.billId) {
      toast({ title: "No bill to print for this sale", variant: "destructive" });
      return;
    }
    // Print the shared structured bill (same template as every other module).
    const { printBillById } = await import("@/lib/billPrint");
    const ok = await printBillById(receipt.billId, hospitalId);
    if (!ok) toast({ title: "Could not open the bill for printing", variant: "destructive" });
  };

  // Receipt view
  if (receipt) {
    return (
      <div className="w-[320px] flex-shrink-0 bg-card border-l border-border flex flex-col overflow-hidden">
        <div className="flex-shrink-0 px-4 py-3 border-b border-border bg-green-50 dark:bg-green-950/20 text-center">
          <Check size={24} className="mx-auto text-green-600 mb-1" />
          <p className="text-sm font-bold text-green-700 dark:text-green-400">Sale Complete!</p>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-4">
            <div className="bg-muted/30 rounded-xl p-4 space-y-3 text-center">
              <p className="text-[11px] font-bold uppercase text-muted-foreground">Pharmacy Receipt</p>
              <p className="text-xs font-mono text-foreground">{receipt.dispensingNumber}</p>
              <p className="text-[10px] text-muted-foreground">{receipt.date}</p>

              <div className="border-t border-dashed border-border pt-3 space-y-1 text-left">
                {receipt.items.map((item, i) => (
                  <div key={i} className="flex justify-between text-xs">
                    <span className="truncate flex-1">{item.drug_name} ×{item.qty}</span>
                    <span className="ml-2 font-medium">₹{(item.unit_price * item.qty).toFixed(0)}</span>
                  </div>
                ))}
              </div>

              <div className="border-t border-dashed border-border pt-2 space-y-1 text-left text-xs">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span><span>₹{receipt.subtotal.toFixed(0)}</span>
                </div>
                {receipt.discountAmount > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Discount</span><span>-₹{receipt.discountAmount.toFixed(0)}</span>
                  </div>
                )}
                <div className="flex justify-between text-muted-foreground">
                  <span>GST</span><span>₹{receipt.gstAmount.toFixed(0)}</span>
                </div>
                <div className="flex justify-between font-bold text-foreground text-sm pt-1 border-t border-border">
                  <span>Total</span><span>₹{receipt.netTotal.toFixed(0)}</span>
                </div>
              </div>

              <div className="text-xs text-muted-foreground text-left pt-1">
                <p>Payment: {receipt.paymentMode.toUpperCase()}</p>
                {receipt.change > 0 && <p className="font-bold text-green-600">Change: ₹{receipt.change.toFixed(0)}</p>}
              </div>
            </div>
          </div>
        </ScrollArea>

        <div className="flex-shrink-0 p-3 border-t border-border grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" className="text-xs h-9" onClick={handlePrint}>
            <Printer size={14} className="mr-1" /> Print
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-9"
            disabled={!customerPhone}
            onClick={handleWhatsApp}
          >
            <MessageSquare size={14} className="mr-1" /> WhatsApp
          </Button>
          <Button size="sm" className="text-xs h-9 col-span-2" onClick={onSaleComplete}>
            <RotateCcw size={14} className="mr-1" /> New Sale
          </Button>
        </div>
      </div>
    );
  }

  // Payment mode selection
  const modes: { key: PaymentMode; icon: React.ReactNode; label: string }[] = [
    { key: "cash", icon: <Banknote size={18} />, label: "Cash" },
    { key: "upi", icon: <Smartphone size={18} />, label: "UPI" },
    { key: "card", icon: <CreditCard size={18} />, label: "Card" },
    { key: "credit", icon: <Building2 size={18} />, label: "Credit" },
  ];

  return (
    <div className="w-[320px] flex-shrink-0 bg-card border-l border-border flex flex-col overflow-hidden">
      {/* Payment Methods */}
      <div className="flex-shrink-0 p-4">
        <p className="text-[11px] font-bold uppercase text-muted-foreground mb-2.5">Payment Method</p>
        <div className="grid grid-cols-2 gap-2">
          {modes.map(m => (
            <button
              key={m.key}
              onClick={() => { setPaymentMode(m.key); if (m.key === "cash") setAmountReceived(0); }}
              className={cn(
                "flex flex-col items-center justify-center h-14 rounded-lg border-[1.5px] transition-all active:scale-[0.97] text-sm font-bold",
                paymentMode === m.key
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-border text-foreground hover:border-primary/30"
              )}
            >
              {m.icon}
              <span className="text-xs mt-1">{m.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Payment Details */}
      <ScrollArea className="flex-1">
        <div className="px-4 pb-4">
          {paymentMode === "cash" && (
            <div className="space-y-3">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Amount Received</p>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg font-bold text-muted-foreground">₹</span>
                  <Input
                    type="number"
                    value={amountReceived || ""}
                    onChange={e => setAmountReceived(parseFloat(e.target.value) || 0)}
                    className="pl-8 h-12 text-xl font-bold text-center"
                    placeholder="0"
                  />
                </div>
              </div>
              {amountReceived >= netTotal && netTotal > 0 && (
                <div className="bg-green-50 dark:bg-green-950/20 rounded-lg p-3 text-center">
                  <p className="text-xs text-muted-foreground">Change to Return</p>
                  <p className="text-xl font-bold text-green-600">₹{change.toFixed(0)}</p>
                </div>
              )}
              <div className="grid grid-cols-4 gap-1.5">
                {PRESETS.map(p => (
                  <button
                    key={p}
                    onClick={() => setAmountReceived(p)}
                    className="h-9 rounded-lg bg-muted text-xs font-bold text-foreground hover:bg-muted/80 active:scale-[0.97]"
                  >₹{p}</button>
                ))}
              </div>
              <button
                onClick={() => setAmountReceived(Math.ceil(netTotal))}
                className="w-full h-8 rounded-lg bg-muted text-xs font-medium text-foreground hover:bg-muted/80 active:scale-[0.97]"
              >Exact ₹{Math.ceil(netTotal)}</button>
            </div>
          )}

          {paymentMode === "upi" && (
            <div className="text-center space-y-3 py-4">
              <div className="w-40 h-40 mx-auto bg-muted/30 rounded-xl border border-dashed border-border flex items-center justify-center">
                <div className="text-center">
                  <Smartphone size={32} className="mx-auto text-muted-foreground/40 mb-2" />
                  <p className="text-xs text-muted-foreground">Scan to pay</p>
                  <p className="text-lg font-bold text-foreground mt-1">₹{netTotal.toFixed(0)}</p>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">Configure Razorpay in Settings for QR</p>
            </div>
          )}

          {paymentMode === "card" && (
            <div className="space-y-3 py-4 text-center">
              <CreditCard size={32} className="mx-auto text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Swipe card on terminal</p>
              <Input placeholder="Transaction ID (optional)" className="h-9 text-xs" />
            </div>
          )}

          {paymentMode === "credit" && (
            <div className="space-y-3 py-4 text-center">
              <Building2 size={32} className="mx-auto text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Credit to patient account</p>
              <p className="text-[10px] text-muted-foreground">Requires linked patient</p>
            </div>
          )}

          {/* Schedule H warning */}
          {hasScheduleH && (
            <div className="mt-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
              <p className="text-[11px] text-amber-800 dark:text-amber-300 font-medium">
                ⚠️ Prescription required for {items.filter(i => i.drug_schedule === "H" || i.drug_schedule === "H1").length} drug(s)
              </p>
            </div>
          )}

          {/* NDPS dual sign-off — required before a Schedule X/NDPS item can be sold */}
          {hasNdpsItem && (
            <div className="mt-3 bg-destructive/5 border border-destructive/20 rounded-lg p-3 space-y-2">
              <p className="text-[11px] text-destructive font-semibold">
                🔴 NDPS Drug — Second Pharmacist Sign-off Required
              </p>
              <Select value={secondPharmacistId} onValueChange={(v) => { setSecondPharmacistId(v); setSecondPharmacistPassword(""); }}>
                <SelectTrigger className="h-9 text-[12px]">
                  <SelectValue placeholder="Select confirming pharmacist…" />
                </SelectTrigger>
                <SelectContent>
                  {pharmacistUsers.filter(u => u.id !== currentUserId).map(u => (
                    <SelectItem key={u.id} value={u.id} className="text-[12px]">
                      {u.full_name} ({u.role})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {secondPharmacistId && (
                <Input
                  type="password"
                  placeholder="Confirming pharmacist's password"
                  value={secondPharmacistPassword}
                  onChange={(e) => setSecondPharmacistPassword(e.target.value)}
                  className="h-9 text-[12px]"
                />
              )}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Complete Sale */}
      <div className="flex-shrink-0 p-4 border-t border-border">
        <Button
          className="w-full h-14 text-base font-bold rounded-xl"
          disabled={!canComplete || processing || (paymentMode === "cash" && amountReceived < netTotal && amountReceived > 0)}
          onClick={handleCompleteSale}
        >
          {processing ? (
            <><Loader2 size={18} className="mr-2 animate-spin" /> Processing…</>
          ) : (
            <>✓ Complete Sale — ₹{netTotal.toFixed(0)}</>
          )}
        </Button>
      </div>

      {/* Session bar */}
      <div className="flex-shrink-0 h-6 bg-muted/30 border-t border-border/50 px-4 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>Retail Counter</span>
        <span>{new Date().toLocaleDateString("en-IN")}</span>
      </div>
    </div>
  );
};

export default RetailPayment;
