import React, { useState, useEffect, useCallback } from "react";
import { Download, Receipt, AlertCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { usePatientPortal } from "@/contexts/PatientPortalContext";

// ── types ─────────────────────────────────────────────────────────────────────

interface BillRow {
  id: string;
  bill_number: string;
  bill_date: string;
  bill_type: string;
  payment_status: string;
  total_amount: number;
  paid_amount: number;
  balance_due: number;
}

// ── helpers ───────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  "₹" + Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });

const STATUS_CFG: Record<string, { bg: string; color: string; label: string }> = {
  paid:    { bg: "#DCFCE7", color: "#15803D", label: "Paid"    },
  partial: { bg: "#FEF9C3", color: "#A16207", label: "Partial" },
  unpaid:  { bg: "#FEE2E2", color: "#DC2626", label: "Unpaid"  },
};

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const cfg = STATUS_CFG[status] ?? { bg: "#F1F5F9", color: "#64748B", label: status };
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap"
      style={{ background: cfg.bg, color: cfg.color }}
    >
      {cfg.label}
    </span>
  );
};

// Lazily append the Razorpay checkout script once
const loadRazorpay = (): Promise<boolean> =>
  new Promise((resolve) => {
    if ((window as any).Razorpay) { resolve(true); return; }
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload  = () => resolve(true);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });

// ── main component ────────────────────────────────────────────────────────────

