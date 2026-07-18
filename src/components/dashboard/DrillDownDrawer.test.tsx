import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import DrillDownDrawer, { DrillDownConfig } from "./DrillDownDrawer";

const callAI = vi.hoisted(() => vi.fn());
vi.mock("@/lib/aiProvider", () => ({ callAI }));
vi.mock("@/hooks/useAIFeature", () => ({ useAIFeature: () => true }));

const config: DrillDownConfig = {
  type: "opd",
  title: "OPD Today",
  icon: "🏥",
  period: "Today",
  currentValue: "0",
  changeText: "0 waiting · 0 seen",
  changePositive: true,
  aiPrompt: "OPD had 0 patients today. Write 2-sentence insight.",
  reportLink: "/opd",
  reportLabel: "View OPD →",
  hospitalId: "hosp-1",
};

const renderDrawer = (props: Partial<React.ComponentProps<typeof DrillDownDrawer>> = {}) =>
  render(
    <MemoryRouter>
      <DrillDownDrawer open onClose={() => {}} config={config} {...props} />
    </MemoryRouter>
  );

describe("DrillDownDrawer AI insight", () => {
  beforeEach(() => {
    callAI.mockReset();
    callAI.mockResolvedValue({ text: "OPD volume is zero today." });
  });

  it("does not call the AI on open — insights are opt-in", async () => {
    renderDrawer();
    // Give any stray effect a chance to fire before asserting absence.
    await waitFor(() => expect(screen.getByText("Generate AI insight")).toBeInTheDocument());
    expect(callAI).not.toHaveBeenCalled();
  });

  it("shows the plain KPI summary without needing an AI call", () => {
    renderDrawer();
    expect(screen.getByText(/0 — Today\. 0 waiting · 0 seen/)).toBeInTheDocument();
  });

  it("generates the insight only when the button is clicked", async () => {
    renderDrawer();

    fireEvent.click(screen.getByText("Generate AI insight"));

    await waitFor(() => expect(screen.getByText("OPD volume is zero today.")).toBeInTheDocument());
    expect(callAI).toHaveBeenCalledTimes(1);
    expect(callAI).toHaveBeenCalledWith(
      expect.objectContaining({ featureKey: "ai_digest", hospitalId: "hosp-1", prompt: config.aiPrompt })
    );
    // Button is replaced by the insight + a Regenerate affordance.
    expect(screen.queryByText("Generate AI insight")).not.toBeInTheDocument();
    expect(screen.getByText("Regenerate")).toBeInTheDocument();
  });

  it("offers a retry when the AI call fails", async () => {
    callAI.mockResolvedValue({ error: "rate limited" });
    renderDrawer();

    fireEvent.click(screen.getByText("Generate AI insight"));

    await waitFor(() => expect(screen.getByText("Retry AI insight")).toBeInTheDocument());
    expect(screen.getByText(/Couldn't generate an insight/)).toBeInTheDocument();
  });

  it("clears a generated insight when the drawer switches to another KPI", async () => {
    const { rerender } = renderDrawer();

    fireEvent.click(screen.getByText("Generate AI insight"));
    await waitFor(() => expect(screen.getByText("OPD volume is zero today.")).toBeInTheDocument());

    rerender(
      <MemoryRouter>
        <DrillDownDrawer open onClose={() => {}} config={{ ...config, type: "beds", title: "Bed Occupancy" }} />
      </MemoryRouter>
    );

    // Stale insight from the previous KPI must not leak into the new one.
    expect(screen.queryByText("OPD volume is zero today.")).not.toBeInTheDocument();
    expect(screen.getByText("Generate AI insight")).toBeInTheDocument();
  });
});
