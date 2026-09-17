/**
 * Phase 1 (PHASED_TEST_PLAN.md §8) — ABDM format validators.
 *
 * The plan asks specifically for "the deliberate 'fake but well-formed PASSES' assertion so
 * nobody later 'fixes' it". These functions validate FORMAT. They do not verify a checksum,
 * they do not call the ABDM gateway, and a syntactically valid identifier that belongs to
 * nobody must pass — the gateway is what decides whether an identifier exists, and a
 * client-side rejection of a well-formed number just blocks a legitimate registration.
 *
 * No real-format identifiers anywhere below: every fixture is a repeated-digit or
 * reserved-range placeholder, per D5 and the no-PHI fixture rule.
 */
import { describe, it, expect } from "vitest";
import {
  validateAbhaId,
  validateAbhaAddress,
  validateMobileForAbha,
  validateAadhaarFormat,
  formatAbhaNumber,
  validateHprId,
} from "@/lib/abdm-validators";

describe("validateAbhaId", () => {
  it("accepts 14 digits", () => {
    expect(validateAbhaId("91000000000001")).toEqual({ valid: true });
  });

  it("accepts the dashed display form", () => {
    expect(validateAbhaId("91-0000-0000-0001")).toEqual({ valid: true });
  });

  it("accepts spaces as separators", () => {
    expect(validateAbhaId("91 0000 0000 0001")).toEqual({ valid: true });
  });

  it("PASSES a well-formed identifier that belongs to nobody — by design", () => {
    // DELIBERATE. This is format validation, not existence verification. Adding a checksum
    // or a registry call here would reject legitimate ABHA numbers offline and block
    // registration at the desk. Existence is the ABDM gateway's job, asserted in Phase 6.
    expect(validateAbhaId("91000000000001").valid).toBe(true);
    expect(validateAbhaId("99999999999999").valid).toBe(true);
    expect(validateAbhaId("00000000000000").valid).toBe(true);
  });

  it("rejects a short number and says how short", () => {
    expect(validateAbhaId("9100000000000")).toEqual({
      valid: false,
      error: "ABHA ID must be 14 digits (got 13)",
    });
  });

  it("rejects a long number and says how long", () => {
    expect(validateAbhaId("910000000000012")).toEqual({
      valid: false,
      error: "ABHA ID must be 14 digits (got 15)",
    });
  });

  it("rejects letters", () => {
    expect(validateAbhaId("9100000000000A")).toEqual({
      valid: false,
      error: "ABHA ID must contain only digits (and optional dashes)",
    });
  });

  it("rejects an empty value with a 'required' message, not a length message", () => {
    // The two errors go to different places in the UI — one is a field-level requirement,
    // the other is a correction hint.
    expect(validateAbhaId("")).toEqual({ valid: false, error: "ABHA ID is required" });
    expect(validateAbhaId("---")).toEqual({ valid: false, error: "ABHA ID is required" });
  });
});

describe("validateAbhaAddress", () => {
  it("accepts a bare address of 8 to 18 characters", () => {
    expect(validateAbhaAddress("testuser")).toEqual({ valid: true });
    expect(validateAbhaAddress("test.user_000001")).toEqual({ valid: true });
  });

  it("validates only the part before @, ignoring the domain", () => {
    expect(validateAbhaAddress("testuser@abdm").valid).toBe(true);
    expect(validateAbhaAddress("testuser@sbx").valid).toBe(true);
  });

  it.each([
    ["abcdefg", false, "7 characters is one short"],
    ["abcdefgh", true, "8 characters is the minimum"],
    ["abcdefghijklmnopqr", true, "18 characters is the maximum"],
    ["abcdefghijklmnopqrs", false, "19 characters is one over"],
  ])("'%s' → valid=%s (%s)", (addr, valid) => {
    expect(validateAbhaAddress(addr).valid).toBe(valid);
  });

  it("reports the specific length rule that was broken", () => {
    expect(validateAbhaAddress("abcdefg").error).toBe("ABHA address must be at least 8 characters");
    expect(validateAbhaAddress("abcdefghijklmnopqrs").error).toBe("ABHA address must be at most 18 characters");
  });

  it("allows letters, digits, dots and underscores only", () => {
    expect(validateAbhaAddress("test_user.01").valid).toBe(true);
    expect(validateAbhaAddress("test-user-01").error).toBe("Only letters, digits, dots and underscores allowed");
    expect(validateAbhaAddress("test user01").error).toBe("Only letters, digits, dots and underscores allowed");
    expect(validateAbhaAddress("test+user01").error).toBe("Only letters, digits, dots and underscores allowed");
  });

  it("rejects a leading or trailing dot or underscore", () => {
    const msg = "Address cannot start or end with dot or underscore";
    expect(validateAbhaAddress(".testuser").error).toBe(msg);
    expect(validateAbhaAddress("_testuser").error).toBe(msg);
    expect(validateAbhaAddress("testuser.").error).toBe(msg);
    expect(validateAbhaAddress("testuser_").error).toBe(msg);
  });

  it("rejects an empty address, including a bare @domain", () => {
    expect(validateAbhaAddress("")).toEqual({ valid: false, error: "ABHA address is required" });
    expect(validateAbhaAddress("@abdm")).toEqual({ valid: false, error: "ABHA address is required" });
  });

  it("applies the length rule to the bare part, not the whole string", () => {
    // "test@abdm" is 9 characters but its address part is 4 — too short. Measuring the whole
    // string would accept an address the gateway will reject.
    expect(validateAbhaAddress("test@abdm").valid).toBe(false);
    expect(validateAbhaAddress("test@abdm").error).toBe("ABHA address must be at least 8 characters");
  });
});

