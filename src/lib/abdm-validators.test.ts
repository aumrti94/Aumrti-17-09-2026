import { describe, it, expect } from "vitest";
import {
  validateAbhaId,
  validateAbhaAddress,
  validateMobileForAbha,
  validateAadhaarFormat,
  formatAbhaNumber,
  validateHprId,
} from "./abdm-validators";

describe("validateAbhaId — 14-digit ABHA number", () => {
  it("accepts a bare 14-digit number", () => {
    expect(validateAbhaId("12345678901234")).toEqual({ valid: true });
  });

  it("accepts a dashed 14-digit number", () => {
    expect(validateAbhaId("12-3456-7890-1234")).toEqual({ valid: true });
  });

  it("rejects a number with the wrong digit count", () => {
    expect(validateAbhaId("123").valid).toBe(false);
    expect(validateAbhaId("123456789012345").valid).toBe(false);
  });

  it("rejects non-digit characters", () => {
    expect(validateAbhaId("1234567890123X").valid).toBe(false);
  });

  it("rejects an empty value", () => {
    expect(validateAbhaId("").valid).toBe(false);
  });
});

describe("validateAbhaAddress — phr-address@abdm format", () => {
  it("accepts a valid bare address", () => {
    expect(validateAbhaAddress("jane.doe123")).toEqual({ valid: true });
  });

  it("accepts a full address with the @abdm suffix, validating only the local part", () => {
    expect(validateAbhaAddress("jane.doe123@abdm")).toEqual({ valid: true });
  });

  it("rejects an address shorter than 8 characters", () => {
    expect(validateAbhaAddress("jane").valid).toBe(false);
  });

  it("rejects an address longer than 18 characters", () => {
    expect(validateAbhaAddress("a".repeat(19)).valid).toBe(false);
  });

  it("rejects disallowed characters", () => {
    expect(validateAbhaAddress("jane doe!!").valid).toBe(false);
  });

  it("rejects an address starting or ending with a dot or underscore", () => {
    expect(validateAbhaAddress(".janedoe").valid).toBe(false);
    expect(validateAbhaAddress("janedoe_").valid).toBe(false);
  });
});

describe("validateMobileForAbha", () => {
  it("accepts a valid 10-digit mobile starting 6-9", () => {
    expect(validateMobileForAbha("9876543210")).toEqual({ valid: true });
    expect(validateMobileForAbha("6000000000")).toEqual({ valid: true });
  });

  it("rejects a number not starting with 6-9", () => {
    expect(validateMobileForAbha("5876543210").valid).toBe(false);
  });

  it("rejects the wrong digit count", () => {
    expect(validateMobileForAbha("98765").valid).toBe(false);
  });

  it("strips non-digit formatting before validating", () => {
    expect(validateMobileForAbha("98765-43210")).toEqual({ valid: true });
  });

  it("rejects a number with a country code prepended — it must be exactly 10 digits", () => {
    expect(validateMobileForAbha("+91 9876543210").valid).toBe(false);
  });
});

describe("validateAadhaarFormat", () => {
  it("accepts a valid 12-digit Aadhaar not starting with 0 or 1", () => {
    expect(validateAadhaarFormat("234567890123")).toEqual({ valid: true });
  });

  it("rejects an Aadhaar starting with 0 or 1", () => {
    expect(validateAadhaarFormat("034567890123").valid).toBe(false);
    expect(validateAadhaarFormat("134567890123").valid).toBe(false);
  });

  it("rejects the wrong digit count", () => {
    expect(validateAadhaarFormat("1234").valid).toBe(false);
  });

  it("rejects non-digit characters", () => {
    expect(validateAadhaarFormat("23456789012X").valid).toBe(false);
  });
});

describe("formatAbhaNumber — progressive XX-XXXX-XXXX-XXXX grouping", () => {
  it("formats a full 14-digit number", () => {
    expect(formatAbhaNumber("12345678901234")).toBe("12-3456-7890-1234");
  });

  it("formats partial input as the user is still typing", () => {
    expect(formatAbhaNumber("1")).toBe("1");
    expect(formatAbhaNumber("12")).toBe("12");
    expect(formatAbhaNumber("123")).toBe("12-3");
    expect(formatAbhaNumber("123456")).toBe("12-3456");
    expect(formatAbhaNumber("1234567")).toBe("12-3456-7");
  });

  it("truncates input beyond 14 digits rather than overflowing the format", () => {
    expect(formatAbhaNumber("123456789012345678")).toBe("12-3456-7890-1234");
  });

  it("strips non-digit characters before formatting", () => {
    expect(formatAbhaNumber("12-3456-7890-1234")).toBe("12-3456-7890-1234");
  });
});

describe("validateHprId — 8-14 digit Healthcare Professional Registry ID", () => {
  it("accepts an 8-digit ID", () => {
    expect(validateHprId("12345678")).toEqual({ valid: true });
  });

  it("accepts a 14-digit ID", () => {
    expect(validateHprId("12345678901234")).toEqual({ valid: true });
  });

  it("rejects an ID shorter than 8 digits", () => {
    expect(validateHprId("1234567").valid).toBe(false);
  });

  it("rejects an ID longer than 14 digits", () => {
    expect(validateHprId("123456789012345").valid).toBe(false);
  });

  it("rejects an empty value", () => {
    expect(validateHprId("").valid).toBe(false);
  });
});
