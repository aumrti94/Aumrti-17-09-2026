import { describe, it, expect, vi, beforeEach } from "vitest";

// Route .from(table) to a per-table canned response so each test can seed the hospital's
// WhatsApp provider config and a trigger's template row independently — exactly the two
// settings the WhatsApp/WATI screen writes (provider credentials, per-trigger auto_send).
const responses: Record<string, any> = {};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn((table: string) => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockImplementation(() => Promise.resolve(responses[table] ?? { data: null, error: null })),
    })),
  },
}));

import { shouldAutoSend } from "@/lib/whatsapp-send";

beforeEach(() => {
  delete responses.hospitals;
  delete responses.whatsapp_templates;
});

describe("shouldAutoSend — per-trigger WhatsApp/WATI settings screen", () => {
  it("returns false when WhatsApp is not enabled for the hospital at all", async () => {
    responses.hospitals = { data: { whatsapp_enabled: false, whatsapp_provider: "wati", wati_api_url: "https://wati.example" }, error: null };
    responses.whatsapp_templates = { data: { is_active: true, auto_send: true }, error: null };
    expect(await shouldAutoSend("hospital-a", "discharge_summary")).toBe(false);
  });

  it("returns false for WATI provider with no api_url configured, even if the trigger is active", async () => {
    responses.hospitals = { data: { whatsapp_enabled: true, whatsapp_provider: "wati", wati_api_url: null }, error: null };
    responses.whatsapp_templates = { data: { is_active: true, auto_send: true }, error: null };
    expect(await shouldAutoSend("hospital-a", "discharge_summary")).toBe(false);
  });

  it("returns false when the trigger's auto_send is off, even with the provider fully configured", async () => {
    responses.hospitals = { data: { whatsapp_enabled: true, whatsapp_provider: "wati", wati_api_url: "https://wati.example" }, error: null };
    responses.whatsapp_templates = { data: { is_active: true, auto_send: false }, error: null };
    expect(await shouldAutoSend("hospital-a", "discharge_summary")).toBe(false);
  });

  it("returns false when the trigger is inactive even if auto_send is true", async () => {
    responses.hospitals = { data: { whatsapp_enabled: true, whatsapp_provider: "wati", wati_api_url: "https://wati.example" }, error: null };
    responses.whatsapp_templates = { data: { is_active: false, auto_send: true }, error: null };
    expect(await shouldAutoSend("hospital-a", "discharge_summary")).toBe(false);
  });

  it("returns the resolved template names when everything is configured and active — the flip side of every false case above", async () => {
    responses.hospitals = { data: { whatsapp_enabled: true, whatsapp_provider: "wati", wati_api_url: "https://wati.example" }, error: null };
    responses.whatsapp_templates = {
      data: { is_active: true, auto_send: true, wati_template_name: "discharge_v2", meta_template_name: null, meta_template_lang: null },
      error: null,
    };
    const result = await shouldAutoSend("hospital-a", "discharge_summary");
    expect(result).toEqual({ watiTemplateName: "discharge_v2", metaTemplateName: undefined, metaTemplateLang: "en" });
  });

  it("meta_cloud provider does not require wati_api_url", async () => {
    responses.hospitals = { data: { whatsapp_enabled: true, whatsapp_provider: "meta_cloud", wati_api_url: null }, error: null };
    responses.whatsapp_templates = {
      data: { is_active: true, auto_send: true, meta_template_name: "discharge_meta", meta_template_lang: "en" },
      error: null,
    };
    const result = await shouldAutoSend("hospital-a", "discharge_summary");
    expect(result).not.toBe(false);
    expect((result as any).metaTemplateName).toBe("discharge_meta");
  });

  it("falls back to the trigger event name as the WATI template name when none is configured", async () => {
    responses.hospitals = { data: { whatsapp_enabled: true, whatsapp_provider: "wati", wati_api_url: "https://wati.example" }, error: null };
    responses.whatsapp_templates = { data: { is_active: true, auto_send: true, wati_template_name: null }, error: null };
    const result = await shouldAutoSend("hospital-a", "lab_result_ready");
    expect((result as any).watiTemplateName).toBe("lab_result_ready");
  });

  it("returns false when no template row exists for the trigger at all", async () => {
    responses.hospitals = { data: { whatsapp_enabled: true, whatsapp_provider: "wati", wati_api_url: "https://wati.example" }, error: null };
    responses.whatsapp_templates = { data: null, error: null };
    expect(await shouldAutoSend("hospital-a", "never_configured_trigger")).toBe(false);
  });
});
