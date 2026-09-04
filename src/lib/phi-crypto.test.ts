import { describe, it, expect } from "vitest";
import {
  maskPHI,
  isPHIEncrypted,
  phiDisplayValue,
  getEncryptedPlaceholder,
  normalizePhone,
  normalizeAadhaar,
} from "./phi-crypto";

// This module never decrypts anything (decryption is server-side only) — it only decides
// what's safe to render. A mistake here is a PHI leak on screen, so every branch of every
// masking rule is covered explicitly.

describe("maskPHI — missing/empty input", () => {
  it("shows an em dash for null, undefined, or blank input, for every field type", () => {
    for (const type of ["phone", "aadhaar", "name", "email", "address", "dob"] as const) {
      expect(maskPHI(null, type)).toBe("—");
      expect(maskPHI(undefined, type)).toBe("—");
      expect(maskPHI("   ", type)).toBe("—");
    }
  });
});

describe("maskPHI — phone", () => {
  it("shows first 5 and last 2 digits of a 10-digit Indian mobile, masking the middle", () => {
    expect(maskPHI("9876543210", "phone")).toBe("98765 *** 10");
  });

  it("strips non-digit formatting (spaces/dashes) before masking, but does not strip a country code", () => {
    // Unlike normalizePhone(), maskPHI() only strips non-digits — it does not special-case
    // +91, so a country-code-prefixed number masks its own first 5 digits, "91987", not the
    // underlying mobile number's first 5.
    expect(maskPHI("98765-43210", "phone")).toBe("98765 *** 10");
    expect(maskPHI("+91 98765-43210", "phone")).toBe("91987 *** 10");
  });

  it("falls back to a shorter mask for a value under 10 digits", () => {
    expect(maskPHI("98765", "phone")).toBe("98*65");
  });
});

describe("maskPHI — aadhaar", () => {
  it("shows only the last 4 digits of a 12-digit Aadhaar", () => {
    expect(maskPHI("123456789012", "aadhaar")).toBe("**** **** 9012");
  });

  it("strips spaces before masking", () => {
    expect(maskPHI("1234 5678 9012", "aadhaar")).toBe("**** **** 9012");
  });

  it("falls back to a dashed mask for a non-12-digit value", () => {
    expect(maskPHI("12345", "aadhaar")).toBe("****-****-2345");
  });
});

describe("maskPHI — name", () => {
  it("shows the first name and masks the rest", () => {
    expect(maskPHI("Ramesh Kumar", "name")).toBe("Ramesh *****");
  });

  it("masks a multi-word surname with matching asterisk length", () => {
    expect(maskPHI("Ramesh Kumar Reddy", "name")).toBe("Ramesh ***********"); // "Kumar Reddy".length
  });

  it("shows a single-word name unmasked — nothing to redact", () => {
    expect(maskPHI("Ramesh", "name")).toBe("Ramesh");
  });
});

describe("maskPHI — email", () => {
  it("shows the first 2 local-part characters, masks the rest, keeps the domain", () => {
    expect(maskPHI("ramesh@gmail.com", "email")).toBe("ra****@gmail.com");
  });

  it("shows a 2-character-or-shorter local part fully, since there's nothing left to mask", () => {
    expect(maskPHI("ab@x.com", "email")).toBe("ab@x.com");
  });

  it("falls back to a generic mask for a value with no @ sign", () => {
    expect(maskPHI("notanemail", "email")).toBe("no****");
  });
});

describe("maskPHI — address", () => {
  it("shows only the last word (typically city/district), masks the rest", () => {
    expect(maskPHI("12 MG Road Nagpur", "address")).toBe("**** Nagpur");
  });

  it("shows a short (2-word-or-fewer) address unmasked", () => {
    expect(maskPHI("MG Road", "address")).toBe("MG Road");
  });
});

describe("maskPHI — dob", () => {
  it("shows only the year, in DD/**/YYYY form", () => {
    expect(maskPHI("1985-03-12", "dob")).toBe("12/**/1985");
  });

  it("falls back to masking everything but the last 4 characters for a non-ISO value", () => {
    expect(maskPHI("not-a-date", "dob")).toBe("****date");
  });
});

describe("maskPHI — already-encrypted values", () => {
  it("shows the role-appropriate placeholder instead of attempting to mask ciphertext", () => {
    expect(maskPHI("v1:aGVsbG8gd29ybGQ=", "phone")).toBe(getEncryptedPlaceholder("phone"));
  });
});

describe("isPHIEncrypted — detects the v{n}: version-prefixed ciphertext format", () => {
  it("recognises a well-formed encrypted blob", () => {
    expect(isPHIEncrypted("v1:aGVsbG8=")).toBe(true);
    expect(isPHIEncrypted("v12:abc123XYZ+/==")).toBe(true);
  });

  it("does not misidentify plaintext as encrypted", () => {
    expect(isPHIEncrypted("9876543210")).toBe(false);
    expect(isPHIEncrypted("Ramesh Kumar")).toBe(false);
  });

  it("requires a non-empty payload after the version prefix", () => {
    expect(isPHIEncrypted("v1:")).toBe(false);
  });

  it("treats a missing value as not encrypted", () => {
    expect(isPHIEncrypted(null)).toBe(false);
    expect(isPHIEncrypted(undefined)).toBe(false);
  });
});

describe("phiDisplayValue — resolves display value across the encryption-migration window", () => {
  it("masks the plaintext column when there is no encrypted column yet (pre-migration row)", () => {
    expect(phiDisplayValue("9876543210", null, "phone")).toBe(maskPHI("9876543210", "phone"));
  });

  it("shows the encrypted placeholder once the row has a real encrypted value, ignoring stale plaintext", () => {
    const result = phiDisplayValue("9876543210", "v1:abc123==", "phone");
    expect(result).toBe(getEncryptedPlaceholder("phone"));
  });

  it("masks the encrypted column's raw value if it is present but not actually encrypted (defensive fallback)", () => {
    const result = phiDisplayValue(null, "9876543210", "phone");
    expect(result).toBe(maskPHI("9876543210", "phone"));
  });

  it("shows an em dash when both columns are empty", () => {
    expect(phiDisplayValue(null, null, "name")).toBe("—");
  });
});

describe("getEncryptedPlaceholder — role-agnostic placeholder text", () => {
  it("returns a distinct placeholder per field type", () => {
    const types = ["phone", "aadhaar", "name", "email", "address", "dob"] as const;
    const placeholders = types.map(getEncryptedPlaceholder);
    expect(new Set(placeholders).size).toBe(types.length);
  });

  it("never leaks any part of the real value — placeholders are fixed strings", () => {
    expect(getEncryptedPlaceholder("phone")).toBe("●●● ●●● ●●●●");
    expect(getEncryptedPlaceholder("aadhaar")).toBe("**** **** ****");
  });
});

describe("normalizePhone — consistent form for HMAC hashing", () => {
  it("strips the +91 country code, spaces, and dashes", () => {
    expect(normalizePhone("+91 98765-43210")).toBe("9876543210");
  });

  it("strips a leading 0 (trunk prefix)", () => {
    expect(normalizePhone("09876543210")).toBe("9876543210");
  });

  it("leaves an already-normalized number unchanged", () => {
    expect(normalizePhone("9876543210")).toBe("9876543210");
  });
});

describe("normalizeAadhaar — consistent form for hashing", () => {
  it("strips spaces and dashes", () => {
    expect(normalizeAadhaar("1234 5678 9012")).toBe("123456789012");
    expect(normalizeAadhaar("1234-5678-9012")).toBe("123456789012");
  });
});
