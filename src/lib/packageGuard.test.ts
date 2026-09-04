import { describe, it, expect } from "vitest";
import { checkServiceAgainstPackage, PackageContext } from "./packageGuard";

const ctx: PackageContext = {
  package: { id: "pkg1", package_name: "Cardiac Care", package_code: "CARD-1", specialty: "cardiology", base_price: 50000 },
  inclusions: [
    { id: "i1", service_id: "svc-echo", service_category: null, display_name: "Echo (included)" },
    { id: "i2", service_id: null, service_category: "nursing", display_name: "Nursing care (included)" },
  ],
  extras: [
    { id: "e1", service_id: "svc-mri", service_category: null, display_name: "MRI (chargeable extra)", extra_rate: 8000 },
    { id: "e2", service_id: null, service_category: "physio", display_name: "Physiotherapy (chargeable extra)", extra_rate: 1500 },
  ],
};

describe("checkServiceAgainstPackage — package billing gate for a single service line", () => {
  it("reports no_package when the admission has no package context", () => {
    expect(checkServiceAgainstPackage(null, "svc-echo", null)).toEqual({ status: "no_package" });
  });

  it("matches an inclusion by exact service_id, taking priority over category", () => {
    expect(checkServiceAgainstPackage(ctx, "svc-echo", "some-other-category")).toEqual({
      status: "included",
      label: "Echo (included)",
    });
  });

  it("matches an inclusion by category when there is no service_id on the service", () => {
    expect(checkServiceAgainstPackage(ctx, null, "nursing")).toEqual({
      status: "included",
      label: "Nursing care (included)",
    });
  });

  it("matches an extra by service_id and returns its rate", () => {
    expect(checkServiceAgainstPackage(ctx, "svc-mri", null)).toEqual({
      status: "extra",
      label: "MRI (chargeable extra)",
      rate: 8000,
    });
  });

  it("matches an extra by category", () => {
    expect(checkServiceAgainstPackage(ctx, null, "physio")).toEqual({
      status: "extra",
      label: "Physiotherapy (chargeable extra)",
      rate: 1500,
    });
  });

  it("checks inclusions before extras — an inclusion match wins even if also listed as an extra", () => {
    const overlapping: PackageContext = {
      ...ctx,
      extras: [...ctx.extras, { id: "e3", service_id: "svc-echo", service_category: null, display_name: "Echo (also listed as extra)", extra_rate: 2000 }],
    };
    expect(checkServiceAgainstPackage(overlapping, "svc-echo", null).status).toBe("included");
  });

  it("falls back to allowed (billed normally) when the service matches neither list", () => {
    expect(checkServiceAgainstPackage(ctx, "svc-xray", "radiology")).toEqual({ status: "allowed" });
  });
});
