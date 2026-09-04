import { describe, it, expect, beforeEach } from "vitest";
import { getDeviceFingerprint, isTrustedDevice, trustDevice } from "./trustedDevice";

describe("trustedDevice — MFA 'remember this device for 30 days'", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("produces a stable fingerprint for the same environment", () => {
    expect(getDeviceFingerprint()).toBe(getDeviceFingerprint());
  });

  it("treats a device with no stored trust as untrusted", () => {
    expect(isTrustedDevice("user-1")).toBe(false);
  });

  it("trusts a device immediately after trustDevice() is called", () => {
    trustDevice("user-1");
    expect(isTrustedDevice("user-1")).toBe(true);
  });

  it("keys trust per-user — trusting one user's session does not trust another user on the same device", () => {
    trustDevice("user-1");
    expect(isTrustedDevice("user-2")).toBe(false);
  });

  it("does not trust a device whose stored expiry is in the past", () => {
    const fingerprint = getDeviceFingerprint();
    const past = new Date();
    past.setDate(past.getDate() - 1);
    localStorage.setItem(
      "aumrti_trusted_devices",
      JSON.stringify({ [`user-1_${fingerprint}`]: past.toISOString() }),
    );
    expect(isTrustedDevice("user-1")).toBe(false);
  });

  it("does not throw on corrupted localStorage — fails closed to untrusted", () => {
    localStorage.setItem("aumrti_trusted_devices", "{not valid json");
    expect(() => isTrustedDevice("user-1")).not.toThrow();
    expect(isTrustedDevice("user-1")).toBe(false);
  });
});
