/**
 * Mount test for WalkInModal.
 *
 * WHY THIS EXISTS. A ReferenceError from this module ("NO_EPISODE is not defined" — an
 * identifier used but never imported) reached a user in the browser after passing every
 * check the repo had:
 *   • `vite build` succeeds — esbuild does not type-check, and a bare identifier is valid
 *     JS syntax that only fails at runtime.
 *   • `eslint` is silent — typescript-eslint disables `no-undef` on the assumption that the
 *     compiler covers it.
 *   • `tsc --noEmit -p tsconfig.json` succeeds — that config declares `"files": []` with
 *     project references, so it compiles NOTHING. The real project is tsconfig.app.json.
 *
 * Nothing but executing the component catches this class of bug, and the e2e suite cannot
 * (it needs a live Supabase session). So: mount the component with Supabase stubbed, let the
 * effects run, and fail on any error.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render as rtlRender, screen, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// The modal renders a <Link> (the ABHA panel), so it needs a router in context.
const render = (ui: React.ReactElement) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);

// A chainable PostgREST double. Every filter returns `this`, and awaiting resolves to an
// empty result — enough for the rate ladder, the episode lookup and the settings reads to
// run their real code paths and fall through to their defaults.
function queryStub(rows: unknown[] = []) {
  const result = { data: rows, error: null, count: rows.length };
  const chain: Record<string, unknown> = {};
  const passthrough = [
    "select", "eq", "neq", "is", "in", "not", "gte", "lte", "gt", "lt",
    "or", "ilike", "like", "order", "limit", "range",
  ];
  for (const m of passthrough) chain[m] = vi.fn(() => chain);
  chain.single = vi.fn(async () => result);
  chain.maybeSingle = vi.fn(async () => result);
  chain.insert = vi.fn(() => chain);
  chain.update = vi.fn(() => chain);
  chain.delete = vi.fn(() => chain);
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
  return chain;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => queryStub()),
    rpc: vi.fn(async () => ({ data: null, error: null })),
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "auth-1" } } })) },
  },
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import WalkInModal from "./WalkInModal";

const HOSPITAL = "11111111-1111-1111-1111-111111111111";

describe("WalkInModal mounts and runs its effects", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  const captured: unknown[][] = [];

  beforeEach(() => {
    captured.length = 0;
    // React reports an error thrown inside an effect through console.error rather than
    // rejecting, so this is what turns a silent ReferenceError into a test failure.
    errorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      captured.push(args);
    });
  });

  afterEach(() => {
    errorSpy.mockRestore();
    cleanup();
  });

  function assertNoRuntimeError() {
    const fatal = captured
      .map(a => a.map(x => (x instanceof Error ? x.message : String(x))).join(" "))
      .filter(m => /is not defined|is not a function|Cannot read propert/i.test(m));
    expect(fatal, `Runtime error inside WalkInModal:\n${fatal.join("\n")}`).toEqual([]);
  }

  it("renders in walk-in mode without a runtime error", async () => {
    render(<WalkInModal hospitalId={HOSPITAL} onClose={() => {}} onCreated={() => {}} />);
    await waitFor(() => expect(screen.getByRole("heading", { name: /quick registration/i })).toBeTruthy());
    await new Promise(r => setTimeout(r, 50));
    assertNoRuntimeError();
  });

  it("renders in appointment mode without a runtime error", async () => {
    render(
      <WalkInModal
        hospitalId={HOSPITAL}
        mode="appointment"
        appointmentSlot={{
          id: "slot-1",
          doctor_id: "22222222-2222-2222-2222-222222222222",
          slot_date: "2026-08-18",
          slot_time: "15:30",
          slot_duration_mins: 15,
          slot_type: "opd",
        }}
        appointmentDoctorName="Suresh Menon"
        onClose={() => {}}
        onCreated={() => {}}
      />
    );
    await waitFor(() => expect(screen.getByRole("heading", { name: /book appointment/i })).toBeTruthy());
    await new Promise(r => setTimeout(r, 50));
    assertNoRuntimeError();
  });

  it("renders in check-in mode — the path that jumps straight to payment — without a runtime error", async () => {
    render(
      <WalkInModal
        hospitalId={HOSPITAL}
        mode="checkin"
        checkinAppointment={{
          id: "appt-1",
          patient_id: "33333333-3333-3333-3333-333333333333",
          patient_name: "Krishnamurthy Iyer",
          uhid: "PT-QA-0010",
          phone: "9876500010",
          doctor_id: "22222222-2222-2222-2222-222222222222",
          department_id: "44444444-4444-4444-4444-444444444444",
          consultation_fee: 700,
          visit_type: "new",
          visit_purpose: "new",
        }}
        onClose={() => {}}
        onCreated={() => {}}
      />
    );
    // This mode goes straight to the payment step, which is where the fee engine renders.
    await waitFor(() => expect(screen.getAllByText(/consultation fee/i).length).toBeGreaterThan(0));
    await new Promise(r => setTimeout(r, 50));
    assertNoRuntimeError();
  });

  it("keeps the check-in patient's name on screen", async () => {
    // Regression: the seeding effect set foundPatient, then the search effect ran in the same
    // commit still holding the mount-render `useExisting === false` and called
    // searchPatient(""), which does setFoundPatient(null) — blanking the name on the payment
    // screen and printing "—" on the receipt.
    render(
      <WalkInModal
        hospitalId={HOSPITAL}
        mode="checkin"
        checkinAppointment={{
          id: "appt-1",
          patient_id: "33333333-3333-3333-3333-333333333333",
          patient_name: "Krishnamurthy Iyer",
          uhid: "PT-QA-0010",
          phone: "9876500010",
          doctor_id: "22222222-2222-2222-2222-222222222222",
          department_id: "44444444-4444-4444-4444-444444444444",
          consultation_fee: 700,
          visit_type: "new",
          visit_purpose: "new",
        }}
        onClose={() => {}}
        onCreated={() => {}}
      />
    );
    await waitFor(() => expect(screen.getAllByText(/consultation fee/i).length).toBeGreaterThan(0));
    await new Promise(r => setTimeout(r, 50));
    expect(
      screen.getAllByText(/Krishnamurthy Iyer/).length,
      "The check-in patient's name was wiped from the payment screen.",
    ).toBeGreaterThan(0);
  });
});