describe("validateMobileForAbha", () => {
  it.each(["6000000001", "7000000001", "8000000001", "9000000001"])(
    "accepts %s — a valid Indian mobile series",
    (mobile) => {
      expect(validateMobileForAbha(mobile)).toEqual({ valid: true });
    },
  );

  it.each(["0000000001", "1000000001", "2000000001", "5000000001"])(
    "rejects %s — not an Indian mobile series",
    (mobile) => {
      expect(validateMobileForAbha(mobile)).toEqual({
        valid: false,
        error: "Mobile number must start with 6, 7, 8 or 9",
      });
    },
  );

  it("strips formatting characters before counting digits", () => {
    expect(validateMobileForAbha("90000 00001").valid).toBe(true);
    expect(validateMobileForAbha("90000-00001").valid).toBe(true);
    expect(validateMobileForAbha("(90000) 00001").valid).toBe(true);
  });

  it("rejects a number of the wrong length", () => {
    expect(validateMobileForAbha("900000000")).toEqual({ valid: false, error: "Enter a valid 10-digit mobile number" });
    expect(validateMobileForAbha("90000000012")).toEqual({ valid: false, error: "Enter a valid 10-digit mobile number" });
    expect(validateMobileForAbha("")).toEqual({ valid: false, error: "Enter a valid 10-digit mobile number" });
  });

  it("rejects a country-code prefixed number — it counts 12 digits, not 10", () => {
    // Pinned rather than silently accepted: a patient pasting "+91 90000 00001" is rejected
    // at the desk with a 10-digit message. Stripping the 91 prefix would be a behaviour
    // change with an ambiguity ("9190000001" is also a valid 10-digit number), so it is a
    // UX finding for the registration form, not a change to make inside the validator.
    expect(validateMobileForAbha("+919000000001").valid).toBe(false);
    expect(validateMobileForAbha("+91 90000 00001").valid).toBe(false);
  });
});

describe("validateAadhaarFormat", () => {
  // Repeated-digit placeholders only. Never a realistic Aadhaar in a fixture — test data
  // gets pasted into issues, CI logs and screenshots.
  it("accepts 12 digits not starting with 0 or 1", () => {
    expect(validateAadhaarFormat("222222222222")).toEqual({ valid: true });
    expect(validateAadhaarFormat("999999999999")).toEqual({ valid: true });
  });

  it("strips spaces from the grouped display form", () => {
    expect(validateAadhaarFormat("2222 2222 2222")).toEqual({ valid: true });
  });

  it("rejects a number starting with 0 or 1 — UIDAI does not issue them", () => {
    expect(validateAadhaarFormat("022222222222").error).toBe("Aadhaar number cannot start with 0 or 1");
    expect(validateAadhaarFormat("122222222222").error).toBe("Aadhaar number cannot start with 0 or 1");
  });

  it("rejects the wrong length and says how long it was", () => {
    expect(validateAadhaarFormat("22222222222").error).toBe("Aadhaar must be 12 digits (got 11)");
    expect(validateAadhaarFormat("2222222222222").error).toBe("Aadhaar must be 12 digits (got 13)");
  });

  it("rejects letters and an empty value", () => {
    expect(validateAadhaarFormat("2222222222AB").error).toBe("Aadhaar must contain only digits");
    expect(validateAadhaarFormat("").error).toBe("Aadhaar must contain only digits");
  });

  it("does not verify the Verhoeff checksum — format only, by design", () => {
    // Same rationale as the ABHA case. A repeated-digit number is not a real Aadhaar and
    // still passes; UIDAI/ABDM verification is a server-side concern, not a form validator.
    expect(validateAadhaarFormat("222222222222").valid).toBe(true);
  });

  it("does not strip dashes, unlike the ABHA validator", () => {
    // Documented inconsistency: validateAbhaId strips [-\s], this one strips only \s. A
    // dashed Aadhaar is rejected with a confusing "only digits" message.
    expect(validateAadhaarFormat("2222-2222-2222").valid).toBe(false);
    expect(validateAadhaarFormat("2222-2222-2222").error).toBe("Aadhaar must contain only digits");
  });
});

