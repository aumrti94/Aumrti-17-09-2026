import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mockFrom } }));

import { formatAlertMessage, loadInsuranceAlertSettings, sendInsuranceAlert } from "./insuranceAlerts";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFrom.mockReset();
  mockFetch.mockReset();
});

describe("formatAlertMessage — one template per alert type", () => {
  it("formats an SLA-at-risk message with the time remaining", () => {
    const msg = formatAlertMessage("SLA_PRE_AUTH_RISK", { hospitalId: "h1", patientName: "Jane", tpaName: "Star Health", timeLeft: 15 });
    expect(msg).toContain("Jane");
    expect(msg).toContain("Star Health");
    expect(msg).toContain("15 min left");
  });

  it("formats an SLA breach message", () => {
    expect(formatAlertMessage("SLA_PRE_AUTH_BREACH", { hospitalId: "h1", patientName: "Jane" })).toContain("SLA BREACHED");
  });

  it("formats a supplementary pre-auth message with Indian-grouped currency", () => {
    const msg = formatAlertMessage("SUPPLEMENTARY_PRE_AUTH_NEEDED", { hospitalId: "h1", currentAmount: 150000, approvedAmount: 100000, utilizationPct: 90 });
    expect(msg).toContain("₹1,50,000");
    expect(msg).toContain("90%");
  });

  it("formats a payment-received message, noting an underpayment when present", () => {
    const underpaid = formatAlertMessage("PAYMENT_RECEIVED", { hospitalId: "h1", amount: 80000, underpaymentAmount: 20000, tpaName: "HDFC Ergo" });
    expect(underpaid).toContain("Underpayment of ₹20,000");

    const fullySettled = formatAlertMessage("PAYMENT_RECEIVED", { hospitalId: "h1", amount: 100000, tpaName: "HDFC Ergo" });
    expect(fullySettled).toContain("Fully settled");
  });

  it("falls back to sensible placeholders for missing optional fields", () => {
    const msg = formatAlertMessage("CLAIM_QUERY_RECEIVED", { hospitalId: "h1" });
    expect(msg).toContain("TPA");
    expect(msg).toContain("deadline");
  });
});

describe("loadInsuranceAlertSettings", () => {
  it("returns in_app defaults when no settings row exists", async () => {
    mockFrom.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) });
    const result = await loadInsuranceAlertSettings("h1");
    expect(result).toEqual({ sla_alert_channel: "in_app", whatsapp_alert_number: null, n8n_webhook_url: null });
  });

  it("returns the configured settings when a row exists", async () => {
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { sla_alert_channel: "whatsapp", whatsapp_alert_number: "+919876543210", n8n_webhook_url: "https://n8n.example/hook", plan_tier: "pro" } }) }) }),
    });
    const result = await loadInsuranceAlertSettings("h1");
    expect(result).toEqual({ sla_alert_channel: "whatsapp", whatsapp_alert_number: "+919876543210", n8n_webhook_url: "https://n8n.example/hook", plan_tier: "pro" });
  });

  it("falls back to safe defaults rather than throwing on a query failure", async () => {
    mockFrom.mockImplementation(() => {
      throw new Error("db down");
    });
    const result = await loadInsuranceAlertSettings("h1");
    expect(result.sla_alert_channel).toBe("in_app");
  });
});

describe("sendInsuranceAlert — channel orchestration", () => {
  const IN_APP_ONLY = { sla_alert_channel: "in_app" as const, whatsapp_alert_number: null, n8n_webhook_url: null };

  it("always writes an in-app clinical_alerts row", async () => {
    const insertSpy = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ insert: insertSpy });

    await sendInsuranceAlert("CLAIM_QUERY_RECEIVED", { hospitalId: "h1" }, IN_APP_ONLY);
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ hospital_id: "h1", severity: "medium" }));
  });

  it("does not call the WhatsApp webhook when the channel isn't configured as whatsapp", async () => {
    mockFrom.mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: null }) });
    await sendInsuranceAlert("CLAIM_QUERY_RECEIVED", { hospitalId: "h1" }, IN_APP_ONLY);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("posts to the n8n webhook when the whatsapp channel is fully configured", async () => {
    mockFrom.mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: null }) });
    mockFetch.mockResolvedValue({ ok: true });
    const settings = { sla_alert_channel: "whatsapp" as const, whatsapp_alert_number: "+919876543210", n8n_webhook_url: "https://n8n.example/hook" };

    await sendInsuranceAlert("SLA_PRE_AUTH_RISK", { hospitalId: "h1", patientName: "Jane" }, settings);
    expect(mockFetch).toHaveBeenCalledWith("https://n8n.example/hook", expect.objectContaining({ method: "POST" }));
  });

  it("records SLA-breach DB side effects only for the breach alert type, not others", async () => {
    const updateEq = vi.fn().mockResolvedValue({});
    const slaLogInsert = vi.fn().mockResolvedValue({ data: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "clinical_alerts") return { insert: vi.fn().mockResolvedValue({ error: null }) };
      if (table === "insurance_pre_auth") return { update: () => ({ eq: updateEq }) };
      if (table === "insurance_sla_log") return { insert: slaLogInsert };
      throw new Error(`unexpected table ${table}`);
    });

    await sendInsuranceAlert("SLA_PRE_AUTH_BREACH", { hospitalId: "h1", preAuthId: "pa1", timeLeft: -20 }, IN_APP_ONLY);
    expect(updateEq).toHaveBeenCalledWith("id", "pa1");
    expect(slaLogInsert).toHaveBeenCalledWith(expect.objectContaining({ reference_id: "pa1", breach_minutes: 20 }));
  });

  it("skips SLA-breach DB writes entirely for a non-breach alert type", async () => {
    const preAuthFrom = vi.fn();
    mockFrom.mockImplementation((table: string) => {
      if (table === "clinical_alerts") return { insert: vi.fn().mockResolvedValue({ error: null }) };
      if (table === "insurance_pre_auth") return preAuthFrom();
      throw new Error(`unexpected table ${table}`);
    });

    await sendInsuranceAlert("SLA_PRE_AUTH_RISK", { hospitalId: "h1", preAuthId: "pa1" }, IN_APP_ONLY);
    expect(preAuthFrom).not.toHaveBeenCalled();
  });
});
