/**
 * Phase 6, Priority 2 (Money) — gst-irn-generate.
 *
 * Already fixed in Phase 4 (KNOWN-BUG-126): "any billing staff member of any hospital could
 * name another hospital's bill_id/hospital_id... and generate a live government e-Invoice/IRN
 * under that hospital's GSTIN, locking their bill in the process." Proves that fix live. No
 * live NIC IRP credentials exist in this local environment, so these tests exercise the
 * documented sandbox/demo-mode path — itself a real, load-bearing behaviour (what every
 * hospital sees until it configures live credentials in Settings → GST).
 */
import { describe, it, expect, afterAll } from "vitest";
import { callFunction, tokenFor, edgeRuntimeReachable } from "../fixtures/edgeFunctionClient";
import { serviceClient } from "../fixtures/serviceClient";
import { HOSPITAL_A, HOSPITAL_B, PATIENTS_A } from "../fixtures/constants";
import { assertLocalTarget } from "../fixtures/guard";

assertLocalTarget(process.env.SUPABASE_URL ?? "http://127.0.0.1:54321", process.env.SUPABASE_PROJECT_REF);
const runtimeUp = await edgeRuntimeReachable();

let tokenBillingA = "";
let tokenBillingB = "";
let taxableBillId = "";
let exemptBillId = "";

if (runtimeUp) {
  [tokenBillingA, tokenBillingB] = await Promise.all([tokenFor("a", "billing_executive"), tokenFor("b", "billing_executive")]);
  const svc = serviceClient();

  const { data: taxable, error: e1 } = await svc
    .from("bills")
    .insert({
      hospital_id: HOSPITAL_A.id, patient_id: PATIENTS_A[0].id,
      bill_number: `GSTTEST-TAX-${Date.now()}`, subtotal: 1000, gst_amount: 120, total_amount: 1120,
    })
    .select("id").single();
  if (e1) throw new Error(`Could not create taxable bill fixture: ${e1.message}`);
  taxableBillId = taxable.id;

  const { data: exempt, error: e2 } = await svc
    .from("bills")
    .insert({
      hospital_id: HOSPITAL_A.id, patient_id: PATIENTS_A[0].id,
      bill_number: `GSTTEST-EXEMPT-${Date.now()}`, subtotal: 500, gst_amount: 0, total_amount: 500,
    })
    .select("id").single();
  if (e2) throw new Error(`Could not create exempt bill fixture: ${e2.message}`);
  exemptBillId = exempt.id;
}

afterAll(async () => {
  if (!runtimeUp) return;
  const svc = serviceClient();
  if (taxableBillId) await svc.from("bills").delete().eq("id", taxableBillId);
  if (exemptBillId) await svc.from("bills").delete().eq("id", exemptBillId);
});

describe.skipIf(!runtimeUp)("gst-irn-generate", () => {
  it("1. missing Authorization header is rejected", async () => {
    const res = await callFunction("gst-irn-generate", { token: null, body: { bill_id: taxableBillId, hospital_id: HOSPITAL_A.id } });
    expect(res.status).toBe(401);
  });

  it("2. a garbage bearer token is rejected", async () => {
    const res = await callFunction("gst-irn-generate", { token: "garbage", body: { bill_id: taxableBillId, hospital_id: HOSPITAL_A.id } });
    expect(res.status).toBe(401);
  });

  it("3. malformed JSON does not 500 with a raw stack trace", async () => {
    const res = await callFunction("gst-irn-generate", { token: tokenBillingA, rawBody: "{bad" });
    expect(res.status).not.toBe(200);
    expect(res.text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });

  it("4. missing bill_id/hospital_id is a clean 400", async () => {
    const res = await callFunction("gst-irn-generate", { token: tokenBillingA, body: {} });
    expect(res.status).toBe(400);
  });

  it("5. cross-hospital: hospital B's billing staff naming hospital A's bill_id/hospital_id is forbidden — the regression test for the fix", async () => {
    const res = await callFunction("gst-irn-generate", {
      token: tokenBillingB,
      body: { bill_id: taxableBillId, hospital_id: HOSPITAL_A.id },
    });
    expect(res.status).toBe(403);
  });

  it("6. an exempt (zero-GST) bill is correctly skipped, never sent to the government IRP", async () => {
    const res = await callFunction("gst-irn-generate", {
      token: tokenBillingA,
      body: { bill_id: exemptBillId, hospital_id: HOSPITAL_A.id },
    });
    expect(res.status).toBe(200);
    expect(res.json.skipped).toBe(true);
    expect(res.json.reason).toBe("exempt_supply");
  });

  it("7. a taxable bill with no configured NIC IRP credentials generates a sandbox/demo IRN and locks the bill", async () => {
    const res = await callFunction("gst-irn-generate", {
      token: tokenBillingA,
      body: { bill_id: taxableBillId, hospital_id: HOSPITAL_A.id },
    });
    expect(res.status).toBe(200);
    expect(res.json.mode).toBe("sandbox");
    expect(res.json.irn).toMatch(/^DEMO-IRN-/);

    const svc = serviceClient();
    const { data: bill } = await svc.from("bills").select("irn, bill_status, irn_mode").eq("id", taxableBillId).maybeSingle();
    expect(bill?.bill_status).toBe("irn_locked");
    expect(bill?.irn_mode).toBe("sandbox");
    expect(bill?.irn).toBe(res.json.irn);
  });
});