describe("formatAbhaNumber", () => {
  it("formats a full 14 digits as XX-XXXX-XXXX-XXXX", () => {
    expect(formatAbhaNumber("91000000000001")).toBe("91-0000-0000-0001");
  });

  it.each([
    ["", ""],
    ["9", "9"],
    ["91", "91"],
    ["910", "91-0"],
    ["910000", "91-0000"],
    ["9100000", "91-0000-0"],
    ["9100000000", "91-0000-0000"],
    ["91000000000", "91-0000-0000-0"],
    ["91000000000001", "91-0000-0000-0001"],
  ])("formats '%s' as '%s' while typing", (raw, formatted) => {
    // The function runs on every keystroke in the ABHA field, so every partial length must
    // produce something sane — a crash or a jumping cursor at length 7 is a real bug.
    expect(formatAbhaNumber(raw)).toBe(formatted);
  });

  it("strips non-digits, including dashes already present", () => {
    expect(formatAbhaNumber("91-0000-0000-0001")).toBe("91-0000-0000-0001");
    expect(formatAbhaNumber("91 0000 0000 0001")).toBe("91-0000-0000-0001");
    expect(formatAbhaNumber("ab91cd0000")).toBe("91-0000");
  });

  it("truncates beyond 14 digits rather than growing the field", () => {
    expect(formatAbhaNumber("910000000000019999")).toBe("91-0000-0000-0001");
  });

  it("round-trips with validateAbhaId", () => {
    const formatted = formatAbhaNumber("91000000000001");
    expect(validateAbhaId(formatted)).toEqual({ valid: true });
  });
});

describe("validateHprId", () => {
  it("accepts 8 to 14 digits", () => {
    expect(validateHprId("10000001")).toEqual({ valid: true });
    expect(validateHprId("10000000000001")).toEqual({ valid: true });
  });

  it.each([
    ["1000000", false],
    ["10000001", true],
    ["10000000000001", true],
    ["100000000000012", false],
  ])("'%s' → valid=%s", (hpr, valid) => {
    expect(validateHprId(hpr).valid).toBe(valid);
  });

  it("reports the range in the error", () => {
    expect(validateHprId("1000000").error).toBe("HPR ID must be 8–14 digits");
  });

  it("strips non-digits before measuring", () => {
    expect(validateHprId("1000-0001").valid).toBe(true);
    expect(validateHprId("HPR 10000001").valid).toBe(true);
  });

  it("rejects an empty value as required", () => {
    expect(validateHprId("")).toEqual({ valid: false, error: "HPR ID is required" });
    expect(validateHprId("HPR")).toEqual({ valid: false, error: "HPR ID is required" });
  });
});

describe("the validators share one result shape", () => {
  it("returns { valid: true } with no error on success", () => {
    const passing = [
      validateAbhaId("91000000000001"),
      validateAbhaAddress("testuser"),
      validateMobileForAbha("9000000001"),
      validateAadhaarFormat("222222222222"),
      validateHprId("10000001"),
    ];
    for (const r of passing) {
      expect(r.valid).toBe(true);
      expect(r.error).toBeUndefined();
    }
  });

  it("returns a non-empty error string on every failure", () => {
    // A falsy error on an invalid result renders an empty red box under the field, which
    // reads as "something is wrong but we won't say what".
    const failing = [
      validateAbhaId("1"),
      validateAbhaAddress("a"),
      validateMobileForAbha("1"),
      validateAadhaarFormat("1"),
      validateHprId("1"),
    ];
    for (const r of failing) {
      expect(r.valid).toBe(false);
      expect(r.error?.length).toBeGreaterThan(0);
    }
  });
});
