/**
 * Opens a subscription invoice PDF via a short-lived signed URL. Lifted out of
 * PaymentHistoryTable.tsx so that file exports only its component — a file mixing
 * component and non-component exports silently disables Fast Refresh for it.
 */
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { PaymentHistoryRow } from "@/components/billing/PaymentHistoryTable";

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
