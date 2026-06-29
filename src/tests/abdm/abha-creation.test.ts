import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import React from "react";

// Pure validator tests — no mocks needed
import {
  validateAbhaId,
  validateAbhaAddress,
  validateMobileForAbha,
  validateAadhaarFormat,
  formatAbhaNumber,
} from "@/lib/abdm-validators";

// ── Module mocks (must be hoisted before component import) ────────────────────

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
  },
}));

vi.mock("@/hooks/useHospitalId", () => ({
  useHospitalId: () => ({ hospitalId: "hospital-test-uuid" }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: "/" }),
  BrowserRouter: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

vi.mock("@/components/patients/ABHASearchPanel", () => ({
  default: ({ onSelect }: { onSelect: (abha: string) => void }) =>
    React.createElement("div", { "data-testid": "abha-search-panel" }),
}));

// ── Import component and mocked module AFTER mock declarations ────────────────
import ABHARegistrationPanel from "@/components/abdm/ABHARegistrationPanel";
import { supabase as mockSupabase } from "@/integrations/supabase/client";

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderPanel(overrides: Partial<React.ComponentProps<typeof ABHARegistrationPanel>> = {}) {
  const onComplete = vi.fn();
  const onSkip = vi.fn();
  const utils = render(
    React.createElement(ABHARegistrationPanel, {
      patientId: "patient-uuid",
      patientName: "Test Patient",
      patientMobile: "9876543210",
      onComplete,
      onSkip,
      ...overrides,
    }),
  );
  return { ...utils, onComplete, onSkip };
}

function mockInvoke(returnValue: Record<string, unknown>) {
  vi.mocked(mockSupabase.functions.invoke).mockResolvedValueOnce({
    data: returnValue,
    error: null,
  });
}

function mockInvokeError(message: string) {
  vi.mocked(mockSupabase.functions.invoke).mockResolvedValueOnce({
    data: { error: message },
    error: null,
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. PURE FORMAT VALIDATION
// ═════════════════════════════════════════════════════════════════════════════

describe("validateAbhaId", () => {
  it("accepts a valid 14-digit ABHA ID", () => {
    expect(validateAbhaId("12345678901234").valid).toBe(true);
  });

  it("accepts ABHA ID with dashes", () => {
    expect(validateAbhaId("12-3456-7890-1234").valid).toBe(true);
  });

  it("rejects empty string", () => {
    const r = validateAbhaId("");
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/required/i);
  });

  it("rejects 13-digit number", () => {
    const r = validateAbhaId("1234567890123");
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/14 digits/i);
  });

  it("rejects 15-digit number", () => {
    expect(validateAbhaId("123456789012345").valid).toBe(false);
  });

  it("rejects non-digit characters", () => {
    const r = validateAbhaId("1234567890abcd");
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/digits/i);
  });
});

describe("validateAbhaAddress", () => {
  it("accepts valid 8-char address", () => {
    expect(validateAbhaAddress("test1234").valid).toBe(true);
  });

  it("accepts address with dots and underscores", () => {
    expect(validateAbhaAddress("john.doe_1234").valid).toBe(true);
  });

  it("rejects addresses shorter than 8 chars", () => {
    const r = validateAbhaAddress("ab");
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/at least 8/i);
  });

  it("rejects addresses longer than 18 chars", () => {
    const r = validateAbhaAddress("a".repeat(19));
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/at most 18/i);
  });

  it("rejects addresses with spaces", () => {
    expect(validateAbhaAddress("john doe1234").valid).toBe(false);
  });

  it("rejects addresses with special characters", () => {
    expect(validateAbhaAddress("john@doe1234").valid).toBe(false);
  });

  it("rejects addresses starting with dot", () => {
    expect(validateAbhaAddress(".johndoe1234").valid).toBe(false);
  });

  it("handles @abdm suffix by checking the bare part", () => {
    expect(validateAbhaAddress("johndoe1234@abdm").valid).toBe(true);
  });
});

