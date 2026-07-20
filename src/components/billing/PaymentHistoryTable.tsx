/**
 * Platform-billing payment history — one component, three consumers:
 *   • Settings › Plan & Billing  (what a hospital paid Aumrti)
 *   • Platform › Hospital › Billing  (same, seen from the console)
 *   • Platform › Revenue  (recent activity across hospitals)
 *
 * It renders the FULL record, not just successful charges: failed attempts and
 * credit notes appear too. Before this, only `subscription.charged` produced a
 * row, so a declined card left no trace anywhere and a refunded invoice still
 * read "paid" — payment history could not be used for support or reconciliation.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Download, FileText, AlertTriangle, RotateCcw, Loader2 } from "lucide-react";
import { formatINRExact } from "@/lib/currency";
import { toast } from "sonner";

export interface PaymentHistoryRow {
  id: string;
  hospital_id: string;
  invoice_number: string;
  invoice_type: "tax_invoice" | "payment_attempt" | "credit_note" | null;
  status: string;
  plan_name: string | null;
  billing_cycle: string | null;
  amount_inr: number | string;
  billing_period_start: string | null;
  billing_period_end: string | null;
  pdf_storage_path: string | null;
  document_format: "pdf" | "html" | null;
  payment_method: string | null;
  payment_method_detail: string | null;
  failure_reason: string | null;
  refund_amount_inr: number | string | null;
  created_at: string;
  hospitals?: { name: string } | null;
}

const SELECT = `
  id, hospital_id, invoice_number, invoice_type, status, plan_name, billing_cycle,
  amount_inr, billing_period_start, billing_period_end, pdf_storage_path,
  document_format, payment_method, payment_method_detail, failure_reason,
  refund_amount_inr, created_at
`;

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

const STATUS_STYLE: Record<string, string> = {
  paid:               "bg-emerald-50 text-emerald-700 border-emerald-200",
  failed:             "bg-red-50 text-red-700 border-red-200",
  refunded:           "bg-amber-50 text-amber-700 border-amber-200",
  partially_refunded: "bg-amber-50 text-amber-700 border-amber-200",
  pending:            "bg-blue-50 text-blue-700 border-blue-200",
};

const TYPE_ICON = {
  tax_invoice:     <FileText size={12} className="text-muted-foreground" />,
  payment_attempt: <AlertTriangle size={12} className="text-red-600" />,
  credit_note:     <RotateCcw size={12} className="text-amber-600" />,
};

export async function downloadInvoiceDocument(row: Pick<PaymentHistoryRow, "pdf_storage_path" | "invoice_number">) {
  if (!row.pdf_storage_path) return;
  const { data, error } = await supabase.storage
    .from("subscription-invoices")
    .createSignedUrl(row.pdf_storage_path, 300);
  if (error || !data?.signedUrl) {
    toast.error("Could not open the invoice. Please try again.");
    return;
  }
  window.open(data.signedUrl, "_blank");
}

interface Props {
  /** Omit to show activity across all hospitals (platform Revenue view). */
  hospitalId?: string;
  limit?: number;
  showHospitalColumn?: boolean;
  title?: string;
  /** Rows supplied by the parent instead of fetched here. */
  rows?: PaymentHistoryRow[];
}

