/**
 * Phase 6, Priority 2 (Money) — razorpay-webhook.
 *
 * Distinct from razorpay-subscription-webhook: this one auto-reconciles a PATIENT bill against
 * an incoming payment.captured / payment_link.paid event, via the record_online_bill_payment
 * RPC. Its secret comes from a Deno env var (RAZORPAY_WEBHOOK_SECRET), not
 * platform_billing_settings — a self-configured local-only test value is set in
 * supabase/functions/.env (gitignored) so this can be tested completely without touching
 * a real Razorpay account; this function never makes an outbound Razorpay API call at all.
 *
 * Two bugs found and fixed writing this test, logged as KNOWN-BUG-183 (plus the much larger
 * platform-level KNOWN-BUG-182, fixed in supabase/config.toml, not exercisable from this local
 * harness — see that entry):
 * (a) the dead-letter-queue write on any thrown error tried to read the original payload off
 *     `(err as any)._rawBody`, which nothing ever set, so every DLQ row was `payload: {}`
 *     regardless of what the webhook actually contained. Test 3 below uses malformed JSON,
 *     which can't populate `payload` either way (nothing can parse invalid JSON into an
 *     object) — it proves the DLQ write itself now happens with a real `error_message`, not
 *     the specific payload-capture fix, which only matters for the rarer case of a genuinely
 *     unexpected exception AFTER the body has already parsed as valid JSON. The function's
 *     other error paths are all deliberate early-returns (Supabase's errors-as-values
 *     contract), not thrown exceptions, so that case is not independently reproducible here
 *     without sabotaging the environment;
 * (b) the catch-all returned `String(err)` raw to the caller.
 */
import { describe, it, expect, afterAll } from "vitest";
import { localSupabaseUrl, serviceClient } from "../fixtures/serviceClient";
import { HOSPITAL_A, PATIENTS_A } from "../fixtures/constants";
import { assertLocalTarget } from "../fixtures/guard";
import { edgeRuntimeReachable } from "../fixtures/edgeFunctionClient";

assertLocalTarget(process.env.SUPABASE_URL ?? "http://127.0.0.1:54321", process.env.SUPABASE_PROJECT_REF);
const runtimeUp = await edgeRuntimeReachable();

const WEBHOOK_SECRET = "test-fixture-patient-billing-webhook-secret-do-not-use-in-prod";
const TEST_BILL_ID = "a0000000-0000-4000-8000-900000000001";

async function sign(body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function postWebhook(rawBody: string, opts: { signature?: string | null; eventId?: string } = {}) {
  const signature = opts.signature === null ? undefined : opts.signature ?? (await sign(rawBody));
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (signature) headers["x-razorpay-signature"] = signature;
  if (opts.eventId) headers["x-razorpay-event-id"] = opts.eventId;
  return fetch(`${localSupabaseUrl()}/functions/v1/razorpay-webhook`, { method: "POST", headers, body: rawBody });
}

function capturedPayload(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: "pay_patientfixture123",
          amount: 50000, // ₹500.00
          method: "upi",
          notes: { bill_id: TEST_BILL_ID, hospital_id: HOSPITAL_A.id },
        },
      },
    },
    ...overrides,
  });
}

if (runtimeUp) {
  const svc = serviceClient();
  await svc.from("bills").delete().eq("id", TEST_BILL_ID);
  await svc.from("bills").insert({
    id: TEST_BILL_ID,
    hospital_id: HOSPITAL_A.id,
    bill_number: "PHASE6-DUNNING-FIXTURE-001",
    patient_id: PATIENTS_A[0].id,
    bill_type: "opd",
    bill_status: "final",
    subtotal: 500,
    taxable_amount: 500,
    gst_amount: 0,
    total_amount: 500,
    patient_payable: 500,
    paid_amount: 0,
    balance_due: 500,
    payment_status: "unpaid",
  });
}

