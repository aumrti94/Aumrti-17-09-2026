import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreateSignedUrl } = vi.hoisted(() => ({ mockCreateSignedUrl: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { storage: { from: vi.fn(() => ({ createSignedUrl: mockCreateSignedUrl })) } },
}));

import { storagePathFromPublicUrl, resolveStorageUrl, BUCKETS } from "./storageUrls";

beforeEach(() => mockCreateSignedUrl.mockReset());

describe("storagePathFromPublicUrl", () => {
  it("extracts the path from a public-URL shape", () => {
    const url = "https://x.supabase.co/storage/v1/object/public/patient-documents/h1/report.pdf";
    expect(storagePathFromPublicUrl(BUCKETS.patientDocuments, url)).toBe("h1/report.pdf");
  });

  it("extracts the path from a signed-URL shape", () => {
    const url = "https://x.supabase.co/storage/v1/object/sign/patient-documents/h1/report.pdf?token=abc";
    expect(storagePathFromPublicUrl(BUCKETS.patientDocuments, url)).toBe("h1/report.pdf");
  });

  it("strips a query string and fragment before matching", () => {
    const url = "https://x.supabase.co/object/public/patient-documents/h1/report.pdf?token=abc#page=2";
    expect(storagePathFromPublicUrl(BUCKETS.patientDocuments, url)).toBe("h1/report.pdf");
  });

  it("falls back to a bare /<bucket>/ marker for hand-built or proxied URLs", () => {
    const url = "https://cdn.example.com/patient-documents/h1/report.pdf";
    expect(storagePathFromPublicUrl(BUCKETS.patientDocuments, url)).toBe("h1/report.pdf");
  });

  it("returns null when the URL doesn't reference the given bucket at all", () => {
    const url = "https://external-system.example.com/files/report.pdf";
    expect(storagePathFromPublicUrl(BUCKETS.patientDocuments, url)).toBeNull();
  });

  it("decodes a percent-encoded path", () => {
    const url = "https://x.supabase.co/object/public/patient-documents/h1/My%20Report.pdf";
    expect(storagePathFromPublicUrl(BUCKETS.patientDocuments, url)).toBe("h1/My Report.pdf");
  });

  it("does not throw on a malformed percent-encoding — returns it as-is", () => {
    const url = "https://x.supabase.co/object/public/patient-documents/h1/100%off.pdf";
    expect(storagePathFromPublicUrl(BUCKETS.patientDocuments, url)).toBe("h1/100%off.pdf");
  });
});

describe("resolveStorageUrl", () => {
  it("signs a bare storage path directly", async () => {
    mockCreateSignedUrl.mockResolvedValue({ data: { signedUrl: "https://signed.example/x" }, error: null });
    const result = await resolveStorageUrl(BUCKETS.patientDocuments, "h1/report.pdf");
    expect(result).toBe("https://signed.example/x");
    expect(mockCreateSignedUrl).toHaveBeenCalledWith("h1/report.pdf", 3600);
  });

  it("derives the path from a public URL for the same bucket, then signs it", async () => {
    mockCreateSignedUrl.mockResolvedValue({ data: { signedUrl: "https://signed.example/x" }, error: null });
    const url = "https://x.supabase.co/object/public/patient-documents/h1/report.pdf";
    await resolveStorageUrl(BUCKETS.patientDocuments, url);
    expect(mockCreateSignedUrl).toHaveBeenCalledWith("h1/report.pdf", 3600);
  });

  it("returns an externally-hosted URL unchanged rather than trying to sign it", async () => {
    const url = "https://external-system.example.com/files/report.pdf";
    const result = await resolveStorageUrl(BUCKETS.patientDocuments, url);
    expect(result).toBe(url);
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  it("throws with a usable message when signing fails", async () => {
    mockCreateSignedUrl.mockResolvedValue({ data: null, error: { message: "object not found" } });
    await expect(resolveStorageUrl(BUCKETS.patientDocuments, "h1/missing.pdf")).rejects.toThrow(
      "object not found",
    );
  });
});
