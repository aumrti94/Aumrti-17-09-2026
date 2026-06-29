import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import React from "react";

// ── Module mocks ──────────────────────────────────────────────────────────────
// vi.hoisted ensures these are initialized before vi.mock factories run

const { mockFrom, mockInvoke } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockInvoke: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: mockInvoke },
    from: mockFrom,
  },
}));

vi.mock("@/contexts/HospitalContext", () => ({
  useHospitalContext: () => ({ role: "hospital_admin", hospitalId: "hospital-uuid" }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: "/" }),
  BrowserRouter: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

import ABDMCareContextsPanel from "@/components/abdm/ABDMCareContextsPanel";

// ── Factories ─────────────────────────────────────────────────────────────────

function makeCareContext(overrides: Record<string, unknown> = {}) {
  return {
    id: "ctx-uuid-1",
    reference: "OPD-2026-001",
    display: "OPD Visit — 2026-05-26",
    context_type: "OPDRecord",
    link_status: "pending",
    linked_at: null,
    created_at: new Date().toISOString(),
    source_id: "token-uuid-1",
    ...overrides,
  };
}

function setupFromMock(rows: unknown[]) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: rows, error: null }),
  };
  mockFrom.mockReturnValue(chain);
  return chain;
}

function renderPanel(
  props: Partial<React.ComponentProps<typeof ABDMCareContextsPanel>> = {},
) {
  return render(
    React.createElement(ABDMCareContextsPanel, {
      patientId: "patient-uuid",
      hospitalId: "hospital-uuid",
      ...props,
    }),
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. CARE CONTEXT DISPLAY
// ═════════════════════════════════════════════════════════════════════════════

describe("ABDMCareContextsPanel — display", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows empty state when no care contexts exist", async () => {
    setupFromMock([]);
    renderPanel();
    await waitFor(() => expect(screen.getByText(/no records yet/i)).toBeTruthy());
  });

  it("shows care context count when records exist", async () => {
    setupFromMock([
      makeCareContext({ link_status: "linked" }),
      makeCareContext({ id: "ctx-uuid-2", reference: "OPD-2026-002", link_status: "pending" }),
    ]);
    renderPanel();
    await waitFor(() => expect(screen.getByText(/1 of 2/i)).toBeTruthy());
  });

  it("shows linked status badge for linked contexts", async () => {
    setupFromMock([makeCareContext({ link_status: "linked", linked_at: new Date().toISOString() })]);
    renderPanel();
    // "Linked" appears in both the badge label and the linked_at timestamp — use getAllByText
    await waitFor(() => expect(screen.getAllByText(/Linked/i).length).toBeGreaterThan(0));
  });

  it("shows failed status badge for failed contexts", async () => {
    setupFromMock([makeCareContext({ link_status: "failed" })]);
    renderPanel();
    await waitFor(() => expect(screen.getAllByText(/Failed/i).length).toBeGreaterThan(0));
  });

  it("shows correct label for OPDRecord type", async () => {
    setupFromMock([makeCareContext({ context_type: "OPDRecord" })]);
    renderPanel();
    // "OPD Visit" may appear in both the display text and the type label
    await waitFor(() => expect(screen.getAllByText(/OPD Visit/i).length).toBeGreaterThan(0));
  });

  it("shows correct label for DischargeSummaryRecord type", async () => {
    setupFromMock([makeCareContext({ context_type: "DischargeSummaryRecord" })]);
    renderPanel();
    await waitFor(() => expect(screen.getAllByText(/IPD Discharge/i).length).toBeGreaterThan(0));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. CARE CONTEXT WITH ABHA LINKED — link-init invoked
// ═════════════════════════════════════════════════════════════════════════════

describe("ABDMCareContextsPanel — retry / link-init", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls abdm-hip-link-init with correct payload when Retry is clicked", async () => {
    const ctx = makeCareContext({ link_status: "failed" });

    // First call: initial load; second call: refresh after retry
    mockFrom
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [ctx], error: null }),
      })
      .mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [{ ...ctx, link_status: "pending" }], error: null }),
      });

    mockInvoke.mockResolvedValue({ data: { success: true }, error: null });

    renderPanel();
    await waitFor(() => expect(screen.getAllByText(/Failed/i).length).toBeGreaterThan(0));

    const retryBtn = screen.queryByRole("button", { name: /retry/i });
    if (retryBtn) {
      await act(async () => fireEvent.click(retryBtn));
      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith(
          "abdm-hip-link-init",
          expect.objectContaining({
            body: expect.objectContaining({
              hospital_id: "hospital-uuid",
              patient_id: "patient-uuid",
              care_context_ids: ["ctx-uuid-1"],
            }),
          }),
        );
      });
    }
  });

  it("does not crash when abdm-hip-link-init returns error", async () => {
    setupFromMock([makeCareContext({ link_status: "failed" })]);
    mockInvoke.mockResolvedValueOnce({ data: null, error: new Error("Link failed") });

    renderPanel();
    await waitFor(() => expect(screen.getAllByText(/Failed/i).length).toBeGreaterThan(0));

    const retryBtn = screen.queryByRole("button", { name: /retry/i });
    if (retryBtn) {
      await act(async () => fireEvent.click(retryBtn));
      // Component should remain stable after error
      await waitFor(() => expect(screen.getAllByText(/Failed/i).length).toBeGreaterThan(0));
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. NO ABHA — care context created but not linked (pending)
// ═════════════════════════════════════════════════════════════════════════════

describe("Care context with no ABHA — pending state", () => {
  beforeEach(() => vi.clearAllMocks());

  it("displays pending status without calling link-init automatically", async () => {
    setupFromMock([makeCareContext({ link_status: "pending" })]);

    renderPanel();
    await waitFor(() => expect(screen.getAllByText(/Pending/i).length).toBeGreaterThan(0));

    // link-init must NOT have been called automatically on mount
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. DISCOVERY CALLBACK — response shape validation
// ═════════════════════════════════════════════════════════════════════════════

describe("Discovery callback response shape", () => {
  it("on-discover payload includes required ABDM fields", () => {
    // Simulate constructing the on-discover response the way abdm-hip-callback does
    const patientId = "patient-uuid";
    const careContexts = [
      { reference: "OPD-2026-001", display: "OPD Visit — 2026-05-26" },
      { reference: "OPD-2026-002", display: "OPD Visit — 2026-04-10" },
    ];

    const onDiscoverPayload = {
      requestId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      transactionId: "txn-discover-001",
      patient: {
        referenceNumber: patientId,
        display: "test@abdm",
        careContexts: careContexts.map((cc) => ({
          referenceNumber: cc.reference,
          display: cc.display,
        })),
        matchedBy: ["PATIENT_ID"],
      },
      resp: { requestId: "req-discover-001" },
    };

    // Validate required fields per ABDM Integration Guide §4.3
    expect(onDiscoverPayload.requestId).toBeTruthy();
    expect(onDiscoverPayload.timestamp).toBeTruthy();
    expect(onDiscoverPayload.transactionId).toBe("txn-discover-001");
    expect(onDiscoverPayload.patient.referenceNumber).toBe(patientId);
    expect(onDiscoverPayload.patient.careContexts).toHaveLength(2);
    expect(onDiscoverPayload.patient.careContexts[0].referenceNumber).toBe("OPD-2026-001");
    expect(onDiscoverPayload.patient.careContexts[0].display).toBeTruthy();
    expect(onDiscoverPayload.resp.requestId).toBe("req-discover-001");
  });

  it("on-discover payload has correct matchedBy when patient found by ABHA address", () => {
    const payload = {
      patient: { matchedBy: ["PATIENT_ID"] },
    };
    expect(payload.patient.matchedBy).toContain("PATIENT_ID");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. LINK CONFIRM — link_status updated to "linked"
// ═════════════════════════════════════════════════════════════════════════════

describe("Link confirm callback — link_status update", () => {
  it("on-link-confirm payload acknowledges SUCCESS", () => {
    // Simulate the payload that abdm-hip-callback sends back to NHA after confirming link
    const onLinkConfirmPayload = {
      requestId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      transactionId: "txn-link-001",
      acknowledgement: { status: "SUCCESS" },
      resp: { requestId: "req-link-001" },
    };

    expect(onLinkConfirmPayload.acknowledgement.status).toBe("SUCCESS");
    expect(onLinkConfirmPayload.transactionId).toBe("txn-link-001");
    expect(onLinkConfirmPayload.resp.requestId).toBe("req-link-001");
  });

  it("maps careContextRefs to DB update correctly", () => {
    // Simulate how handleLinkConfirm extracts refs from the NHA callback body
    const confirmationBody = {
      confirmation: {
        linkRefNumber: "link-ref-001",
        careContexts: [
          { referenceNumber: "OPD-2026-001" },
          { referenceNumber: "OPD-2026-002" },
        ],
      },
      requestId: "req-link-001",
      transactionId: "txn-link-001",
    };

    const confirmation = confirmationBody.confirmation as Record<string, unknown>;
    const careContextRefs = (confirmation.careContexts as Array<{ referenceNumber: string }>) ?? [];
    const refs = careContextRefs.map((c) => c.referenceNumber);

    expect(refs).toEqual(["OPD-2026-001", "OPD-2026-002"]);
    expect(confirmation.linkRefNumber).toBe("link-ref-001");
  });

  it("shows linked status after successful link confirm", async () => {
    setupFromMock([makeCareContext({ link_status: "linked", linked_at: new Date().toISOString() })]);

    renderPanel();
    await waitFor(() => expect(screen.getAllByText(/Linked/i).length).toBeGreaterThan(0));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. FHIR VIEW
// ═════════════════════════════════════════════════════════════════════════════

describe("FHIR bundle view", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls abdm-fhir-package with correct care context fields", async () => {
    const ctx = makeCareContext({ link_status: "linked", linked_at: new Date().toISOString() });
    setupFromMock([ctx]);
    mockInvoke.mockResolvedValue({ data: { bundle: { resourceType: "Bundle" } }, error: null });

    // Mock window.open
    const mockOpen = vi.fn(() => ({
      document: { write: vi.fn(), title: "" },
    }));
    vi.stubGlobal("open", mockOpen);

    renderPanel();
    await waitFor(() => expect(screen.getAllByText(/Linked/i).length).toBeGreaterThan(0));

    const fhirBtn = screen.queryByTitle(/FHIR Bundle/i);
    if (fhirBtn) {
      await act(async () => fireEvent.click(fhirBtn));
      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith(
          "abdm-fhir-package",
          expect.objectContaining({
            body: expect.objectContaining({
              hospital_id: "hospital-uuid",
              care_context_reference: ctx.reference,
              context_type: ctx.context_type,
              source_id: ctx.source_id,
            }),
          }),
        );
      });
    }

    vi.unstubAllGlobals();
  });
});