const PatientPortalBillsPage: React.FC = () => {
  const { patientId, hospitalId, patient, hospital } = usePatientPortal();

  const [bills, setBills]         = useState<BillRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [payingId, setPayingId]   = useState<string | null>(null);
  // per-bill error messages — never block other rows
  const [billErrors, setBillErrors] = useState<Record<string, string>>({});

  // ── fetch ───────────────────────────────────────────────────────────────────
  const fetchBills = useCallback(async () => {
    if (!patientId || !hospitalId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("bills")
      .select("id, bill_number, bill_date, bill_type, payment_status, total_amount, paid_amount, balance_due")
      .eq("patient_id", patientId)
      .eq("hospital_id", hospitalId)
      .order("bill_date", { ascending: false })
      .limit(100);
    if (!error) setBills((data as BillRow[]) ?? []);
    setLoading(false);
  }, [patientId, hospitalId]);

  useEffect(() => { fetchBills(); }, [fetchBills]);

  // ── Razorpay checkout ───────────────────────────────────────────────────────
  const handlePayNow = async (bill: BillRow) => {
    if (!hospitalId) return;
    setPayingId(bill.id);
    setBillErrors((prev) => { const n = { ...prev }; delete n[bill.id]; return n; });

    try {
      // 1. Create Razorpay order via edge function
      const { data: orderData, error: fnErr } = await supabase.functions.invoke(
        "create-razorpay-order",
        {
          body: {
            hospitalId,
            packageId: bill.id,   // edge fn uses packageId for receipt tag only
            amount: bill.balance_due,
            notes: { bill_number: bill.bill_number, source: "patient_portal" },
          },
        }
      );

      if (fnErr || !orderData?.order_id) {
        const msg =
          orderData?.error ??
          fnErr?.message ??
          "Could not initiate payment. Please try again.";
        setBillErrors((prev) => ({ ...prev, [bill.id]: msg }));
        setPayingId(null);
        return;
      }

      // 2. Load checkout SDK (no-op if already loaded)
      const sdkReady = await loadRazorpay();
      if (!sdkReady) {
        setBillErrors((prev) => ({
          ...prev,
          [bill.id]: "Payment gateway unavailable. Please try again later.",
        }));
        setPayingId(null);
        return;
      }

      // 3. Open Razorpay checkout
      const rzp = new (window as any).Razorpay({
        key:         orderData.key_id,
        amount:      orderData.amount,
        currency:    orderData.currency,
        order_id:    orderData.order_id,
        name:        hospital?.name ?? "Hospital",
        description: `Bill #${bill.bill_number}`,
        image:       hospital?.logoUrl ?? undefined,
        prefill: {
          name:    patient?.fullName,
          contact: patient?.phone  ?? undefined,
          email:   patient?.email  ?? undefined,
        },
        theme: { color: "#0E7B7B" },
        handler: (_response: Record<string, string>) => {
          // 4a. Optimistic update — mark this bill as paid immediately
          setBills((prev) =>
            prev.map((b) =>
              b.id === bill.id
                ? { ...b, paid_amount: b.total_amount, balance_due: 0, payment_status: "paid" }
                : b
            )
          );
          toast.success(`Payment successful for Bill #${bill.bill_number}`);
          // 4b. Refresh from backend after 4 s (webhook may have updated by then)
          setTimeout(() => fetchBills(), 4000);
          setPayingId(null);
        },
        modal: {
          ondismiss: () => setPayingId(null),
        },
      });

      rzp.open();
    } catch (err) {
      setBillErrors((prev) => ({
        ...prev,
        [bill.id]: "An unexpected error occurred. Please try again.",
      }));
      setPayingId(null);
    }
  };

  // ── print receipt ───────────────────────────────────────────────────────────
  const handleReceipt = (bill: BillRow) => {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`
      <html><head><title>Receipt - ${bill.bill_number}</title>
      <style>
        body { font-family: Inter, sans-serif; padding: 32px; max-width: 480px; margin: 0 auto; }
        h1  { font-size: 18px; color: #0E7B7B; margin-bottom: 4px; }
        sub { font-size: 12px; color: #64748B; }
        .row { display: flex; justify-content: space-between; padding: 7px 0;
               font-size: 13px; border-bottom: 1px solid #F1F5F9; }
        .lbl { color: #64748B; } .val { font-weight: 600; color: #0F172A; }
        .footer { margin-top: 24px; font-size: 11px; color: #94A3B8; text-align: center; }
      </style></head>
      <body>
        <h1>Payment Receipt</h1>
        <sub>${hospital?.name ?? ""}</sub>
        <div style="margin-top:20px">
          <div class="row"><span class="lbl">Bill No</span><span class="val">${bill.bill_number}</span></div>
          <div class="row"><span class="lbl">Date</span>
               <span class="val">${new Date(bill.bill_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span></div>
          <div class="row"><span class="lbl">Patient</span><span class="val">${patient?.fullName ?? ""}</span></div>
          <div class="row"><span class="lbl">UHID</span><span class="val">${patient?.uhid ?? ""}</span></div>
          <div class="row"><span class="lbl">Type</span><span class="val">${bill.bill_type?.toUpperCase() ?? ""}</span></div>
          <div class="row"><span class="lbl">Total</span><span class="val">${fmt(bill.total_amount)}</span></div>
          <div class="row"><span class="lbl">Paid</span><span class="val" style="color:#15803D">${fmt(bill.paid_amount)}</span></div>
          <div class="row"><span class="lbl">Balance</span><span class="val" style="color:${bill.balance_due > 0 ? "#DC2626" : "#15803D"}">${fmt(bill.balance_due)}</span></div>
        </div>
        <div class="footer">Thank you for choosing ${hospital?.name ?? "us"}.</div>
        <script>window.onload = () => window.print();</script>
      </body></html>`);
    w.document.close();
  };

  // ── derived ─────────────────────────────────────────────────────────────────
  const totalOutstanding = bills.reduce((s, b) => s + (b.balance_due > 0 ? b.balance_due : 0), 0);

  // ── render ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full" style={{ background: "#F8FAFC" }}>

      {/* Page header */}
      <div
        className="flex-shrink-0 flex items-center justify-between px-5 py-4"
        style={{ background: "#fff", borderBottom: "1px solid #E2E8F0" }}
      >
        <div>
          <h1 className="text-base font-bold" style={{ color: "#0F172A" }}>Bills & Payments</h1>
          <p className="text-xs mt-0.5" style={{ color: "#94A3B8" }}>
            {bills.length} record{bills.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={fetchBills}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
          style={{ border: "1px solid #E2E8F0", color: "#64748B" }}
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Outstanding banner */}
      {totalOutstanding > 0 && !loading && (
        <div
          className="flex-shrink-0 mx-5 mt-4 flex items-center justify-between rounded-xl px-4 py-3"
          style={{ background: "#FEF9C3", border: "1px solid #FDE68A" }}
        >
          <span className="text-sm font-medium" style={{ color: "#A16207" }}>Total Outstanding</span>
          <span className="text-xl font-bold" style={{ color: "#A16207" }}>{fmt(totalOutstanding)}</span>
        </div>
      )}

      {/* Table area */}
      <div className="flex-1 overflow-auto p-5">
        {loading ? (
          <SkeletonTable />
        ) : bills.length === 0 ? (
          <EmptyState />
        ) : (
          <div
            className="rounded-xl overflow-hidden"
            style={{ border: "1px solid #E2E8F0", background: "#fff" }}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: 680 }}>
                <thead>
                  <tr style={{ background: "#F8FAFC", borderBottom: "1px solid #E2E8F0" }}>
                    {["Bill No", "Date", "Type", "Status", "Total", "Paid", "Balance", "Action"].map(
                      (h) => (
                        <th
                          key={h}
                          className="px-4 py-3 text-left text-xs font-semibold"
                          style={{ color: "#64748B" }}
                        >
                          {h}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {bills.map((bill, idx) => {
                    const isLast   = idx === bills.length - 1;
                    const isOwed   = (bill.balance_due ?? 0) > 0;
                    const isPaying = payingId === bill.id;
                    const rowErr   = billErrors[bill.id];

                    return (
                      <React.Fragment key={bill.id}>
                        <tr
                          className="transition-colors hover:bg-slate-50"
                          style={{ borderBottom: isLast && !rowErr ? "none" : "1px solid #F1F5F9" }}
                        >
                          {/* Bill No */}
                          <td className="px-4 py-3 font-mono text-xs font-semibold" style={{ color: "#0F172A" }}>
                            #{bill.bill_number}
                          </td>

                          {/* Date */}
                          <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: "#64748B" }}>
                            {new Date(bill.bill_date).toLocaleDateString("en-IN", {
                              day: "numeric", month: "short", year: "numeric",
                            })}
                          </td>

                          {/* Type */}
                          <td className="px-4 py-3">
                            <span
                              className="text-[11px] font-bold uppercase px-1.5 py-0.5 rounded"
                              style={{ background: "#F1F5F9", color: "#64748B" }}
                            >
                              {bill.bill_type || "—"}
                            </span>
                          </td>

                          {/* Status */}
                          <td className="px-4 py-3">
                            <StatusBadge status={bill.payment_status} />
                          </td>

                          {/* Total */}
                          <td className="px-4 py-3 text-sm font-semibold" style={{ color: "#0F172A" }}>
                            {fmt(bill.total_amount ?? 0)}
                          </td>

                          {/* Paid */}
                          <td className="px-4 py-3 text-sm" style={{ color: "#15803D" }}>
                            {fmt(bill.paid_amount ?? 0)}
                          </td>

                          {/* Balance */}
                          <td className="px-4 py-3 text-sm font-semibold"
                            style={{ color: isOwed ? "#DC2626" : "#15803D" }}>
                            {fmt(bill.balance_due ?? 0)}
                          </td>

                          {/* Action */}
                          <td className="px-4 py-3">
                            {isOwed ? (
                              <button
                                onClick={() => handlePayNow(bill)}
                                disabled={!!payingId}
                                className="text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-all active:scale-95 disabled:opacity-50 whitespace-nowrap"
                                style={{ background: "#0E7B7B" }}
                              >
                                {isPaying ? "Opening…" : "Pay Now"}
                              </button>
                            ) : (
                              <button
                                onClick={() => handleReceipt(bill)}
                                className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                                style={{ border: "1px solid #E2E8F0", color: "#64748B" }}
                              >
                                <Download size={12} /> Receipt
                              </button>
                            )}
                          </td>
                        </tr>

                        {/* Per-bill error row — never blocks other bills */}
                        {rowErr && (
                          <tr style={{ borderBottom: isLast ? "none" : "1px solid #F1F5F9" }}>
                            <td colSpan={8} className="px-4 py-2">
                              <div className="flex items-center gap-2 text-xs rounded-lg px-3 py-2"
                                style={{ background: "#FEF2F2", color: "#DC2626" }}>
                                <AlertCircle size={13} />
                                {rowErr}
                                <button
                                  className="ml-auto underline text-xs"
                                  onClick={() => setBillErrors((p) => { const n = { ...p }; delete n[bill.id]; return n; })}
                                >
                                  Dismiss
                                </button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ── skeleton ──────────────────────────────────────────────────────────────────

const SkeletonTable: React.FC = () => (
  <div className="rounded-xl overflow-hidden animate-pulse" style={{ border: "1px solid #E2E8F0", background: "#fff" }}>
    <div className="h-10" style={{ background: "#F8FAFC", borderBottom: "1px solid #E2E8F0" }} />
    {[1, 2, 3, 4].map((i) => (
      <div key={i} className="flex gap-4 px-4 py-3.5" style={{ borderBottom: "1px solid #F1F5F9" }}>
        {[80, 96, 56, 64, 72, 72, 72, 64].map((w, j) => (
          <div key={j} className="h-3.5 rounded" style={{ width: w, background: "#E2E8F0", flexShrink: 0 }} />
        ))}
      </div>
    ))}
  </div>
);

// ── empty state ───────────────────────────────────────────────────────────────

const EmptyState: React.FC = () => (
  <div
    className="flex flex-col items-center justify-center py-20 rounded-xl"
    style={{ border: "1px solid #E2E8F0", background: "#fff" }}
  >
    <Receipt size={40} style={{ color: "#E2E8F0" }} />
    <p className="mt-3 text-sm font-medium" style={{ color: "#94A3B8" }}>No bills found</p>
    <p className="text-xs mt-1" style={{ color: "#CBD5E1" }}>Bills generated at the hospital will appear here.</p>
  </div>
);

export default PatientPortalBillsPage;
