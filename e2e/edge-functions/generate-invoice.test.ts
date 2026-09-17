/**
 * Phase 6, Priority 2 (Money) — generate-invoice.
 *
 * Already fixed in Phase 4 (KNOWN-BUG-126): "any caller with just the public anon key could
 * insert a fabricated status:'paid' subscription_invoices row for a hospital that never paid,
 * generate a real tax invoice bearing that hospital's own name/address/GSTIN, and email its
 * admin a fake 'payment success' notice." This proves that fix live. Minor cleanup in the same
 * pass: the catch-all logged the raw error object and returned `err.message` to the caller.
 */
import { describe, it, expect, afterAll } from "vitest";
import { callFunction, edgeRuntimeReachable } from "../fixtures/edgeFunctionClient";
import { serviceClient, LOCAL_SERVICE_ROLE_KEY } from "../fixtures/serviceClient";
import { HOSPITAL_A } from "../fixtures/constants";
import { assertLocalTarget } from "../fixtures/guard";

assertLocalTarget(process.env.SUPABASE_URL ?? "http://127.0.0.1:54321", process.env.SUPABASE_PROJECT_REF);
const runtimeUp = await edgeRuntimeReachable();

const createdInvoiceNumbers: string[] = [];

afterAll(async () => {
  if (!runtimeUp || createdInvoiceNumbers.length === 0) return;
  const svc = serviceClient();
  await svc.from("subscription_invoices").delete().in("invoice_number", createdInvoiceNumbers);
  await svc.from("subscription_events").delete().eq("hospital_id", HOSPITAL_A.id).eq("event_type", "payment_success");
});

describe.skipIf(!runtimeUp)("generate-invoice", () => {
  it("1. no Authorization header is rejected — the regression test for the fabricated-invoice fix", async () => {
    const res = await callFunction("generate-invoice", {
      token: null,
      body: { hospital_id: HOSPITAL_A.id, plan_name: "Growth", amount_inr: 5000 },
    });
    expect(res.status).toBe(401);
  });

  it("2. a garbage bearer token (not the service-role secret) is rejected", async () => {
    const res = await callFunction("generate-invoice", {
      token: "garbage",
      body: { hospital_id: HOSPITAL_A.id, plan_name: "Growth", amount_inr: 5000 },
    });
    expect(res.status).toBe(401);
  });

  it("3. missing required fields with a valid service-role token is a clean 400", async () => {
    const res = await callFunction("generate-invoice", { token: LOCAL_SERVICE_ROLE_KEY, body: { hospital_id: HOSPITAL_A.id } });
    expect(res.status).toBe(400);
  });

  it("4. malformed JSON does not 500 with a raw stack trace", async () => {
    const res = await callFunction("generate-invoice", { token: LOCAL_SERVICE_ROLE_KEY, rawBody: "{bad" });
    expect(res.status).not.toBe(200);
    expect(res.text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });

  it("5. the real service-role secret succeeds and produces a correctly GST-split invoice record", async () => {
    const res = await callFunction("generate-invoice", {
      token: LOCAL_SERVICE_ROLE_KEY,
      body: { hospital_id: HOSPITAL_A.id, plan_name: "Growth", amount_inr: 5900, billing_cycle: "monthly" },
    });
    expect(res.status).toBe(200);
    expect(res.json.invoice_number).toBeTruthy();
    createdInvoiceNumbers.push(res.json.invoice_number);

    const svc = serviceClient();
    const { data: row } = await svc
      .from("subscription_invoices")
      .select("subtotal_inr, cgst_inr, sgst_inr, igst_inr, tax_rate_pct, status, hospital_id")
      .eq("invoice_number", res.json.invoice_number)
      .maybeSingle();
    expect(row?.hospital_id).toBe(HOSPITAL_A.id);
    expect(row?.status).toBe("paid");
    // Tax-inclusive breakup must reconstruct the exact charged total.
    const total = Number(row!.subtotal_inr) + Number(row!.cgst_inr) + Number(row!.sgst_inr) + Number(row!.igst_inr);
    expect(Math.round(total * 100) / 100).toBe(5900);
  });

  it("6. a different charged amount produces a different taxable base — the GST split is real, not a stub", async () => {
    const res = await callFunction("generate-invoice", {
      token: LOCAL_SERVICE_ROLE_KEY,
      body: { hospital_id: HOSPITAL_A.id, plan_name: "Enterprise", amount_inr: 11800, billing_cycle: "monthly" },
    });
    expect(res.status).toBe(200);
    createdInvoiceNumbers.push(res.json.invoice_number);

    const svc = serviceClient();
    const { data: cheap } = await svc.from("subscription_invoices").select("subtotal_inr").eq("invoice_number", createdInvoiceNumbers[0]).maybeSingle();
    const { data: dear } = await svc.from("subscription_invoices").select("subtotal_inr").eq("invoice_number", createdInvoiceNumbers[1]).maybeSingle();
    expect(Number(dear?.subtotal_inr)).toBeGreaterThan(Number(cheap?.subtotal_inr));
  });
});
