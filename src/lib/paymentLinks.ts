import { supabase } from "@/integrations/supabase/client";

export interface GeneratePaymentLinkOpts {
  hospitalId: string;
  billId: string;
  patientId: string;
  patientName: string;
  amount: number;
  phone?: string | null;
  expiryDays?: number;
  createdBy?: string | null;
}

export interface GeneratePaymentLinkResult {
  url: string;
  isRazorpay: boolean;
  linkToken: string;
}

/**
 * The one real way to create a shareable payment link: try Razorpay first,
 * then always persist a `payment_links` row and return a real, resolvable
 * URL — the app's own registered `/pay/:token` route (never a placeholder
 * domain the hospital doesn't own).
 */
export async function generatePaymentLink(opts: GeneratePaymentLinkOpts): Promise<GeneratePaymentLinkResult> {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + (opts.expiryDays ?? 7) * 86400000).toISOString();

  let razorpayLinkId: string | null = null;
  let razorpayLinkUrl: string | null = null;
  let shortUrl: string | null = null;
  try {
    const rzpRes = await supabase.functions.invoke("create-razorpay-payment-link", {
      body: {
        bill_id: opts.billId,
        amount: opts.amount,
        patient_name: opts.patientName,
        phone: opts.phone || undefined,
        hospital_id: opts.hospitalId,
      },
    });
    if (!rzpRes.error && (rzpRes.data as any)?.razorpay_link_id) {
      razorpayLinkId = (rzpRes.data as any).razorpay_link_id;
      razorpayLinkUrl = (rzpRes.data as any).razorpay_link_url;
      shortUrl = (rzpRes.data as any).short_url;
    }
  } catch {
    // Razorpay not configured or unreachable — fall through to the local link
  }

  const { error } = await (supabase as any).from("payment_links").insert({
    hospital_id: opts.hospitalId,
    bill_id: opts.billId,
    patient_id: opts.patientId,
    link_token: token,
    amount: opts.amount,
    expires_at: expiresAt,
    created_by: opts.createdBy ?? null,
    sent_via: [],
    razorpay_link_id: razorpayLinkId,
    razorpay_link_url: razorpayLinkUrl,
    short_url: shortUrl,
  });
  if (error) throw error;

  const url = shortUrl || `${window.location.origin}/pay/${token}`;
  return { url, isRazorpay: !!razorpayLinkId, linkToken: token };
}
