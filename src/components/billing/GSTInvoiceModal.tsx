import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Printer, MessageSquare, Mail, Info, Lock, Sparkles, Loader2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { printDocument, printHeader } from "@/lib/printUtils";

import type { BillRecord } from "@/pages/billing/BillingPage";
import type { LineItem } from "@/components/billing/BillEditor";

interface Props {
  bill: BillRecord;
  lineItems: LineItem[];
  hospitalName: string;
  hospitalGstin: string;
  hospitalAddress: string;
  irn: string;
  onClose: () => void;
}

const GSTInvoiceModal: React.FC<Props> = ({
  bill, lineItems, hospitalName, hospitalGstin, hospitalAddress, irn: initialIrn, onClose,
}) => {
  const { toast } = useToast();
  const [manualIrn, setManualIrn] = useState(initialIrn || "");
  const [generatedIrn, setGeneratedIrn] = useState<string>("");
  const [signedQr, setSignedQr] = useState<string>("");
  const [irnMode, setIrnMode] = useState<"live" | "sandbox" | "manual" | "">(
    (bill as any).irn_mode || "",
  );
  const [lockingIrn, setLockingIrn] = useState(false);
  const [generatingIrn, setGeneratingIrn] = useState(false);
  const irn = initialIrn || generatedIrn || manualIrn;
  const isLocked = bill.bill_status === "irn_locked";

  const handleGenerateIrn = async () => {
    setGeneratingIrn(true);
    try {
      const { data, error } = await supabase.functions.invoke("gst-irn-generate", {
        body: { bill_id: bill.id, hospital_id: (bill as any).hospital_id },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const result = data as { irn: string; signed_qr?: string; mode: "live" | "sandbox"; message?: string };
      setGeneratedIrn(result.irn);
      setSignedQr(result.signed_qr || "");
      setIrnMode(result.mode);
      toast({
        title: result.mode === "live" ? "Live IRN generated" : "Sandbox IRN generated",
        description: result.message || `IRN: ${result.irn}`,
      });
    } catch (e: any) {
      toast({ title: "IRN generation failed", description: e?.message || "Try again", variant: "destructive" });
    } finally {
      setGeneratingIrn(false);
    }
  };

  const handleLockIrn = async () => {
    if (!manualIrn.trim()) return;
    setLockingIrn(true);
    try {
      await (supabase as any).from("bills").update({
        irn: manualIrn.trim(),
        irn_generated_at: new Date().toISOString(),
        bill_status: "irn_locked",
        irn_mode: "manual",
      }).eq("id", bill.id);
      setIrnMode("manual");
      toast({ title: "IRN saved & bill locked", description: "This bill can no longer be edited." });
    } catch {
      toast({ title: "Failed to lock bill", variant: "destructive" });
    } finally {
      setLockingIrn(false);
    }
  };

  const taxableItems = lineItems.filter((i) => i.gst_percent > 0);

  // Group GST
  const gstBreakdown: Record<number, { taxable: number; cgst: number; sgst: number }> = {};
  taxableItems.forEach((i) => {
    const taxable = i.quantity * i.unit_rate * (1 - i.discount_percent / 100);
    const gst = taxable * i.gst_percent / 100;
    if (!gstBreakdown[i.gst_percent]) gstBreakdown[i.gst_percent] = { taxable: 0, cgst: 0, sgst: 0 };
    gstBreakdown[i.gst_percent].taxable += taxable;
    gstBreakdown[i.gst_percent].cgst += gst / 2;
    gstBreakdown[i.gst_percent].sgst += gst / 2;
  });

  const totalTaxable = Object.values(gstBreakdown).reduce((s, g) => s + g.taxable, 0);
  const totalCgst = Object.values(gstBreakdown).reduce((s, g) => s + g.cgst, 0);
  const totalSgst = Object.values(gstBreakdown).reduce((s, g) => s + g.sgst, 0);

  const fmt = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>GST Tax Invoice</DialogTitle>
        </DialogHeader>

        {/* Invoice preview */}
        <div className="border border-border rounded-lg overflow-hidden text-xs" id="gst-invoice-print">
          {/* Header */}
          <div className="bg-primary text-primary-foreground px-5 py-3 text-center">
            <p className="text-base font-bold tracking-wide">TAX INVOICE</p>
          </div>

          {/* Seller / Buyer */}
          <div className="grid grid-cols-2 border-b border-border">
            <div className="p-3 border-r border-border">
              <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">Seller</p>
              <p className="font-bold text-foreground">{hospitalName}</p>
              <p className="text-muted-foreground">{hospitalAddress || "—"}</p>
              <p className="text-muted-foreground mt-1">GSTIN: {hospitalGstin || "Not configured"}</p>
            </div>
            <div className="p-3">
              <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">Buyer</p>
              <p className="font-bold text-foreground">{bill.patient_name}</p>
              <p className="text-muted-foreground">UHID: {bill.uhid}</p>
            </div>
          </div>

          {/* IRN Status Indicator */}
          <div className="bg-muted/30 px-4 py-2.5 border-b border-border">
            <div className="flex items-center gap-2 flex-wrap">
              {isLocked ? (
                <Lock size={14} className="text-primary" />
              ) : (
                <Info size={14} className="text-muted-foreground" />
              )}
              <span className="text-[11px] font-semibold text-foreground">
                IRN Generation: {isLocked ? "Locked" : "Pending"}
              </span>
              {irnMode === "live" && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/30">
                  Live IRN
                </span>
              )}
              {irnMode === "sandbox" && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground border border-border">
                  Sandbox IRN
                </span>
              )}
              {irnMode === "manual" && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground border border-border">
                  Manual Entry
                </span>
              )}
            </div>
            {!isLocked && !initialIrn && (
              <div className="mt-2 space-y-2">
                <Button
                  size="sm"
                  className="h-7 text-xs gap-1 w-full"
                  disabled={generatingIrn}
                  onClick={handleGenerateIrn}
                >
                  {generatingIrn ? (
                    <>
                      <Loader2 size={12} className="animate-spin" /> Generating IRN...
                    </>
                  ) : (
                    <>
                      <Sparkles size={12} /> Generate IRN via NIC IRP
                    </>
                  )}
                </Button>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">Or enter manually:</span>
                  <Input
                    value={manualIrn}
                    onChange={(e) => setManualIrn(e.target.value)}
                    placeholder="Paste IRN from GST portal..."
                    className="h-7 text-xs font-mono flex-1"
                  />
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!manualIrn.trim() || lockingIrn} onClick={handleLockIrn}>
                    {lockingIrn ? "Locking..." : "Lock"}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* IRN display */}
          {irn && (
          <div className="bg-muted/50 px-4 py-2 border-b border-border flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold uppercase text-muted-foreground">IRN</p>
              <p className="font-mono text-xs font-bold text-foreground break-all">{irn}</p>
            </div>
            {signedQr && (
              <div className="flex-shrink-0">
                <QRCodeSVG value={signedQr} size={64} level="M" />
              </div>
            )}
            <div className="text-right flex-shrink-0">
              <p className="text-[10px] text-muted-foreground">Invoice No: {bill.bill_number}</p>
              <p className="text-[10px] text-muted-foreground">Date: {bill.bill_date}</p>
            </div>
          </div>
          )}
          {!irn && (
          <div className="bg-muted/50 px-4 py-2 border-b border-border flex items-center justify-between">
            <div className="text-right w-full">
              <p className="text-[10px] text-muted-foreground">Invoice No: {bill.bill_number}</p>
              <p className="text-[10px] text-muted-foreground">Date: {bill.bill_date}</p>
            </div>
          </div>
          )}

          {/* Items table */}
          <table className="w-full">
            <thead>
              <tr className="bg-muted/50 text-[9px] font-bold uppercase text-muted-foreground">
                <th className="px-2 py-1.5 text-left">#</th>
                <th className="px-2 py-1.5 text-left">Description</th>
                <th className="px-2 py-1.5 text-center">HSN</th>
                <th className="px-2 py-1.5 text-center">Qty</th>
                <th className="px-2 py-1.5 text-right">Rate</th>
                <th className="px-2 py-1.5 text-right">Taxable</th>
                <th className="px-2 py-1.5 text-center">CGST%</th>
                <th className="px-2 py-1.5 text-right">CGST</th>
                <th className="px-2 py-1.5 text-center">SGST%</th>
                <th className="px-2 py-1.5 text-right">SGST</th>
                <th className="px-2 py-1.5 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {taxableItems.map((item, idx) => {
                const taxable = item.quantity * item.unit_rate * (1 - item.discount_percent / 100);
                const gst = taxable * item.gst_percent / 100;
                return (
                  <tr key={item.id} className="border-b border-border">
                    <td className="px-2 py-1 text-muted-foreground">{idx + 1}</td>
                    <td className="px-2 py-1 text-foreground">{item.description}</td>
                    <td className="px-2 py-1 text-center text-muted-foreground">{item.hsn_code || "999311"}</td>
                    <td className="px-2 py-1 text-center">{item.quantity}</td>
                    <td className="px-2 py-1 text-right">{fmt(item.unit_rate)}</td>
                    <td className="px-2 py-1 text-right">{fmt(taxable)}</td>
                    <td className="px-2 py-1 text-center">{item.gst_percent / 2}%</td>
                    <td className="px-2 py-1 text-right">{fmt(gst / 2)}</td>
                    <td className="px-2 py-1 text-center">{item.gst_percent / 2}%</td>
                    <td className="px-2 py-1 text-right">{fmt(gst / 2)}</td>
                    <td className="px-2 py-1 text-right font-bold">{fmt(taxable + gst)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-muted/30 font-bold border-t border-border">
                <td colSpan={5} className="px-2 py-1.5 text-right">Total</td>
                <td className="px-2 py-1.5 text-right">{fmt(totalTaxable)}</td>
                <td />
                <td className="px-2 py-1.5 text-right">{fmt(totalCgst)}</td>
                <td />
                <td className="px-2 py-1.5 text-right">{fmt(totalSgst)}</td>
                <td className="px-2 py-1.5 text-right">{fmt(totalTaxable + totalCgst + totalSgst)}</td>
              </tr>
            </tfoot>
          </table>

          {/* Declaration */}
          <div className="px-4 py-3 border-t border-border">
            <p className="text-[10px] text-muted-foreground italic">
              We declare that this invoice shows actual price of goods/services described
              and that all particulars are true and correct.
            </p>
            <p className="text-[10px] text-muted-foreground mt-2">Computer generated invoice — no signature required</p>
          </div>

          {/* UPI QR Code */}
          {bill.balance_due > 0 && (
            <div className="px-4 py-3 border-t border-border flex items-center gap-4">
              <QRCodeSVG
                value={`upi://pay?pa=hospital@upi&pn=${encodeURIComponent(hospitalName)}&am=${bill.balance_due}&cu=INR&tn=Bill-${bill.bill_number}`}
                size={80}
                level="M"
              />
              <div>
                <p className="text-xs font-bold text-foreground">Pay via UPI</p>
                <p className="text-[11px] text-muted-foreground">Scan & pay ₹{bill.balance_due.toLocaleString("en-IN")}</p>
                <p className="text-[10px] font-mono text-muted-foreground mt-1">UPI ID: hospital@upi</p>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="grid grid-cols-3 gap-2 mt-2">
          <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={() => {
            const rows = taxableItems.map((item, idx) => {
              const taxable = item.quantity * item.unit_rate * (1 - item.discount_percent / 100);
              const gst = taxable * item.gst_percent / 100;
              return `<tr><td>${idx + 1}</td><td>${item.description}</td><td>${item.hsn_code || "999311"}</td><td style="text-align:center">${item.quantity}</td><td style="text-align:right">${fmt(taxable)}</td><td style="text-align:center">${item.gst_percent / 2}%</td><td style="text-align:right">${fmt(gst / 2)}</td><td style="text-align:center">${item.gst_percent / 2}%</td><td style="text-align:right">${fmt(gst / 2)}</td><td style="text-align:right">${fmt(taxable + gst)}</td></tr>`;
            }).join("");
            const body = `<div style="text-align:center;background:#1A2F5A;color:#fff;padding:12px;font-size:16px;font-weight:bold">TAX INVOICE</div>
              ${printHeader(hospitalName, `GSTIN: ${hospitalGstin || "Not configured"}`)}
              <div class="row"><span class="label">Buyer:</span><span>${bill.patient_name} (${bill.uhid})</span></div>
              <div class="row"><span class="label">Invoice:</span><span>${bill.bill_number}</span></div>
              <div class="row"><span class="label">Date:</span><span>${bill.bill_date}</span></div>
              <div class="row"><span class="label">IRN:</span><span style="font-family:monospace;font-size:11px">${irn}</span></div>
              <table><tr><th>#</th><th>Description</th><th>HSN</th><th>Qty</th><th style="text-align:right">Taxable</th><th>CGST%</th><th style="text-align:right">CGST</th><th>SGST%</th><th style="text-align:right">SGST</th><th style="text-align:right">Total</th></tr>${rows}
              <tr style="font-weight:bold;background:#f1f5f9"><td colspan="4">Total</td><td style="text-align:right">${fmt(totalTaxable)}</td><td></td><td style="text-align:right">${fmt(totalCgst)}</td><td></td><td style="text-align:right">${fmt(totalSgst)}</td><td style="text-align:right">${fmt(totalTaxable + totalCgst + totalSgst)}</td></tr></table>
              <p style="font-size:10px;color:#64748b;font-style:italic">We declare that this invoice shows actual price of goods/services described and that all particulars are true and correct.</p>`;
            printDocument(`GST Invoice ${bill.bill_number}`, body);
          }}>
            <Printer size={14} /> Print Invoice
          </Button>
          <Button variant="outline" size="sm" className="gap-1 text-xs">
            <MessageSquare size={14} /> WhatsApp
          </Button>
          <Button variant="outline" size="sm" className="gap-1 text-xs">
            <Mail size={14} /> Email
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default GSTInvoiceModal;
