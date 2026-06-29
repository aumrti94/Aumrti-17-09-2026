import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { PortalSession } from "./PortalLogin";
import { X, Smartphone, Link2, Building2, Download } from "lucide-react";
import { toast } from "sonner";

const PortalBills: React.FC<{ session: PortalSession }> = ({ session }) => {
  const [tab, setTab] = useState<"pending" | "paid">("pending");
  const [bills, setBills] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [payingBill, setPayingBill] = useState<any>(null);
  const [hospital, setHospital] = useState<any>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("bills")
        .select("id, bill_number, bill_date, bill_type, total_amount, paid_amount, balance_due, payment_status")
        .eq("patient_id", session.patientId)
        .eq("hospital_id", session.hospitalId)
        .order("bill_date", { ascending: false })
        .limit(50);
      setBills(data || []);

      const { data: h } = await supabase
        .from("hospitals")
        .select("name, address, razorpay_key_id")
        .eq("id", session.hospitalId)
        .maybeSingle();
      setHospital(h);

      setLoading(false);
    })();
  }, [session]);

  const pendingBills = bills.filter((b) => b.payment_status === "unpaid" || b.payment_status === "partial");
  const paidBills = bills.filter((b) => b.payment_status === "paid");
  const totalDue = pendingBills.reduce((s, b) => s + (b.balance_due || 0), 0);

  const activeBills = tab === "pending" ? pendingBills : paidBills;

  const handlePrintReceipt = (bill: any) => {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`
      <html><head><title>Receipt - ${bill.bill_number}</title>
      <style>
        body { font-family: Inter, sans-serif; padding: 32px; max-width: 500px; margin: 0 auto; }
        h1 { font-size: 18px; color: #0E7B7B; } 
        .row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13px; border-bottom: 1px solid #F1F5F9; }
        .label { color: #64748B; } .value { font-weight: bold; color: #0F172A; }
        .footer { margin-top: 24px; font-size: 11px; color: #94A3B8; }
      </style></head><body>
        <h1>🧾 Payment Receipt</h1>
        <p style="font-size:12px;color:#64748B">${session.hospitalName}</p>
        <div style="margin-top:20px">
          <div class="row"><span class="label">Bill #</span><span class="value">${bill.bill_number}</span></div>
          <div class="row"><span class="label">Date</span><span class="value">${new Date(bill.bill_date).toLocaleDateString("en-IN")}</span></div>
          <div class="row"><span class="label">Patient</span><span class="value">${session.fullName}</span></div>
          <div class="row"><span class="label">UHID</span><span class="value">${session.uhid}</span></div>
          <div class="row"><span class="label">Total</span><span class="value">₹${(bill.total_amount || 0).toLocaleString("en-IN")}</span></div>
          <div class="row"><span class="label">Paid</span><span class="value" style="color:#15803D">₹${(bill.paid_amount || 0).toLocaleString("en-IN")}</span></div>
        </div>
        <div class="footer">Thank you for choosing ${session.hospitalName}.</div>
        <script>window.onload=()=>window.print()</script>
      </body></html>
    `);
    w.document.close();
  };

  return (
    <div className="px-4 py-0">
      {/* Tabs */}
      <div className="flex" style={{ height: 44, borderBottom: "1px solid #E2E8F0" }}>
        {[
          { key: "pending" as const, label: "⏳ Pending" },
          { key: "paid" as const, label: "✅ Paid" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="flex-1 text-sm font-medium transition-colors"
            style={{
              color: tab === t.key ? "#0E7B7B" : "#94A3B8",
              borderBottom: tab === t.key ? "2px solid #0E7B7B" : "2px solid transparent",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="py-4">
        {/* Outstanding banner */}
        {tab === "pending" && totalDue > 0 && (
          <div
            className="rounded-xl p-3.5 mb-3 flex items-center justify-between"
            style={{ background: "#FEF3C7", border: "1px solid #FDE68A" }}
          >
            <span className="text-xs font-medium" style={{ color: "#D97706" }}>Total Outstanding</span>
            <span className="text-xl font-bold" style={{ color: "#D97706" }}>
              ₹{totalDue.toLocaleString("en-IN")}
            </span>
          </div>
        )}

        {loading ? (
          <SkeletonList />
        ) : activeBills.length === 0 ? (
          <EmptyCard text={tab === "pending" ? "No pending bills 🎉" : "No paid bills found"} />
        ) : (
          <div className="space-y-2.5">
            {activeBills.map((b) => {
              const isPaid = (b.balance_due || 0) <= 0;
              return (
                <div
                  key={b.id}
                  className="bg-white rounded-xl p-3.5"
                  style={{
                    border: "1px solid #E2E8F0",
                    borderLeft: isPaid ? "3px solid #10B981" : "3px solid #EF4444",
                  }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-mono" style={{ color: "#94A3B8" }}>#{b.bill_number}</span>
                    <div className="flex items-center gap-2">
                      {b.bill_type && (
                        <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ background: "#F1F5F9", color: "#64748B" }}>
                          {b.bill_type}
                        </span>
                      )}
                      <span className="text-[10px]" style={{ color: "#94A3B8" }}>
                        {new Date(b.bill_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                      </span>
                    </div>
                  </div>

                  <p className="text-base font-bold" style={{ color: "#0F172A" }}>
                    ₹{(b.total_amount || 0).toLocaleString("en-IN")}
                  </p>

                  {!isPaid ? (
                    <div className="flex items-center justify-between mt-1.5">
                      <div>
                        <span className="text-[11px]" style={{ color: "#10B981" }}>
                          Paid: ₹{(b.paid_amount || 0).toLocaleString("en-IN")}
                        </span>
                        <span className="text-[11px] font-bold ml-2" style={{ color: "#EF4444" }}>
                          Due: ₹{(b.balance_due || 0).toLocaleString("en-IN")}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-[11px] font-bold" style={{ color: "#10B981" }}>Paid ✓</span>
                    </div>
                  )}

                  {/* Action button */}
                  {!isPaid ? (
                    <button
                      onClick={() => setPayingBill(b)}
                      className="w-full mt-3 rounded-lg text-white font-bold text-sm flex items-center justify-center gap-2"
                      style={{ height: 44, background: "#0E7B7B" }}
                    >
                      📱 Pay Now
                    </button>
                  ) : (
                    <button
                      onClick={() => handlePrintReceipt(b)}
                      className="w-full mt-3 rounded-lg font-bold text-sm flex items-center justify-center gap-2"
                      style={{ height: 44, border: "1.5px solid #E2E8F0", color: "#374151" }}
                    >
                      <Download size={14} /> Download Receipt
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Payment Sheet */}
      {payingBill && (
        <PaymentSheet
          bill={payingBill}
          hospital={hospital}
          session={session}
          onClose={() => setPayingBill(null)}
        />
      )}
    </div>
  );
};

/* ═══════════════ PAYMENT SHEET ═══════════════ */
const PaymentSheet: React.FC<{
  bill: any;
  hospital: any;
  session: PortalSession;
  onClose: () => void;
}> = ({ bill, hospital, session, onClose }) => {
  const balance = bill.balance_due || 0;

  const handleUPI = () => {
    const upiUrl = `upi://pay?pa=&pn=${encodeURIComponent(session.hospitalName)}&am=${balance}&cu=INR&tn=Bill-${bill.bill_number}`;
    window.open(upiUrl, "_blank", "noopener,noreferrer");
  };

  const handlePaymentLink = () => {
    if (hospital?.razorpay_key_id) {
      toast.info("Payment link will be sent to your WhatsApp shortly.");
    } else {
      toast.info("Please contact the hospital for bank details.");
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
      <div
        className="w-full bg-white rounded-t-2xl p-5 pb-8 animate-slide-up"
        style={{ maxWidth: 480 }}
      >
        <div className="flex items-center justify-between mb-4">
          <p className="text-lg font-bold" style={{ color: "#0F172A" }}>
            Pay ₹{balance.toLocaleString("en-IN")}
          </p>
          <button onClick={onClose} className="p-1 rounded-full" style={{ background: "#F1F5F9" }}>
            <X size={18} color="#64748B" />
          </button>
        </div>

        <p className="text-xs mb-4" style={{ color: "#94A3B8" }}>Bill #{bill.bill_number}</p>

        <div className="space-y-2.5">
          <button
            onClick={handleUPI}
            className="w-full flex items-center gap-3 p-4 rounded-xl text-left transition-all active:scale-[0.98]"
            style={{ border: "1.5px solid #E2E8F0" }}
          >
            <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "#EEF9F9" }}>
              <Smartphone size={18} color="#0E7B7B" />
            </div>
            <div>
              <p className="text-sm font-bold" style={{ color: "#0F172A" }}>UPI Payment</p>
              <p className="text-[11px]" style={{ color: "#64748B" }}>Pay via PhonePe, GPay, Paytm</p>
            </div>
          </button>

          <button
            onClick={handlePaymentLink}
            className="w-full flex items-center gap-3 p-4 rounded-xl text-left transition-all active:scale-[0.98]"
            style={{ border: "1.5px solid #E2E8F0" }}
          >
            <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "#EEF9F9" }}>
              <Link2 size={18} color="#0E7B7B" />
            </div>
            <div>
              <p className="text-sm font-bold" style={{ color: "#0F172A" }}>Payment Link</p>
              <p className="text-[11px]" style={{ color: "#64748B" }}>
                {hospital?.razorpay_key_id ? "Razorpay secure link" : "Bank transfer details"}
              </p>
            </div>
          </button>

          <button
            onClick={() => { toast.info(`Visit billing counter with Bill #${bill.bill_number}`); onClose(); }}
            className="w-full flex items-center gap-3 p-4 rounded-xl text-left transition-all active:scale-[0.98]"
            style={{ border: "1.5px solid #E2E8F0" }}
          >
            <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "#FEF3C7" }}>
              <Building2 size={18} color="#D97706" />
            </div>
            <div>
              <p className="text-sm font-bold" style={{ color: "#0F172A" }}>Pay at Hospital Counter</p>
              <p className="text-[11px]" style={{ color: "#64748B" }}>
                {hospital?.address || "Visit the billing counter"}
              </p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};

/* ═══════════════ SHARED ═══════════════ */
const EmptyCard: React.FC<{ text: string }> = ({ text }) => (
  <div className="bg-white rounded-xl p-10 text-center" style={{ border: "1px solid #E2E8F0" }}>
    <p className="text-sm" style={{ color: "#94A3B8" }}>{text}</p>
  </div>
);

const SkeletonList: React.FC = () => (
  <div className="space-y-2.5">
    {[1, 2, 3].map((i) => (
      <div key={i} className="bg-white rounded-xl p-4 animate-pulse" style={{ border: "1px solid #E2E8F0" }}>
        <div className="h-3 w-20 rounded" style={{ background: "#E2E8F0" }} />
        <div className="h-4 w-32 rounded mt-2" style={{ background: "#E2E8F0" }} />
      </div>
    ))}
  </div>
);

export default PortalBills;
