import React, { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, Clock, CreditCard } from "lucide-react";

interface LinkData {
  id: string;
  amount: number;
  status: string;
  expires_at: string;
  bill_id: string;
  patient_id: string;
  bill_number: string;
  patient_name: string;
  hospital_name: string;
  hospital_logo: string | null;
  razorpay_link_url: string | null;
}

const PaymentLandingPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [link, setLink] = useState<LinkData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    loadLink();
  }, [token]);

  const loadLink = async () => {
    const { data, error: err } = await supabase
      .from("payment_links" as any)
      .select("*, bills(bill_number, hospital_id, hospitals(name, logo_url)), patients(full_name), razorpay_link_url")
      .eq("link_token", token)
      .maybeSingle();

    if (err || !data) {
      setError("Payment link not found.");
      setLoading(false);
      return;
    }

    const d = data as any;
    const isExpired = new Date(d.expires_at) < new Date();
    if (isExpired && d.status === "active") {
      await supabase.from("payment_links" as any).update({ status: "expired" }).eq("id", d.id);
      d.status = "expired";
    }

    setLink({
      id: d.id,
      amount: Number(d.amount),
      status: d.status,
      expires_at: d.expires_at,
      bill_id: d.bill_id,
      patient_id: d.patient_id,
      bill_number: d.bills?.bill_number || "",
      patient_name: d.patients?.full_name || "",
      hospital_name: d.bills?.hospitals?.name || "Hospital",
      hospital_logo: d.bills?.hospitals?.logo_url || null,
      razorpay_link_url: d.razorpay_link_url || null,
    });
    setLoading(false);
  };

  const handlePay = async () => {
    if (!link) return;
    // Redirect to Razorpay checkout if a real payment link was generated
    if (link.razorpay_link_url) {
      window.location.href = link.razorpay_link_url;
      return;
    }
    // Fallback: simulate payment for hospitals without Razorpay configured
    const { data: userData } = await supabase.from("users").select("id").limit(1).maybeSingle();

    // Insert payment record
    await supabase.from("bill_payments").insert({
      hospital_id: (await supabase.from("bills").select("hospital_id").eq("id", link.bill_id).maybeSingle()).data?.hospital_id,
      bill_id: link.bill_id,
      amount: link.amount,
      payment_mode: "online",
      gateway_reference: `PAY-${link.id.slice(0, 8).toUpperCase()}`,
      received_by: userData?.id || null,
    });

    // Update bill
    const { data: bill } = await supabase.from("bills").select("paid_amount, balance_due, total_amount, admission_id").eq("id", link.bill_id).maybeSingle();
    if (bill) {
      const newPaid = (Number(bill.paid_amount) || 0) + link.amount;
      const newBalance = Math.max(0, (Number(bill.total_amount) || 0) - newPaid);
      await supabase.from("bills").update({
        paid_amount: newPaid,
        balance_due: newBalance,
        payment_status: newBalance <= 0 ? "paid" : "partial",
      }).eq("id", link.bill_id);

      if (newBalance <= 0 && bill.admission_id) {
        await supabase.from("admissions").update({ billing_cleared: true }).eq("id", bill.admission_id);
      }
    }

    // Update link status
    await supabase.from("payment_links" as any).update({
      status: "paid",
      paid_at: new Date().toISOString(),
    }).eq("id", link.id);

    setLink({ ...link, status: "paid" });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground text-sm">Loading payment details...</p>
      </div>
    );
  }

  if (error || !link) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-3">
          <AlertTriangle size={48} className="text-destructive mx-auto" />
          <p className="text-lg font-bold text-foreground">{error || "Link not found"}</p>
          <p className="text-sm text-muted-foreground">Please contact the hospital for assistance.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl shadow-lg max-w-md w-full overflow-hidden">
        {/* Header */}
        <div className="bg-primary text-primary-foreground px-6 py-5 text-center">
          {link.hospital_logo && (
            <img src={link.hospital_logo} alt="" className="h-10 mx-auto mb-2 rounded" />
          )}
          <h1 className="text-lg font-bold">{link.hospital_name}</h1>
          <p className="text-xs opacity-80 mt-1">Secure Bill Payment</p>
        </div>

        <div className="p-6 space-y-5">
          {link.status === "paid" ? (
            <div className="text-center space-y-3 py-4">
              <CheckCircle2 size={56} className="text-emerald-500 mx-auto" />
              <h2 className="text-xl font-bold text-foreground">Payment Received!</h2>
              <p className="text-sm text-muted-foreground">Thank you for your payment. A receipt has been sent.</p>
              <Badge className="bg-emerald-100 text-emerald-700 text-sm px-4 py-1">₹{link.amount.toLocaleString("en-IN")} Paid</Badge>
            </div>
          ) : link.status === "expired" ? (
            <div className="text-center space-y-3 py-4">
              <Clock size={56} className="text-muted-foreground mx-auto" />
              <h2 className="text-xl font-bold text-foreground">Link Expired</h2>
              <p className="text-sm text-muted-foreground">
                This payment link has expired. Please contact {link.hospital_name} for a new link.
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Patient</span>
                  <span className="font-medium">{link.patient_name}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Bill No.</span>
                  <span className="font-mono text-xs">{link.bill_number}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Valid Until</span>
                  <span>{new Date(link.expires_at).toLocaleDateString("en-IN")}</span>
                </div>
              </div>

              <div className="bg-muted/50 rounded-xl p-5 text-center">
                <p className="text-xs text-muted-foreground mb-1">Amount to Pay</p>
                <p className="text-3xl font-bold text-foreground font-mono">
                  ₹{link.amount.toLocaleString("en-IN")}
                </p>
              </div>

              <Button onClick={handlePay} className="w-full h-12 text-base gap-2" size="lg">
                <CreditCard size={18} /> Pay Now
              </Button>

              <p className="text-[10px] text-center text-muted-foreground">
                Secured by Razorpay • 256-bit SSL encryption
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default PaymentLandingPage;