export default function PaymentHistoryTable({
  hospitalId,
  limit = 12,
  showHospitalColumn = false,
  title = "Payment History",
  rows: providedRows,
}: Props) {
  const { data: fetched = [], isLoading } = useQuery({
    queryKey: ["payment-history", hospitalId ?? "all", limit, showHospitalColumn],
    queryFn: async () => {
      let q = (supabase as any)
        .from("subscription_invoices")
        .select(showHospitalColumn ? `${SELECT}, hospitals(name)` : SELECT)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (hospitalId) q = q.eq("hospital_id", hospitalId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as PaymentHistoryRow[];
    },
    enabled: providedRows === undefined,
    staleTime: 60_000,
  });

  const rows = providedRows ?? fetched;

  if (providedRows === undefined && isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-6">
        <Loader2 size={13} className="animate-spin" /> Loading payment history…
      </div>
    );
  }

  return (
    <section>
      {title && <h2 className="text-sm font-semibold text-foreground mb-3">{title}</h2>}

      {/* An empty state rather than hiding the section: a hospital whose first
          payment failed must still see that something happened. */}
      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">No payments yet.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Invoices appear here automatically once a subscription is charged.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="bg-muted/40 text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left px-4 py-2.5 font-medium">Document</th>
                {showHospitalColumn && <th className="text-left px-4 py-2.5 font-medium">Hospital</th>}
                <th className="text-left px-4 py-2.5 font-medium">Plan</th>
                <th className="text-left px-4 py-2.5 font-medium">Period</th>
                <th className="text-left px-4 py-2.5 font-medium">Method</th>
                <th className="text-left px-4 py-2.5 font-medium">Status</th>
                <th className="text-right px-4 py-2.5 font-medium">Amount</th>
                <th className="text-right px-4 py-2.5 font-medium">Invoice</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((inv) => {
                const isCredit = inv.invoice_type === "credit_note";
                return (
                  <tr key={inv.id} className="hover:bg-muted/20 transition-colors align-top">
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 font-mono text-xs text-foreground">
                        {TYPE_ICON[(inv.invoice_type ?? "tax_invoice") as keyof typeof TYPE_ICON]}
                        {inv.invoice_number}
                      </span>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{fmtDate(inv.created_at)}</p>
                    </td>

                    {showHospitalColumn && (
                      <td className="px-4 py-3 text-foreground">{inv.hospitals?.name ?? "—"}</td>
                    )}

                    <td className="px-4 py-3 text-foreground">
                      {inv.plan_name ?? "—"}
                      {inv.billing_cycle && (
                        <span className="text-[11px] text-muted-foreground ml-1">
                          ({inv.billing_cycle === "yearly" ? "yearly" : "monthly"})
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {inv.billing_period_start
                        ? `${fmtDate(inv.billing_period_start)} – ${fmtDate(inv.billing_period_end)}`
                        : "—"}
                    </td>

                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {inv.payment_method
                        ? <>
                            <span className="uppercase">{inv.payment_method}</span>
                            {inv.payment_method_detail && (
                              <span className="block text-[11px]">{inv.payment_method_detail}</span>
                            )}
                          </>
                        : "—"}
                    </td>

                    <td className="px-4 py-3">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium capitalize ${
                        STATUS_STYLE[inv.status] ?? "bg-muted text-muted-foreground border-border"
                      }`}>
                        {inv.status.replace("_", " ")}
                      </span>
                      {inv.failure_reason && (
                        <p className="text-[11px] text-red-600 mt-1 max-w-[200px]">{inv.failure_reason}</p>
                      )}
                    </td>

                    <td className={`px-4 py-3 text-right font-semibold ${isCredit ? "text-amber-700" : "text-foreground"}`}>
                      {isCredit ? "−" : ""}{formatINRExact(Number(inv.amount_inr))}
                      {!isCredit && Number(inv.refund_amount_inr) > 0 && (
                        <p className="text-[11px] font-normal text-amber-700">
                          {formatINRExact(Number(inv.refund_amount_inr))} refunded
                        </p>
                      )}
                    </td>

                    <td className="px-4 py-3 text-right">
                      {inv.pdf_storage_path ? (
                        <button
                          onClick={() => downloadInvoiceDocument(inv)}
                          className="inline-flex items-center gap-1 text-primary hover:underline text-xs font-medium"
                        >
                          {/* Labelled from what was actually stored — the old button
                              said "PDF" while serving an HTML file. */}
                          <Download size={12} /> {inv.document_format === "html" ? "View" : "PDF"}
                        </button>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
