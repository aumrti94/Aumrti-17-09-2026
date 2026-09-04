import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const { mockGetUser, mockFrom } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser: mockGetUser }, from: mockFrom },
}));

import { useDoctorQuickPicks } from "./useDoctorQuickPicks";

function makeChain(resolveValue: any) {
  const p: any = Promise.resolve(resolveValue);
  const self = () => p;
  for (const m of ["select", "eq", "order", "limit", "is", "not", "in", "maybeSingle", "single"]) {
    p[m] = self;
  }
  return p;
}

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  mockGetUser.mockReset();
  mockFrom.mockReset();
  mockGetUser.mockResolvedValue({ data: { user: { id: "auth1" } } });
});

describe("useDoctorQuickPicks", () => {
  it("falls back to the built-in defaults when the doctor has no saved customisation", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return makeChain({ data: { id: "doc1", hospital_id: "h1" } });
      if (table === "doctor_quick_picks") return { select: () => makeChain({ data: null }) };
      throw new Error(`unexpected table ${table}`);
    });

    const { result } = renderHook(() => useDoctorQuickPicks("complaints"), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isCustomized).toBe(false);
    expect(result.current.items.length).toBeGreaterThan(0);
  });

  it("uses the doctor's saved items when a customisation row exists, including an empty list", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return makeChain({ data: { id: "doc1", hospital_id: "h1" } });
      if (table === "doctor_quick_picks") return { select: () => makeChain({ data: { items: [] } }) };
      throw new Error(`unexpected table ${table}`);
    });

    const { result } = renderHook(() => useDoctorQuickPicks("complaints"), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isCustomized).toBe(true);
    expect(result.current.items).toEqual([]);
  });

  it("save() upserts the doctor's items keyed by doctor_id and category", async () => {
    const upsertSpy = vi.fn(() => makeChain({ data: null, error: null }));
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return makeChain({ data: { id: "doc1", hospital_id: "h1" } });
      if (table === "doctor_quick_picks") return { select: () => makeChain({ data: null }), upsert: upsertSpy };
      throw new Error(`unexpected table ${table}`);
    });

    const { result } = renderHook(() => useDoctorQuickPicks("complaints"), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await result.current.save(["Fever", "Cough"]);

    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ doctor_id: "doc1", hospital_id: "h1", category: "complaints", items: ["Fever", "Cough"] }),
      { onConflict: "doctor_id,category" },
    );
  });

  it("reset() deletes the doctor's customisation row for this category", async () => {
    const deleteEqSpy = vi.fn(() => makeChain({ data: null, error: null }));
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return makeChain({ data: { id: "doc1", hospital_id: "h1" } });
      if (table === "doctor_quick_picks") {
        return { select: () => makeChain({ data: { items: ["custom"] } }), delete: () => ({ eq: () => ({ eq: deleteEqSpy }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    });

    const { result } = renderHook(() => useDoctorQuickPicks("complaints"), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await result.current.reset();
    expect(deleteEqSpy).toHaveBeenCalled();
  });
});