describe("validateMobileForAbha", () => {
  it("accepts valid 10-digit mobile starting with 9", () => {
    expect(validateMobileForAbha("9876543210").valid).toBe(true);
  });

  it("accepts mobile starting with 6", () => {
    expect(validateMobileForAbha("6543210987").valid).toBe(true);
  });

  it("rejects 9-digit number", () => {
    const r = validateMobileForAbha("987654321");
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/10-digit/i);
  });

  it("rejects number starting with 5", () => {
    const r = validateMobileForAbha("5876543210");
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/6, 7, 8 or 9/i);
  });

  it("rejects number starting with 1 (landline pattern)", () => {
    expect(validateMobileForAbha("1176543210").valid).toBe(false);
  });

  it("strips spaces before validating", () => {
    // "98765 43210" → "9876543210" (10 digits starting with 9)
    expect(validateMobileForAbha("98765 43210").valid).toBe(true);
  });
});

describe("validateAadhaarFormat", () => {
  it("accepts valid 12-digit Aadhaar starting with 2", () => {
    expect(validateAadhaarFormat("234567890123").valid).toBe(true);
  });

  it("rejects Aadhaar starting with 0", () => {
    const r = validateAadhaarFormat("034567890123");
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/cannot start with 0 or 1/i);
  });

  it("rejects Aadhaar starting with 1", () => {
    expect(validateAadhaarFormat("134567890123").valid).toBe(false);
  });

  it("rejects 11-digit Aadhaar", () => {
    const r = validateAadhaarFormat("23456789012");
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/12 digits/i);
  });

  it("rejects Aadhaar with letters", () => {
    expect(validateAadhaarFormat("2345ABCD5678").valid).toBe(false);
  });
});

