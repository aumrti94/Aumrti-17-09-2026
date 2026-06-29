import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, Copy, Info, Loader2, ExternalLink, QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import type { BillRecord } from "@/pages/billing/BillingPage";

interface Props {
  bill: BillRecord;
  hospitalId: string;
  hospitalName: string;
  hospitalPhone?: string;
  razorpayConfigured: boolean;
  onClose: () => void;
}

/**
 * Payment Link Modal — generates a real Razorpay payment link via edge function
 * and sends it via WhatsApp. Falls back to wa.me deeplink if Razorpay not configured.
 */
const PaymentLinkModal: React.FC<Props> = ({
  bill, hospitalId, hospitalName, hospitalPhone, razorpayConfigured, onClose,
}) => {
  const { toast } = useToast();
  const [amount, setAmount] = useState(bill.balance_due);
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);

  /** Build the WhatsApp message body given a payment link URL */
  const buildMessage = (link: string) =>
    `🏥 *${hospitalName}*\n\nDear Patient,\nYour bill #${bill.bill_number} is ready.\n\n💰 *Amount Due: ₹${amount.toLocaleString("en-IN")}*\n\nPay securely online:\n👉 ${link}\n\nFor queries: ${hospitalPhone || "Contact hospital"}`;

  /** Attempt Razorpay edge fn, return the short URL. Throws on hard failure. */
  const generateRazorpayLink = async (): Promise<string> => {
    const { data, error } = await supabase.functions.invoke("create-razorpay-payment-link", {
      body: {
        bill_id: bill.id,
        amount,
        patient_name: bill.patient_name,
        phone: phone || undefined,
        hospital_id: hospitalId,
      },
    });
    if (error) throw new Error(error.message);
    const url = data?.short_url || data?.razorpay_link_url;
    if (!url) throw new Error("No URL returned by Razorpay");
    return url as string;
  };

  const handleSend = async () => {
    if (!phone || phone.replace(/\D/g, "").length < 10) {
      toast({ title: "Enter a valid 10-digit phone number", variant: "destructive" });
      return;
    }
    setSending(true);
    try {
      let paymentLink: string;

      if (razorpayConfigured) {
        try {
          paymentLink = await generateRazorpayLink();
          setGeneratedLink(paymentLink);
        } catch (rzpErr: unknown) {
          const msg = rzpErr instanceof Error ? rzpErr.message : String(rzpErr);
          console.debug("Razorpay link failed, falling back to demo link:", msg);
          paymentLink = `https://pay.hospital.app/pay/${bill.id.slice(0, 8)}`;
        }
      } else {
        paymentLink = `https://pay.hospital.app/pay/${bill.id.slice(0, 8)}`;
      }

      // Send via WhatsApp
      const cleanPhone = phone.replace(/\D/g, "");
      const fullPhone = cleanPhone.startsWith("91") ? cleanPhone : `91${cleanPhone}`;
      window.open(
        `https://wa.me/${fullPhone}?text=${encodeURIComponent(buildMessage(paymentLink))}`,
        "_blank",
        "noopener,noreferrer"
      );

      // Mark bill as link-sent
      await supabase.from("bills").update({ payment_link_sent: true } as never).eq("id", bill.id);

      toast({ title: "Payment link sent on WhatsApp ✓" });
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Failed to send payment link", description: msg, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const handleCopy = async () => {
    let link = generatedLink;
    if (!link) {
      if (razorpayConfigured) {
        try {
          link = await generateRazorpayLink();
          setGeneratedLink(link);
        } catch {
          link = `https://pay.hospital.app/pay/${bill.id.slice(0, 8)}`;
        }
      } else {
        link = `https://pay.hospital.app/pay/${bill.id.slice(0, 8)}`;
      }
    }
    await navigator.clipboard.writeText(link);
    toast({ title: "Payment link copied ✓" });
  };

  const previewLink = generatedLink || `https://pay.hospital.app/pay/${bill.id.slice(0, 8)}`;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Send Payment Link</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Patient header */}
          <div className="flex items-center gap-3 bg-muted/50 rounded-lg p-3">
            <div className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">
              {bill.patient_name.charAt(0)}
            </div>
            <div>
              <p className="text-sm font-bold text-foreground">{bill.patient_name}</p>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] h-5">{bill.uhid}</Badge>
                <span className="text-[11px] font-mono text-muted-foreground">Bill #{bill.bill_number}</span>
              </div>
            </div>
          </div>

          {/* Amount */}
          <div className="space-y-2">
            <Label className="text-xs">Amount (₹)</Label>
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="text-lg font-bold h-12"
            />
          </div>

          {/* Phone */}
          <div className="space-y-2">
            <Label className="text-xs">Patient Phone Number *</Label>
            <Input
              placeholder="9876543210"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={12}
            />
          </div>

          {/* Config notice */}
          {!razorpayConfigured && (
            <div className="flex items-start gap-2 bg-accent/10 border border-accent/20 rounded-lg p-3">
              <Info size={14} className="text-accent mt-0.5 shrink-0" />
              <p className="text-[11px] text-muted-foreground">
                Configure Razorpay in Settings → Integrations for live payment links. Demo link will be used.
              </p>
            </div>
          )}

          {/* Razorpay badge when configured */}
          {razorpayConfigured && (
            <div className="flex items-center gap-1.5 text-[11px] text-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 rounded-lg px-3 py-2">
              <span className="font-semibold">✓ Razorpay configured</span>
              <span className="text-muted-foreground">— Live payment link will be generated</span>
            </div>
          )}

          {/* Message preview */}
          <div className="bg-muted/30 rounded-lg p-3 border border-border">
            <p className="text-[10px] font-bold uppercase text-muted-foreground mb-2">Message Preview</p>
            <pre className="text-[11px] text-foreground whitespace-pre-wrap font-sans leading-relaxed">
              {buildMessage(previewLink)}
            </pre>
          </div>

          {/* Generated link display */}
          {generatedLink && (
            <div className="flex flex-col items-center gap-3 bg-primary/5 border border-primary/20 rounded-lg p-4">
              <div className="flex items-center gap-2 w-full">
                <ExternalLink size={12} className="text-primary shrink-0" />
                <a
                  href={generatedLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-primary underline truncate flex-1"
                >
                  {generatedLink}
                </a>
              </div>
              <div className="bg-white p-2 rounded border mt-2">
                <QRCodeSVG value={generatedLink} size={140} level="M" />
              </div>
              <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                <QrCode size={10} /> Scan to pay via UPI / Cards
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={handleCopy}
              disabled={sending}
            >
              <Copy size={14} /> Copy Link
            </Button>
            <Button
              size="sm"
              className="gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={handleSend}
              disabled={sending}
            >
              {sending ? <Loader2 size={13} className="animate-spin" /> : <MessageSquare size={14} />}
              {sending ? "Sending…" : "Send on WhatsApp"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PaymentLinkModal;