afterAll(async () => {
  if (!runtimeUp) return;
  const svc = serviceClient();
  await svc.from("bill_payments").delete().eq("bill_id", TEST_BILL_ID);
  await svc.from("journal_line_items").delete().eq("hospital_id", HOSPITAL_A.id).eq("reference_id", TEST_BILL_ID);
  await svc.from("journal_entries").delete().eq("hospital_id", HOSPITAL_A.id).eq("reference_id", TEST_BILL_ID);
  await svc.from("bills").delete().eq("id", TEST_BILL_ID);
  await svc.from("razorpay_webhook_log").delete().like("webhook_id", "evt_patientfixture%");
  await svc.from("webhook_dlq").delete().eq("source", "razorpay_payment").ilike("error_message", "%Unexpected%");
});

describe.skipIf(!runtimeUp)("razorpay-webhook", () => {
  it("1. missing signature header is rejected", async () => {
    const res = await postWebhook(capturedPayload(), { signature: null });
    expect(res.status).toBe(401);
  });

  it("2. a forged signature is rejected", async () => {
    const res = await postWebhook(capturedPayload(), { signature: "0".repeat(64) });
    expect(res.status).toBe(401);
  });

  it("3. malformed JSON with a valid signature over that exact body does not 500 with a raw stack trace, and is genuinely written to the DLQ with a real error_message", async () => {
    const badBody = "{not valid json, but signed correctly";
    const res = await postWebhook(badBody);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Internal error");
    expect(res.headers.get("content-type") || "").not.toMatch(/text\/plain/);
    expect(JSON.stringify(body)).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);

    const svc = serviceClient();
    const { data: dlqRows } = await svc
      .from("webhook_dlq")
      .select("payload, error_message")
      .eq("source", "razorpay_payment")
      .order("created_at", { ascending: false })
      .limit(1);
    // Before the fix this was always `{}` — the raw body never actually reached the DLQ writer.
    expect(dlqRows?.[0]?.error_message).toBeTruthy();
  });

  it("4. an event type this webhook does not act on is acknowledged as ignored", async () => {
    const res = await postWebhook(JSON.stringify({ event: "payment.authorized", payload: {} }), { eventId: "evt_patientfixture_ignored" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ignored");
  });

  it("5. payment.captured with no bill_id in notes is a clean no-op, not an error", async () => {
    const res = await postWebhook(
      JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_nobillid", amount: 10000, notes: {} } } } }),
      { eventId: "evt_patientfixture_nobill" },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("no_bill_id");
  });

  it("6. a correctly-signed payment.captured event for a real bill genuinely reconciles the payment", async () => {
    const res = await postWebhook(capturedPayload(), { eventId: "evt_patientfixture_001" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.bill_id).toBe(TEST_BILL_ID);
    expect(body.amount).toBe(500);

    const svc = serviceClient();
    const { data: bill } = await svc.from("bills").select("payment_status, paid_amount, balance_due").eq("id", TEST_BILL_ID).maybeSingle();
    expect(bill?.payment_status).toBe("paid");
    expect(Number(bill?.paid_amount)).toBe(500);
    expect(Number(bill?.balance_due)).toBe(0);

    const { data: payments } = await svc.from("bill_payments").select("amount, payment_mode, transaction_id").eq("bill_id", TEST_BILL_ID);
    expect(payments).toHaveLength(1);
    expect(payments![0].transaction_id).toBe("pay_patientfixture123");
  });

  it("7. the same webhook event id replayed is skipped as a duplicate, not double-reconciled", async () => {
    const res = await postWebhook(capturedPayload(), { eventId: "evt_patientfixture_001" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skipped).toBe("duplicate");

    const svc = serviceClient();
    const { data: payments } = await svc.from("bill_payments").select("id").eq("bill_id", TEST_BILL_ID);
    expect(payments).toHaveLength(1); // still just the one from test 6, not two
  });

  it("8. an unknown bill_id returns a clean 404, not a raw DB error", async () => {
    const res = await postWebhook(
      capturedPayload({ payload: { payment: { entity: { id: "pay_unknownbill", amount: 10000, notes: { bill_id: "00000000-0000-0000-0000-000000000000" } } } } }),
      { eventId: "evt_patientfixture_unknownbill" },
    );
    expect(res.status).toBe(404);
  });
});