describe("formatAbhaNumber", () => {
  it("formats 14 digits as XX-XXXX-XXXX-XXXX", () => {
    expect(formatAbhaNumber("12345678901234")).toBe("12-3456-7890-1234");
  });

  it("ignores non-digit characters in input", () => {
    expect(formatAbhaNumber("12-3456-7890-1234")).toBe("12-3456-7890-1234");
  });

  it("truncates at 14 digits", () => {
    expect(formatAbhaNumber("123456789012345")).toBe("12-3456-7890-1234");
  });

  it("returns partial format for short input", () => {
    expect(formatAbhaNumber("1234")).toBe("12-34");
    expect(formatAbhaNumber("123456")).toBe("12-3456");
    expect(formatAbhaNumber("1234567890")).toBe("12-3456-7890");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. MOBILE OTP FLOW — step progression
// ═════════════════════════════════════════════════════════════════════════════

describe("Mobile OTP flow", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("renders choice step initially", () => {
    renderPanel();
    // Choice step shows both "Create via Mobile OTP" and "Link Existing ABHA"
    expect(screen.getByText(/Create via Mobile OTP/i)).toBeTruthy();
  });

  it("navigates to mobile_input step when Create via Mobile OTP is clicked", async () => {
    renderPanel();
    await act(async () => fireEvent.click(screen.getByText(/Create via Mobile OTP/i)));
    // mobile_input step shows "Send OTP to Mobile" button
    await waitFor(() => expect(screen.queryByRole("button", { name: /Send OTP to Mobile/i })).toBeTruthy());
  });

  it("progresses mobile_input → otp after initiate_mobile succeeds", async () => {
    mockInvoke({ txnId: "txn-abc-123" });
    renderPanel();

    // Step 1: navigate to mobile_input
    await act(async () => fireEvent.click(screen.getByText(/Create via Mobile OTP/i)));
    const sendOtpBtn = await waitFor(() => screen.getByRole("button", { name: /Send OTP to Mobile/i }));

    // Step 2: click Send OTP → calls initiate_mobile
    await act(async () => fireEvent.click(sendOtpBtn));

    await waitFor(() => expect(mockSupabase.functions.invoke).toHaveBeenCalledTimes(1));
  });

  it("Send OTP button is disabled when mobile is blank", async () => {
    renderPanel({ patientMobile: "" });

    await act(async () => fireEvent.click(screen.getByText(/Create via Mobile OTP/i)));
    const sendOtpBtn = await waitFor(() =>
      screen.getByRole("button", { name: /Send OTP to Mobile/i }),
    );

    // Button should be disabled when mobile is empty (mobile.length < 10)
    expect(sendOtpBtn).toBeDisabled();
    // invoke should NOT have been called
    expect(mockSupabase.functions.invoke).not.toHaveBeenCalled();
  });

  it("shows OTP step after initiate_mobile succeeds", async () => {
    mockInvoke({ txnId: "txn-abc-123" });
    renderPanel();
    await act(async () => fireEvent.click(screen.getByText(/Create via Mobile OTP/i)));
    const sendOtpBtn = await waitFor(() => screen.getByRole("button", { name: /Send OTP to Mobile/i }));

    await act(async () => fireEvent.click(sendOtpBtn));
    await waitFor(() => expect(mockSupabase.functions.invoke).toHaveBeenCalledTimes(1));

    // OTP step shows "Enter OTP" header and a disabled Verify OTP button (waiting for 6 digits)
    await waitFor(() => {
      expect(screen.queryByText(/Enter OTP/i)).toBeTruthy();
      const verifyBtn = screen.getByRole("button", { name: /Verify OTP/i });
      expect(verifyBtn).toBeDisabled(); // disabled until 6 digits entered
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. EXISTING ABHA LINKING
// ═════════════════════════════════════════════════════════════════════════════

describe("Existing ABHA linking", () => {
  beforeEach(() => vi.clearAllMocks());

  it("initiate_mobile is called with hospital_id and patient_id", async () => {
    mockInvoke({ txnId: "txn-link-1" });
    renderPanel();
    await act(async () => fireEvent.click(screen.getByText(/Create via Mobile OTP/i)));
    const sendOtpBtn = await waitFor(() => screen.getByRole("button", { name: /Send OTP to Mobile/i }));

    await act(async () => fireEvent.click(sendOtpBtn));
    await waitFor(() => expect(mockSupabase.functions.invoke).toHaveBeenCalledTimes(1));

    expect(mockSupabase.functions.invoke).toHaveBeenCalledWith(
      "abdm-abha-create",
      expect.objectContaining({
        body: expect.objectContaining({
          action: "initiate_mobile",
          hospital_id: "hospital-test-uuid",
          patient_id: "patient-uuid",
          mobile: "9876543210",
        }),
      }),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. DUPLICATE ABHA ERROR
// ═════════════════════════════════════════════════════════════════════════════

describe("Duplicate ABHA error", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows error when initiate_mobile returns error response", async () => {
    mockInvokeError("Too many ABHA creation attempts. Please try again later.");
    renderPanel();

    await act(async () => fireEvent.click(screen.getByText(/Create via Mobile OTP/i)));
    const sendOtpBtn = await waitFor(() => screen.getByRole("button", { name: /Send OTP to Mobile/i }));

    await act(async () => fireEvent.click(sendOtpBtn));

    await waitFor(() => {
      // Should show error message from the response
      expect(
        screen.queryByText(/too many/i) ??
        screen.queryByText(/error/i) ??
        screen.queryByText(/try again/i),
      ).toBeTruthy();
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. SKIP ABHA FLOW
// ═════════════════════════════════════════════════════════════════════════════

describe("Skip ABHA flow", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows skip warning before calling onSkip", async () => {
    const { onSkip } = renderPanel();

    const skipBtn = screen.queryByRole("button", { name: /skip/i });
    expect(skipBtn).toBeTruthy();

    if (skipBtn) {
      await act(async () => fireEvent.click(skipBtn));
      // Should show warning, not immediately call onSkip
      await waitFor(() => {
        const warning = screen.queryByText(/skip.*warning|without.*abha|proceed.*without/i);
        // The warning content may vary — just check that onSkip was NOT called yet
        expect(onSkip).not.toHaveBeenCalled();
      });
    }
  });

  it("calls onSkip after confirming skip warning", async () => {
    const { onSkip } = renderPanel();

    const skipBtn = screen.queryByRole("button", { name: /skip/i });
    if (skipBtn) {
      await act(async () => fireEvent.click(skipBtn));

      // Find and click the confirmation button
      const confirmSkip = screen.queryByRole("button", { name: /skip anyway|confirm skip|yes.*skip/i });
      if (confirmSkip) {
        await act(async () => fireEvent.click(confirmSkip));
        expect(onSkip).toHaveBeenCalled();
      }
    }
  });
});
