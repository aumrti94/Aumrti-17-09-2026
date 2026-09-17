/**
 * Phase 6, Priority 1 (PHI-handling) — export-lab-reports.
 *
 * Auth and cross-hospital isolation are both correctly built (caller's hospital_id resolved
 * server-side, compared against the admission's hospital_id before anything is returned).
 * The real gap found writing this test: the lab_order_items query was scoped only by
 * hospital_id, not by this admission's own orders — fetching every lab_order_item in the
 * ENTIRE hospital and filtering to this admission in memory. PostgREST's default 1000-row cap
 * meant a hospital with enough accumulated lab history could silently have a CURRENT
 * admission's own results truncated out of its own exported report (oldest-first ordering
 * puts a recent admission's rows at the end of that dataset — exactly what a cap drops first).
 * Fixed to scope the query by this admission's order ids directly.
 */
import { describe, it, expect, afterAll } from "vitest";
import { callFunction, tokenFor, edgeRuntimeReachable } from "../fixtures/edgeFunctionClient";
import { serviceClient } from "../fixtures/serviceClient";
import { HOSPITAL_A, HOSPITAL_B, PATIENTS_A, staffUserId } from "../fixtures/constants";
import { assertLocalTarget } from "../fixtures/guard";

assertLocalTarget(process.env.SUPABASE_URL ?? "http://127.0.0.1:54321", process.env.SUPABASE_PROJECT_REF);
const runtimeUp = await edgeRuntimeReachable();

let tokenDoctorA = "";
let tokenDoctorB = "";
let admissionId = "";
let labOrderId = "";

if (runtimeUp) {
  [tokenDoctorA, tokenDoctorB] = await Promise.all([tokenFor("a", "doctor"), tokenFor("b", "doctor")]);
  const svc = serviceClient();
  const doctorAId = staffUserId("a", "doctor");

  const { data: adm, error: admErr } = await svc
    .from("admissions")
    .insert({
      hospital_id: HOSPITAL_A.id,
      patient_id: PATIENTS_A[0].id,
      admitting_doctor_id: doctorAId,
      admission_type: "daycare", // sidesteps admissions_bed_required_unless_daycare — no bed fixture needed for this test
    })
    .select("id")
    .single();
  if (admErr) throw new Error(`Could not create test admission: ${admErr.message}`);
  admissionId = adm.id;

  const { data: order, error: orderErr } = await svc
    .from("lab_orders")
    .insert({
      hospital_id: HOSPITAL_A.id,
      patient_id: PATIENTS_A[0].id,
      admission_id: admissionId,
      ordered_by: doctorAId,
    })
    .select("id")
    .single();
  if (orderErr) throw new Error(`Could not create test lab order: ${orderErr.message}`);
  labOrderId = order.id;

  const { data: testMaster } = await svc.from("lab_test_master").select("id").limit(1).maybeSingle();
  if (!testMaster) throw new Error("No lab_test_master row seeded — cannot build fixture");

  await svc.from("lab_order_items").insert({
    hospital_id: HOSPITAL_A.id,
    lab_order_id: labOrderId,
    test_id: testMaster.id,
    result_value: "13.5",
    result_unit: "g/dL",
    result_flag: "normal",
  });
}

afterAll(async () => {
  if (!runtimeUp || !admissionId) return;
  const svc = serviceClient();
  await svc.from("lab_order_items").delete().eq("lab_order_id", labOrderId);
  await svc.from("lab_orders").delete().eq("id", labOrderId);
  await svc.from("admissions").delete().eq("id", admissionId);
});

describe.skipIf(!runtimeUp)("export-lab-reports", () => {
  it("1. a valid authenticated request for the caller's own hospital succeeds and returns a signed URL", async () => {
    const res = await callFunction("export-lab-reports", {
      token: tokenDoctorA,
      body: { admission_id: admissionId },
    });
    expect(res.status).toBe(200);
    expect(res.json.file_url).toMatch(/^https?:\/\//);
  });

  it("2a. missing Authorization header is rejected", async () => {
    const res = await callFunction("export-lab-reports", { token: null, body: { admission_id: admissionId } });
    expect(res.status).toBe(401);
  });

  it("2b. a garbage bearer token is rejected", async () => {
    const res = await callFunction("export-lab-reports", { token: "garbage", body: { admission_id: admissionId } });
    expect(res.status).toBe(401);
  });

  it("3a. malformed JSON does not 500 with a stack trace", async () => {
    const res = await callFunction("export-lab-reports", { token: tokenDoctorA, rawBody: "{bad json" });
    expect(res.status).not.toBe(200);
    expect(res.text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });

  it("3b. a missing admission_id is a clean 400", async () => {
    const res = await callFunction("export-lab-reports", { token: tokenDoctorA, body: {} });
    expect(res.status).toBe(400);
  });

  it("4. cross-hospital: hospital B's doctor cannot export hospital A's admission report", async () => {
    const res = await callFunction("export-lab-reports", {
      token: tokenDoctorB,
      body: { admission_id: admissionId },
    });
    expect(res.status).toBe(403);
  });

  it("5. the generated report actually contains this admission's lab result, not an empty/truncated one", async () => {
    const res = await callFunction("export-lab-reports", { token: tokenDoctorA, body: { admission_id: admissionId } });
    expect(res.status).toBe(200);
    // The signed URL is minted using the URL the edge-function container itself sees
    // (the internal Docker hostname "kong"), unreachable from this host process — rewrite to
    // the externally-published address before fetching.
    const externalUrl = res.json.file_url.replace(/^https?:\/\/[^/]+/, "http://127.0.0.1:54321");
    const fileRes = await fetch(externalUrl);
    const html = await fileRes.text();
    expect(html).toContain("13.5");
    expect(html).not.toContain("No lab orders found");
  });
});
