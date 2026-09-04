import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const { mockGetUser, mockFrom } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser: mockGetUser }, from: mockFrom },
}));

import { useAIAudit } from "./useAIAudit";

beforeEach(() => {
  mockGetUser.mockReset();
  mockFrom.mockReset();
});

describe("useAIAudit", () => {
  it("writes the AI suggestion, user action, and resolved user id to the audit table", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const insertSpy = vi.fn().mockResolvedValue({ data: null });
    mockFrom.mockReturnValue({ insert: insertSpy });

    const { result } = renderHook(() => useAIAudit());
    await result.current.logAudit(
      { hospitalId: "h1", featureKey: "clinical_note", aiOutput: { text: "draft" }, confidence: 0.9 },
      "accepted",
    );

    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ hospital_id: "h1", feature_key: "clinical_note", user_action: "accepted", user_id: "u1", confidence: 0.9 }),
    );
  });

  it("records the override value when the user edits the AI suggestion before accepting", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const insertSpy = vi.fn().mockResolvedValue({ data: null });
    mockFrom.mockReturnValue({ insert: insertSpy });

    const { result } = renderHook(() => useAIAudit());
    await result.current.logAudit(
      { hospitalId: "h1", featureKey: "icd_suggest", aiOutput: { code: "J45" } },
      "overridden",
      { code: "J45.9" },
    );

    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ user_action: "overridden", override_value: { code: "J45.9" }, user_id: null }));
  });

  it("never throws — an audit-logging failure must not break the caller's AI workflow", async () => {
    mockGetUser.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useAIAudit());
    await expect(
      result.current.logAudit({ hospitalId: "h1", featureKey: "clinical_note", aiOutput: {} }, "rejected"),
    ).resolves.toBeUndefined();
  });
});
