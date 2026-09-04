import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreateSignedUrl, mockToastError } = vi.hoisted(() => ({
  mockCreateSignedUrl: vi.fn(),
  mockToastError: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { storage: { from: vi.fn(() => ({ createSignedUrl: mockCreateSignedUrl })) } },
}));
vi.mock("sonner", () => ({ toast: { error: mockToastError } }));

import { downloadInvoiceDocument } from "./invoiceDownload";

beforeEach(() => {
  mockCreateSignedUrl.mockReset();
  mockToastError.mockReset();
  vi.stubGlobal("open", vi.fn());
});

describe("downloadInvoiceDocument", () => {
  it("does nothing when there is no stored PDF path", async () => {
    await downloadInvoiceDocument({ pdf_storage_path: null, invoice_number: "INV-1" } as any);
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
  });

  it("opens a signed URL in a new tab when signing succeeds", async () => {
    mockCreateSignedUrl.mockResolvedValue({ data: { signedUrl: "https://signed.example/inv.pdf" }, error: null });
    await downloadInvoiceDocument({ pdf_storage_path: "invoices/inv-1.pdf", invoice_number: "INV-1" } as any);
    expect(window.open).toHaveBeenCalledWith("https://signed.example/inv.pdf", "_blank");
  });

  it("shows an error toast and does not open a tab when signing fails", async () => {
    mockCreateSignedUrl.mockResolvedValue({ data: null, error: { message: "not found" } });
    await downloadInvoiceDocument({ pdf_storage_path: "invoices/missing.pdf", invoice_number: "INV-1" } as any);
    expect(mockToastError).toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
  });
});
